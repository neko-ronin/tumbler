/** Engine-neutral recreational flight. World axes X east, Y north, Z up.
 * The client supplies a height sampler and input, never invents lift regions.
 * Integrate at a fixed 1/120 s step; all speeds are wind-relative metres/sec.
 */
export function launchFlight(config, mode, site, height) {
  if(config.version!==1)throw new Error(`Unsupported flight rules version: ${config.version}`);
  if (!config.modes[mode]) throw new Error(`Unknown flight activity: ${mode}`);
  const [x,y] = site.xy_m;
  return {mode,x,y,z:height(x,y)+(config.launch_clearance_m??18),heading:site.heading_deg*Math.PI/180,speed:config.modes[mode].trim_mps,
    vertical:0,vario:0,bank:0,pitch:0,throttle:mode==='paramotor'?.55:0,grounded:false,anchor:[x,y,height(x,y)+1],distance:0};
}
export function sampleAir(config, windBearing, state, time, height) {
  const bearing=windBearing*Math.PI/180;
  const gust=config.wind.gust_mps*(Math.sin(time*.31)+.35*Math.sin(time*1.7));
  const speed=config.wind.speed_mps+gust;
  const wx=-Math.sin(bearing)*speed, wy=-Math.cos(bearing)*speed;
  let lift=0;
  for(const thermal of config.thermals){
    const r=Math.hypot(state.x-thermal.xy_m[0],state.y-thermal.xy_m[1])/thermal.radius_m;
    if(state.z<thermal.top_m) lift+=thermal.lift_mps*Math.exp(-r*r*2)*(1-Math.max(0,state.z-thermal.top_m+150)/150);
  }
  const ground=height(state.x,state.y), agl=state.z-ground;
  const gx=(height(state.x+12,state.y)-height(state.x-12,state.y))/24;
  const gy=(height(state.x,state.y+12)-height(state.x,state.y-12))/24;
  lift+=Math.max(0,wx*gx+wy*gy)*Math.exp(-Math.max(0,agl)/180)*.75;
  return {wx,wy,lift,agl};
}
export function stepFlight(state,input,dt,time,config,windBearing,height,hitTest=null) {
  const s={...state}; const mode=config.modes[s.mode];
  if(s.grounded)return s;
  const air=sampleAir(config,windBearing,s,time,height);
  const turn=Math.max(-1,Math.min(1,input.turn||0));
  const brake=Math.max(-1,Math.min(1,input.brake||0));
  s.throttle=Math.max(0,Math.min(1,s.throttle+(input.throttle||0)*dt*.4));
  const targetSpeed=mode.trim_mps*(1-brake*(s.mode==='parakite'?.43:.25));
  const previousSpeed=s.speed;
  s.speed+=(targetSpeed-s.speed)*Math.min(1,dt*1.8);
  s.heading-=turn*mode.turn_rps*dt;
  s.bank+=(turn*.55-s.bank)*Math.min(1,dt*3);
  s.pitch+=(brake*(s.mode==='parakite'?.42:.12)-s.pitch)*Math.min(1,dt*3);
  // Flare trades kinetic energy for height; a dive pays that height back.
  const flareHeight=(previousSpeed*previousSpeed-s.speed*s.speed)/(2*9.81)*(mode.flare_efficiency??0);
  const sink=mode.sink_mps*(1+turn*turn*.5+Math.max(0,-brake)*.25);
  let climb=air.lift-sink+mode.powered_climb_mps*s.throttle;
  if(mode.tether_m>0)climb+=Math.max(0,config.wind.speed_mps-2)*.85;
  s.vertical+=(climb-s.vertical)*Math.min(1,dt*1.7);
  const dx=(Math.cos(s.heading)*s.speed+air.wx)*dt;
  const dy=(Math.sin(s.heading)*s.speed+air.wy)*dt;
  s.x+=dx;s.y+=dy;s.z+=s.vertical*dt+flareHeight;s.distance+=Math.hypot(dx,dy);
  if(mode.tether_m>0){
    const [ax,ay,az]=s.anchor;const length=Math.hypot(s.x-ax,s.y-ay,s.z-az);
    if(length>mode.tether_m){const k=mode.tether_m/length;s.x=ax+(s.x-ax)*k;s.y=ay+(s.y-ay)*k;s.z=az+(s.z-az)*k;}
  }
  s.x=Math.max(-config.world_limit_m,Math.min(config.world_limit_m,s.x));
  s.y=Math.max(-config.world_limit_m,Math.min(config.world_limit_m,s.y));
  s.z=Math.min(config.ceiling_m,s.z);
  s.vario=s.vertical+flareHeight/dt;
  const hit=hitTest?.([state.x,state.y,state.z],[s.x,s.y,s.z],.45);
  if(hit){s.x=state.x;s.y=state.y;s.z=state.z;s.impact=hit.kind;s.grounded=true;s.vertical=s.vario=s.speed=0;return s;}
  const floor=height(s.x,s.y)+config.landing_clearance_m;
  if(s.z<=floor){s.z=floor;s.grounded=true;s.vertical=0;s.vario=0;s.speed=0;}
  return s;
}

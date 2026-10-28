/** Engine-neutral recreational flight. X east, Y north, Z up; SI units.
 * Fixed 1/120 s integration. Manuals and intentional approximations:
 * docs/design/FLIGHT-MANUALS.md. This is not a flight-training model.
 */
import {knockDirection} from './collision.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const approach=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
const wave=(x,y,z,t)=>Math.sin(x*.013+y*.009+t*.73+z*.005)*.55+Math.sin(x*.043-y*.031-t*1.87)*.3+Math.sin(y*.11+z*.07+t*3.1)*.15;

export function launchFlight(config,mode,site,height,weather='soaring') {
  if(config.version!==3)throw new Error(`Unsupported flight rules version: ${config.version}`);
  if(!config.modes[mode])throw new Error(`Unknown flight activity: ${mode}`);
  const [x,y]=site.xy_m;
  return {mode,weather,x,y,z:height(x,y)+(site.clearance_m??config.launch_clearance_m??18),
    heading:site.heading_deg*Math.PI/180,speed:config.modes[mode].trim_mps,vertical:0,vario:0,
    bank:0,rollRate:0,pitch:0,pitchRate:0,brakeLeft:0,brakeRight:0,accelerator:0,
    handleLeft:mode==='parakite'?.45:0,handleRight:mode==='parakite'?.45:0,
    throttle:mode==='paramotor'?.55:0,engine:mode==='paramotor'?.55:0,
    load:1,pressure:1,stall:0,turbulence:0,groundSpeed:0,grounded:false,distance:0,
    maneuver:0,turnMemory:0,reversals:0,groundEffect:0,figure:'Trim glide'};
}

/** Continuous advected air field: height shear, thermals with return sink,
 * signed orographic lift and lee rotor. No frame-dependent random impulses.
 */
export function sampleAir(config,windBearing,state,time,height) {
  const weather=config.weather?.[state.weather??'soaring']??{wind_scale:1,gust_scale:1,thermal_scale:1,turbulence_mps:.35};
  const bearing=windBearing*Math.PI/180,ux=-Math.sin(bearing),uy=-Math.cos(bearing);
  const ground=height(state.x,state.y),agl=Math.max(0,state.z-ground);
  const wind=config.wind.speed_mps*weather.wind_scale;
  const shear=.65+.35*clamp(Math.log1p(agl/8)/Math.log(51));
  const advX=state.x-ux*wind*time,advY=state.y-uy*wind*time;
  const gust=config.wind.gust_mps*weather.gust_scale*wave(advX,advY,state.z,time*.35);
  const speed=Math.max(0,wind*shear+gust);
  const gx=(height(state.x+12,state.y)-height(state.x-12,state.y))/24;
  const gy=(height(state.x,state.y+12)-height(state.x,state.y-12))/24;
  const slope=ux*gx+uy*gy;
  const terrainFade=Math.exp(-agl/180);
  const upwindGround=height(state.x-ux*160,state.y-uy*160);
  const lee=clamp((upwindGround-ground)/100)*terrainFade;
  const ridge=clamp(speed*slope*.65,-5,6)*terrainFade;
  let thermalLift=0;
  for(const thermal of config.thermals) {
    const base=height(...thermal.xy_m),rise=Math.max(0,state.z-base);
    const top=clamp((thermal.top_m-state.z)/150);
    const radius=thermal.radius_m*(.65+.35*clamp(rise/800));
    const drift=rise*.16*clamp(wind/4.2,0,2);
    const r=Math.hypot(state.x-thermal.xy_m[0]-ux*drift,state.y-thermal.xy_m[1]-uy*drift)/radius;
    thermalLift+=thermal.lift_mps*(Math.exp(-2*r*r)-.17*Math.exp(-.45*r*r))*top*weather.thermal_scale;
  }
  const intensity=weather.turbulence_mps*(.35+.65*terrainFade)+lee*speed*.22*weather.gust_scale;
  const lateral=wave(advY,advX,state.z+47,time+13)*intensity;
  const turbulence=wave(advX+73,advY-28,state.z,time+31)*intensity;
  return {wx:ux*speed-uy*lateral,wy:uy*speed+ux*lateral,
    lift:ridge+thermalLift-lee*speed*.18+turbulence,
    agl,gust,turbulence,intensity,lee,ridge,thermal:thermalLift,windSpeed:speed};
}

/** The canopy as a capsule from wingtip to wingtip (docs/design/COLLISION.md):
 * canopy_height_m above the feet along the pilot's banked up, span_m long,
 * chord_m / 2 thick. The lines below it are not tested.
 */
export function canopySegment(state,config){
  const mode=config.modes[state.mode],h=state.heading??0,b=state.bank??0,right=[Math.sin(h),-Math.cos(h)];
  const up=[right[0]*Math.sin(b),right[1]*Math.sin(b),Math.cos(b)],axis=[right[0]*Math.cos(b),right[1]*Math.cos(b),-Math.sin(b)];
  const centre=[state.x+up[0]*mode.canopy_height_m,state.y+up[1]*mode.canopy_height_m,state.z-config.landing_clearance_m+up[2]*mode.canopy_height_m];
  const half=mode.span_m/2;
  return {a:centre.map((v,i)=>v-axis[i]*half),b:centre.map((v,i)=>v+axis[i]*half),radius:mode.chord_m/2};
}

/** Whether any of a canopy, sampled every metre along it, is in foliage or touches a solid. */
export function canopyTouches(segment,hitTest){
  const d=segment.b.map((v,i)=>v-segment.a[i]),n=Math.max(1,Math.ceil(Math.hypot(...d)));
  for(let k=0;k<=n;k++){
    const p=segment.a.map((v,i)=>v+d[i]*k/n);
    if(hitTest.soft?.(p,segment.radius)?.length||hitTest(p,p,segment.radius))return true;
  }
  return false;
}

const BODY=.45,G=9.81;

/** The pilot's body against a solid between `prev` and `s`: keep the speed along the
 * surface and send back `restitution` of the speed into it. A trunk or mesh pushes
 * him out of itself where he ended, so he slides on (falling past a trunk's top or
 * flare included); an untyped box puts him back where he was free; a body three
 * pushes cannot clear goes on through, since clipping is better than hanging in the
 * air. A surface facing up (a roof) also pushes him off sideways, so he falls to the ground.
 */
function bounce(prev,s,v,c,hitTest){
  const hit=hitTest([prev.x,prev.y,prev.z],[s.x,s.y,s.z],BODY);
  if(!hit)return false;
  const speed=Math.hypot(...v),contact=hitTest.contact?.([s.x,s.y,s.z],BODY);
  const n=contact?.normal??(speed>1e-9?v.map(x=>-x/speed):[0,0,1]),into=v[0]*n[0]+v[1]*n[1]+v[2]*n[2];
  if(into<0)for(let i=0;i<3;i++)v[i]-=(1+c.restitution)*into*n[i];
  if(n[2]>.7){
    const l=Math.hypot(n[0],n[1]),mid=[(hit.min[0]+hit.max[0])/2,(hit.min[1]+hit.max[1])/2];
    let [ux,uy]=l>.05?[n[0]/l,n[1]/l]:[prev.x-mid[0],prev.y-mid[1]];const m=Math.hypot(ux,uy)||1;
    const out=Math.max(2,Math.hypot(v[0],v[1]));v[0]=ux/m*out;v[1]=uy/m*out;
  }
  const out=hitTest.pushOut?.([[s.x,s.y,s.z]],BODY);
  if(out?.offset){s.x+=out.offset[0];s.y+=out.offset[1];s.z+=out.offset[2];}
  else if(!out){s.x=prev.x;s.y=prev.y;s.z=prev.z;}
  return true;
}

/** Foliage at the body: drag on every component, and a knock on each crown newly entered. */
function brush(s,v,dt,c,hitTest){
  const inside=hitTest?.soft?.([s.x,s.y,s.z],BODY)??[],before=s.foliage??[];
  if(inside.length){const d=Math.exp(-c.foliage_drag_per_s*dt);for(let i=0;i<3;i++)v[i]*=d;}
  for(const {shape} of inside)if(!before.includes(shape.id)){
    const speed=Math.hypot(...v),[ux,uy]=knockDirection(shape,[s.x,s.y,s.z]);
    v[0]+=ux*c.knock*speed;v[1]+=uy*c.knock*speed;s.knock=Math.max(s.knock??0,c.knock*speed);
  }
  s.foliage=inside.map(({shape})=>shape.id);
  s.knock=(s.knock??0)*Math.exp(-4*dt);
  return inside.length>0;
}

/** The touchdown of a collapsed fall: he lies where he lands, wing and all. */
function settle(s,v,config,height){
  const floor=height(s.x,s.y)+config.landing_clearance_m;
  if(s.z>floor)return;
  s.z=floor;s.grounded=true;s.landingSpeed=Math.max(0,-v[2]);v[0]=v[1]=v[2]=0;
}

const publish=(s,v)=>{
  s.vx=v[0];s.vy=v[1];s.vertical=s.vario=v[2];s.speed=Math.hypot(v[0],v[1]);
  if(s.speed>.5)s.heading=Math.atan2(v[1],v[0]);
  s.figure=s.grounded?'Wing collapsed · unhook or relaunch':'Wing collapsed';
  return s;
};

/** A collapsed wing gives no lift: he falls toward terminal_mps under linear drag,
 * integrated exactly so the outcome does not depend on the step size.
 */
function stepCollapsed(state,dt,config,height,hitTest){
  const s={...state},c=config.collapse,k=G/c.terminal_mps,e=Math.exp(-k*dt),vt=-c.terminal_mps;
  const v=[s.vx??0,s.vy??0,s.vertical??0],prev={x:s.x,y:s.y,z:s.z};
  s.x+=v[0]*(1-e)/k;s.y+=v[1]*(1-e)/k;s.z+=vt*dt+(v[2]-vt)*(1-e)/k;
  v[0]*=e;v[1]*=e;v[2]=vt+(v[2]-vt)*e;
  if(hitTest)bounce(prev,s,v,c,hitTest);
  brush(s,v,dt,c,hitTest);
  settle(s,v,config,height);
  return publish(s,v);
}

export function stepFlight(state,input,dt,time,config,windBearing,height,hitTest=null) {
  if(!(dt>0)||!Number.isFinite(dt))return {...state};
  const s={...state},mode=config.modes[s.mode];
  if(s.grounded)return s;
  if(config.collapse&&s.collapsed)return stepCollapsed(s,dt,config,height,hitTest);
  const air=sampleAir(config,windBearing,s,time,height);
  const control=clamp(input.brake||0,-1,1);
  let left=clamp((input.brakeLeft||0)+Math.max(0,control));
  let right=clamp((input.brakeRight||0)+Math.max(0,control));
  const steer=clamp(input.turn||0,-1,1);
  let turn=clamp(steer+(right-left)*.8,-1,1),release=0;
  if(s.mode==='parakite'){
    // Neutral is the best-glide flag. Forward stick releases both handles;
    // weight shift releases the outside one, changing whole-wing incidence.
    const neutral=.45+control*(control>0?.55:.45);
    const targetLeft=clamp(neutral+(input.brakeLeft||0)*.55-Math.max(0,steer)*.4);
    const targetRight=clamp(neutral+(input.brakeRight||0)*.55-Math.max(0,-steer)*.4);
    // One actual handle state drives both incidence and flight response.
    // At full release no outside travel remains: weight shift still rolls,
    // without secretly pulling the inside handle for the player.
    s.handleLeft=approach(s.handleLeft??.45,targetLeft,5,dt);
    s.handleRight=approach(s.handleRight??.45,targetRight,5,dt);
    turn=clamp(steer*.5+(s.handleRight-s.handleLeft)*1.5,-1,1);
    release=clamp((.45-(s.handleLeft+s.handleRight)*.5)/.45);
    left=clamp((s.handleLeft-.45)/.55);right=clamp((s.handleRight-.45)/.55);
    s.brakeLeft=left;s.brakeRight=right;
  }else{
    // Assisted coordinated steering: weight shift plus modest inside brake.
    // Explicit independent brakes still steer; steering assistance does not
    // count twice toward turn demand. These amplitudes are game tuning.
    left=clamp(left+Math.max(0,-steer)*.35);right=clamp(right+Math.max(0,steer)*.35);
    s.brakeLeft=approach(s.brakeLeft??0,left,5,dt);s.brakeRight=approach(s.brakeRight??0,right,5,dt);
    s.handleLeft=s.brakeLeft;s.handleRight=s.brakeRight;
  }
  const brake=(s.brakeLeft+s.brakeRight)*.5;
  // An assisted interlock releases the ordinary speedbar when braking.
  const accelerator=brake>.08?0:clamp(Math.max(0,-control,input.accelerator||0));
  s.accelerator=approach(s.accelerator??0,s.mode==='parakite'?release:accelerator,4,dt);
  s.throttle=s.mode==='paramotor'?clamp(s.throttle+(input.throttle||0)*dt*.4):0;
  s.engine=approach(s.engine??s.throttle,s.throttle,1.8,dt);
  // Hold maneuver for greater weight-shift authority and a less damped roll.
  // Alternating turns carry roll through the centre; release progressively
  // damps the pendulum. No scripted rotation, impulse or energy award.
  s.maneuver=approach(s.maneuver??0,input.maneuver?1:0,4,dt);
  const bankLimit=mode.max_bank_rad+(mode.maneuver_bank_rad-mode.max_bank_rad)*s.maneuver;
  const targetBank=turn*bankLimit+(s.mode==='paramotor'?s.engine*.045:0)+clamp(air.turbulence*.035,-.12,.12);
  s.rollRate=(s.rollRate+(targetBank-s.bank)*12*dt)*Math.exp(-(5.8+(mode.roll_damping-5.8)*s.maneuver)*dt);
  s.bank=clamp(s.bank+s.rollRate*dt,-mode.maneuver_bank_rad,mode.maneuver_bank_rad);
  s.load=1/Math.max(.25,Math.cos(s.bank));
  s.heading-=clamp(9.81*Math.tan(s.bank)/Math.max(5,s.speed),-mode.turn_rps,mode.turn_rps)*dt;
  const trim=mode.trim_mps;
  const targetSpeed=trim*(1-brake*mode.brake_fraction+s.accelerator*mode.accelerator_fraction)*Math.sqrt(s.load);
  const previousSpeed=s.speed;
  const response=targetSpeed>s.speed?mode.dive_response:brake>.08?mode.recovery_response:mode.speed_response*.32;
  s.speed=approach(s.speed,Math.max(trim*.48,targetSpeed),response,dt);
  s.stall=clamp((brake-.82)/.18)*clamp((trim*.8-s.speed)/(trim*.3));
  const ratio=s.speed/trim;
  // Canopy clearance, not pilot clearance. A nearby broad, level surface
  // reduces only induced loss; it cannot add lift, arrest a dive or hold height.
  // Bank/stall/steep terrain suppress this deliberately modest approximation.
  const canopyAgl=air.agl-config.landing_clearance_m+mode.canopy_height_m;
  const gx=(height(s.x+mode.span_m*.5,s.y)-height(s.x-mode.span_m*.5,s.y))/mode.span_m;
  const gy=(height(s.x,s.y+mode.span_m*.5)-height(s.x,s.y-mode.span_m*.5))/mode.span_m;
  s.groundEffect=clamp(1-canopyAgl/(mode.span_m*.7))**2*clamp(1-Math.hypot(gx,gy)*2)*clamp(1-Math.abs(s.bank)/.7)*(1-s.stall);
  const polar=(1+mode.polar_drag*(ratio-.88)**2)/(1+mode.polar_drag*.12**2);
  const sink=mode.sink_mps*Math.pow(s.load,1.5)*polar*(.45+.55*(1-mode.ground_drag_relief*s.groundEffect))+s.stall*6;
  // Increasing kinetic energy is paid for in full. Braking returns only a
  // fraction: repeating dive/flare cycles cannot create free energy.
  const kineticHeight=(previousSpeed**2-s.speed**2)/(2*9.81);
  const exchange=kineticHeight*(kineticHeight>0?mode.flare_efficiency:1);
  const climb=air.lift-sink+mode.powered_climb_mps*s.engine;
  s.vertical=approach(s.vertical,climb,2,dt);
  s.vario=s.vertical+exchange/dt;
  // Pitch now follows the paid trajectory, making the dive and climbing arc
  // visible, with an additional small brake/pressure incidence response.
  const targetPitch=clamp(Math.atan2(s.vario,Math.max(5,s.speed))*.8+brake*.12,-.75,.65);
  s.pitchRate=(s.pitchRate+(targetPitch-s.pitch)*12*dt)*Math.exp(-5*dt);
  s.pitch+=s.pitchRate*dt;
  s.pressure=approach(s.pressure,clamp(1-s.stall*.45-Math.abs(air.turbulence)*.05,.45,1.15),4,dt);
  s.turbulence=air.turbulence;
  if(Math.abs(turn)>.45&&Math.sign(turn)!==Math.sign(s.turnMemory||turn))s.reversals=(s.reversals??0)+1;
  if(Math.abs(turn)>.45)s.turnMemory=turn;
  if(s.maneuver<.1)s.reversals=0;
  s.figure=s.stall>.15?'Low energy · ease handles':s.vario>1&&exchange/dt>1&&s.speed>trim*.8?'Swoop · climbing':
    s.mode==='paramotor'&&s.engine>.1&&s.vertical>.2?'Powered climb':
    s.accelerator>.65?'Dive · storing speed':s.maneuver>.5&&Math.abs(s.bank)>.72?
    ((s.reversals??0)>0?'Wingover':'Spiral · release to recover'):Math.abs(turn)<.1&&Math.abs(s.bank)>.08&&s.maneuver<.3?'Recovering':
    Math.abs(s.bank)>.3?'Dynamic S-turn':s.groundEffect>.02?'Ground skim · reduced drag':'Trim glide';
  const dx=(Math.cos(s.heading)*s.speed+air.wx)*dt,dy=(Math.sin(s.heading)*s.speed+air.wy)*dt;
  s.x+=dx;s.y+=dy;s.z+=s.vertical*dt+exchange;s.groundSpeed=Math.hypot(dx,dy)/dt;s.distance+=Math.hypot(dx,dy);
  s.x=clamp(s.x,-config.world_limit_m,config.world_limit_m);s.y=clamp(s.y,-config.world_limit_m,config.world_limit_m);
  s.z=Math.min(config.ceiling_m,s.z);
  if(config.collapse&&hitTest){
    // A canopy touching foliage or a solid collapses, and so does any contact of
    // his body: the canopy is above him. A solid bounces him instead of stopping him.
    const c=config.collapse,v=[(s.x-state.x)/dt,(s.y-state.y)/dt,(s.z-state.z)/dt];
    const solid=bounce(state,s,v,c,hitTest),leaves=brush(s,v,dt,c,hitTest);
    if(solid||leaves||canopyTouches(canopySegment(s,config),hitTest)){
      s.collapsed=true;settle(s,v,config,height);return publish(s,v);
    }
  }
  const hit=hitTest?.([state.x,state.y,state.z],[s.x,s.y,s.z],.45);
  if(hit){s.x=state.x;s.y=state.y;s.z=state.z;s.impact=hit.kind;s.grounded=true;s.vertical=s.vario=s.speed=0;return s;}
  const floor=height(s.x,s.y)+config.landing_clearance_m;
  if(s.z<=floor){s.z=floor;s.grounded=true;s.vertical=s.vario=s.speed=0;}
  return s;
}

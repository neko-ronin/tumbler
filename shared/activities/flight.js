/** Engine-neutral recreational flight. X east, Y north, Z up; SI units.
 * Fixed 1/120 s integration. Manuals and intentional approximations:
 * docs/design/FLIGHT-MANUALS.md. This is not a flight-training model.
 */
import {knockDirection} from './collision.js';
import {stepCoupled,wingBasis,pilotBasis} from './coupled-flight.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const approach=(a,b,rate,dt)=>a+(b-a)*(1-Math.exp(-rate*dt));
const wave=(x,y,z,t)=>Math.sin(x*.013+y*.009+t*.73+z*.005)*.55+Math.sin(x*.043-y*.031-t*1.87)*.3+Math.sin(y*.11+z*.07+t*3.1)*.15;

export function launchFlight(config,mode,site,height,weather='soaring') {
  if(config.version!==3)throw new Error(`Unsupported flight rules version: ${config.version}`);
  if(!config.modes[mode])throw new Error(`Unknown flight activity: ${mode}`);
  const [x,y]=site.xy_m;
  return {mode,weather,x,y,z:height(x,y)+(site.clearance_m??config.launch_clearance_m??18),
    heading:site.heading_deg*Math.PI/180,speed:config.modes[mode].trim_mps,
    vertical:config.coupled?-config.modes[mode].sink_mps:0,vario:config.coupled?-config.modes[mode].sink_mps:0,
    bank:0,rollRate:0,pitch:0,pitchRate:0,brakeLeft:0,brakeRight:0,accelerator:0,
    handleLeft:mode==='parakite'?.45:0,handleRight:mode==='parakite'?.45:0,
    throttle:mode==='paramotor'?.55:0,engine:mode==='paramotor'?.55:0,thrustN:0,engineWorkJ:0,
    load:1,pressure:1,stall:0,turbulence:0,groundSpeed:0,grounded:false,distance:0,
    pilotPitch:0,pilotRoll:0,pilotPitchRate:0,pilotRollRate:0,challenge:null,
    maneuver:0,turnMemory:0,reversals:0,groundEffect:0,figure:'Trim glide'};
}

/** Reduced angular suspension response about the harness attachment. Forces
 * drive a damped pendulum pose; angular work is not fed back into translation.
 * This deliberately does not claim a two-mass or slack-line constraint solver.
 */
function suspensionPose(s,previousSpeed,dt,mode,config){
  const c=config.suspension;if(!c)return;
  const omega=Math.sqrt(9.81/mode.canopy_height_m);
  const goals=[clamp(-Math.atan((s.speed-previousSpeed)/dt/9.81)-s.pitch,-c.pitch_limit_rad,c.pitch_limit_rad),
    clamp(-s.bank*c.roll_follow-s.rollRate*c.roll_rate_gain_s,-c.roll_limit_rad,c.roll_limit_rad)];
  for(const [i,key] of ['pilotPitch','pilotRoll'].entries()){
    const rate=key+'Rate',angle=s[key]??0;
    s[rate]=((s[rate]??0)+(goals[i]-angle)*omega*omega*dt)*Math.exp(-2*c.damping_ratio*omega*dt);
    const limit=i===0?c.pitch_limit_rad:c.roll_limit_rad;
    s[key]=clamp(angle+s[rate]*dt,-limit,limit);
    if(Math.abs(s[key])===limit&&Math.sign(s[rate])===Math.sign(s[key]))s[rate]=0;
  }
}
function releaseSuspension(s){s.pilotPitch=s.pilotRoll=s.pilotPitchRate=s.pilotRollRate=0;delete s.coupled;}

export function startFlightChallenge(state,id,config){
  if(!id)return {...state,challenge:null};
  if(!config.challenges?.[id])throw new Error(`Unknown flight challenge: ${id}`);
  return {...state,challenge:{id,status:'active',turns:0,lastSide:0}};
}
function scoreFlight(s,config){
  if(!s.challenge||s.challenge.status!=='active')return s;
  const rule=config.challenges?.[s.challenge.id];if(!rule)return s;
  const c={...s.challenge};s.challenge=c;
  if(s.collapsed||s.impact){c.status='retry';return s;}
  if(rule.goal==='linked_turns'){
    const side=Math.abs(s.bank)>=rule.bank_rad?Math.sign(s.bank):0;
    if(side&&side!==c.lastSide){if(c.lastSide)c.turns++;c.lastSide=side;}
    if(c.turns>=rule.reversals)c.status='complete';
    else if(s.grounded&&!s.launching)c.status='retry';
  }else if(rule.goal==='landing'&&s.grounded&&!s.launching){
    c.status=s.landingSpeed!==undefined&&s.landingSpeed<=rule.max_descent_mps&&s.landingGroundSpeed<=rule.max_ground_mps?'complete':'retry';
  }
  return s;
}

/** Assisted inflation and ground run. Running and the final leg push are
 * explicit launch assistance, separate from free-flight energy accounting.
 */
function abortGroundLaunch(s,figure){
  s.launching=false;s.launchAborted=true;
  s.speed=s.groundSpeed=s.launchRunSpeed=s.vx=s.vy=s.vz=s.vertical=s.vario=0;
  s.figure=figure;return s;
}
function stepGroundLaunch(s,input,dt,time,config,bearing,height,hitTest,launchHeight,launchDryHeight){
  const c=config.ground_launch,m=config.modes[s.mode];releaseSuspension(s);
  s.launchTime=(s.launchTime??0)+dt;s.launchProgress=clamp(s.launchTime/c.inflate_s);
  s.launchStage=s.launchProgress<1?'inflating':'running';s.pressure=s.launchInflation=s.launchProgress;
  if(s.mode==='paramotor')s.throttle=clamp((s.throttle??0)+(input.throttle??0)*dt*.4);
  s.engine=approach(s.engine??0,s.throttle??0,1.8,dt);
  if(s.launchProgress<1){s.speed=s.groundSpeed=s.launchRunSpeed=s.vx=s.vy=s.vz=s.vertical=s.vario=0;s.figure='Inflating wing';return s;}
  if(s.launchTime-c.inflate_s>c.max_run_s)return abortGroundLaunch(s,'Launch stalled · find downhill ground or face the wind');
  const air=sampleAir(config,bearing,s,time,height),ch=Math.cos(s.heading),sh=Math.sin(s.heading);
  // Current footing and a future dry floor are distinct questions. A ledge's
  // lower floor need not be standable when the next step leaves the ground.
  const floor=launchHeight(s.x,s.y),ahead=launchDryHeight(s.x+ch,s.y+sh);
  if(!Number.isFinite(floor)||!Number.isFinite(ahead))return abortGroundLaunch(s,'Launch blocked · need dry ground ahead');
  const motor=s.mode==='paramotor'?config.propulsion:null;
  const thrust=motor?Math.min(motor.max_thrust_n*s.engine,motor.max_power_w*s.engine/Math.max(1,s.launchRunSpeed??0)):0;
  s.thrustN=thrust;
  const grade=(ahead-floor)/Math.hypot(1,ahead-floor);
  const accel=c.run_accel_mps2*(1-clamp(input.brake??0))-9.81*grade+(motor?thrust/motor.mass_kg:0);
  const before=s.launchRunSpeed??0,run=clamp(before+accel*dt,0,c.max_run_mps??m.trim_mps);
  const x=s.x+ch*run*dt,y=s.y+sh*run*dt,ground=launchDryHeight(x,y),drop=floor-ground>c.dropoff_m;
  const z=drop?s.z:ground+config.landing_clearance_m;
  const blocked=!Number.isFinite(ground)||(!drop&&!Number.isFinite(launchHeight(x,y)))||hitTest?.([s.x,s.y,s.z],[x,y,z],.45)||
    config.collapse&&hitTest&&canopyTouches(canopySegment({...s,x,y,z},config),hitTest);
  if(blocked)return abortGroundLaunch(s,'Launch blocked · reposition and retry');
  // Every accepted ground displacement spends work, including the last step
  // off a ledge or past the run-distance limit. Record it before either exit;
  // a blocked step above has not moved and must not spend this work.
  if(motor)s.engineWorkJ=(s.engineWorkJ??0)+thrust*(before+run)*.5*dt;
  s.launchWorkHead=(s.launchWorkHead??0)+Math.max(0,(run*run-before*before)/(2*9.81))+Math.max(0,z-(floor+config.landing_clearance_m));
  // Preserve the actual ground-run velocity for the first free-flight solve.
  // A scalar airspeed plus the wind would otherwise invent crosswind motion.
  s.vx=ch*run;s.vy=sh*run;
  const forwardAir=Math.max(0,run-air.wx*ch-air.wy*sh),airspeed=Math.hypot(s.vx-air.wx,s.vy-air.wy);
  if(drop){
    s.x=x;s.y=y;s.distance+=run*dt;s.groundSpeed=s.launchRunSpeed=run;
    s.launchDistance=(s.launchDistance??0)+run*dt;s.grounded=false;s.launching=false;
    s.speed=airspeed;s.vz=s.vertical=s.vario=0;s.figure='Taking flight';return s;
  }
  const groundVertical=(z-s.z)/dt;
  s.x=x;s.y=y;s.z=z;s.distance+=run*dt;s.groundSpeed=run;s.launchRunSpeed=run;
  s.launchDistance=(s.launchDistance??0)+run*dt;
  if(s.launchDistance>c.max_run_m)return abortGroundLaunch(s,'Launch needs more airspeed · face headwind or use clear descending ground');
  // Instruments report the actual horizontal relative-air magnitude. The
  // assisted forward takeoff gate must not count a sideways gust as a run.
  s.speed=airspeed;s.vz=s.vario=s.vertical=groundVertical;
  s.launchProgress=clamp(forwardAir/(m.trim_mps*c.takeoff_speed_fraction));
  s.figure='Running launch';
  if(forwardAir>=m.trim_mps*c.takeoff_speed_fraction){
    s.grounded=false;s.launching=false;s.vz=s.vertical=s.vario=c.hop_mps;
    s.launchWorkHead+=c.hop_mps*c.hop_mps/(2*9.81);s.figure='Taking flight';
  }
  return s;
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

/** Shared rigid rig frame in core axes. Local +X is pilot-left, +Y up,
 * +Z forward. Pitch raises the nose; positive bank lowers the right tip.
 * Clients convert these vectors to their own axes rather than scaling bank.
 */
export function flightFrame(state,config){
  if(state.coupled&&!state.grounded&&!state.collapsed){
    const basis=wingBasis(state.heading,state.pitch,state.bank),height=config.modes[state.mode].canopy_height_m;
    return {...basis,origin:state.coupled.wingPosition.map((v,i)=>v-basis.up[i]*height)};
  }
  const h=state.heading??0,p=state.grounded?0:(state.pitch??0),b=state.grounded?0:(state.bank??0);
  const forward=[Math.cos(h),Math.sin(h),0],left=[-Math.sin(h),Math.cos(h),0];
  const pitchedUp=[-forward[0]*Math.sin(p),-forward[1]*Math.sin(p),Math.cos(p)];
  return {origin:[state.x,state.y,state.z-config.landing_clearance_m],
    forward:[forward[0]*Math.cos(p),forward[1]*Math.cos(p),Math.sin(p)],
    left:left.map((v,i)=>v*Math.cos(b)+pitchedUp[i]*Math.sin(b)),
    up:pitchedUp.map((v,i)=>v*Math.cos(b)-left[i]*Math.sin(b))};
}

/** Independently simulated harness frame. Local origin is at nominal feet;
 * the real hip anchor is harness_height_m above it along the suspension.
 * Legacy clients retain their existing relative angular pose path.
 */
export function pilotFrame(state,config){
  if(!state.coupled||state.grounded||state.collapsed)return flightFrame(state,config);
  const basis=pilotBasis(state);
  return {...basis,origin:state.coupled.pilotPosition.map((v,i)=>v-basis.up[i]*config.coupled.harness_height_m)};
}

/** The canopy as a capsule from wingtip to wingtip (docs/design/COLLISION.md):
 * canopy_height_m above the feet along the pilot's banked up, span_m long,
 * chord_m / 2 thick. The lines below it are not tested.
 */
export function canopySegment(state,config){
  const mode=config.modes[state.mode],frame=flightFrame(state,config);
  const centre=frame.origin.map((v,i)=>v+frame.up[i]*mode.canopy_height_m),axis=frame.left.map(v=>-v);
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
  s.z=floor;s.grounded=true;touchdown(s,Math.max(0,-v[2]),Math.hypot(v[0],v[1]),config);v[0]=v[1]=v[2]=0;
}

function touchdown(s,vertical,groundSpeed,config){
  s.landingSpeed=vertical;s.landingGroundSpeed=groundSpeed;
  const limits=config.landing??{smooth_mps:1.5,hard_mps:4};
  s.landingQuality=vertical<=limits.smooth_mps?'smooth':vertical>=limits.hard_mps?'hard':'firm';
}

const publish=(s,v)=>{
  s.vx=v[0];s.vy=v[1];s.vz=s.vertical=s.vario=v[2];s.speed=Math.hypot(v[0],v[1]);
  if(s.speed>.5)s.heading=Math.atan2(v[1],v[0]);
  s.figure=s.grounded?'Wing collapsed · unhook or relaunch':'Wing collapsed';
  return s;
};

/** A collapsed wing gives no lift: he falls toward terminal_mps under linear drag,
 * integrated exactly so the outcome does not depend on the step size.
 */
function stepCollapsed(state,dt,config,height,hitTest){
  const s={...state},c=config.collapse,k=G/c.terminal_mps,e=Math.exp(-k*dt),vt=-c.terminal_mps;
  releaseSuspension(s);
  const v=[s.vx??0,s.vy??0,s.vertical??0],prev={x:s.x,y:s.y,z:s.z};
  s.x+=v[0]*(1-e)/k;s.y+=v[1]*(1-e)/k;s.z+=vt*dt+(v[2]-vt)*(1-e)/k;
  v[0]*=e;v[1]*=e;v[2]=vt+(v[2]-vt)*e;
  if(hitTest)bounce(prev,s,v,c,hitTest);
  brush(s,v,dt,c,hitTest);
  settle(s,v,config,height);
  return publish(s,v);
}

export function stepFlight(state,input,dt,time,config,windBearing,height,hitTest=null,launchHeight=height,launchDryHeight=launchHeight) {
  if(!(dt>0)||!Number.isFinite(dt))return {...state};
  const s={...state},mode=config.modes[s.mode];
  if(s.launching&&config.ground_launch)return stepGroundLaunch(s,input,dt,time,config,windBearing,height,hitTest,launchHeight,launchDryHeight);
  if(s.grounded){releaseSuspension(s);return s;}
  if(config.collapse&&s.collapsed)return scoreFlight(stepCollapsed(s,dt,config,height,hitTest),config);
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
  if(config.coupled)s.rollRate=clamp(s.rollRate,-config.coupled.max_roll_rate_rps,config.coupled.max_roll_rate_rps);
  s.bank=clamp(s.bank+s.rollRate*dt,-mode.maneuver_bank_rad,mode.maneuver_bank_rad);
  if(Math.abs(turn)>.45&&Math.sign(turn)!==Math.sign(s.turnMemory||turn))s.reversals=(s.reversals??0)+1;
  if(Math.abs(turn)>.45)s.turnMemory=turn;
  if(s.maneuver<.1)s.reversals=0;
  if(config.coupled){
    stepCoupled(s,dt,config,position=>sampleAir(config,windBearing,{...s,x:position[0],y:position[1],z:position[2]},time,height));
    s.turbulence=air.turbulence;
    if(s.maneuver>.5&&Math.abs(s.bank)>.72&&!s.stall)s.figure=(s.reversals??0)>0?'Wingover':'Spiral · release to recover';
  }else{
  s.load=1/Math.max(.25,Math.cos(s.bank));
  s.heading-=clamp(9.81*Math.tan(s.bank)/Math.max(5,s.speed),-mode.turn_rps,mode.turn_rps)*dt;
  const trim=mode.trim_mps;
  const targetSpeed=trim*(1-brake*mode.brake_fraction+s.accelerator*mode.accelerator_fraction)*Math.sqrt(s.load);
  const previousSpeed=s.speed;
  const response=targetSpeed>s.speed?mode.dive_response:brake>.08?mode.recovery_response:mode.speed_response*.32;
  s.speed=approach(s.speed,Math.max(trim*.48,targetSpeed),response,dt);
  // Propulsive work is bounded by both thrust and available shaft power.
  // A small part changes airspeed; the remaining work changes flight-path
  // height through the energy budget below. Mass and split are game tuning.
  let engineHeight=0;
  const motor=s.mode==='paramotor'?config.propulsion:null;
  s.thrustN=0;
  if(motor){
    s.thrustN=Math.min(motor.max_thrust_n*s.engine,motor.max_power_w*s.engine/Math.max(1,s.speed));
    const work=s.thrustN*s.speed*Math.max(0,Math.cos(s.pilotPitch??0))*dt;
    engineHeight=work/(motor.mass_kg*9.81);s.engineWorkJ=(s.engineWorkJ??0)+work;
    s.speed=Math.sqrt(s.speed*s.speed+2*9.81*engineHeight*motor.airspeed_share);
  }
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
  const climb=air.lift-sink+(motor?0:mode.powered_climb_mps*s.engine);
  s.vertical=approach(s.vertical,climb,2,dt);
  s.vario=s.vertical+(exchange+engineHeight)/dt;
  // Pitch now follows the paid trajectory, making the dive and climbing arc
  // visible, with an additional small brake/pressure incidence response.
  const targetPitch=clamp(Math.atan2(s.vario,Math.max(5,s.speed))*.8+brake*.12,-.75,.65);
  s.pitchRate=(s.pitchRate+(targetPitch-s.pitch)*12*dt)*Math.exp(-5*dt);
  s.pitch+=s.pitchRate*dt;
  suspensionPose(s,previousSpeed,dt,mode,config);
  s.pressure=approach(s.pressure,clamp(1-s.stall*.45-Math.abs(air.turbulence)*.05,.45,1.15),4,dt);
  s.turbulence=air.turbulence;
  s.figure=s.stall>.15?'Low energy · ease handles':s.vario>1&&exchange/dt>1&&s.speed>trim*.8?'Swoop · climbing':
    s.mode==='paramotor'&&s.engine>.1&&s.vario>.2?'Powered climb':
    s.accelerator>.65?'Dive · storing speed':s.maneuver>.5&&Math.abs(s.bank)>.72?
    ((s.reversals??0)>0?'Wingover':'Spiral · release to recover'):Math.abs(turn)<.1&&Math.abs(s.bank)>.08&&s.maneuver<.3?'Recovering':
    Math.abs(s.bank)>.3?'Dynamic S-turn':s.groundEffect>.02?'Ground skim · reduced drag':'Trim glide';
  const dx=(Math.cos(s.heading)*s.speed+air.wx)*dt,dy=(Math.sin(s.heading)*s.speed+air.wy)*dt;
  s.x+=dx;s.y+=dy;s.z+=s.vertical*dt+exchange+engineHeight;s.groundSpeed=Math.hypot(dx,dy)/dt;s.distance+=Math.hypot(dx,dy);
  }
  const beforeClamp=[s.x,s.y,s.z];
  s.x=clamp(s.x,-config.world_limit_m,config.world_limit_m);s.y=clamp(s.y,-config.world_limit_m,config.world_limit_m);
  s.z=Math.min(config.ceiling_m,s.z);
  if(s.coupled){
    // World/ceiling boundaries are external contacts, not free-flight work.
    const shift=[s.x,s.y,s.z].map((v,i)=>v-beforeClamp[i]);
    if(shift.some(v=>v!==0)){
      const c=s.coupled,mass=config.coupled.pilot_mass_kg+config.coupled.wing_mass_kg;
      for(const key of ['pilotPosition','wingPosition'])c[key]=c[key].map((v,i)=>v+shift[i]);
      const work=mass*G*shift[2];c.contactWorkJ=(c.contactWorkJ??0)+work;c.energyJ+=work;
    }
  }
  if(config.collapse&&hitTest){
    // A canopy touching foliage or a solid collapses, and so does any contact of
    // his body: the canopy is above him. A solid bounces him instead of stopping him.
    const c=config.collapse,v=[(s.x-state.x)/dt,(s.y-state.y)/dt,(s.z-state.z)/dt];
    const solid=bounce(state,s,v,c,hitTest),leaves=brush(s,v,dt,c,hitTest);
    if(solid||leaves||canopyTouches(canopySegment(s,config),hitTest)){
      s.collapsed=true;releaseSuspension(s);settle(s,v,config,height);return scoreFlight(publish(s,v),config);
    }
  }
  const hit=hitTest?.([state.x,state.y,state.z],[s.x,s.y,s.z],.45);
  if(hit){s.x=state.x;s.y=state.y;s.z=state.z;s.impact=hit.kind;s.grounded=true;s.vx=s.vy=s.vz=s.vertical=s.vario=s.speed=0;releaseSuspension(s);return scoreFlight(s,config);}
  const floor=height(s.x,s.y)+config.landing_clearance_m;
  if(s.z<=floor){
    touchdown(s,Math.max(0,-s.vario),s.groundSpeed,config);
    s.z=floor;s.grounded=true;s.vx=s.vy=s.vz=s.vertical=s.vario=s.speed=0;releaseSuspension(s);
  }
  return scoreFlight(s,config);
}

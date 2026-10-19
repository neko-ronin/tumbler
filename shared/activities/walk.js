/** Ground movement and harness transitions in metres (x east, y north, z up).
 * Call at <= 50 ms; jumps integrate at <= 120 Hz. Inputs are held values, not
 * client events. Jump edges, phase, style and velocity belong to every client.
 */
import {launchFlight} from './flight.js';
import {createTrailSampler} from './ride.js';
const jumpDefaults={gravity_mps2:10.8,takeoff_mps:4.8,hop_mps:3.8,takeoff_s:.12,landing_s:.18,air_control_mps2:2.4,max_ground_grade:1};
const rules=config=>({...jumpDefaults,...config.jump});

/** Exclude submerged ground using the core's named water footprints and bank
 * envelope. Height decides the shoreline inside that envelope, as for carving.
 */
export function createWalkHeight(worldmap,height){
  const bodies=worldmap.water?.bodies??[];
  const trailAt=createTrailSampler({...worldmap,tracks:worldmap.tracks??[]});
  // The published 8 m grid cannot hold every narrow tread. The declared
  // profile remains a physical surface for any activity, including landing.
  const floorHeight=(x,y)=>{const z=height(x,y);if(!Number.isFinite(z))return null;const t=trailAt(x,y);return t?.beyond===0?Math.max(z,t.z):z;};
  const walkHeight=(x,y)=>{
    const z=floorHeight(x,y);if(!Number.isFinite(z))return null;
    for(const b of bodies){
      if(z>=b.surface_z_m+.05)continue;
      if(b.kind==='lake'&&Math.hypot((x-b.centre_xy_m[0])/(b.size_m[0]/2+b.bank_m),(y-b.centre_xy_m[1])/(b.size_m[1]/2+b.bank_m))<=1)return null;
      if(b.kind==='river')for(let i=1;i<b.polyline.length;i++){
        const a=b.polyline[i-1],c=b.polyline[i],dx=c[0]-a[0],dy=c[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<=Math.max(b.width_start_m,b.width_end_m)/2+b.bank_m)return null;
      }
    }
    return z;
  };
  return Object.assign(walkHeight,{floorHeight,trailAt});
}

/** A finite dry height, walkable local slope and room for the standing body.
 * Clients may supply null for water/unsupported terrain. No nearby-point search:
 * a rejected transition must never silently relocate the player.
 */
export function safeWalkGround(x,y,config,height,hitTest){
  const z=height(x,y),r=config.radius_m;
  if(!Number.isFinite(z))return null;
  const samples=[height(x+r,y),height(x-r,y),height(x,y+r),height(x,y-r)];
  if(!samples.every(Number.isFinite)||Math.hypot((samples[0]-samples[1])/(2*r),(samples[2]-samples[3])/(2*r))>rules(config).max_ground_grade)return null;
  if(hitTest?.([x,y,z+r],[x,y,z+1.7-r],r))return null;
  return z;
}

export function stepWalk(state,input,dt,config,height,hitTest){
  if(!(dt>0)||!Number.isFinite(dt))return {...state};
  const j=rules(config),s={...state},duration=Math.min(dt,.05);
  s.grounded??=true;s.jumpPhase??='grounded';s.jumpTime??=0;s.jumpCount??=0;s.vz??=0;
  const magnitude=Math.hypot(input.x??0,input.y??0),speed=(input.run?config.run_mps:config.walk_mps)*Math.min(1,magnitude);
  const vx=magnitude?(input.x/magnitude)*speed:0,vy=magnitude?(input.y/magnitude)*speed:0;
  const edge=!!input.jump&&!s.jumpHeld;s.jumpHeld=!!input.jump;
  if(edge&&s.jumpPhase==='grounded'&&safeWalkGround(s.x,s.y,config,height,hitTest)!==null){
    s.jumpStyle=speed>.5?'hop':['celebrate','heel_click','star'][s.jumpCount%3];
    s.jumpCount++;s.jumpPhase='takeoff';s.jumpTime=0;s.vx=vx;s.vy=vy;
  }
  for(let remaining=duration;remaining>1e-10;){
    const step=Math.min(remaining,1/120);remaining-=step;
    if(s.grounded&&s.jumpPhase!=='takeoff'){s.vx=vx;s.vy=vy;}
    else if(!s.grounded&&magnitude){
      const dx=vx-s.vx,dy=vy-s.vy,length=Math.hypot(dx,dy),amount=Math.min(1,j.air_control_mps2*step/(length||1));
      s.vx+=dx*amount;s.vy+=dy*amount;
    }
    const x=s.x+s.vx*step,y=s.y+s.vy*step,z=height(x,y),oldFloor=height(s.x,s.y);
    const distance=Math.hypot(s.vx,s.vy)*step;
    const obstructed=!Number.isFinite(z)||(s.grounded?Math.abs(z-s.z)>Math.max(config.max_step_m,distance*config.max_grade):z>s.z+config.max_step_m)
      ||hitTest?.([s.x,s.y,s.z+config.radius_m],[x,y,(s.grounded?z:s.z)+config.radius_m],config.radius_m)
      ||hitTest?.([s.x,s.y,s.z+.9],[x,y,(s.grounded?z:s.z)+.9],config.radius_m)
      ||hitTest?.([s.x,s.y,s.z+1.5],[x,y,(s.grounded?z:s.z)+1.5],config.radius_m);
    if(!obstructed){s.x=x;s.y=y;if(s.grounded)s.z=z;}
    else{s.vx=0;s.vy=0;}
    s.speed=Math.hypot(s.vx,s.vy);
    if(s.speed>.01)s.heading=Math.atan2(s.vy,s.vx);
    if(s.jumpPhase==='takeoff'){
      s.jumpTime+=step;
      if(s.jumpTime>=j.takeoff_s){s.grounded=false;s.jumpPhase='airborne';s.jumpTime=0;s.vz=s.jumpStyle==='hop'?j.hop_mps:j.takeoff_mps;}
    }else if(!s.grounded){
      const next=s.z+s.vz*step-.5*j.gravity_mps2*step*step;
      const ceiling=hitTest?.([s.x,s.y,s.z+1.5],[s.x,s.y,next+1.5],config.radius_m);
      s.vz-=j.gravity_mps2*step;
      if(ceiling&&next>s.z)s.vz=Math.min(0,s.vz);else s.z=next;
      const floor=height(s.x,s.y)??oldFloor;
      if(Number.isFinite(floor)&&s.z<=floor){s.z=floor;s.grounded=true;s.vz=0;s.jumpPhase='landing';s.jumpTime=0;}
      else s.jumpTime+=step;
    }else if(s.jumpPhase==='landing'){
      s.jumpTime+=step;
      if(s.jumpTime>=j.landing_s){s.jumpPhase='grounded';s.jumpTime=0;}
    }
  }
  s.groundZ=height(s.x,s.y)??state.groundZ??state.z;
  const phaseDuration=s.jumpPhase==='takeoff'?j.takeoff_s:s.jumpPhase==='landing'?j.landing_s:
    2*(s.jumpStyle==='hop'?j.hop_mps:j.takeoff_mps)/j.gravity_mps2;
  s.jumpProgress=s.jumpPhase==='grounded'?0:Math.min(1,s.jumpTime/phaseDuration);
  return s;
}

export function unharnessFlight(state,walkConfig,flightConfig,height,hitTest){
  if(!state?.grounded||state.impact||!flightConfig.modes[state.mode])return null;
  const z=safeWalkGround(state.x,state.y,walkConfig,height,hitTest);
  if(z===null||Math.abs(state.z-flightConfig.landing_clearance_m-z)>.15)return null;
  return {x:state.x,y:state.y,z,groundZ:z,heading:state.heading,speed:0,grounded:true,jumpPhase:'grounded',jumpCount:0,
    harnessMode:state.mode,harnessWeather:state.weather};
}

export function reharnessWalk(state,walkConfig,flightConfig,height,hitTest){
  if(!state?.harnessMode||state.grounded===false||!['grounded',undefined].includes(state.jumpPhase))return null;
  const z=safeWalkGround(state.x,state.y,walkConfig,height,hitTest);
  if(z===null||Math.abs(state.z-z)>.15||!flightConfig.modes[state.harnessMode])return null;
  const s=launchFlight(flightConfig,state.harnessMode,{xy_m:[state.x,state.y],heading_deg:state.heading*180/Math.PI,clearance_m:flightConfig.landing_clearance_m},height,state.harnessWeather);
  return {...s,grounded:true,speed:0,vertical:0,vario:0,engine:0,throttle:0,pressure:0,figure:'Harnessed · ready to launch'};
}

/** Assisted ground run/hop at this exact contact position, without a preset or
 * awarded height. Gliding wings need descending ground or lift; motor spools
 * from idle. The client must require a fresh launch input.
 */
export function relaunchGround(state,walkConfig,flightConfig,height,hitTest){
  if(!unharnessFlight(state,walkConfig,flightConfig,height,hitTest))return null;
  const vertical=3.2,speed=flightConfig.modes[state.mode].trim_mps,base=state.z-flightConfig.landing_clearance_m;
  const ahead=[state.x+Math.cos(state.heading)*3,state.y+Math.sin(state.heading)*3],z=height(...ahead);
  if(!Number.isFinite(z)||z>state.z||hitTest?.([state.x,state.y,state.z],[...ahead,z+flightConfig.landing_clearance_m],.45))return null;
  for(let distance=.2;distance<=3.001;distance+=.2){
    const floor=height(state.x+Math.cos(state.heading)*distance,state.y+Math.sin(state.heading)*distance),t=distance/speed;
    if(!Number.isFinite(floor)||floor>base+vertical*t-6*t*t-.01)return null;
  }
  return {...state,grounded:false,speed,vertical,vario:vertical,
    pressure:.45,throttle:state.mode==='paramotor'?.65:0,engine:0,figure:'Ground launch'};
}

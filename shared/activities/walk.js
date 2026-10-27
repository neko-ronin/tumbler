/** Ground movement and harness transitions in metres (x east, y north, z up).
 * Call at <= 50 ms; jumps integrate at <= 120 Hz. Inputs are held values, not
 * client events. Jump edges, phase, style and velocity belong to every client.
 */
import {launchFlight,canopySegment,canopyTouches} from './flight.js';
import {createTrailSampler} from './ride.js';
import {knockDirection} from './collision.js';
// The optional chain, release, apex, buffer and lift fields default to the
// original single fixed-height jump under constant gravity.
const jumpDefaults={gravity_mps2:10.8,takeoff_mps:4.8,hop_mps:3.8,takeoff_s:.12,landing_s:.18,air_control_mps2:2.4,max_ground_grade:1,
  speed_lift:0,release_gravity:1,apex_mps:0,apex_gravity:1,buffer_s:0,chain_s:0,chain_mps:[],chain_speed_mps:0};
const rules=config=>({...jumpDefaults,...config.jump});
// Recovery grows with touchdown speed beyond the jump's own launch speed, up to
// 2.8x: a big drop needs a deeper, longer crouch than a hop on level ground.
const landingTime=(s,j)=>j.landing_s*Math.min(2.8,Math.max(1,1+((s.landingSpeed??0)-(s.jumpVz??j.takeoff_mps))/4));

/** Exclude submerged ground using the core's named water footprints and bank
 * envelope. Height decides the shoreline inside that envelope, as for carving.
 */
export function createWalkHeight(worldmap,height){
  const bodies=worldmap.water?.bodies??[];
  const trailAt=createTrailSampler({...worldmap,tracks:worldmap.tracks??[]});
  // The published 8 m grid cannot hold every narrow tread. The declared
  // profile remains a physical surface for any activity, including landing.
  const floorHeight=(x,y)=>{const z=height(x,y);if(!Number.isFinite(z))return null;const t=trailAt(x,y);return t?.beyond===0?Math.max(z,t.z):z;};
  /** The water at a point, or null: its surface, the depth over the floor, and
   * the river's flow direction (unit, along its polyline; lakes are still). */
  const waterAt=(x,y)=>{
    const z=floorHeight(x,y);if(!Number.isFinite(z))return null;
    // Outer reaches already have published course, width and falling levels.
    // The same footprint now participates in walking/swimming and diving.
    for(const reach of worldmap.mountains?.enclosure?.river_reaches??[]){
      const line=reach.polyline_xyz_m;
      // The block's own body wins inside its boundary; beyond the junction
      // the reach wins over the old body's round endpoint envelope.
      if((x-line[0][0])*(line.at(-1)[0]-line[0][0])<0)continue;
      let nearest=null;
      for(let i=1;i<line.length;i++){
        const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(length*length)));
        const surface=a[2]+(b[2]-a[2])*t;
        const distance=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
        if(distance>reach.half_width_m||distance>=(nearest?.distance??Infinity))continue;
        const sign=b[2]>a[2]?-1:1;
        nearest={distance,surface,flow:[dx/length*sign,dy/length*sign]};
      }
      if(nearest)return z<nearest.surface+.05?{surface_z:nearest.surface,depth:Math.max(0,nearest.surface-z),flow:nearest.flow}:null;
    }
    for(const b of bodies){
      if(z>=b.surface_z_m+.05)continue;
      const water=flow=>({surface_z:b.surface_z_m,depth:Math.max(0,b.surface_z_m-z),flow});
      if(b.kind==='lake'&&Math.hypot((x-b.centre_xy_m[0])/(b.size_m[0]/2+b.bank_m),(y-b.centre_xy_m[1])/(b.size_m[1]/2+b.bank_m))<=1)return water([0,0]);
      if(b.kind==='river')for(let i=1;i<b.polyline.length;i++){
        const a=b.polyline[i-1],c=b.polyline[i],dx=c[0]-a[0],dy=c[1]-a[1];
        const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<=Math.max(b.width_start_m,b.width_end_m)/2+b.bank_m)return water([dx/Math.hypot(dx,dy),dy/Math.hypot(dx,dy)]);
      }
    }
    return null;
  };
  const walkHeight=(x,y)=>{const z=floorHeight(x,y);return !Number.isFinite(z)||waterAt(x,y)?null:z;};
  return Object.assign(walkHeight,{floorHeight,trailAt,waterAt});
}

/** A finite dry height, walkable local slope and room for the standing body.
 * Clients may supply null for water/unsupported terrain. No nearby-point search:
 * a rejected transition must never silently relocate the player.
 */
export function safeWalkGround(x,y,config,height,hitTest,{dropOffs=false}={}){
  const z=height(x,y),r=config.radius_m;
  if(!Number.isFinite(z))return null;
  let samples=[height(x+r,y),height(x-r,y),height(x,y+r),height(x,y-r)];
  // To jump he needs footing, not level ground all round: a drop-off (or water)
  // beside a ledge reads as level; a wall face beside him still does not.
  if(dropOffs)samples=samples.map(h=>Number.isFinite(h)&&h>=z-config.max_step_m?h:z);
  if(!samples.every(Number.isFinite)||Math.hypot((samples[0]-samples[1])/(2*r),(samples[2]-samples[3])/(2*r))>rules(config).max_ground_grade)return null;
  if(hitTest?.([x,y,z+r],[x,y,z+1.7-r],r))return null;
  return z;
}

/** Which locomotion slot of the character contract plays at this ground
 * speed: an optional stroll below `stroll_mps`, the walk, then the run a little
 * above walking speed. Clients map the slot to a clip (`clips[slot]`).
 */
export function gaitFor(speed,config,clips={}){
  if(speed>config.walk_mps*1.15)return 'run';
  return clips.stroll&&config.stroll_mps&&speed<config.stroll_mps?'stroll':'walk';
}

export function stepWalk(state,input,dt,config,height,hitTest){
  if(!(dt>0)||!Number.isFinite(dt))return {...state};
  const j=rules(config),s={...state},duration=Math.min(dt,.05);
  s.grounded??=true;s.jumpPhase??='grounded';s.jumpTime??=0;s.jumpCount??=0;s.vz??=0;s.vx??=0;s.vy??=0;
  const magnitude=Math.hypot(input.x??0,input.y??0),speed=(input.run?config.run_mps:config.walk_mps)*Math.min(1,magnitude);
  const vx=magnitude?(input.x/magnitude)*speed:0,vy=magnitude?(input.y/magnitude)*speed:0;
  const edge=!!input.jump&&!s.jumpHeld;s.jumpHeld=!!input.jump;
  // A fresh press keeps for buffer_s, so one made just before touchdown still
  // jumps; so does one during the landing crouch. Holding never presses again.
  if(edge)s.jumpBuffer=j.buffer_s;
  // A jump keeps the velocity the feet actually have; older contracts snap to
  // input, so for them that is still the held direction.
  if((edge||s.jumpBuffer>0)&&(s.jumpPhase==='grounded'||s.jumpPhase==='landing')&&safeWalkGround(s.x,s.y,config,height,hitTest,{dropOffs:true})!==null){
    // Jumping again within chain_s of touchdown climbs the chain, like Mario's
    // double and triple jump; its last link needs chain_speed_mps of ground speed.
    const last=1+j.chain_mps.length,tier=s.chainLeft>0&&(s.jumpTier??1)<last?(s.jumpTier??1)+1:1;
    s.jumpTier=tier===last&&tier>1&&s.speed<j.chain_speed_mps?1:tier;
    // Standing jumps play; moving ones are athletic: leap, tuck, then the flip.
    const moving=Math.max(speed,s.speed??0)>.5;
    s.jumpStyle=moving?['leap','tuck','flip'][s.jumpTier-1]:s.jumpTier>1?'star':['celebrate','heel_click','star'][s.jumpCount%3];
    s.jumpCount++;s.jumpPhase='takeoff';s.jumpTime=0;s.jumpBuffer=0;
    if(!(config.accel_mps2<Infinity)){s.vx=vx;s.vy=vy;}
  }
  const heading=s.heading??0;
  const blocked=(x,y)=>{
    const z=height(x,y),distance=Math.hypot(x-s.x,y-s.y);
    return !Number.isFinite(z)||(s.grounded?Math.abs(z-s.z)>Math.max(config.max_step_m,distance*config.max_grade):z>s.z+config.max_step_m)
      ||[config.radius_m,.9,1.5].some(h=>hitTest?.([s.x,s.y,s.z+h],[x,y,(s.grounded?z:s.z)+h],config.radius_m))
      // The floor is terrain only, so passing over a structure in the air would
      // land him inside its box, where nothing can move him again. A trunk or mesh
      // he is already above (a flared trunk below a push-off) never stops him
      // moving: only a move that newly puts him over one does.
      ||(!s.grounded&&overSolid(x,y,z)&&!(overSolid.last.type&&overSolid(s.x,s.y,height(s.x,s.y))));
  };
  function overSolid(x,y,z){overSolid.last=hitTest?.([x,y,s.z+config.radius_m],[x,y,z+config.radius_m],config.radius_m);return !!overSolid.last;}
  // Trunks and meshes slide on their true surface: the move is made, then pushed
  // back out across the ground along the contact normal (collision.js pushOut), so
  // he hugs what stopped him. Null leaves the move to the world-axis slide (untyped
  // boxes, terrain, older clients); {stuck} means no push clears him.
  const flush=(x,y)=>{
    const z=s.grounded?height(x,y):s.z,out=hitTest?.pushOut?.([config.radius_m,.9,1.5].map(h=>[x,y,z+h]),config.radius_m,{horizontal:true});
    return out?.offset?{x:x+out.offset[0],y:y+out.offset[1],normals:out.normals}:out??null;
  };
  // Foliage (optional `foliage` contract): it slows the stride to `slow` of its
  // target, drags any motion at drag_per_s, and each crown he enters knocks him
  // sideways by knock times his speed, the same way for the same path.
  const leaves=config.foliage&&hitTest?.soft?config.foliage:null;
  for(let remaining=duration;remaining>1e-10;){
    const step=Math.min(remaining,1/120);remaining-=step;
    // A fall or a hop can end a hair inside a trunk or mesh, and every move would
    // then start blocked: step out of it first.
    const inside=flush(s.x,s.y);
    if(inside?.normals){s.x=inside.x;s.y=inside.y;if(s.grounded)s.z=height(s.x,s.y);}
    if(s.grounded&&s.jumpPhase!=='takeoff'){
      // Traction: speed up at accel_mps2, brake (release, reverse) at decel_mps2.
      // Contracts without them keep the original instant response. A tumble
      // ignores input and only brakes.
      const slow=leaves&&s.foliage?.length?leaves.slow:1;
      const [tx,ty,tspeed]=s.jumpPhase==='tumble'?[0,0,0]:[vx*slow,vy*slow,speed*slow];
      const dx=tx-s.vx,dy=ty-s.vy,length=Math.hypot(dx,dy);
      const rate=tx*s.vx+ty*s.vy>=0&&tspeed>=Math.hypot(s.vx,s.vy)?config.accel_mps2??Infinity:config.decel_mps2??Infinity;
      const amount=Math.min(1,rate*step/(length||1));
      s.vx+=dx*amount;s.vy+=dy*amount;
    }
    else if(!s.grounded&&magnitude){
      const dx=vx-s.vx,dy=vy-s.vy,length=Math.hypot(dx,dy),amount=Math.min(1,j.air_control_mps2*step/(length||1));
      s.vx+=dx*amount;s.vy+=dy*amount;
    }
    const oldFloor=height(s.x,s.y);
    let moved=false;
    if(blocked(s.x+s.vx*step,s.y+s.vy*step)){
      const out=flush(s.x+s.vx*step,s.y+s.vy*step);
      if(out?.normals&&!blocked(out.x,out.y)){
        s.x=out.x;s.y=out.y;if(s.grounded)s.z=height(s.x,s.y);moved=true;
        for(const [nx,ny] of out.normals){const into=s.vx*nx+s.vy*ny;if(into<0){s.vx-=into*nx;s.vy-=into*ny;}}
      }else if(out){s.vx=s.vy=0;}
      else{
        // Slide along what stopped us on a world axis: for an untyped box the
        // free axis of the move is the tangent; head-on contact still stops.
        const axes=Math.abs(s.vx)>=Math.abs(s.vy)?[[1,0],[0,1]]:[[0,1],[1,0]];
        const free=axes.find(([a,b])=>Math.abs(a*s.vx+b*s.vy)>1e-6&&!blocked(s.x+a*s.vx*step,s.y+b*s.vy*step));
        s.vx*=free?.[0]??0;s.vy*=free?.[1]??0;
      }
    }
    if(!moved&&(s.vx||s.vy)){s.x+=s.vx*step;s.y+=s.vy*step;if(s.grounded)s.z=height(s.x,s.y);}
    if(leaves){
      const inside=hitTest.soft([s.x,s.y,s.z+.9],config.radius_m),before=s.foliage??[];
      if(inside.length){const decay=Math.exp(-leaves.drag_per_s*step);s.vx*=decay;s.vy*=decay;}
      for(const {shape} of inside)if(!before.includes(shape.id)){
        const v=Math.hypot(s.vx,s.vy),[ux,uy]=knockDirection(shape,[s.x,s.y,s.z]);
        s.vx+=ux*leaves.knock*v;s.vy+=uy*leaves.knock*v;s.knock=Math.max(s.knock??0,leaves.knock*v);
        // Which way it pushed him, for presentation: +1 to his left, -1 to his right.
        const h=s.heading??0;s.knockSide=Math.sign(-ux*Math.sin(h)+uy*Math.cos(h))||1;
      }
      s.foliage=inside.map(({shape})=>shape.id);
    }
    s.speed=Math.hypot(s.vx,s.vy);
    if(s.speed>.01)s.heading=Math.atan2(s.vy,s.vx);
    if(s.jumpPhase==='takeoff'){
      s.jumpTime+=step;
      if(s.jumpTime>=j.takeoff_s){
        s.grounded=false;s.jumpPhase='airborne';s.jumpTime=0;
        // A running start adds speed_lift of the ground speed to the launch.
        s.vz=s.jumpVz=(s.jumpTier>1?j.chain_mps[s.jumpTier-2]:['hop','leap'].includes(s.jumpStyle)?j.hop_mps:j.takeoff_mps)+j.speed_lift*s.speed;
      }
    }else if(!s.grounded){
      // Stylized gravity: letting go on the way up raises it, ending the rise
      // early but smoothly, and holding through the top eases it so he hangs at
      // the peak (tap for a crisp hop, hold to float). A held arc stays
      // symmetric about the apex, so he lands as fast as he launched.
      const g=j.gravity_mps2*(s.jumpPhase!=='airborne'?1:!input.jump&&s.vz>0?j.release_gravity:input.jump&&Math.abs(s.vz)<j.apex_mps?j.apex_gravity:1);
      const next=s.z+s.vz*step-.5*g*step*step;
      const ceiling=hitTest?.([s.x,s.y,s.z+1.5],[s.x,s.y,next+1.5],config.radius_m);
      s.vz-=g*step;
      if(ceiling&&next>s.z)s.vz=Math.min(0,s.vz);else s.z=next;
      const floor=height(s.x,s.y)??oldFloor;
      if(Number.isFinite(floor)&&s.z<=floor){
        // A high fall bounces once (tumble_mps, rebound), then tumbles for tumble_s.
        const impact=-s.vz;s.z=floor;s.vz=0;s.jumpTime=0;
        if(s.jumpPhase==='bounce'){s.grounded=true;s.jumpPhase='tumble';}
        else if(j.tumble_mps&&impact>j.tumble_mps){s.landingSpeed=impact;s.vz=impact*j.rebound;s.jumpPhase='bounce';}
        else{s.landingSpeed=impact;s.grounded=true;s.jumpPhase='landing';s.chainLeft=j.chain_s;}
      }
      else s.jumpTime+=step;
    }else if(s.jumpPhase==='landing'||s.jumpPhase==='tumble'){
      s.jumpTime+=step;
      if(s.jumpTime>=(s.jumpPhase==='tumble'?j.tumble_s:landingTime(s,j))){s.jumpPhase='grounded';s.jumpTime=0;}
    }
  }
  s.groundZ=height(s.x,s.y)??state.groundZ??state.z;
  // Signed yaw rate (rad/s, positive turning left) for leaning and turn clips.
  const turn=s.heading-heading;s.turnRate=Math.atan2(Math.sin(turn),Math.cos(turn))/duration;
  s.jumpBuffer=Math.max(0,(s.jumpBuffer??0)-duration);s.chainLeft=Math.max(0,(s.chainLeft??0)-duration);
  // The last knock, for presentation, fading at 4 per second.
  if(leaves)s.knock=(s.knock??0)*Math.exp(-4*duration);
  const phaseDuration=s.jumpPhase==='takeoff'?j.takeoff_s:s.jumpPhase==='landing'?landingTime(s,j):s.jumpPhase==='tumble'?j.tumble_s:
    2*s.landingSpeed*j.rebound/j.gravity_mps2;
  // In the air, progress follows the arc itself (0.5 at the apex), so a jump cut
  // short reaches its apex pose early instead of lagging behind it.
  const v0=s.jumpVz??j.takeoff_mps;
  s.jumpProgress=s.jumpPhase==='grounded'?0:s.jumpPhase==='airborne'?Math.min(1,Math.max(0,(v0-s.vz)/(2*v0))):Math.min(1,s.jumpTime/phaseDuration);
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
  // Only from the ground: never from a trunk or the water.
  if(state?.mode&&state.mode!=='ground')return null;
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
  if(relaunchRefusal(state,walkConfig,flightConfig,height,hitTest))return null;
  const vertical=3.2,speed=flightConfig.modes[state.mode].trim_mps;
  return {...state,grounded:false,speed,vertical,vario:vertical,
    pressure:.45,throttle:state.mode==='paramotor'?.65:0,engine:0,figure:'Ground launch',
    // A collapsed wing is laid out again for the launch.
    ...(state.collapsed!==undefined?{collapsed:false,knock:0,foliage:[]}:{})};
}

/** Why a relaunch here would be refused, or null: 'ground' for footing, slope or
 * an obstacle in the run, 'canopy' when the wing would rise into foliage or a solid.
 */
export function relaunchRefusal(state,walkConfig,flightConfig,height,hitTest){
  if(!unharnessFlight(state,walkConfig,flightConfig,height,hitTest))return 'ground';
  const vertical=3.2,speed=flightConfig.modes[state.mode].trim_mps,base=state.z-flightConfig.landing_clearance_m;
  const ahead=[state.x+Math.cos(state.heading)*3,state.y+Math.sin(state.heading)*3],z=height(...ahead);
  if(!Number.isFinite(z)||z>state.z||hitTest?.([state.x,state.y,state.z],[...ahead,z+flightConfig.landing_clearance_m],.45))return 'ground';
  for(let distance=.2;distance<=3.001;distance+=.2){
    const floor=height(state.x+Math.cos(state.heading)*distance,state.y+Math.sin(state.heading)*distance),t=distance/speed;
    if(!Number.isFinite(floor)||floor>base+vertical*t-6*t*t-.01)return 'ground';
  }
  if(flightConfig.collapse&&hitTest){
    // The wing rises over the first 0.7 s of the run: none of it may meet foliage or a
    // solid there, or the launch would only collapse a moment later.
    const reach=speed*.7;
    for(let d=0;d<=reach+1e-9;d+=.5)
      if(canopyTouches(canopySegment({...state,bank:0,x:state.x+Math.cos(state.heading)*d,y:state.y+Math.sin(state.heading)*d},flightConfig),hitTest))return 'canopy';
  }
  return null;
}

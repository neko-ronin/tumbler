/** Climbing tree trunks in metres (x east, y north, z up). The core judges what
 * can be climbed from the trunk records clients attach to tree colliders.
 */

/** Trunk radius at height z: linear in the profile's [z, r] rows, held at its ends. */
export function trunkRadiusAt(trunk,z){
  const p=trunk.profile;
  if(z<=p[0][0])return p[0][1];
  for(let i=1;i<p.length;i++)if(z<=p[i][0]){const [z0,r0]=p[i-1],[z1,r1]=p[i];return r0+(r1-r0)*(z-z0)/(z1-z0);}
  return p.at(-1)[1];
}

const chest=.9,body=.5;
export const climbRadiusAt=(trunk,z)=>trunkRadiusAt({profile:trunk.climb_profile??trunk.profile},z);
const holdRadius=(trunk,z,c)=>climbRadiusAt(trunk,z)+c.hold_m;

/** The climbable trunk within reach of the cat, or null: thick enough
 * (`min_radius_m`) at his height and below the climbable top. Typed trunks use their round bark; legacy boxes use their bounds.
 */
export function findTrunk(state,input,world,config){
  const c=config.climb,reach=config.radius_m+.15;let best=null,bestGap=Infinity;
  // A round trunk is asked for a metre wider: its reach is judged below, at his feet.
  for(const box of world.hitTest.near?.([state.x,state.y,state.z+chest],reach+1)??[]){
    const t=box.trunk;
    // On a slope he touches the downhill side of the collider below the trunk's base: allow a step's worth.
    if(!t)continue;
    const top=t.climb_top_z??t.top_z;
    if(state.z<t.base_z-config.max_step_m||state.z>top-c.top_clearance_m)continue;
    // Reach is measured at the nearest of his body's collision heights, where a flare stops him;
    // an untyped box keeps the old measure, to its grown extent at his chest.
    const r=trunkRadiusAt(t,state.z+chest),gap=Math.min(...[config.radius_m,chest,1.5].map(h=>Math.hypot(state.x-t.x,state.y-t.y)-trunkRadiusAt(t,state.z+h)));
    if(box.type?gap>reach:!box.min.every((lo,a)=>[state.x,state.y,state.z+chest][a]>=lo-reach&&[state.x,state.y,state.z+chest][a]<=box.max[a]+reach))continue;
    if(r>=c.min_radius_m&&gap<bestGap){best=box;bestGap=gap;}
  }
  return best;
}

export function attachClimb(state,box,config){
  const t=box.trunk,c=config.climb,angle=Math.atan2(state.y-t.y,state.x-t.x),z=Math.min(state.z,(t.climb_top_z??t.top_z)-c.top_clearance_m);
  const s={...state,sliding:false,mode:'climb',trunk:t,trunkBox:box,angle,z,climbPhase:'mount',climbTime:0,climbPush:0,
    grounded:false,jumpPhase:'grounded',jumpTime:0,jumpBuffer:0,chainLeft:0,vx:0,vy:0,vz:0,speed:0,mountFrom:[state.x,state.y]};
  return mount(s,c);
}

/** During the mount he slides from where he grabbed to the bark, eased. */
function mount(s,c){
  place(s,c);
  const u=Math.min(1,s.climbTime/c.mount_s),e=u*u*(3-2*u);
  s.x=s.mountFrom[0]+(s.x-s.mountFrom[0])*e;s.y=s.mountFrom[1]+(s.y-s.mountFrom[1])*e;
  return s;
}

function place(s,c){
  const d=holdRadius(s.trunk,s.z,c);
  s.x=s.trunk.x+Math.cos(s.angle)*d;s.y=s.trunk.y+Math.sin(s.angle)*d;s.heading=s.angle+Math.PI;s.groundZ=s.z;
  return s;
}

/** Leaving the trunk: on the bark he hugs closer than his collision radius, so step
 * him just clear of its collider along his outward direction, or walking rules
 * would see every move start inside it. A round trunk is cleared at its radius;
 * an untyped square box at its corner.
 */
function clearOf(s,config){
  const box=s.trunkBox,ux=Math.cos(s.angle),uy=Math.sin(s.angle);
  if(box.type==='trunk'){const d=climbRadiusAt(s.trunk,s.z)+config.radius_m+.02;return {x:s.trunk.x+ux*d,y:s.trunk.y+uy*d};}
  const half=Math.max(box.max[0]-box.min[0],box.max[1]-box.min[1])/2+config.radius_m+.02;
  const d=Math.max(Math.hypot(s.x-s.trunk.x,s.y-s.trunk.y),half/Math.max(Math.abs(ux),Math.abs(uy)));
  return {x:s.trunk.x+ux*d,y:s.trunk.y+uy*d};
}

/** Up/down along the trunk (stick forward/back), around it (stick right/left),
 * faster with run; jump pushes off as a ground-mode fall. Reaching the floor
 * stands him up; the top below the crown is a perch.
 */
export function stepClimb(state,input,dt,config,world){
  const c=config.climb,s={...state},edge=!!input.jump&&!s.jumpHeld;s.jumpHeld=!!input.jump;
  if(!(dt>0))return s;
  s.climbTime+=dt;
  if(s.climbPhase==='mount'&&!edge){if(s.climbTime>=c.mount_s)s.climbPhase='grip';return mount(s,c);}
  if(edge){
    return pushOffTree(s,input,config);
  }
  const [sx,sy]=input.stick??[0,0],fast=input.run?c.fast_factor:1,top=(s.trunk.climb_top_z??s.trunk.top_z)-c.top_clearance_m;
  const vz=(sy>0?c.up_mps:c.down_mps)*sy*fast,around=c.around_mps*sx*fast;
  for(let remaining=Math.min(dt,.05);remaining>1e-10;){
    const step=Math.min(remaining,1/120);remaining-=step;
    s.z=Math.min(top,s.z+vz*step);
    const angle=s.angle+around*step/holdRadius(s.trunk,s.z,c),d=holdRadius(s.trunk,s.z,c);
    const x=s.trunk.x+Math.cos(angle)*d,y=s.trunk.y+Math.sin(angle)*d;
    // Anything but this tree's own trunk stops the way round.
    const blocked=world.hitTest.near?.([x,y,s.z+body],.25).some(box=>box!==s.trunkBox&&box.trunk!==s.trunk&&
      !(box.crown&&box.crown.x===s.trunk.x&&box.crown.y===s.trunk.y));
    if(!blocked)s.angle=angle;
    place(s,c);
    const floor=world.height(s.x,s.y)??s.trunk.base_z;
    if(vz<0&&s.z<=floor+.02){
      const clear=clearOf(s,config),z=world.height(clear.x,clear.y)??floor;
      return {...s,...clear,mode:'ground',grounded:true,jumpPhase:'grounded',jumpTime:0,z,groundZ:z,vx:0,vy:0,vz:0,speed:0,climbCooldown:.5,climbPhase:undefined,launchReady:false};
    }
  }
  s.vz=vz;s.around=around;s.speed=Math.hypot(vz,around);
  s.climbPhase=s.z>=top-1e-9&&vz>=0?'perch':vz||around?'climb':'grip';
  s.launchReady=s.climbPhase==='perch'&&!!s.trunk.launch_mode;
  return s;
}

/** A deliberate bark push: preserve tangential travel and steer away from the
 * surface. No target snapping and no automatic reattachment on the return. */
export function pushOffTree(s,input,config){
  const c=config.climb,out=[Math.cos(s.angle),Math.sin(s.angle)],tangent=[-out[1],out[0]];
  const length=Math.hypot(input.x??0,input.y??0),wish=length>.1?[(input.x??0)/length,(input.y??0)/length]:out;
  const carry=s.mode==='climb'?(s.around??0):(s.vx??0)*tangent[0]+(s.vy??0)*tangent[1];
  const along=(wish[0]*tangent[0]+wish[1]*tangent[1])*c.jump_out_mps*.75+carry*.5;
  const vx=out[0]*c.jump_out_mps+tangent[0]*along,vy=out[1]*c.jump_out_mps+tangent[1]*along;
  return {...s,...clearOf(s,config),sliding:false,mode:'ground',grounded:false,jumpPhase:'airborne',jumpStyle:'wall',jumpTime:0,jumpProgress:0,
    jumpCount:(s.jumpCount??0)+1,jumpTier:1,jumpHeld:true,jumpBuffer:0,vx,vy,vz:c.jump_up_mps,jumpVz:c.jump_up_mps,
    speed:Math.hypot(vx,vy),heading:Math.atan2(vy,vx),climbCooldown:.25,wallTree:s.trunkBox,climbPhase:undefined,launchReady:false};
}

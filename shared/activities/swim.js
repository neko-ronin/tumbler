/** Swimming in metres (x east, y north, z up; z is his feet). Three states, in `swimPhase`:
 *  - wade: in the shallows (under `swim_depth_m`) he walks on the bed;
 *  - at the surface he floats with his feet `float_draft_m` under it, treading when still, paddling with the stick;
 *  - under (run on: Shift toggles it) he swims freely in 3D (phase 12): the stick swims where the camera looks,
 *    at `dive_mps` along its pitch; still, he hovers at his depth ('hover'); jump rises at `rise_mps` (he sinks
 *    by looking down and swimming: tuck shares Shift, the dive's own toggle). Run off, buoyancy bobs him back to the surface. He never goes below `floor_clear_m` over the bed.
 * Rivers carry him along their flow. Breath is kept as data (`breath_s`: seconds his head has been under,
 * `under`: whether it is) and nothing consumes it yet: the human chose no breath limit (2026-11-14); diving
 * gameplay will read it.
 * `world = {floorHeight, waterAt, height, hitTest}` (see walk.js createWalkHeight).
 */
const DRAG=6;  // m/s² toward the wanted velocity, in water
const HEAD_M=1.55;  // his eyes over his feet: the head is under when this is below the surface

export function stepSwim(state,input,dt,config,world){
  const c=config.swim,s={...state};
  if(!(dt>0)||!Number.isFinite(dt))return s;
  s.jumpHeld=!!input.jump;
  const magnitude=Math.min(1,Math.hypot(input.x??0,input.y??0));
  for(let remaining=Math.min(dt,.05);remaining>1e-10;){
    const step=Math.min(remaining,1/120);remaining-=step;
    const water=world.waterAt(s.x,s.y);
    if(!water){
      // Out of the water: he walks on, standing on the floor.
      const z=world.height(s.x,s.y)??world.floorHeight(s.x,s.y);
      return {...s,mode:'ground',grounded:true,jumpPhase:'grounded',jumpTime:0,z,groundZ:z,vz:0,swimPhase:undefined,under:false,breath_s:0,
        speed:Math.hypot(s.vx??0,s.vy??0)};
    }
    const floor=world.floorHeight(s.x,s.y),wading=water.depth<c.swim_depth_m;
    // Under, the stick swims along the camera's pitch, down or up (negative looks down).
    const diving=!wading&&!!input.run,pitch=diving?Math.max(-1.2,Math.min(1.2,input.pitch??-.3)):0;
    const direction=magnitude?[input.x/Math.hypot(input.x,input.y),input.y/Math.hypot(input.x,input.y)]:[Math.cos(s.heading??0),Math.sin(s.heading??0)];
    const speed=wading?config.walk_mps*.5*magnitude:diving?c.dive_mps*magnitude*Math.cos(pitch):c.paddle_mps*magnitude;
    const [tx,ty]=[direction[0]*speed,direction[1]*speed];
    const dx=tx-(s.vx??0),dy=ty-(s.vy??0),length=Math.hypot(dx,dy),amount=Math.min(1,DRAG*step/(length||1));
    s.vx=(s.vx??0)+dx*amount;s.vy=(s.vy??0)+dy*amount;
    // Height: on the bed when wading; driven down by a dive; otherwise buoyancy
    // eases him toward the float level (never below the bed clearance).
    const float=Math.max(floor+c.floor_clear_m,water.surface_z-c.float_draft_m);
    let vz;
    // Neutrally buoyant under: only the stick's pitch, jump and tuck move him up or down.
    if(diving)vz=c.dive_mps*magnitude*Math.sin(pitch)+(input.jump?c.rise_mps:0);
    // Wading follows the bed at up to 2.9 m/s (a 5 cm frame); floating bobs at rise_mps. Both ease, so no height pops.
    else{const target=wading?floor:float,gap=target-s.z;vz=Math.sign(gap)*Math.min(Math.abs(gap)/step,wading?2.9:c.rise_mps);}
    s.vz=(s.vz??vz)+(vz-(s.vz??vz))*Math.min(1,DRAG*step);
    if(!diving)s.vz=vz;
    const x=s.x+(s.vx+water.flow[0]*c.flow_mps)*step,y=s.y+(s.vy+water.flow[1]*c.flow_mps)*step;
    const blocked=world.hitTest?.([s.x,s.y,s.z+.5],[x,y,s.z+.5],config.radius_m)
      ||(!world.waterAt(x,y)&&(world.height(x,y)??Infinity)>s.z+config.max_step_m);
    if(!blocked){s.x=x;s.y=y;}else{s.vx=0;s.vy=0;}
    // A dive stops floor_clear_m above the bed; otherwise buoyancy eases him and the bed is the floor.
    const contactFloor=world.floorHeight(s.x,s.y);
    s.z=Math.max(diving?contactFloor+c.floor_clear_m:contactFloor,s.z+s.vz*step);
    if(diving)s.z=Math.min(s.z,Math.max(contactFloor+c.floor_clear_m,float));  // a rising dive surfaces at his float, not above it
    s.swimPhase=wading?'wade':diving?(magnitude||input.jump?'dive':'hover'):Math.hypot(s.vx,s.vy)>.05&&magnitude?'paddle':'tread';
    const under=s.z+HEAD_M<water.surface_z;s.breath_s=under?(s.breath_s??0)+step:0;s.under=under;
  }
  s.speed=Math.hypot(s.vx,s.vy);
  if(s.speed>.05)s.heading=Math.atan2(s.vy,s.vx);
  s.groundZ=world.floorHeight(s.x,s.y);
  return s;
}

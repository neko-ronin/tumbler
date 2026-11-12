/** Which movement mode the character is in, and when it changes: ground
 * (walk.js), climb (climb.js). `world = {height, hitTest}`; `input` is the
 * walking input plus `stick: [right, forward]` (raw) and camera `pitch`.
 * A contract without `climb` tuning is plain walking, field for field.
 */
import {mountNearbyBranch,stepBranch,stepTreeJump,branchLanding} from './branches.js';
import {stepWalk} from './walk.js';
import {findTrunk,attachClimb,stepClimb,pushOffTree,trunkGap} from './climb.js';
import {stepSwim} from './swim.js';
import {createBalance,stepBalance,senseGround,DOWN} from './balance.js';

/** Walking spent against a balance budget (balance.js), when the world gives one:
 * `world.balance = {config, surfaceAt(x, y) → 'grass'|'granite'|'snow'}`. On the ground
 * the budget scales the legs' response; once he is down, the balance's velocity moves
 * him through the same swept collision as walking, with his legs out of it. In the air
 * (a jump, a fall) the budget waits. `input.tuck` asks for a roll. Without
 * `world.balance` this is stepWalk, field for field. */
export function stepGround(state,input,dt,config,world,height=world.height){
  const bal=world.balance;
  if(!bal)return stepWalk(state,input,dt,config,height,world.hitTest);
  const before=state.balance??createBalance();
  const onFeet=(state.grounded??true)&&['grounded',undefined].includes(state.jumpPhase);
  if(!onFeet&&!DOWN.has(before.phase))return {...stepWalk(state,input,dt,config,height,world.hitTest),balance:before};
  const ground={...senseGround(height,state.x,state.y),surface:bal.surfaceAt(state.x,state.y)};
  const b=stepBalance(before,ground,{vx:state.vx??0,vy:state.vy??0},input,dt,bal.config);
  if(DOWN.has(b.phase)){
    // No traction: the legs neither push nor brake, so the balance's velocity carries
    // him and the swept collision (trunks, walls, steps) still has its say.
    const s=stepWalk({...state,vx:b.vx,vy:b.vy,jumpPhase:'grounded'},{x:0,y:0},dt,{...config,accel_mps2:0,decel_mps2:0},height,world.hitTest);
    return {...s,balance:{...b,vx:s.vx,vy:s.vy}};
  }
  const k=b.control;
  return {...stepWalk(state,{...input,x:(input.x??0)*k,y:(input.y??0)*k,jump:b.phase==='steady'&&input.jump},dt,config,height,world.hitTest),balance:b};
}

export function stepMoves(state,input,dt,config,world){
  if(state.mode==='branch')return stepBranch(state,input,dt,config,world);
  if(state.mode==='tree-jump')return stepTreeJump(state,input,dt,config,world);
  if(state.mode==='climb'){
    if(input.branch){const branch=mountNearbyBranch(state,config,world);if(branch)return branch;}
    return stepClimb(state,input,dt,config,world);
  }
  if(state.mode==='swim')return stepSwim(state,input,dt,config,world);
  // With swimming, water is a surface he can walk or fall onto, and then swims in.
  // In water he walks (and falls) onto the bed. He starts swimming once it is
  // exit_depth_m deep where he stands, or as he passes the surface of water that
  // deep, and only stops on dry land: the gap keeps a ragged shore from flipping
  // him between the two at every crossing.
  const swims=config.swim&&world.waterAt,bed=(x,y)=>world.waterAt(x,y)?world.floorHeight(x,y):world.height(x,y);
  let s=stepGround(state,input,dt,config,world,swims?bed:world.height);
  const water=swims&&world.waterAt(s.x,s.y);
  if(water&&water.depth>=config.swim.exit_depth_m&&(s.grounded||s.z<=water.surface_z+1e-6||s.jumpPhase==='bounce'))
    s={...s,sliding:false,mode:'swim',balance:undefined,grounded:false,jumpPhase:'grounded',jumpTime:0,jumpBuffer:0,chainLeft:0,vz:0,swimPhase:'wade'};
  if(s.mode==='swim')return s;
  const landed=branchLanding(state,s,config,world);if(landed)return landed;
  const c=config.climb;
  if(!c)return s;
  s.climbCooldown=Math.max(0,(state.climbCooldown??0)-dt);
  const box=s.climbCooldown>0?null:findTrunk(s,input,world,config);
  // A fresh airborne press at a trunk he is not already on pushes off it, keeping
  // the wall-to-wall parkour move. It is `state` that decides — he must have been
  // in the air when the press arrived — because the press that *started* this jump
  // is not also a wall push-off, or jumping at a trunk he is standing against
  // would shove him off it instead of taking hold.
  const jumpEdge=!!input.jump&&!state.jumpHeld;
  const wasAirborne=state.grounded===false;
  if(box&&jumpEdge&&wasAirborne&&box!==state.wallTree&&!['bounce','tumble'].includes(s.jumpPhase)){
    const angle=Math.atan2(s.y-box.trunk.y,s.x-box.trunk.x);
    return pushOffTree({...s,trunk:box.trunk,trunkBox:box,angle},input,config);
  }
  if(box&&takesHold(box,s,input,config))return attachClimb(s,box,config);
  if(s.grounded)s.wallTree=null;
  return s;
}

/** Whether this contact is his to take. In the air anything he meets is, unless
 * the stick is pushed away from it — he is leaving, not arriving, and that also
 * keeps a descent from re-mounting the tree it just left. On the ground it must
 * be bark he is already against with the stick pushed into it, so walking past a
 * trunk never takes hold. The stick is the only intent there is.
 */
function takesHold(box,s,input,config){
  const dx=box.trunk.x-s.x,dy=box.trunk.y-s.y,distance=Math.hypot(dx,dy);
  const magnitude=Math.hypot(input.x??0,input.y??0);
  const aim=distance>1e-6&&magnitude>1e-6?(dx*input.x+dy*input.y)/(distance*magnitude):0;
  if(!s.grounded)return aim>-.35;
  return !s.sliding&&s.jumpPhase==='grounded'&&magnitude>=.5&&aim>.7&&trunkGap(box,s,config)<=config.radius_m+.02;
}

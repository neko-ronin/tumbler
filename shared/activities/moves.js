/** Which movement mode the character is in, and when it changes: ground
 * (walk.js), climb (climb.js). `world = {height, hitTest}`; `input` is the
 * walking input plus `stick: [right, forward]` (raw) and camera `pitch`.
 * A contract without `climb` tuning is plain walking, field for field.
 */
import {mountNearbyBranch,stepBranch,stepTreeJump,branchLanding} from './branches.js';
import {stepWalk} from './walk.js';
import {findTrunk,attachClimb,stepClimb,pushOffTree} from './climb.js';
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
  const grabEdge=!!input.grab&&!state.grabHeld;
  if(config.climb)state={...state,grabHeld:!!input.grab};
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
    s={...s,sliding:false,mode:'swim',balance:undefined,grounded:false,jumpPhase:'grounded',jumpTime:0,jumpBuffer:0,chainLeft:0,vz:0,swimPhase:'wade',climbPush:0};
  if(s.mode==='swim')return s;
  const landed=branchLanding(state,s,config,world);if(landed)return landed;
  const c=config.climb;
  if(!c)return s;
  s.climbCooldown=Math.max(0,(state.climbCooldown??0)-dt);
  const box=s.climbCooldown>0?null:findTrunk(s,input,world,config);
  // A fresh deliberate grab owns attachment, on foot and in the air.
  if(box&&grabEdge&&!s.sliding&&!['bounce','tumble'].includes(s.jumpPhase))return attachClimb(s,box,config);
  const jumpEdge=!!input.jump&&!state.jumpHeld;
  if(box&&jumpEdge&&!state.grounded&&box!==state.wallTree&&!['bounce','tumble'].includes(s.jumpPhase)){
    const angle=Math.atan2(s.y-box.trunk.y,s.x-box.trunk.x);
    return pushOffTree({...s,trunk:box.trunk,trunkBox:box,angle},input,config);
  }
  if(s.grounded)s.wallTree=null;
  return s;
}

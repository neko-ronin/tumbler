/** Which movement mode the character is in, and when it changes: ground
 * (walk.js), climb (climb.js). `world = {height, hitTest}`; `input` is the
 * walking input plus `stick: [right, forward]` (raw) and camera `pitch`.
 * A contract without `climb` tuning is plain walking, field for field.
 */
import {mountNearbyBranch,stepBranch,stepTreeJump,branchLanding} from './branches.js';
import {stepWalk} from './walk.js';
import {findTrunk,attachClimb,stepClimb,pushOffTree} from './climb.js';
import {stepSwim} from './swim.js';

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
  let s=stepWalk(state,input,dt,config,swims?bed:world.height,world.hitTest);
  const water=swims&&world.waterAt(s.x,s.y);
  if(water&&water.depth>=config.swim.exit_depth_m&&(s.grounded||s.z<=water.surface_z+1e-6||s.jumpPhase==='bounce'))
    s={...s,sliding:false,mode:'swim',grounded:false,jumpPhase:'grounded',jumpTime:0,jumpBuffer:0,chainLeft:0,vz:0,swimPhase:'wade',climbPush:0};
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

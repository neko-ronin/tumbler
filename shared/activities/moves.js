/** Which movement mode the character is in, and when it changes: ground
 * (walk.js), climb (climb.js). `world = {height, hitTest}`; `input` is the
 * walking input plus `stick: [right, forward]` (raw) and camera `pitch`.
 * A contract without `climb` tuning is plain walking, field for field.
 */
import {stepWalk} from './walk.js';
import {findTrunk,attachClimb,stepClimb} from './climb.js';
import {stepSwim} from './swim.js';
import {surfaceGap} from './collision.js';

export function stepMoves(state,input,dt,config,world){
  if(state.mode==='climb')return stepClimb(state,input,dt,config,world);
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
    s={...s,mode:'swim',grounded:false,jumpPhase:'grounded',jumpTime:0,jumpBuffer:0,chainLeft:0,vz:0,swimPhase:'wade',climbPush:0};
  if(s.mode==='swim')return s;
  const c=config.climb;
  if(!c)return s;
  s.climbCooldown=Math.max(0,(state.climbCooldown??0)-dt);
  const box=s.climbCooldown>0?null:findTrunk(s,input,world,config);
  // Any airborne contact grabs on; on the ground he must push into the trunk for
  // attach_s: touching its collider (which slides him along it) with the stick
  // pointing at all toward it. Brushing past without touching never grabs.
  if(box&&!s.grounded)return attachClimb(s,box,config);
  // Touching is measured where walking stops him: the nearest of his body's
  // collision heights, so a trunk's flare at his feet still counts.
  const touching=box&&(box.type?Math.min(...[config.radius_m,.9,1.5].map(h=>surfaceGap(box,[s.x,s.y,s.z+h]))):Math.hypot(...[0,1].map(i=>Math.max(box.min[i]-s[i?'y':'x'],0,s[i?'y':'x']-box.max[i]))))<=config.radius_m+.02;
  const toward=touching&&Math.hypot(input.x??0,input.y??0)>.5
    &&((box.trunk.x-s.x)*input.x+(box.trunk.y-s.y)*input.y)/Math.hypot(box.trunk.x-s.x,box.trunk.y-s.y)/Math.hypot(input.x,input.y)>.3;
  s.climbPush=toward&&s.jumpPhase==='grounded'?(state.climbPush??0)+dt:0;
  return s.climbPush>=c.attach_s-1e-9?attachClimb(s,box,config):s;
}

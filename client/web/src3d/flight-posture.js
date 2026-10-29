/** Avatar posture only. A monotone first-order follower removes visual chatter
 * without a spring, displacement clamp or feedback into the shared forces.
 * The physical hip and upper wing anchors are never filtered here.
 */
import * as T from '../vendor/three.module.min.js';

export function createFlightPosture(responseS=.18){
  const rotation=new T.Quaternion();let ready=false;
  return {
    update(target,dt,reset=false){
      if(!ready||reset){rotation.copy(target);ready=true;}
      else rotation.slerp(target,1-Math.exp(-Math.max(0,dt)/responseS));
      return rotation;
    },
    reset(){ready=false;},
  };
}

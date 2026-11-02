/** A compact navigation aid, not a visible world object or steering assist. */
import {Vector3} from '../vendor/three.module.min.js';
export function createParaGuide(element,camera){
 const forward=new Vector3();
 return {update(course,progress,state,enabled=true){
  element.hidden=!enabled||!course||!state||state.grounded||state.collapsed;
  if(element.hidden)return;
  const mark=course.landmarks[progress?.index??0];
  if(!mark){element.textContent=`${course.label} · Valley reached`;return;}
  camera.getWorldDirection(forward);
  const target=Math.atan2(mark.position_m[1]-state.y,mark.position_m[0]-state.x),heading=Math.atan2(-forward.z,forward.x),angle=Math.atan2(Math.sin(target-heading),Math.cos(target-heading));
  const distance=Math.round(Math.hypot(mark.position_m[0]-state.x,mark.position_m[1]-state.y)),back=Math.abs(angle)>2.35;
  const arrow=Math.abs(angle)<.2?'↑':angle>0?(back?'↶':'↖'):(back?'↷':'↗');
  element.textContent=`${arrow}  ${mark.label} · ${distance} m`;
  element.setAttribute('aria-label',`${course.label}: ${mark.label}, ${distance} metres, ${Math.abs(angle)<.2?'ahead':angle>0?'left':'right'}`);
 }};
}

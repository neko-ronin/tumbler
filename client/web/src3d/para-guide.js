/** A compact navigation aid, not a visible world object or steering assist. */
import {Vector3} from '../vendor/three.module.min.js';
export function createParaGuide(element,camera){
 const forward=new Vector3();
 return {update(course,progress,state,enabled=true){
  element.hidden=!!(!enabled||!course||!state||((state.grounded||state.collapsed)&&!['landed','retry'].includes(progress?.phase)));
  if(element.hidden)return;
  const phase=progress?.phase,arrival=course.arrival;
  if(phase==='landed'||phase==='retry'){
   element.textContent=phase==='landed'?`${course.label} · Landed${state.landingQuality==='hard'?' · hard touchdown':''}`:`${course.label} · Run ended`;
   element.setAttribute('aria-label',element.textContent);return;
  }
  const xy=phase==='exit'?arrival?.entry_xy_m:phase==='approach'?arrival?.landing_xy_m:null;
  const mark=xy?{label:phase==='exit'?'Valley exit':arrival.label,position_m:[...xy,state.z]}:course.landmarks[progress?.index??0];
  if(!mark){element.textContent=`${course.label} · Valley reached`;element.setAttribute('aria-label',`${course.label}: Valley reached`);return;}
  camera.getWorldDirection(forward);
  const target=Math.atan2(mark.position_m[1]-state.y,mark.position_m[0]-state.x),heading=Math.atan2(-forward.z,forward.x),angle=Math.atan2(Math.sin(target-heading),Math.cos(target-heading));
  const distance=Math.round(Math.hypot(mark.position_m[0]-state.x,mark.position_m[1]-state.y)),back=Math.abs(angle)>2.35;
  const arrow=Math.abs(angle)<.2?'↑':angle>0?(back?'↶':'↖'):(back?'↷':'↗');
  const index=progress?.index??0,next=course.landmarks[index+1],previous=course.landmarks[index-1];
  // Preview the authored next leg before the current shoulder is passed. This
  // reads route geometry only; the arrow never supplies steering or forces.
  let preview='';
  if(!xy&&next&&previous&&distance<=Math.min(350,Math.max(100,(state.speed??0)*8))){
   const a=mark.position_m.map((v,i)=>v-previous.position_m[i]),b=next.position_m.map((v,i)=>v-mark.position_m[i]);
   const turn=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
   preview=` · then ${Math.abs(turn)<.35?'↑':turn>0?'↶':'↷'} ${next.label}`;
  }
  element.textContent=`${arrow}  ${mark.label} · ${distance} m${preview}`;
  element.setAttribute('aria-label',`${course.label}: ${mark.label}, ${distance} metres, ${Math.abs(angle)<.2?'ahead':angle>0?'left':'right'}${preview.replace('↶','left toward').replace('↷','right toward').replace('↑','ahead toward')}`);
 }};
}

/** Optional course guidance in core XYZ metres. Landmarks are suggestions:
 * generous plane-crossing bypasses advance the guide without racing fail states.
 * No forces, camera changes, position writes, or prescribed flight heights.
 */
export function stepScenicCourse(course,progress,state,launchXY){
 let index=progress?.index??0;
 const p=[state.x,state.y,state.z],previous=progress?.position??p;
 for(;index<course.landmarks.length;index++){
  const mark=course.landmarks[index],q=mark.position_m;
  const a=index?course.landmarks[index-1].position_m:launchXY;
  const dx=p[0]-previous[0],dy=p[1]-previous[1],dz=p[2]-previous[2];
  const t=Math.max(0,Math.min(1,((q[0]-previous[0])*dx+(q[1]-previous[1])*dy+(q[2]-previous[2])*dz)/(dx*dx+dy*dy+dz*dz||1)));
  const distance=Math.hypot(previous[0]+t*dx-q[0],previous[1]+t*dy-q[1],previous[2]+t*dz-q[2]);
  const passed=(p[0]-q[0])*(q[0]-a[0])+(p[1]-q[1])*(q[1]-a[1])>=0;
  const bypass=passed&&Math.hypot(p[0]-q[0],p[1]-q[1])<mark.radius_m*3&&Math.abs(p[2]-q[2])<150;
  if(distance>mark.radius_m&&!bypass)break;
 }
 const complete=index===course.landmarks.length,arrival=course.arrival?.modes.includes(state.mode)?course.arrival:null;
 let phase=progress?.phase??'route';
 if(arrival){
  if(phase==='route'&&complete)phase='exit';
  if(phase==='exit'&&Math.hypot(state.x-arrival.entry_xy_m[0],state.y-arrival.entry_xy_m[1])<=arrival.entry_radius_m)phase='approach';
  if(!['landed','retry'].includes(phase)){
   if(state.collapsed)phase='retry';
   else if(state.grounded)phase=phase==='approach'&&Math.hypot(state.x-arrival.landing_xy_m[0],state.y-arrival.landing_xy_m[1])<=arrival.landing_radius_m?'landed':'retry';
  }
 }
 return {index,position:p,complete,phase};
}

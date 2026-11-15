import * as T from '../vendor/three.module.min.js';

/** The pilot's head inside the harness: looks into the turn, partly counter-rolls
 * against the swing, sinks under load and buffets with the air. Presentation
 * only; never reads back into flight. strength 0 (reduced motion) is a still head. */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number.isFinite(v)?v:0));
export function createFirstPersonHead(){
 let yaw=0,roll=0,pitch=0,sink=0,clock=0;
 const pose={yaw:0,roll:0,pitch:0,sink:0};
 return {update(state,dt,strength=1,reset=false){
  const step=clamp(dt,0,.1),follow=s=>reset?1:1-Math.exp(-step/s),bank=state.bank??0;
  clock+=step;
  yaw+=(-bank*.3-yaw)*follow(.32);
  roll+=(-bank*.3-roll)*follow(.2);
  pitch+=(-(state.pilotPitch??0)*.3-pitch)*follow(.25);
  sink+=(clamp((state.load??1)-1,-.6,2.5)*.022-sink)*follow(.14);
  const rush=clamp(((state.speed??0)/35)**2,0,1.8),rough=Math.abs(state.turbulence??0);
  const amp=(rush*.0011+rough*.0014)*strength;
  const a=Math.sin(clock*41)+.6*Math.sin(clock*67+1.3),b=Math.sin(clock*53+.7)+.6*Math.sin(clock*29+2.1);
  pose.yaw=yaw*strength+a*amp*.5;pose.roll=roll*strength+b*amp;pose.pitch=pitch*strength+b*amp*.8;pose.sink=sink*strength;
  return pose;
 }};
}

// Work in the pilot's frame so a bank, wingover or the physical suspension
// changes the safe look with the body. Keep the level and upward view free.
function cockpitLook(forward,down){
 const front=clamp((forward-.03)/.88,0,1);
 const arc=front*front*(3-2*front);
 const limit=.16+.92*arc,knee=.15;
 const start=limit-knee,excess=Math.max(0,down-start);
 const bend=clamp((down-.34)/.59,0,1);
 return {
  down:Math.min(down,start)+knee*(-Math.expm1(-excess/knee)),
  lean:.215*Math.sqrt(arc)*bend*bend*(3-2*bend),
 };
}

/** Fit the requested camera view to the local cockpit.
 * Far from vertical, use the actual azimuth relative to the pilot. Blend
 * toward manual yaw near the poles, where camera pitch can dominate azimuth. */
export function createCockpitCamera(){
 const aim=new T.Vector3(),up=new T.Vector3(),ahead=new T.Vector3();
 const horizontal=new T.Vector3(),neutral=new T.Vector3(),fittedAim=new T.Vector3(),swing=new T.Quaternion();
 const collar=new T.Vector3(),awayAxis=new T.Vector3(),sideAxis=new T.Vector3(),plane=new T.Vector3();
 const viewInverse=new T.Quaternion(),baseView=new T.Quaternion(),trialView=new T.Quaternion(),turn=new T.Quaternion();
 const planes=[[-1,0],[1,0],[0,-1],[0,1],[0,0]];
 return (camera,pilotMatrix,eye,collarBounds,hipY,scale,sink,yaw,fov=camera.fov)=>{
  up.setFromMatrixColumn(pilotMatrix,1);
  ahead.setFromMatrixColumn(pilotMatrix,2);
  aim.set(0,0,-1).applyQuaternion(camera.quaternion);
  const down=-Math.asin(clamp(aim.dot(up),-1,1));
  horizontal.copy(aim).projectOnPlane(up);
  neutral.set(-Math.sin(yaw),0,-Math.cos(yaw)).projectOnPlane(up);
  if(neutral.lengthSq()<1e-8)neutral.copy(ahead);
  neutral.normalize();
  const radius=horizontal.length();
  const blend=clamp(radius/.48,0,1);
  const weight=blend*blend*(3-2*blend);
  const heading=neutral.dot(ahead)*(1-weight)+(radius>1e-8?horizontal.dot(ahead)*weight/radius:0);
  const fit=cockpitLook(heading,down);
  if(down-fit.down>1e-9){
   // Blend the full aim around the down pole, with a forward bias through
   // the overlap so opposing azimuths do not aim back through the closure.
   fittedAim.copy(horizontal).normalize().multiplyScalar(Math.cos(fit.down)).addScaledVector(up,-Math.sin(fit.down));
   const stableAim=neutral.multiplyScalar(Math.cos(fit.down)).addScaledVector(up,-Math.sin(fit.down));
   fittedAim.lerp(stableAim,1-weight).addScaledVector(ahead,.52*weight*(1-weight)*4).normalize();
   camera.quaternion.premultiply(swing.setFromUnitVectors(aim,fittedAim));
  }
  camera.position.set(eye[0]*scale,hipY+(eye[1]-hipY)*scale-sink,(eye[2]+fit.lean)*scale+sink*.4)
   .applyMatrix4(pilotMatrix);

  // Keep the upper closure out of the frustum at any cockpit angle.
  if(!collarBounds)return;
  const {centre,radius:collarRadius,halfSize}=collarBounds;
  const halfFov=fov*Math.PI/360,tanY=Math.tan(halfFov),tanX=tanY*camera.aspect;
  sideAxis.setFromMatrixColumn(pilotMatrix,0);
  collar.set(centre[0]*scale,hipY+(centre[1]-hipY)*scale,centre[2]*scale)
   .applyMatrix4(pilotMatrix).sub(camera.position);
  function clearance(view){
   let outside=-Infinity;
   for(const [x,y] of planes){
    plane.set(x,y,x?tanX:y?tanY:1).normalize().applyQuaternion(view);
    const extent=scale*(halfSize[0]*Math.abs(plane.dot(sideAxis))+
     halfSize[1]*Math.abs(plane.dot(up))+halfSize[2]*Math.abs(plane.dot(ahead)));
    outside=Math.max(outside,plane.dot(collar)+(!x&&!y?camera.near:0)-extent);
   }
   return outside;
  }
  const margin=.003;
  const initial=clearance(camera.quaternion);
  if(initial>=margin)return;
  // Move directly away from the collar. The cone around all four viewport
  // corners gives an outside endpoint. Find the first clear pose along it
  // against the tighter oriented box, so a slight bank only nudges the view.
  baseView.copy(camera.quaternion);
  aim.copy(collar).applyQuaternion(viewInverse.copy(baseView).invert());
  const corner=Math.atan(Math.hypot(tanX,tanY));
  const separation=Math.atan2(Math.hypot(aim.x,aim.y),-aim.z);
  let low=0,high=Math.max(0,corner+Math.asin(clamp(collarRadius*scale/collar.length(),0,1))+.08-separation);
  awayAxis.set(-aim.y,aim.x,0);
  if(awayAxis.lengthSq()<1e-12)awayAxis.set(1,0,0);
  awayAxis.normalize().applyQuaternion(baseView);
  for(let i=0;i<10;i++){
   const middle=(low+high)*.5;
   trialView.copy(baseView).premultiply(turn.setFromAxisAngle(awayAxis,middle));
   if(clearance(trialView)>=margin)high=middle;
   else low=middle;
  }
  camera.quaternion.premultiply(turn.setFromAxisAngle(awayAxis,high));
 };
}

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

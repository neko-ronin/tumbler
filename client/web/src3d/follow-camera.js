/** Browser camera dynamics. Authored taste lives in shared camera.json. */
const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
/** Exact critically damped response for a fixed goal over this frame. The stored
 * velocity carries across automatic direction/speed changes; manual look owns
 * the view immediately. A zero response preserves legacy distance policies. */
function damp(value,velocity,goal,dt,response){
 if(!(response>0))return [goal,0];
 const w=2/response,change=value-goal,pull=(velocity+w*change)*dt,decay=Math.exp(-w*dt);
 return [goal+(change+pull)*decay,(velocity-w*pull)*decay];
}
export function createFollowCamera(){
 let quiet=Infinity,commitment=0,direction=null,previousHeading=null,holdProgress=0,progress=0,startYaw=null,startPitch=0,distanceMode=null;
 let yawVelocity=0,pitchVelocity=0,goalYaw=null,goalPitch=0,lastEase=0;
 const forgetResponse=()=>{yawVelocity=0;pitchVelocity=0;goalYaw=null;};
 const restart=()=>{commitment=0;direction=null;holdProgress=0;progress=0;startYaw=null;};
 const present=(dt,yaw,pitch,profile,start=false)=>{
  const [nextYaw,nextVelocity]=damp(yaw,yawVelocity,yaw+angle(goalYaw-yaw),dt,profile.follow_response_s);
  const limit=Number.isFinite(profile.max_turn_rad_s)?profile.max_turn_rad_s*dt:Infinity;
  const turn=Math.max(-limit,Math.min(limit,nextYaw-yaw));
  yawVelocity=Math.abs(nextYaw-yaw)>limit?(dt>0?turn/dt:0):nextVelocity;
  [pitch,pitchVelocity]=damp(pitch,pitchVelocity,goalPitch,dt,profile.follow_response_s);
  return {yaw:yaw+turn,pitch,distanceFollow:true,distanceEase:lastEase,distanceStart:start};
 };
 return {
  manual(){quiet=0;restart();forgetResponse();},
  reset(){quiet=Infinity;previousHeading=null;restart();forgetResponse();},
  step(dt,yaw,pitch,heading,moving,profile,held=false,transport=false,distanceM=0){
   const nextDistanceMode=profile.follow_distance_m>0;
   if(nextDistanceMode!==distanceMode){restart();forgetResponse();distanceMode=nextDistanceMode;}
   const travelTurn=previousHeading===null?0:angle(heading-previousHeading);previousHeading=heading;
   dt=Math.max(0,dt);quiet=held?0:quiet+dt;
   if(held){restart();forgetResponse();return {yaw,pitch};}
   if(!moving){
    if(!nextDistanceMode)restart();
    return nextDistanceMode&&goalYaw!==null&&profile.follow_response_s>0?present(dt,yaw,pitch,profile):{yaw,pitch};
   }
   // Commitment is to a travel direction, not to holding any movement key.
   // Reversing or wandering restarts the gentle ground-camera ramp.
   if(direction===null||(((profile.follow_hold_s??0)>0||profile.follow_distance_m>0)&&Math.abs(angle(heading-direction))>.35)){restart();direction=heading;}
   commitment+=dt;
   if(quiet<profile.return_delay_s||!profile.follow_rate)return {yaw,pitch};
   if(profile.follow_distance_m>0){
    const start=startYaw===null;
    if(start){startYaw=goalYaw??yaw;startPitch=goalYaw===null?pitch:goalPitch;}
    const hold=Math.min(profile.follow_distance_m*.95,profile.follow_hold_m>0?profile.follow_hold_m:profile.follow_distance_m*(profile.follow_hold_fraction??0));
    // Integrate progress rather than dividing all past travel by a changing
    // speed-dependent window. Accelerating cannot jump the view, and slowing
    // down cannot unwind correction or reopen the trailing gap.
    let remaining=Math.max(0,distanceM);
    if(hold>0&&holdProgress<1){const used=Math.min(remaining,(1-holdProgress)*hold);holdProgress+=used/hold;remaining-=used;}
    else holdProgress=1;
    progress=Math.min(1,progress+remaining/(profile.follow_distance_m-hold));
    const u=progress;
    // Quintic easing spreads acceleration over a broader part of the window
    // than the old seventh-degree curve, with zero end velocity/acceleration.
    lastEase=u*u*u*(10+u*(-15+6*u));
    goalYaw=startYaw+angle(heading-startYaw)*lastEase;
    goalPitch=startPitch+(profile.pitch-startPitch)*lastEase;
    return present(dt,yaw,pitch,profile,start);
   }
   // On a trunk, carry the chosen orbit with its changing surface normal.
   // This removes turn-rate-dependent lag on narrow trunks while the tight
   // correction brings the view back after a manual look.
   const carried=transport?travelTurn:0;yaw+=carried;
   const hold=profile.follow_hold_s??0,ramp=profile.follow_ramp_s??0;
   const u=commitment<=hold?0:ramp>0?Math.min(1,(commitment-hold)/ramp):1;
   const strength=u*u*(3-2*u),k=1-Math.exp(-dt*profile.follow_rate*strength);
   const turn=angle(heading-yaw)*k,limit=Number.isFinite(profile.max_turn_rad_s)?profile.max_turn_rad_s*dt*strength:Infinity;
   const result={yaw:yaw+Math.max(-limit,Math.min(limit,turn)),pitch:pitch+(profile.pitch-pitch)*k};
   if(transport)result.transport=carried;return result;
  }
 };
}
/** Hard constraint AFTER interpolation/intro/shake. Cover the near-plane footprint,
 * not just the eye. It uses the same physical floor as navigation. */
export function clearCameraTerrain(position,height,radius=.45){
 let floor=-Infinity;
 for(const [dx,dy] of [[0,0],[radius,0],[-radius,0],[0,radius],[0,-radius],[radius,radius],[-radius,radius],[radius,-radius],[-radius,-radius]]){
  const h=height(position.x+dx,-position.z+dy);if(Number.isFinite(h))floor=Math.max(floor,h);
 }
 position.y=Math.max(position.y,floor+radius);
 return position;
}
/** Lift a full-length boom above intervening terrain. Retracting toward an aim
 * lagging uphill can put the eye inside the player. Raising the eye retains
 * distance; its height is the smallest linear boom clearing all sampled floors. */
export function clearTerrainBoom(eye,target,height,radius=.45){
 const dx=eye.x-target.x,dz=eye.z-target.z;
 const n=Math.min(512,Math.max(1,Math.ceil(Math.hypot(dx,dz)/.2)));
 let required=eye.y;
 for(let i=1;i<=n;i++){
  const t=i/n,h=height(target.x+dx*t,-target.z-dz*t);
  if(Number.isFinite(h))required=Math.max(required,target.y+(h+radius-target.y)/t);
 }
 eye.y=required;return clearCameraTerrain(eye,height,radius);
}
/** Interpolate an orbit in angles, never a chord through the player's head.
 * Translating the target translates the boom immediately; only the orbit eases. */
export function createCameraBoom(){
 let azimuth=null,elevation=0,length=0;
 return {
  reset(){azimuth=null;},
  rotate(delta){if(azimuth!==null)azimuth+=delta;},
  place(out,target,desired,dt,snap=false){
   const x=desired.x-target.x,y=desired.y-target.y,z=desired.z-target.z;
   const heading=Math.atan2(x,z),tilt=Math.atan2(y,Math.hypot(x,z)),distance=Math.hypot(x,y,z);
   const k=1-Math.exp(-Math.max(0,dt)*10);
   if(snap||azimuth===null){azimuth=heading;elevation=tilt;length=distance;}
   else{azimuth+=angle(heading-azimuth)*k;elevation+=(tilt-elevation)*k;length+=(distance-length)*k;}
   const horizontal=Math.cos(elevation)*length;
   return out.set(target.x+Math.sin(azimuth)*horizontal,target.y+Math.sin(elevation)*length,target.z+Math.cos(azimuth)*horizontal);
  }
 };
}

/** Radius enclosing the current perspective near plane, including wide viewports. */
export function cameraTerrainRadius(camera){
 const near=camera.near??.15,tan=Math.tan((camera.fov??62)*Math.PI/360);
 return Math.max(.45,near*Math.sqrt(1+tan*tan*(1+(camera.aspect??1)**2))+.05);
}

/** Range can lag along with heading: hold the old eye as a world anchor, then
 * ease its radius toward the normal chase distance using the same travel curve.
 * The near-character safety bound has priority over the soft distance lag. */
export function createFollowRange(){
 let anchor=null,current=null;
 return {
  reset(){anchor=null;current=null;},
  update(eye,focus,wanted,ease,start=false,minimum=0,maximum=Infinity){
   if(start||anchor===null)anchor={x:eye.x,y:eye.y,z:eye.z};
   if(ease!==undefined){
    const lag=Math.hypot(anchor.x-focus.x,anchor.y-focus.y,anchor.z-focus.z);
    current=lag+(wanted-lag)*ease;
    // Round the soft far-range limit so opening a gap does not suddenly stop
    // the boom's radial motion. The near-character bound remains a hard safety.
    const width=Number.isFinite(maximum)?Math.max(0,Math.min(.75,(maximum-minimum)/2)):0;
    if(width>0&&current>maximum-width&&current<maximum+width)current=maximum-(maximum+width-current)**2/(4*width);
    current=Math.max(minimum,Math.min(maximum,current));
   }
   return current??wanted;
  }
 };
}
/** Lower the subject by a fraction of its existing distance to the bottom.
 * Measure the animated body after the ordinary aim, preserving the jump aim's
 * natural movement in frame. Half means (old screen Y + bottom) / 2. */
export function composeFollowView(camera,target,lowerFraction=0,subject=target,centerFraction=0){
 camera.lookAt(centerFraction?target.clone().lerp(subject,centerFraction):target);
 if(!lowerFraction)return;
 const local=subject.clone().sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
 const before=Math.atan2(local.y,-local.z),tan=Math.tan(camera.fov*Math.PI/360);
 const ndc=Math.tan(before)/tan,after=Math.atan((ndc*(1-lowerFraction)-lowerFraction)*tan);
 camera.rotateX(before-after);
}

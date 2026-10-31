/** Keyboard, pointer and Gamepad input; flight, ski and bike rules live in shared/. */
import * as T from '../vendor/three.module.min.js';
import {launchFlight,stepFlight,sampleAir,flightFrame,pilotFrame,startFlightChallenge} from '../../../shared/activities/flight.js';
import {rideStart,startRide,stepRide} from '../../../shared/activities/ride.js';
import {flightInput} from './flight-input.js';
import {gaitFor,unharnessFlight,reharnessWalk,relaunchGround,relaunchRefusal,safeWalkGround} from '../../../shared/activities/walk.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {createFixedAirSampler} from './fixed-air.js';
import {createFlightPosture} from './flight-posture.js';
const JUMP_FRAME_M=2,AIM_S=.5,SHOT_S=2.5;
export function createNavigation(camera,canvas,orbit,ground,config,worldmap,rig,hitTest,ride,character,characterConfig,options={}){
  let mode='orbit',state=null,previousFlight=null,accumulator=0,time=0,yaw=0,pitch=0,drag=false,view='chase',hop=false,snap=true,shot=null;
  let weather='soaring',siteIndex=0,feedbackTime=0,effects=1,aimY=null,aimV=0,restTime=0,challengeId='';
  let actionArmed=false,harnessArmed=false,actionHeld=false,queuedPrimary=false,queuedHarness=false,message='',parkedWing=null,underwater=false;
  const flightPressed=new Set(),flightModes=Object.keys(config.modes);
  const pressed=new Set(),riding=()=>ride.config.modes[mode]!==undefined,chase=new T.Vector3();
  const keys=new Set(),blockedActions=new Set(),look=new T.Euler(0,0,0,'YXZ');
  const height=(x,y)=>options.floorHeight?.(x,y)??ground.height(x,y)??0;
  const forward=new T.Vector3(),side=new T.Vector3();
  const target=new T.Vector3();
  const flightMatrix=new T.Matrix4(),pilotMatrix=new T.Matrix4(),pilotTransform=new T.Matrix4(),flightLeft=new T.Vector3(),flightUp=new T.Vector3(),flightForward=new T.Vector3();
  const pilotPosture=createFlightPosture(),physicalPilotRotation=new T.Quaternion(),pilotOrigin=new T.Vector3(),pilotUp=new T.Vector3(),unitScale=new T.Vector3(1,1,1);
  let pilotMotion=options.pilotMotion??'steady';
  let presentedGrounded=null,landingClipLeft=0,carried=null;
  function frameMatrix(frame,out){
    flightLeft.set(frame.left[0],frame.left[2],-frame.left[1]);
    flightUp.set(frame.up[0],frame.up[2],-frame.up[1]);
    flightForward.set(frame.forward[0],frame.forward[2],-frame.forward[1]);
    return out.makeBasis(flightLeft,flightUp,flightForward).setPosition(frame.origin[0],frame.origin[2],-frame.origin[1]);
  }
  const clear=()=>{for(const code of ['Space','KeyE'])if(keys.has(code))blockedActions.add(code);keys.clear();drag=false;accumulator=0;previousFlight=null;pilotPosture.reset();presentedGrounded=config.modes[mode]?(state?.grounded??null):null;landingClipLeft=0;actionArmed=false;harnessArmed=false;actionHeld=false;queuedPrimary=false;queuedHarness=false;hop=false;};
  function key(e,down){
    // A control may receive focus between press and release. Always retire
    // the held key, while leaving form key presses to the form itself.
    if(!down){blockedActions.delete(e.code);keys.delete(e.code);return;}
    if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if(down&&(['Space','KeyE'].includes(e.code))&&(e.repeat||blockedActions.has(e.code)))return;
    if(down&&e.code==='Space')queuedPrimary=true;if(down&&e.code==='KeyE')queuedHarness=true;
    if(down&&!e.repeat&&e.code==='Space')hop=true;if(down&&!e.repeat&&e.code==='KeyV'&&(mode==='walk'||mode==='gondola'||riding()||config.modes[mode]))toggleView();
    if(down&&!e.repeat&&e.code==='KeyF'&&mode==='walk')character.toggleKatana?.();
    if(down&&!e.repeat&&e.code==='KeyQ'&&mode==='walk')character.attack?.();
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyR','KeyF','KeyE'].includes(e.code)){if(down)keys.add(e.code);else keys.delete(e.code);if(e.target===canvas)e.preventDefault();}}
  const kd=e=>key(e,true),ku=e=>key(e,false);
  window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);window.addEventListener('gamepaddisconnected',clear);
  // On foot, a click that does not drag the view is an attack.
  let press=null;
  const down=e=>{if(mode==='orbit')return;drag=true;press={x:e.clientX,y:e.clientY,t:e.timeStamp};canvas.focus();canvas.setPointerCapture(e.pointerId);};
  const up=e=>{drag=false;if(press&&mode==='walk'&&e.button===0&&e.timeStamp-press.t<300&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<6)character.attack?.();press=null;};
  const move=e=>{if(mode==='orbit'||(!drag&&document.pointerLockElement!==canvas))return;yaw-=e.movementX*.003;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.003));};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointermove',move);
  const dead=v=>Math.abs(v??0)<.14?0:Math.sign(v)*(Math.abs(v)-.14)/.86;
  function toggleView(){shot=null;view=view==='chase'?'first':'chase';if(riding())ride.rig.visible=view==='chase';snap=true;}
  function select(next,site='0'){
    if(next==='walk'&&config.modes[mode]){changeHarness();return;}
    if(mode==='walk'&&config.modes[next]){
      const hooked=reharnessWalk({...state,harnessMode:next,harnessWeather:weather},characterConfig.walk,config,walkHeight,hitTest);
      if(!hooked){message='Find clear, stable ground to put on the harness';return;}
      clear();mode=next;state=startFlightChallenge(hooked,challengeId,config);message='';parkedWing=null;
      rig.visible=true;ride.rig.visible=false;character.object.visible=true;orbit.enabled=false;
      snap=true;view='chase';yaw=0;pitch=-.34;updateFlightPresentation(0);
      options.onFlightChange?.(mode,siteIndex,weather);return;
    }
    const previous=mode==='orbit'?null:state;
    // Look around → walk is one continuous shot: the camera glides from where it was down to the chase view.
    shot=mode==='orbit'&&next==='walk'?{from:camera.position.clone(),q:camera.quaternion.clone(),fov:camera.fov,raw:new T.Vector3(),aim:new T.Quaternion(),t:0}:null;
    clear();message='';parkedWing=null;mode=next;camera.fov=62;camera.updateProjectionMatrix();orbit.enabled=next==='orbit';rig.visible=config.modes[next]!==undefined;ride.rig.visible=riding()&&view==='chase';
    character.object.visible=characterConfig.modes.includes(next);snap=true;
    if(next==='orbit'){orbit.setTarget(camera.position.x,camera.position.y,camera.position.z-20);return;}
    const direction=new T.Vector3();camera.getWorldDirection(direction);yaw=Math.atan2(-direction.x,-direction.z);pitch=0;
    if(next==='walk'){
      const x=previous?.x??camera.position.x,y=previous?.y??-camera.position.z;
      state={x,y,z:height(x,y),heading:previous?.heading??yaw+Math.PI/2,speed:0};
      pitch=-.24;character.object.rotation.set(0,state.heading+Math.PI/2,0);updateWalk(0,0,0,false);return;
    }
    if(riding()){
      state=startRide(ride.config,rideStart(ride.config,site,worldmap,ride.snowAt),ride.height);yaw=0;pitch=0;snap=true;hop=false;
      for(const [name,mesh] of Object.entries(ride.meshes))mesh.visible=name===next;return;
    }
    siteIndex=Number(site)||0;state=startFlightChallenge(launchFlight(config,next,config.launches[siteIndex],height,weather),challengeId,config);yaw=0;pitch=-.34;
    options.onFlightChange?.(next,siteIndex,weather);
    updateFlightPresentation(0);
  }
  const walkHeight=(x,y)=>options.walkHeight?.(x,y)??(options.walkHeight?null:ground.height(x,y));
  const launchHeight=(x,y)=>safeWalkGround(x,y,characterConfig.walk,walkHeight,hitTest,{dropOffs:true});
  const characterHeight=(x,y)=>options.characterHeight?.(x,y)??walkHeight(x,y)??height(x,y);
  function changeHarness(){
    const foot=config.modes[mode]?unharnessFlight(state,characterConfig.walk,config,walkHeight,hitTest):null;
    const hooked=mode==='walk'?reharnessWalk(state,characterConfig.walk,config,walkHeight,hitTest):null;
    if(!foot&&!hooked){message='Find clear, stable ground before changing harness';return false;}
    pilotPosture.reset();presentedGrounded=null;landingClipLeft=0;
    parkedWing=foot?{...state,pressure:0,engine:0,throttle:0,harnessed:false,launching:false}:null;
    state=foot??hooked;mode=foot?'walk':hooked.mode;accumulator=0;previousFlight=null;actionArmed=false;harnessArmed=false;actionHeld=false;message='';snap=true;view='chase';
    orbit.enabled=false;rig.visible=true;character.object.visible=true;
    if(foot){yaw=state.heading-Math.PI/2;pitch=-.24;character.object.rotation.set(0,state.heading+Math.PI/2,0);camera.fov=62;camera.updateProjectionMatrix();updateWalk(0,0,0,false);}
    else{yaw=0;pitch=-.34;updateFlightPresentation(0);}
    options.onFlightChange?.(mode,siteIndex,weather);return true;
  }
  function launchHere(){
    if(!config.modes[mode]||!state.grounded||state.launching)return false;
    const launched=relaunchGround(state,characterConfig.walk,config,walkHeight,hitTest);
    if(launched){state=startFlightChallenge(launched,challengeId,config);previousFlight=null;accumulator=0;message='';return true;}
    message=relaunchRefusal(state,characterConfig.walk,config,walkHeight,hitTest)==='canopy'?'No room for the wing here':'Need clear, stable ground and room ahead to launch';return false;
  }
  /** Ride something the core moves (a gondola cabin): {x, y, z, heading} of the floor he stands on, every frame. */
  function carry(pose){
    if(mode!=='gondola'){
      clear();message='';parkedWing=null;mode='gondola';orbit.enabled=false;rig.visible=false;ride.rig.visible=false;
      character.object.visible=true;camera.fov=62;camera.updateProjectionMatrix();snap=true;yaw=0;pitch=-.12;
    }
    carried=pose;state={x:pose.x,y:pose.y,z:pose.z,heading:pose.heading,speed:0};
  }
  /** Step off onto the ground at [x, y], on foot. */
  function alight(x,y,heading){state={x,y,heading};carried=null;mode='gondola';select('walk');}
  /** Called on display refreshes between render frames: a controller A tap
   * shorter than one 30 FPS frame is latched like a keyboard tap. */
  function poll(){if([...(navigator.getGamepads?.()??[])].find(p=>p?.connected)?.buttons[0]?.pressed)queuedPrimary=true;}
  function update(dt){
    const pad=[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);
    if(mode==='gondola'){time+=Math.min(dt,.05);updateCarried(dt,pad);return;}
    if(!riding()){
      const edge=i=>{const now=pad?.buttons[i]?.pressed??false,was=flightPressed.has(i);now?flightPressed.add(i):flightPressed.delete(i);return now&&!was;};
      const previous=edge(14),next=edge(15),up=edge(12),down=edge(13),changeView=edge(3),changeWeather=edge(9);
      const primary=(pad?.buttons[0]?.pressed??false)||keys.has('Space')||queuedPrimary;
      const harness=(pad?.buttons[2]?.pressed??false)||keys.has('KeyE')||queuedHarness;
      queuedPrimary=false;queuedHarness=false;
      if(!primary&&!harness){actionArmed=true;harnessArmed=true;}
      let primaryEdge=primary&&actionArmed;
      if(primaryEdge)actionArmed=false;
      actionHeld=primary&&(primaryEdge||actionHeld);
      if(harness&&harnessArmed){harnessArmed=false;primaryEdge=false;changeHarness();}
      if(previous||next){const i=flightModes.indexOf(mode);select(flightModes[(Math.max(0,i)+(next?1:-1)+flightModes.length)%flightModes.length],siteIndex);}
      if(up||down){siteIndex=(siteIndex+(up?-1:1)+config.launches.length)%config.launches.length;if(config.modes[mode])select(mode,siteIndex);}
      if(primaryEdge&&config.modes[mode]&&state.launching){/* A held or repeated launch cannot restart inflation. */}
      else if(primaryEdge&&config.modes[mode]&&state.grounded){
        launchHere();
      }else if(primaryEdge&&mode==='orbit')select('paraglider',siteIndex);
      else if(primaryEdge&&pad?.buttons[0]?.pressed&&config.modes[mode]&&!state.grounded)select(mode,siteIndex);
      if(changeView&&config.modes[mode])toggleView();
      if(changeView&&mode==='walk')character.toggleKatana?.();
      if(edge(11)&&mode==='walk')toggleView();
      if(edge(1)&&mode==='walk')character.attack?.();
      if(changeWeather){const names=Object.keys(config.weather),i=names.indexOf(weather);setWeather(names[(i+1)%names.length]);}
    }
    if(mode==='orbit'){time+=Math.min(dt,.05);orbit.update();return;}
    const lx=dead(pad?.axes[0]),ly=dead(pad?.axes[1]),rx=dead(pad?.axes[2]),ry=dead(pad?.axes[3]);
    yaw-=rx*dt*1.6;pitch=Math.max(-1.35,Math.min(1.35,pitch-ry*dt*1.4));
    const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+lx;
    const y=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-ly;
    if(riding()){time+=Math.min(dt,.05);updateRide(dt,pad,x,y);return;}
    if(mode==='walk'){
      time+=Math.min(dt,.05);
      updateWalk(dt,x,y,keys.has('ShiftLeft')||keys.has('ShiftRight')||(pad?.buttons[10]?.pressed??false));
    }else{
      const input=flightInput(pad,keys);
      accumulator+=Math.min(dt,.05);
      while(accumulator>=1/120){previousFlight=state;state=stepFlight(state,input,1/120,time,config,worldmap.wind.direction_deg,height,hitTest,launchHeight,walkHeight);time+=1/120;accumulator-=1/120;}
      updateFlightPresentation(dt,flightPose());
      feedbackTime+=dt;
      if(options.haptics?.()!==false&&effects&&feedbackTime>.12&&pad?.vibrationActuator?.playEffect){
        feedbackTime=0;const strength=state.grounded?0:Math.min(.45,Math.abs(state.turbulence)*.07+Math.max(0,state.load-1)*.15);
        if(strength>.025)Promise.resolve(pad.vibrationActuator.playEffect('dual-rumble',{duration:110,strongMagnitude:strength*.4,weakMagnitude:strength})).catch(()=>{});
      }
    }
    orbit.target.copy(camera.position);orbit.target.y=height(camera.position.x,-camera.position.z);
  }
  function follow(dt,distance,heading,lift=0){
    target.copy(character.object.position).add(new T.Vector3(0,(config.modes[mode]?2.7:1.1*characterConfig.scale)+lift,0));
    // On foot the aim follows his height on a critically damped spring (Unity's
    // SmoothDamp) instead of riding it: in a jump he rises in the frame while the
    // world holds still, and touchdown eases in rather than jolting, since the
    // aim's speed and acceleration stay continuous. The bound is soft: the
    // further he gets from the aim (JUMP_FRAME_M is far), the quicker it follows.
    const gap=target.y-(aimY??target.y),w=2*(1+(gap/JUMP_FRAME_M)**2)/AIM_S,x=w*dt,decay=1/(1+x+.48*x*x+.235*x*x*x);
    if(snap||aimY===null||mode!=='walk'){aimY=target.y;aimV=0;}
    else{const pull=(aimV-w*gap)*dt;aimV=(aimV-w*pull)*decay;aimY=target.y+(pull-gap)*decay;}
    target.y=aimY;
    const angle=heading-Math.PI/2+yaw;
    chase.set(target.x+Math.sin(angle)*Math.cos(pitch)*distance,target.y-Math.sin(pitch)*distance,target.z+Math.cos(angle)*Math.cos(pitch)*distance);
    chase.y=Math.max(chase.y,height(chase.x,-chase.z)+.45);
    // Pull the camera in along the same view ray when a tree or home blocks it.
    const start=[target.x,-target.z,target.y];
    // While he climbs a tree, that tree's own trunk and crown boxes do not count.
    const own=box=>mode==='walk'&&state?.mode==='climb'&&box.min[0]<=state.trunk.x&&box.max[0]>=state.trunk.x&&box.min[1]<=state.trunk.y&&box.max[1]>=state.trunk.y;
    for(let i=0;i<12;i++){const box=hitTest?.(start,[chase.x,-chase.z,chase.y],.2);if(!box||own(box))break;chase.lerp(target,.2);}
    if(shot&&mode!=='walk')shot=null;
    if(shot&&!snap)camera.position.copy(shot.raw);
    if(snap)camera.position.copy(chase);else camera.position.lerp(chase,1-Math.exp(-dt*10));
    camera.lookAt(target);snap=false;
    if(shot){
      shot.raw.copy(camera.position);shot.aim.copy(camera.quaternion);shot.t+=dt;
      const u=Math.min(1,shot.t/SHOT_S),k=u*u*u*(u*(u*6-15)+10);  // smootherstep: no jolt at either end
      camera.position.lerpVectors(shot.from,shot.raw,k);camera.quaternion.slerpQuaternions(shot.q,shot.aim,k);
      camera.fov=shot.fov+(62-shot.fov)*k;camera.updateProjectionMatrix();
      if(u>=1)shot=null;
    }
  }
  function updateWalk(dt,x,y,run){
    forward.set(-Math.sin(yaw),0,-Math.cos(yaw));side.set(Math.cos(yaw),0,-Math.sin(yaw));
    const movement=forward.clone().multiplyScalar(y).addScaledVector(side,x);
    const before=state.speed??0;
    const water=options.walkHeight?.waterAt;
    // He plants his feet to attack: no steering or jumping until the blow ends.
    const busy=character.attacking===true;
    state=stepMoves(state,{x:busy?0:movement.x,y:busy?0:-movement.z,run:run&&!busy,jump:actionHeld&&!busy,stick:busy?[0,0]:[x,y],pitch},dt,characterConfig.walk,
      {height:walkHeight,hitTest,waterAt:water,floorHeight:options.walkHeight?.floorHeight??options.floorHeight??height});
    const climbing=state.mode==='climb',swimming=state.mode==='swim';
    character.object.position.set(state.x,state.z,-state.y);
    // Where the model faces now versus where it travels: a big gap asks for a pivot.
    const facing=new T.Vector3(0,0,1).applyQuaternion(character.object.quaternion),goalYaw=state.heading+Math.PI/2,turn=goalYaw-Math.atan2(facing.x,facing.z);
    if(climbing)character.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),state.heading+Math.PI/2);
    else if(state.speed>0){
      const goal=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),state.heading+Math.PI/2);
      character.object.quaternion.slerp(goal,1-Math.exp(-dt*14));
    }
    const jumping=state.jumpPhase&&state.jumpPhase!=='grounded';
    // The gait follows the speed the feet actually have, not the Shift key.
    const gait=gaitFor(state.speed,characterConfig.walk,characterConfig.clips);
    character.update(dt,climbing?'climb':swimming?'swim':jumping?'jump':state.speed>.05?gait:'idle',swimming?Math.hypot(state.speed,state.vz??0):state.speed,{climb:climbing?state:null,swim:swimming?state:null,jump:jumping&&!climbing&&!swimming?state:null,turnRate:state.turnRate,accel:dt>0?(state.speed-before)/dt:0,facing:state.speed>.05?Math.atan2(Math.sin(turn),Math.cos(turn)):0,groundZ:characterHeight(state.x,state.y),groundHeight:characterHeight,knock:state.knock,knockSide:state.knockSide});
    if(parkedWing)rig.userData.flightUpdate?.(dt,parkedWing);
    // Walk heading follows movement; the camera's yaw stays independently controllable.
    character.object.visible=view==='chase';
    if(view==='first'){
      camera.position.set(state.x,state.z+1.65*characterConfig.scale,-state.y);
      look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);snap=false;
    }else follow(dt,(climbing?6.9:5.4)*characterConfig.scale,Math.PI/2,(climbing?.6:0)*characterConfig.scale);
    // Below the water's surface, the client tints and fogs the view (main.js).
    const overhead=water?.(camera.position.x,-camera.position.z);underwater=!!overhead&&camera.position.y<overhead.surface_z;
  }
  function updateCarried(dt,pad){
    yaw-=dead(pad?.axes[2])*dt*1.6;pitch=Math.max(-1.35,Math.min(1.35,pitch-dead(pad?.axes[3])*dt*1.4));
    const p=carried??state;
    character.object.position.set(p.x,p.z,-p.y);character.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),p.heading+Math.PI/2);
    character.update(dt,'idle',0,{groundZ:p.z,groundHeight:()=>p.z});
    character.object.visible=view==='chase';
    if(view==='first'){camera.position.set(p.x,p.z+1.65*characterConfig.scale,-p.y);look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);snap=false;}
    else follow(dt,9*characterConfig.scale,Math.PI/2,.4);
    orbit.target.copy(camera.position);
  }
  function flightPose(){
    if(!previousFlight||state.grounded)return state;
    // Render between physics ticks so both the pilot and camera aim move on
    // every frame. The simulation and instruments keep the current state.
    const pose={...state},alpha=accumulator*120;
    for(const key of ['x','y','z','pitch','bank','speed','pilotPitch','pilotRoll'])pose[key]=(previousFlight[key]??0)+((state[key]??0)-(previousFlight[key]??0))*alpha;
    const headingChange=state.heading-previousFlight.heading;
    pose.heading=previousFlight.heading+Math.atan2(Math.sin(headingChange),Math.cos(headingChange))*alpha;
    if(state.coupled&&previousFlight.coupled){
      pose.coupled={...state.coupled};
      for(const key of ['pilotPosition','wingPosition'])pose.coupled[key]=state.coupled[key].map((v,i)=>previousFlight.coupled[key][i]+(v-previousFlight.coupled[key][i])*alpha);
      pose.coupled.lineSlackM=previousFlight.coupled.lineSlackM+(state.coupled.lineSlackM-previousFlight.coupled.lineSlackM)*alpha;
    }
    return pose;
  }
  function updateFlightPresentation(dt,pose=state){
    const frame=flightFrame(pose,config);
    const coupled=pose.coupled&&!pose.grounded&&!pose.collapsed;
    rig.position.set(frame.origin[0],frame.origin[2],-frame.origin[1]);
    rig.quaternion.setFromRotationMatrix(frameMatrix(frame,flightMatrix));
    if(coupled){
      frameMatrix(pilotFrame(pose,config),pilotMatrix);
      if(pilotMotion==='steady'){
        // A single cable gives an effective particle orientation, not a rigid
        // human torso. Animate around the TRUE hip only; this posture and its
        // eye/equipment appearance never return to the shared force model.
        physicalPilotRotation.setFromRotationMatrix(pilotMatrix);
        const rotation=pilotPosture.update(physicalPilotRotation,dt,snap);
        pilotUp.set(0,1,0).applyQuaternion(rotation);
        pilotOrigin.set(pose.coupled.pilotPosition[0],pose.coupled.pilotPosition[2],-pose.coupled.pilotPosition[1]).addScaledVector(pilotUp,-config.coupled.harness_height_m);
        pilotMatrix.compose(pilotOrigin,rotation,unitScale);
      }else pilotPosture.reset();
      character.object.position.setFromMatrixPosition(pilotMatrix);
      character.object.quaternion.setFromRotationMatrix(pilotMatrix);
      pilotTransform.copy(flightMatrix).invert().multiply(pilotMatrix);
    }else{
      pilotPosture.reset();
      character.object.position.copy(rig.position);
      character.object.quaternion.copy(rig.quaternion);
      if(!pose.grounded&&!pose.collapsed){character.object.rotateX(-(pose.pilotPitch??0));character.object.rotateZ(pose.pilotRoll??-pose.bank*.25);}
    }
    character.object.visible=view==='chase';
    // A collapsed wing: he tumbles as he falls and on touchdown, then sits beside the
    // wing until unhooked or relaunched (the human's ruling, docs/design/COLLISION.md).
    restTime=pose.collapsed&&pose.grounded?restTime+dt:0;
    const tumble=characterConfig.fall_clips?.tumble;
    const heavyLanding=characterConfig.landing?.heavy;
    if(pose.grounded&&!pose.collapsed&&!pose.launching&&presentedGrounded===false&&pose.landingQuality==='hard'){
      const action=character.actions?.[heavyLanding];landingClipLeft=action?.getClip().duration??0;
      // The fade can outlast the nominal clip timer; never wrap into a second
      // impact while the landing action is fading back to idle.
      if(action){action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;}
    }
    if(!pose.grounded||pose.launching)landingClipLeft=0;
    presentedGrounded=pose.grounded;
    const bodyClip=!pose.collapsed?(landingClipLeft>0?heavyLanding:undefined):!pose.grounded||restTime<(characterConfig.walk.jump?.tumble_s??.8)?tumble
      :(characterConfig.idle_sequence??[]).find(step=>step.hold)?.clip;
    const attachment=characterConfig.flight_attachment;
    const flightAnchor=attachment&&!pose.grounded&&!pose.collapsed?(coupled?new T.Vector3(pose.coupled.pilotPosition[0],pose.coupled.pilotPosition[2],-pose.coupled.pilotPosition[1]):rig.localToWorld(new T.Vector3().fromArray(attachment.position_m))):null;
    character.update(dt,pose.launching&&pose.launchStage==='running'?'run':pose.grounded?'idle':'flight',pose.launching?(pose.launchRunSpeed??0):0,{mode:pose.mode,bank:pose.bank,grounded:pose.grounded,bodyClip,
      flightAnchor,
      groundZ:pose.grounded?characterHeight(pose.x,pose.y):undefined,groundHeight:pose.grounded?characterHeight:undefined});
    landingClipLeft=Math.max(0,landingClipLeft-dt);
    if(view==='chase'){
      follow(dt,(12+Math.min(3,pose.speed*.08))*Math.max(1,.95/camera.aspect),pose.heading);
    }else{
      character.object.visible=false;
      if(coupled)camera.position.copy(new T.Vector3(0,config.landing_clearance_m+.15,0).applyMatrix4(pilotMatrix));
      else camera.position.set(pose.x,pose.z+.15,-pose.y);
      look.set(pitch+pose.pitch*.2,pose.heading-Math.PI/2+yaw,-pose.bank*.08*effects);camera.quaternion.setFromEuler(look);snap=false;
    }
    const desired=62+Math.min(18,Math.max(0,pose.speed-12)*.8)*effects;
    camera.fov+= (desired-camera.fov)*(1-Math.exp(-dt*3));camera.updateProjectionMatrix();
    let pilotOffset;
    if(pose.launching&&attachment&&character.model){
      rig.updateMatrixWorld(true);character.object.updateMatrixWorld(true);
      const hips=character.model.getObjectByName(attachment.bone);
      if(hips)pilotOffset=rig.worldToLocal(hips.getWorldPosition(new T.Vector3())).sub(new T.Vector3().fromArray(attachment.position_m)).toArray();
    }
    const lineSagDirection=coupled?new T.Vector3(0,-1,0).transformDirection(new T.Matrix4().copy(flightMatrix).invert()).toArray():undefined;
    rig.userData.flightUpdate?.(dt,{...pose,harnessed:true},{pilotScale:characterConfig.scale,pilotAttachment:attachment?.position_m,pilotOffset,pilotTransform:coupled?pilotTransform:undefined,lineSagDirection});
  }
  /** Steer, pedal or pole, brake, tuck and hop; a chase camera, or first person on V / Y. */
  function updateRide(dt,pad,x,y){
    const button=i=>pad?.buttons[i]?.pressed??false,edge=i=>{const was=pressed.has(i),now=button(i);now?pressed.add(i):pressed.delete(i);return now&&!was;};
    if(edge(0))hop=true;if(edge(3))toggleView();
    const input={steer:x,push:Math.max(0,y)+(pad?.buttons[7]?.value??0),brake:Math.max(0,-y)+(pad?.buttons[6]?.value??0),tuck:Number(keys.has('ShiftLeft')||button(1))};
    accumulator+=Math.min(dt,.05);
    while(accumulator>=1/120){state=stepRide(state,{...input,hop},1/120,ride.config,ride.height,ride.surfaceAt,hitTest);hop=false;accumulator-=1/120;}
    const p=new T.Vector3(state.x,state.z,-state.y),h=state.heading;
    ride.rig.position.copy(p);ride.rig.rotation.set(-state.pitch,h+Math.PI/2,state.lean);
    if(!drag&&view==='chase'){yaw*=Math.exp(-dt*1.5);pitch*=Math.exp(-dt*1.5);}
    if(view==='chase'){
      chase.set(p.x-Math.cos(h+yaw)*6.5,p.y+2.6-pitch*4,p.z+Math.sin(h+yaw)*6.5);
      if(snap)camera.position.copy(chase);else camera.position.lerp(chase,1-Math.exp(-dt*6));
      camera.position.y=Math.max(camera.position.y,height(camera.position.x,-camera.position.z)+.8);
      camera.lookAt(p.x,p.y+1.2,p.z);
    }else{
      camera.position.set(p.x+Math.cos(h)*.15,p.y+1.62,p.z-Math.sin(h)*.15);
      look.set(pitch+state.pitch*.6,h-Math.PI/2+yaw,-state.lean*.5);camera.quaternion.setFromEuler(look);
    }
    snap=false;orbit.target.copy(p);
  }
  function setWeather(name){if(!config.weather[name])return;weather=name;if(state&&config.modes[mode])state={...state,weather};else if(mode==='walk'&&state?.harnessMode)state={...state,harnessWeather:weather};options.onFlightChange?.(mode,siteIndex,weather);}
  function setChallenge(id){if(id&&!config.challenges?.[id])throw new Error(`Unknown flight challenge: ${id}`);challengeId=id;if(state&&config.modes[mode])state=startFlightChallenge(state,id,config);}
  function setPilotMotion(value){if(!['steady','physical'].includes(value))throw new Error(`Unknown pilot posture: ${value}`);pilotMotion=value;pilotPosture.reset();}
  // Fixed renderer fields share the live wind clock/weather, while their
  // immutable floor/trail queries may be reused for this scene's lifetime.
  function fixedEnvironmentSampler(options){
    return createFixedAirSampler((x,y,z,terrain)=>sampleAir(config,worldmap.wind.direction_deg,{x,y,z,weather},time,terrain),height,options);
  }
  return {select,update,poll,clear,changeHarness,launchHere,carry,alight,setWeather,setChallenge,setPilotMotion,fixedEnvironmentSampler,sampleFloor:height,sampleEnvironment(x,y,z){return sampleAir(config,worldmap.wind.direction_deg,{x,y,z,weather},time,height);},setEffects(value){effects=value;},get message(){return message;},get underwater(){return mode==='walk'&&underwater;},get weather(){return weather;},get siteIndex(){return siteIndex;},get view(){return view;},get mode(){return mode;},get state(){return state;},get air(){return state&&config.modes[mode]?sampleAir(config,worldmap.wind.direction_deg,state,time,height):null;},dispose(){window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',clear);window.removeEventListener('gamepaddisconnected',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointermove',move);}};
}

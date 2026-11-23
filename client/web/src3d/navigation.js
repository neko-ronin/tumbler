/** Keyboard, pointer and Gamepad input; flight, ski and bike rules live in shared/. */
import * as T from '../vendor/three.module.min.js';
import {stepParakiteFollowFlight} from '../../../shared/activities/parakite-follow.js';
import {launchFlight,launchTreeFlight,stepFlight,sampleAir,flightFrame,pilotFrame,startFlightChallenge} from '../../../shared/activities/flight.js';
import {rideStart,startRide,stepRide} from '../../../shared/activities/ride.js';
import {flightInput} from './flight-input.js';
import {parakiteLessonLift,startParakiteLesson,stepParakiteLesson} from '../../../shared/activities/parakite-lesson.js';
import {gaitFor,unharnessFlight,reharnessWalk,relaunchGround,relaunchRefusal,safeWalkGround,walkSpawn} from '../../../shared/activities/walk.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {stairFloor,stairPoint} from '../../../shared/activities/stairs.js';
import {playTape} from '../../../shared/activities/balance.js';
import {createFixedAirSampler} from './fixed-air.js';
import {createFlightPosture} from './flight-posture.js';
import {createFirstPersonHead,createCockpitCamera} from './first-person-head.js';
import {composeFollowView,createFollowRange,createCameraBoom,createFollowCamera,clearCameraTerrain,clearTerrainBoom,cameraTerrainRadius} from './follow-camera.js';
import {cameraProfile,cameraMovementProfile} from '../../../shared/activities/camera.js';
const JUMP_FRAME_M=2,AIM_S=.5;
/** The orbit→walk introduction is one continuous shot, this many seconds long.
 * 3.0 s is a product number the human can veto; see
 * docs/reviews/intro-jitter-cadence-2026-11-05.md for the measurements. */
export const SHOT_S=3;
// The opening shot eases harder late than early. The subject spends most of the
// move below the frame and sweeps in over the last third, so a symmetric
// smootherstep puts its peak screen speed exactly where it is visible. Warping
// the clock front-weights the part nobody can see while keeping zero velocity
// and acceleration at both ends.
/** Clock warp for the opening shot: front-weighted but C2 at both ends. */
export const introShotEase=u=>{const w=u**.8;return w*w*w*(w*(w*6-15)+10);};
const FLY_SPEED_MPS=450;  // the 24 km world in under a minute

export function createNavigation(camera,canvas,orbit,ground,config,worldmap,rig,hitTest,ride,character,characterConfig,options={}){
  let mode='orbit',state=null,previousFlight=null,accumulator=0,time=0,yaw=0,pitch=0,drag=false,view='chase',hop=false,snap=true,shot=null,preferredFlightMode='paraglider';
  let weather='soaring',timeOfDay='afternoon',siteIndex=0,feedbackTime=0,effects=1,aimY=null,aimV=0,challengeId='';
  let flightLesson=null;
  const parakiteOnly=l=>l===config.parakite_practice_launch||!!config.parakite_launches?.includes(l);
  // The air as it is now: the world's own wind record, plus which phase of the
  // day it is being sampled in. One record is handed to the flight step, the
  // scenery sampler and so the generators, so nothing in the scene can be
  // breathing a different wind from the wing. The client names the phase; the
  // core's diurnal table decides what that does to the air.
  let air=worldmap.wind;
  const refreshAir=()=>{air=worldmap.wind.diurnal?{...worldmap.wind,phase:timeOfDay}:worldmap.wind;};
  refreshAir();
  let queuedSlide=false,queuedBranch=false,actionArmed=false,harnessArmed=false,actionHeld=false,queuedPrimary=false,queuedHarness=false,message='',parkedWing=null,underwater=false;
  const director=createFollowCamera(),boom=createCameraBoom(),range=createFollowRange();
  let movementYaw=null,lastInput=[0,0],terrainLift=0;
  // Keyboard movement runs on foot by default; the left stick's own travel ramps the pace to a
  // full run. Held Shift is the tuck on foot and feeds the fast-climb flag. In water, Shift is a
  // toggle for the dive, as it always was. `clear()` retires both.
  let runToggled=false,runStick=0;
  const fallback={version:1,profiles:{climb:{distance:6.9,lift:.6,pitch:-.24,follow_rate:8,return_delay_s:.9},branch:{distance:5.8,lift:.25,pitch:-.3,follow_rate:.65,return_delay_s:2.4,follow_hold_s:.9,follow_ramp_s:2.2,max_turn_rad_s:.55},'tree-jump':{distance:6.9,lift:.6,pitch:-.3,follow_rate:0,return_delay_s:2.4},walk:{distance:5.4,lift:0,pitch:-.24,follow_rate:1.1,return_delay_s:1.8},flight:{distance:12,lift:0,pitch:-.34,follow_rate:1.1,return_delay_s:1.8},ride:{distance:6.5,lift:0,pitch:0,follow_rate:1.1,return_delay_s:1.8}},areas:[]};
  const policy=()=>cameraMovementProfile(cameraProfile(options.cameraPolicy??fallback,mode==='walk'?(state?.mode??'walk'):riding()?'ride':mode==='gondola'?'gondola':'flight',[state?.x??0,state?.y??0,state?.z??0],options.forestSpacingM??0),mode==='walk'?(state?.speed??0):0,characterConfig.walk);
  const flightPressed=new Set(),flightModes=Object.keys(config.modes);
  const pressed=new Set(),riding=()=>ride.config.modes[mode]!==undefined,chase=new T.Vector3();
  const keys=new Set(),blockedActions=new Set(),look=new T.Euler(0,0,0,'YXZ');
  const height=(x,y)=>options.floorHeight?.(x,y)??ground.height(x,y)??0;
  // Away from the look-around, the orbit target trails the camera at the floor,
  // so the scenery shadow and meadow focus follow the view. Both the walk frame
  // and the arrival preview read it.
  const orbitAtCamera=()=>{orbit.target.copy(camera.position);orbit.target.y=height(camera.position.x,-camera.position.z);};
  // Cosmetic moving queries share immutable thermal bases, not wind vectors.
  // Simulation steps retain the ordinary uncached terrain/evaluator path.
  const airAnchors=(config.thermals??[]).map(t=>t.xy_m);
  const renderAir=fixedEnvironmentSampler({maxTerrainSamples:airAnchors.length,terrainAnchors:airAnchors});
  const forward=new T.Vector3(),side=new T.Vector3();
  const target=new T.Vector3(),framingSubject=new T.Vector3(),framingFoot=new T.Vector3();
  const framingHead=character.model?.getObjectByName('head'),framingFeet=['heel.L','heel.R'].map(name=>character.model?.getObjectByName(name)).filter(Boolean);
  const firstPersonHead=createFirstPersonHead();
  const fitCockpitCamera=createCockpitCamera();
  const flightMatrix=new T.Matrix4(),pilotMatrix=new T.Matrix4(),pilotTransform=new T.Matrix4(),flightLeft=new T.Vector3(),flightUp=new T.Vector3(),flightForward=new T.Vector3();
  const pilotPosture=createFlightPosture(),physicalPilotRotation=new T.Quaternion(),pilotOrigin=new T.Vector3(),pilotUp=new T.Vector3(),unitScale=new T.Vector3(1,1,1);
  const interpolatedAttitude=new T.Quaternion(),nextAttitude=new T.Quaternion();
  const cockpitForward=new T.Quaternion(0,1,0,0),headAttitude=new T.Quaternion();
  let pilotMotion=options.pilotMotion??'steady';
  let treeFraming=0,framedDistance=null,framedLift=0,framedLower=null;
  let presentedGrounded=null,landingClipLeft=0,carried=null,tuckHeld=false,padDiveHeld=false,tape=null;
  function frameMatrix(frame,out){
    flightLeft.set(frame.left[0],frame.left[2],-frame.left[1]);
    flightUp.set(frame.up[0],frame.up[2],-frame.up[1]);
    flightForward.set(frame.forward[0],frame.forward[2],-frame.forward[1]);
    return out.makeBasis(flightLeft,flightUp,flightForward).setPosition(frame.origin[0],frame.origin[2],-frame.origin[1]);
  }
  const clear=()=>{treeFraming=0;framedDistance=null;framedLift=0;framedLower=null;director.reset();boom.reset();range.reset();terrainLift=0;movementYaw=null;lastInput=[0,0];runToggled=false;runStick=0;queuedSlide=false;character.setCharge?.(false);queuedBranch=false;for(const code of ['Space','KeyE'])if(keys.has(code))blockedActions.add(code);keys.clear();drag=false;accumulator=0;previousFlight=null;pilotPosture.reset();presentedGrounded=config.modes[mode]?(state?.grounded??null):null;landingClipLeft=0;actionArmed=false;harnessArmed=false;actionHeld=false;queuedPrimary=false;queuedHarness=false;hop=false;};
  // Player mode keeps to the controls a player is shown (no weather, wing or site cycling, no
  // Look-around launch); while a menu is open the world takes no input at all.
  let playerMode=false,suspended=false;
  function key(e,down){
    // A control may receive focus between press and release. Always retire
    // the held key, while leaving form key presses to the form itself.
    if(!down){blockedActions.delete(e.code);keys.delete(e.code);return;}
    if(held()||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName)||flightLesson&&e.code==='Space'&&e.target.tagName==='BUTTON')return;
    if(down&&(['Space','KeyE'].includes(e.code))&&(e.repeat||blockedActions.has(e.code)))return;
    if(down&&e.code==='Space')queuedPrimary=true;if(down&&e.code==='KeyE')queuedHarness=true;
    if(down&&!e.repeat&&e.code==='Space')hop=true;if(down&&!e.repeat&&e.code==='KeyV'&&(mode==='walk'||mode==='gondola'||riding()||config.modes[mode]))toggleView();
    if(down&&!e.repeat&&e.code==='KeyF'&&mode==='walk')character.toggleKatana?.();
    if(down&&!e.repeat&&e.code==='ControlLeft'&&mode==='walk')queuedSlide=true;
    if(down&&!e.repeat&&(e.code==='ShiftLeft'||e.code==='ShiftRight')&&mode==='walk'&&state?.mode==='swim')runToggled=!runToggled;
    if(down&&!e.repeat&&e.code==='KeyQ'&&mode==='walk')character.attack?.();
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyR','KeyF','KeyJ','KeyK','KeyE','ControlLeft'].includes(e.code)){if(down)keys.add(e.code);else keys.delete(e.code);if(e.target===canvas)e.preventDefault();}}
  const kd=e=>key(e,true),ku=e=>key(e,false);
  window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);window.addEventListener('gamepaddisconnected',clear);
  // An authored shot yields the moment the player takes the camera, so a drag,
  // a scroll or the stick never fights the interpolation.
  const manual=()=>{shot=null;director.manual();};
  // The first load's glide from the village viewpoint down to him holds every input until it lands.
  const held=()=>suspended||shot?.intro===true;
  // On foot, a click that does not drag the view is an attack.
  let press=null;
  const down=e=>{if(mode==='orbit'||held())return;if(mode==='fly')canvas.requestPointerLock?.()?.catch?.(()=>{});drag=true;press={x:e.clientX,y:e.clientY,t:e.timeStamp};canvas.focus();canvas.setPointerCapture(e.pointerId);};
  const up=e=>{drag=false;if(press&&mode==='walk'&&e.button===0&&e.timeStamp-press.t<300&&Math.hypot(e.clientX-press.x,e.clientY-press.y)<6)character.attack?.();press=null;};
  const move=e=>{if(mode==='orbit'||held()||(!drag&&document.pointerLockElement!==canvas))return;if(e.movementX||e.movementY){manual();if(movementYaw!==null)movementYaw-=e.movementX*.003;}yaw-=e.movementX*.003;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.003));};
  const cancel=()=>{drag=false;press=null;};
  canvas.addEventListener('pointercancel',cancel);canvas.addEventListener('lostpointercapture',cancel);
  const wheel=e=>{if(mode==='orbit'||held()||e.ctrlKey)return;const unit=e.deltaMode===1?16:e.deltaMode===2?canvas.clientHeight||800:1;const dx=e.deltaX*unit*.003,dy=e.deltaY*unit*.003;if(dx||dy){manual();yaw-=dx;if(movementYaw!==null)movementYaw-=dx;pitch=Math.max(-1.35,Math.min(1.35,pitch-dy));}e.preventDefault();};
  canvas.addEventListener('wheel',wheel,{passive:false});
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointermove',move);
  const dead=v=>Math.abs(v??0)<.14?0:Math.sign(v)*(Math.abs(v)-.14)/.86;
  function toggleView(){manual();movementYaw=null;view=view==='chase'?'first':'chase';if(riding())ride.rig.visible=view==='chase';
    // The chase framing looks down at the pilot; a pilot looks along the flight path.
    if(view==='first'&&config.modes[mode])pitch=-.2;snap=true;}
  function select(next,site='0',arrival=null){
    flightLesson=null;
    if(config.modes[mode])preferredFlightMode=mode;
    if(next==='walk'&&config.modes[mode]){changeHarness();return;}
    if(mode==='walk'&&config.modes[next]){
      const hooked=reharnessWalk({...state,harnessMode:next,harnessWeather:weather},characterConfig.walk,config,walkHeight,hitTest);
      if(!hooked){message='Find clear, stable ground to put on the harness';return;}
      preferredFlightMode=next;
      clear();mode=next;state=startFlightChallenge(hooked,challengeId,config);message='';parkedWing=null;
      rig.visible=true;ride.rig.visible=false;character.object.visible=true;orbit.enabled=false;
      snap=true;view='chase';yaw=0;pitch=-.34;updateFlightPresentation(0);
      options.onFlightChange?.(mode,'here',weather);return;
    }
    const previous=mode==='orbit'?null:state;
    // Look around → walk is one continuous shot: the camera glides from where it was down to the chase view.
    if(mode==='fly'&&next!=='fly')document.exitPointerLock?.();
    shot=(mode==='orbit'||mode==='fly')&&next==='walk'?{from:camera.position.clone(),q:camera.quaternion.clone(),fov:camera.fov,raw:new T.Vector3(),aim:new T.Quaternion(),t:0}:null;
    clear();message='';parkedWing=null;mode=next;camera.fov=62;camera.updateProjectionMatrix();orbit.enabled=next==='orbit';rig.visible=config.modes[next]!==undefined;ride.rig.visible=riding()&&view==='chase';
    character.object.visible=characterConfig.modes.includes(next);snap=true;
    if(next==='orbit'){orbit.setTarget(camera.position.x,camera.position.y,camera.position.z-20);return;}
    const direction=new T.Vector3();camera.getWorldDirection(direction);yaw=Math.atan2(-direction.x,-direction.z);pitch=0;
    if(next==='fly'){state=null;pitch=Math.max(-1.35,Math.min(1.35,Math.asin(direction.y)));updateFly(0);return;}
    if(next==='walk'){
      // From Look around he appears under the camera; over a granite wall or water that is no footing,
      // so he appears on the nearest ground he can stand on. A body already walking keeps its place.
      // An authored `arrival` (the first load's opening frame) names his spot, heading and the chase camera's yaw and pitch.
      const from=arrival&&!previous?arrival:{x:camera.position.x,y:-camera.position.z};
      const spawn=previous?null:walkSpawn(from.x,from.y,characterConfig.walk,walkHeight,hitTest);
      const x=previous?.x??spawn?.[0]??from.x,y=previous?.y??spawn?.[1]??from.y;
      state={x,y,z:spawn?.[2]??height(x,y),heading:previous?.heading??(arrival&&!previous?arrival.heading:yaw+Math.PI/2),speed:0};
      pitch=-.24;if(arrival&&!previous){yaw=arrival.yaw;pitch=arrival.pitch;}
      character.object.rotation.set(0,state.heading+Math.PI/2,0);updateWalk(0,0,0);return;
    }
    if(riding()){
      state=startRide(ride.config,rideStart(ride.config,site,worldmap,ride.snowAt),ride.height);yaw=0;pitch=0;snap=true;hop=false;
      for(const [name,mesh] of Object.entries(ride.meshes))mesh.visible=name===next;return;
    }
    siteIndex=Number(site)||0;
    if(!config.launches[siteIndex]||next!=='parakite'&&parakiteOnly(config.launches[siteIndex]))siteIndex=0;
    state=startFlightChallenge(launchFlight(config,next,config.launches[siteIndex],height,weather),challengeId,config);yaw=0;pitch=-.34;
    options.onFlightChange?.(next,siteIndex,weather);
    updateFlightPresentation(0);
  }
  /** Hold the walk view the entry opens on while `warm` runs. `select('walk')`
   * already builds that state — the same spawn, heading, body rotation, pitch
   * and field of view the entry produces — so the warm sees the real arrival
   * rather than a second copy of the chase camera math. The preview owns no
   * shot of its own. By default everything it moves — camera, field of view,
   * orbit target and mode — is restored exactly, so an authored shot can still
   * start from its bookmark; `{restore:false}` keeps the arrival instead, which
   * is what the journal's entry needs: the camera, state, shadow focus and
   * resources the warm leaves in place are the first live walk frame.
   * Called by the automatic intro while the journal is still up; a ?view= or
   * ?course= link starts where it is told and does not pay for it. */
  async function warmArrival(warm,{restore=true,arrival=null}={}){
    const from={position:camera.position.clone(),quaternion:camera.quaternion.clone(),fov:camera.fov,target:orbit.target.clone(),yaw,pitch,snap,mode,
      rig:rig.visible,ride:ride.rig.visible,body:character.object.visible};
    select('walk','0',arrival);shot=null;
    // The first real walk frame ends by trailing the orbit target with the
    // camera; the scenery shadow and meadow focus read it, so warm that too.
    orbitAtCamera();
    try{return await warm();}
    finally{
      if(restore){
        shot=null;clear();mode=from.mode;state=null;
        camera.position.copy(from.position);camera.quaternion.copy(from.quaternion);camera.fov=from.fov;camera.updateProjectionMatrix();
        orbit.enabled=from.mode==='orbit';orbit.target.copy(from.target);
        rig.visible=from.rig;ride.rig.visible=from.ride;character.object.visible=from.body;
        yaw=from.yaw;pitch=from.pitch;snap=from.snap;
      }
    }
  }
  const walkHeight=(x,y)=>options.walkHeight?.(x,y)??(options.walkHeight?null:ground.height(x,y));
  const launchHeight=(x,y)=>safeWalkGround(x,y,characterConfig.walk,walkHeight,hitTest,{dropOffs:true});
  const characterHeight=(x,y)=>options.characterHeight?.(x,y)??walkHeight(x,y)??height(x,y);
  function changeHarness(){
    if(config.modes[mode])preferredFlightMode=mode;
    const foot=config.modes[mode]?unharnessFlight(state,characterConfig.walk,config,walkHeight,hitTest):null;
    const hooked=mode==='walk'?reharnessWalk(state,characterConfig.walk,config,walkHeight,hitTest):null;
    if(!foot&&!hooked){message='Find clear, stable ground before changing harness';return false;}
    flightLesson=null;
    pilotPosture.reset();presentedGrounded=null;landingClipLeft=0;
    parkedWing=foot?{...state,pressure:0,engine:0,throttle:0,harnessed:false,launching:false}:null;
    state=foot??hooked;mode=foot?'walk':hooked.mode;accumulator=0;previousFlight=null;actionArmed=false;harnessArmed=false;actionHeld=false;message='';snap=true;view='chase';
    orbit.enabled=false;rig.visible=true;character.object.visible=true;
    if(foot){yaw=state.heading-Math.PI/2;pitch=-.24;character.object.rotation.set(0,state.heading+Math.PI/2,0);camera.fov=62;camera.updateProjectionMatrix();updateWalk(0,0,0);}
    else{yaw=0;pitch=-.34;updateFlightPresentation(0);}
    options.onFlightChange?.(mode,foot?siteIndex:'here',weather);return true;
  }
  function launchHere(){
    if(!config.modes[mode]||!state.grounded||state.launching)return false;
    const launched=relaunchGround(state,characterConfig.walk,config,walkHeight,hitTest);
    if(launched){flightLesson=null;state=startFlightChallenge(launched,challengeId,config);previousFlight=null;accumulator=0;message='';return true;}
    message=relaunchRefusal(state,characterConfig.walk,config,walkHeight,hitTest)==='canopy'?'No room for the wing here':'Need clear, stable ground and room ahead to launch';return false;
  }
  /** From a launch-ready crown perch, in `next` or the last flown mode; false anywhere else. */
  function launchFromTree(next=preferredFlightMode){
    if(mode!=='walk'||state?.mode!=='climb'||!state.launchReady||!config.modes[next])return false;
    preferredFlightMode=next;
    const launched=launchTreeFlight(config,preferredFlightMode,state,height,weather);
    clear();mode=preferredFlightMode;state=startFlightChallenge(launched,challengeId,config);message='';parkedWing=null;
    rig.visible=true;ride.rig.visible=false;character.object.visible=true;orbit.enabled=false;snap=true;view='chase';yaw=0;pitch=-.34;
    options.onFlightChange?.(mode,'here',weather);updateFlightPresentation(0);return true;
  }
  /** Ride something the core moves (a gondola cabin): {x, y, z, heading} of the floor he stands on, every frame. */
  function carry(pose){
    if(mode!=='gondola'){
      flightLesson=null;
      clear();shot=null;message='';parkedWing=null;mode='gondola';orbit.enabled=false;rig.visible=false;ride.rig.visible=false;
      character.object.visible=true;camera.fov=62;camera.updateProjectionMatrix();snap=true;yaw=0;pitch=-.12;
    }
    carried=pose;state={x:pose.x,y:pose.y,z:pose.z,heading:pose.heading,speed:0};
  }
  /** Step off onto the ground at [x, y], on foot. */
  function alight(x,y,heading){state={x,y,heading};carried=null;mode='gondola';select('walk');}
  /** Called on display refreshes between render frames: a controller A tap
   * shorter than one 30 FPS frame is latched like a keyboard tap. */
  function poll(){if(held())return;const pad=[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);if(pad?.buttons[0]?.pressed)queuedPrimary=true;if(mode==='walk'&&pad?.buttons[11]?.pressed)queuedSlide=true;}
  function update(dt){
    if(suspended&&state?.guidedParakite)return;
    const pad=held()?null:[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);
    if(mode==='gondola'){
      // Riding: Y changes the view, as it does in flight. RB (fast travel) is gondola.js's.
      const y=!!pad?.buttons[3]?.pressed;if(y&&!flightPressed.has(3))toggleView();y?flightPressed.add(3):flightPressed.delete(3);
      time+=Math.min(dt,.05);updateCarried(dt,pad);return;
    }
    if(!riding()){
      const edge=i=>{const now=pad?.buttons[i]?.pressed??false,was=flightPressed.has(i);now?flightPressed.add(i):flightPressed.delete(i);return now&&!was;};
      const dev=!playerMode,previous=edge(14)&&dev,next=edge(15)&&dev,up=edge(12)&&dev,down=edge(13)&&dev,changeView=edge(3),changeWeather=edge(9)&&dev,stickView=edge(10);
      const primary=(pad?.buttons[0]?.pressed??false)||keys.has('Space')||queuedPrimary;
      const harness=(pad?.buttons[2]?.pressed??false)||keys.has('KeyE')||queuedHarness;
      queuedPrimary=false;queuedHarness=false;
      if(!primary&&!harness){actionArmed=true;harnessArmed=true;}
      let primaryEdge=primary&&actionArmed;
      if(primaryEdge)actionArmed=false;
      actionHeld=primary&&(primaryEdge||actionHeld);
      if(harness&&harnessArmed){harnessArmed=false;primaryEdge=false;
        if(mode==='walk'&&state?.mode==='climb'&&state.launchReady)launchFromTree();
        else if(mode==='walk'&&hitTest?.branchesNear&&characterConfig.walk.branches&&['climb','branch'].includes(state?.mode))queuedBranch=true;
        else changeHarness();}
      if(previous||next){const i=flightModes.indexOf(mode);select(flightModes[(Math.max(0,i)+(next?1:-1)+flightModes.length)%flightModes.length],siteIndex);}
      if(up||down){
        const count=mode==='parakite'?config.launches.length:config.launches.filter(l=>!parakiteOnly(l)).length;
        siteIndex=(siteIndex+(up?-1:1)+count)%count;if(config.modes[mode])select(mode,siteIndex);
      }
      if(primaryEdge&&flightLesson){
        if(flightLesson.ready) beginFlightLesson();
        else if(!flightLesson.guided||flightLesson.progress.phase!=='passed')prepareFlightLesson(flightLesson.progress.id,flightLesson.guided);
      }else if(primaryEdge&&config.modes[mode]&&state.launching){/* A held or repeated launch cannot restart inflation. */}
      else if(primaryEdge&&config.modes[mode]&&state.grounded){
        launchHere();
      }else if(primaryEdge&&mode==='orbit'&&!playerMode)select('paraglider',siteIndex);
      else if(primaryEdge&&pad?.buttons[0]?.pressed&&config.modes[mode]&&!state.grounded)select(mode,siteIndex);
      if(changeView&&config.modes[mode])toggleView();
      if(changeView&&mode==='walk')character.toggleKatana?.();
      // L3 is the controller's V: first person on foot, where Y is already the katana.
      if(stickView&&mode==='walk')toggleView();
      if(mode==='walk'){
        queuedSlide=queuedSlide||edge(11)||keys.has('ControlLeft');
        character.setCharge?.(!!pad?.buttons[7]?.pressed||keys.has('KeyR'));
      }
      if(edge(1)&&mode==='walk')character.attack?.();
      if(changeWeather){const names=Object.keys(config.weather),i=names.indexOf(weather);setWeather(names[(i+1)%names.length]);}
    }
    if(mode==='orbit'){time+=Math.min(dt,.05);orbit.update();return;}
    if(mode==='fly'){time+=Math.min(dt,.05);updateFly(dt);return;}
    const lx=dead(pad?.axes[0]),ly=dead(pad?.axes[1]),rx=dead(pad?.axes[2]),ry=dead(pad?.axes[3]);
    const manualX=rx+Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),manualY=ry+Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
    if(manualX||manualY){manual();if(movementYaw!==null)movementYaw-=manualX*dt*1.6;}
    yaw-=manualX*dt*1.6;
    pitch=Math.max(-1.35,Math.min(1.35,pitch-(ry+Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp')))*dt*1.4));
    const x=Number(keys.has('KeyD'))-Number(keys.has('KeyA'))+lx;
    const y=Number(keys.has('KeyW'))-Number(keys.has('KeyS'))-ly;
    if(mode!=='walk'&&view==='chase'){const auto=director.step(dt,yaw,pitch,0,true,policy(),drag);yaw=auto.yaw;pitch=auto.pitch;}
    if(riding()){time+=Math.min(dt,.05);updateRide(dt,pad,x,y);return;}
    if(mode==='walk'){
      time+=Math.min(dt,.05);
      tuckHeld=keys.has('ShiftLeft')||keys.has('ShiftRight')||(pad?.buttons[4]?.pressed??false);
      // LB toggles the dive while swimming, as Shift does on the keyboard.
      const padDive=pad?.buttons[4]?.pressed??false;if(padDive&&!padDiveHeld&&state?.mode==='swim')runToggled=!runToggled;padDiveHeld=padDive;
      // Keyboard movement runs by default; the stick ramps from a walk to a run.
      const keyed=['KeyW','KeyA','KeyS','KeyD'].some(code=>keys.has(code));
      runStick=keyed?1:Math.min(1,Math.hypot(lx,ly));
      updateWalk(dt,x,y);
    }else{
      const input=flightInput(pad,keys);
      const stoppedLesson=flightLesson?.ready||flightLesson?.guided&&flightLesson.progress.phase==='passed';
      if(!stoppedLesson)accumulator+=Math.min(dt,.05);
      while(accumulator>=1/120){
        previousFlight=state;
        const localLift=parakiteLessonLift(flightLesson?.progress,state);
        state=state.followStep===undefined?stepFlight(state,input,1/120,time,config,air,height,hitTest,launchHeight,walkHeight,localLift):
          stepParakiteFollowFlight(state,input,1/120,config,worldmap.wind.direction_deg,height,hitTest,walkHeight);
        if(flightLesson)stepParakiteLesson(flightLesson.progress,previousFlight,state,input,1/120,height);
        time+=1/120;accumulator-=1/120;
      }
      updateFlightPresentation(dt,flightPose(),input.turn);
      feedbackTime+=dt;
      if(options.haptics?.()!==false&&effects&&feedbackTime>.12&&pad?.vibrationActuator?.playEffect){
        feedbackTime=0;const strength=state.grounded?0:Math.min(.45,Math.abs(state.turbulence)*.07+Math.max(0,state.load-1)*.15);
        if(strength>.025)Promise.resolve(pad.vibrationActuator.playEffect('dual-rumble',{duration:110,strongMagnitude:strength*.4,weakMagnitude:strength})).catch(()=>{});
      }
    }
    orbitAtCamera();
  }
  // On a helix the chase boom swings into the bole: hold the camera behind him and out from the
  // trunk instead, and turn the walk's yaw to match it so forward stays the way he faces.
  // Behind is along the flight, the way he last went on it (down while on the rail): a vault faces him
  // out over the rail, and behind *that* is the bole.
  const stairEye=new T.Vector3(),stairLook=new T.Vector3();let stairEased=null,stairSign=1;
  function stairCamera(dt){
    const s=state,r=s.stair,ox=s.x-r.matrix[12],oy=s.y-r.matrix[13],o=Math.hypot(ox,oy)||1;
    if(s.stairPhase==='rail')stairSign=-1;else if(s.stairPhase==='walk'&&Math.abs(s.stairV)>.05)stairSign=Math.sign(s.stairV);
    const a=stairPoint(r,s.u-.5),b=stairPoint(r,s.u+.5),l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,fx=(b[0]-a[0])/l*stairSign,fy=(b[1]-a[1])/l*stairSign;
    // Galleries and dwellings crowd the flight: walk the eye in from the target until the sight is clear.
    // From head height, over the 1 m handrail beside him.
    const look=[s.x,s.y,s.z+1.5],want=[s.x-fx*4.5+ox/o*3.5,s.y-fy*4.5+oy/o*3.5,s.z+1.8];let eye=look;
    for(let k=1;k<=10;k++){const next=look.map((v,i)=>v+(want[i]-v)*k/10);if(hitTest?.(eye,next,.25))break;eye=next;}
    stairEye.set(eye[0],eye[2],-eye[1]);
    if(!stairEased||camera.position.distanceTo(stairEye)>12)stairEased=stairEye.clone();else stairEased.lerp(stairEye,1-Math.exp(-dt*4));
    camera.position.copy(stairEased);stairLook.set(s.x,s.z+.9,-s.y);camera.lookAt(stairLook);
    const d=stairLook.clone().sub(camera.position);yaw=Math.atan2(-d.x,-d.z);pitch=Math.atan2(d.y,Math.hypot(d.x,d.z));
  }
  function follow(dt,distance,heading,lift=0,presentation={}){
    const {direct=false,introProgress=0,rangeEase,rangeStart=false,groundRange=false}=presentation;
    target.copy(character.object.position).add(new T.Vector3(0,(config.modes[mode]?2.7:1.1*characterConfig.scale)+lift,0));
    // On foot the aim follows his height on a critically damped spring (Unity's
    // SmoothDamp) instead of riding it: in a jump he rises in the frame while the
    // world holds still, and touchdown eases in rather than jolting, since the
    // aim's speed and acceleration stay continuous. The bound is soft: the
    // further he gets from the aim (JUMP_FRAME_M is far), the quicker it follows.
    const gap=target.y-(aimY??target.y),w=2*(1+(gap/JUMP_FRAME_M)**2)/(AIM_S-.26*treeFraming),x=w*dt,decay=1/(1+x+.48*x*x+.235*x*x*x);
    if(snap||aimY===null||mode!=='walk'||state?.mode==='climb'){aimY=target.y;aimV=0;}
    else{const pull=(aimV-w*gap)*dt;aimV=(aimV-w*pull)*decay;aimY=target.y+(pull-gap)*decay;}
    // The jump spring must never leave the aim buried in an uphill floor.
    target.y=Math.max(aimY,height(target.x,-target.z)+.9*characterConfig.scale);
    const profile=policy();
    if(groundRange)distance=range.update(camera.position,target,distance,rangeEase,rangeStart,Math.min(distance,4.6*characterConfig.scale),profile.follow_max_distance_m>0?profile.follow_max_distance_m*characterConfig.scale:Infinity);
    const angle=heading-Math.PI/2+yaw;
    chase.set(target.x+Math.sin(angle)*Math.cos(pitch)*distance,target.y-Math.sin(pitch)*distance,target.z+Math.cos(angle)*Math.cos(pitch)*distance);

    if(shot&&mode!=='walk')shot=null;
    boom.place(camera.position,target,chase,dt,snap||direct);
    const baseEyeY=camera.position.y;
    clearTerrainBoom(camera.position,target,height,cameraTerrainRadius(camera));
    const requiredLift=camera.position.y-baseEyeY;
    terrainLift=snap?requiredLift:Math.max(requiredLift,terrainLift*Math.exp(-dt*3));
    camera.position.y=baseEyeY+terrainLift;
    const lowerGoal=profile.screen_lower_fraction;
    framedLower=snap||framedLower===null?lowerGoal:framedLower+(lowerGoal-framedLower)*(1-Math.exp(-dt*5));
    const lowerFraction=framedLower;
    framingSubject.copy(character.object.position).addScaledVector(T.Object3D.DEFAULT_UP,1.1*characterConfig.scale);
    if(mode==='walk'&&framingHead&&framingFeet.length){
      character.object.updateWorldMatrix(true,true);framingHead.getWorldPosition(framingSubject);
      for(const foot of framingFeet)framingSubject.addScaledVector(foot.getWorldPosition(framingFoot),1/framingFeet.length);
      framingSubject.multiplyScalar(.5);
    }
    composeFollowView(camera,target,lowerFraction,framingSubject,mode==='walk'?treeFraming:0);snap=false;
    if(shot?.path){
      // The first load's tour: a centripetal Catmull-Rom through the spiral's waypoints that ends on the
      // live chase pose, watching the village centre and handing the aim to him as it lands.
      shot.raw.copy(camera.position);shot.aim.copy(camera.quaternion);shot.t+=dt;
      // Every channel rides the one ease k, so speed, turn and handoff each rise once and settle once.
      const u=Math.min(1,shot.t/shot.seconds),k=u*u*u*(u*(u*6-15)+10),end=shot.curve.points[shot.curve.points.length-1];
      if(end.distanceToSquared(shot.raw)>1e-4){end.copy(shot.raw);shot.curve.needsUpdate=true;shot.curve.updateArcLengths();}
      camera.position.copy(shot.curve.getPointAt(k));
      shot.look.copy(shot.focus).lerp(target,k);
      shot.basis.lookAt(camera.position,shot.look,T.Object3D.DEFAULT_UP);
      camera.quaternion.setFromRotationMatrix(shot.basis).slerp(shot.aim,k*k*k);
      camera.fov=shot.fov+(62-shot.fov)*k;camera.updateProjectionMatrix();
      clearCameraTerrain(camera.position,height,cameraTerrainRadius(camera));
      if(u>=1)shot=null;
    }else if(shot){
      shot.raw.copy(camera.position);shot.aim.copy(camera.quaternion);shot.t+=dt;
      const u=Math.min(1,shot.t/(shot.seconds??SHOT_S)),k=Math.max(introProgress,introShotEase(u));
      camera.position.lerpVectors(shot.from,shot.raw,k);camera.quaternion.slerpQuaternions(shot.q,shot.aim,k);
      camera.fov=shot.fov+(62-shot.fov)*k;camera.updateProjectionMatrix();
      clearCameraTerrain(camera.position,height,cameraTerrainRadius(camera));
      if(k>=1)shot=null;
    }
  }
  // Velocity is the keys held this frame and nothing else, so releasing them stops dead. The orbit
  // target follows as it does on foot, which is what the scenery shadow and forest focus read.
  function updateFly(dt){
    look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);
    forward.set(0,0,-1).applyQuaternion(camera.quaternion);side.set(1,0,0).applyQuaternion(camera.quaternion);
    const held=(a,b)=>(keys.has(a)?1:0)-(keys.has(b)?1:0),v=forward.multiplyScalar(held('KeyW','KeyS')).addScaledVector(side,held('KeyD','KeyA'));
    v.y+=held('KeyR','KeyF');
    if(v.lengthSq()>0)camera.position.addScaledVector(v.normalize(),(keys.has('ShiftLeft')||keys.has('ShiftRight')?characterConfig.walk.run_mps:FLY_SPEED_MPS)*dt);
    clearCameraTerrain(camera.position,height,cameraTerrainRadius(camera));
    orbitAtCamera();
  }
  function updateWalk(dt,x,y){
    // Latch the movement basis during a held direction so automatic camera
    // rotation cannot turn a straight run into a spiral. Manual look still steers it.
    if(movementYaw===null||Math.hypot(x-lastInput[0],y-lastInput[1])>.15||(!x&&!y))movementYaw=yaw;
    lastInput=[x,y];
    // On a stair the camera follows him round the bole, so forward is its live yaw, not the one held at the press.
    const basis=view==='first'||state.mode==='stair'?yaw:movementYaw;
    forward.set(-Math.sin(basis),0,-Math.cos(basis));side.set(Math.cos(basis),0,-Math.sin(basis));
    const movement=forward.clone().multiplyScalar(y).addScaledVector(side,x);
    const before=state.speed??0,beforeMode=state.mode,fromX=state.x,fromY=state.y;
    const water=options.walkHeight?.waterAt;
    const busy=character.attacking===true;
    const planted=character.charging&&state.grounded;
    const input={x:planted?0:movement.x,y:planted?0:-movement.z,run:(state.mode==='swim'?runToggled:tuckHeld)&&!planted,run_amount:planted?0:runStick,jump:actionHeld,tuck:tuckHeld,stick:[x,y],pitch,branch:queuedBranch,slide:queuedSlide};
    if(tape&&dt>0)tape.frames.push([1,input,Math.round(dt*1e4)/1e4]);
    state=stepMoves(state,input,dt,characterConfig.walk,
      {height:walkHeight,hitTest,waterAt:water,floorHeight:options.walkHeight?.floorHeight??options.floorHeight??height,balance:options.balance});
    if(queuedBranch)message=state.mode==='climb'?'No branch within reach · climb or circle toward a limb':'';
    else if(x||y)message='';
    queuedBranch=false;queuedSlide=false;
    if(state.mode==='branch'&&beforeMode!=='branch')movementYaw=null;
    const climbing=state.mode==='climb',
      // Stepping off the bark onto the floor is already walking to look at, even
      // though the core still reports the climb until the eased step ends.
      onBark=climbing&&state.climbPhase!=='dismount',branching=state.mode==='branch',swimming=state.mode==='swim';
    character.object.position.set(state.x,state.z,-state.y);
    // Where the model faces now versus where it travels: a big gap asks for a pivot.
    const facing=new T.Vector3(0,0,1).applyQuaternion(character.object.quaternion),goalYaw=state.heading+Math.PI/2,turn=goalYaw-Math.atan2(facing.x,facing.z);
    if(onBark)character.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),state.heading+Math.PI/2);
    else if(state.speed>0){
      const goal=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),state.heading+Math.PI/2);
      character.object.quaternion.slerp(goal,1-Math.exp(-dt*14));
    }
    const jumping=state.jumpPhase&&state.jumpPhase!=='grounded';
    // On a village stair: the treads under each foot, and the vault and handrail slide scrubbed by
    // the core's own progress (the rail slide loops on its clock).
    const stair=state.mode==='stair'?state:null,stairClips=characterConfig.stair_clips;
    const stairName=stair&&stairClips?{vault:stairClips.vault,rail:stairClips.rail}[stair.stairPhase]:null,stairClip=character.actions?.[stairName]?stairName:null;
    const clipLength=stairClip?character.actions[stairClip].getClip().duration:1;
    const stairTime=!stairClip?undefined:stair.stairPhase==='vault'?(stair.stairProgress??0)*clipLength:stair.stairTime%clipLength;
    const floorUnder=stair?(x,y)=>stair.stairPhase==='walk'?stairFloor(stair.stair,stair.u,x,y):stair.z-2:state.deck?()=>state.groundZ:characterHeight;
    const bal=state.balance,down=bal&&bal.phase!=='steady'&&bal.phase!=='stumble';
    if(bal){const p=options.balance.config.phases;bal.progress=bal.phase==='trip'?bal.t/p.trip_s:bal.phase==='recover'?bal.t/p.recover_s:0;}
    // The gait follows the speed the feet actually have, not a key.
    const gait=gaitFor(state.speed,characterConfig.walk,characterConfig.clips);
    character.update(dt,onBark?'climb':swimming?'swim':down?'balance':jumping?'jump':state.speed>.05?gait:'idle',swimming?Math.hypot(state.speed,state.vz??0):state.speed,{balance:bal,slide:state.sliding?state:null,climb:onBark?state:null,swim:swimming?state:null,jump:jumping&&!climbing&&!swimming?state:null,turnRate:state.turnRate,accel:dt>0?(state.speed-before)/dt:0,facing:state.speed>.05?Math.atan2(Math.sin(turn),Math.cos(turn)):0,groundZ:branching||stair?state.z:floorUnder(state.x,state.y),groundHeight:branching?()=>state.z:floorUnder,knock:state.knock,knockSide:state.knockSide,bodyClip:stairClip??undefined,bodyTime:stairTime});
    if(parkedWing)rig.userData.flightUpdate?.(dt,parkedWing);
    const profile=policy();let distanceFollow=false,distanceEase=0,distanceStart=false;
    if(view==='chase'){const auto=director.step(dt,yaw,pitch,state.heading-Math.PI/2,state.speed>.15&&!busy,profile,drag,climbing,Math.hypot(state.x-fromX,state.y-fromY));yaw=auto.yaw;pitch=auto.pitch;boom.rotate(auto.transport??0);distanceFollow=auto.distanceFollow??false;distanceEase=auto.distanceEase??0;distanceStart=auto.distanceStart??false;}
    character.object.visible=view==='chase';
    if(view==='first'){
      camera.position.set(state.x,state.z+1.65*characterConfig.scale,-state.y);
      look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);snap=false;
    }else {
      // Preserve continuous tree framing while using the authored per-mode goals.
      // Heading, pitch and ground trailing range retain their travel-based curve.
      const treePlay=['climb','branch','tree-jump'].includes(state.mode),blend=1-Math.exp(-dt*5);
      treeFraming+=((treePlay?1:0)-treeFraming)*blend;
      framedDistance=snap||framedDistance===null?profile.distance:framedDistance+(profile.distance-framedDistance)*blend;
      framedLift=snap?profile.lift:framedLift+(profile.lift-framedLift)*blend;
      follow(dt,framedDistance*characterConfig.scale,Math.PI/2,framedLift*characterConfig.scale,{direct:distanceFollow,introProgress:distanceEase,groundRange:profile.follow_distance_m>0,rangeEase:distanceFollow?distanceEase:undefined,rangeStart:distanceStart});
      if(state.mode==='stair')stairCamera(dt);else stairEased=null;
    }
    // Below the water's surface, the client tints and fogs the view (main.js).
    const overhead=water?.(camera.position.x,-camera.position.z);underwater=!!overhead&&camera.position.y<overhead.surface_z;
  }
  function updateCarried(dt,pad){
    const rx=dead(pad?.axes[2])+Number(keys.has('ArrowRight'))-Number(keys.has('ArrowLeft')),ry=dead(pad?.axes[3])+Number(keys.has('ArrowDown'))-Number(keys.has('ArrowUp'));
    if(rx||ry)director.manual();yaw-=rx*dt*1.6;pitch=Math.max(-1.35,Math.min(1.35,pitch-ry*dt*1.4));
    const p=carried??state;
    character.object.position.set(p.x,p.z,-p.y);character.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),p.heading+Math.PI/2);
    character.update(dt,'idle',0,{groundZ:p.z,groundHeight:()=>p.z});
    character.object.visible=view==='chase';
    if(view==='first'){camera.position.set(p.x,p.z+1.65*characterConfig.scale,-p.y);look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);snap=false;}
    else {const p=policy();follow(dt,p.distance*characterConfig.scale,Math.PI/2,p.lift);}
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
    if(state.rotation&&previousFlight.rotation){
      pose.rotation={...state.rotation};
      for(const body of ['pilot','wing']){
        const orientation=interpolatedAttitude.fromArray(previousFlight.rotation[body].orientation)
          .slerp(nextAttitude.fromArray(state.rotation[body].orientation),alpha).toArray();
        pose.rotation[body]={...state.rotation[body],orientation};
      }
    }
    return pose;
  }
  function updateFlightPresentation(dt,pose=state,turn=0){
    const resetBody=dt===0&&snap;
    const frame=flightFrame(pose,config);
    const coupled=pose.coupled&&!pose.grounded&&!pose.collapsed;
    rig.position.set(frame.origin[0],frame.origin[2],-frame.origin[1]);
    rig.quaternion.setFromRotationMatrix(frameMatrix(frame,flightMatrix));
    if(coupled){
      frameMatrix(pilotFrame(pose,config),pilotMatrix);
      if(pilotMotion==='steady'&&!pose.rotation){
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
    if(!coupled)pilotMatrix.compose(character.object.position,character.object.quaternion,unitScale);
    character.object.visible=view==='chase';
    // A collapsed wing falls plainly; a long fall gives one compact rebound, then rests.
    const heavyLanding=characterConfig.landing?.heavy;
    if(pose.grounded&&!pose.collapsed&&!pose.launching&&presentedGrounded===false&&pose.landingQuality==='hard'){
      const action=character.actions?.[heavyLanding];landingClipLeft=action?.getClip().duration??0;
      // The fade can outlast the nominal clip timer; never wrap into a second
      // impact while the landing action is fading back to idle.
      if(action){action.setLoop(T.LoopOnce,1);action.clampWhenFinished=true;}
    }
    if(!pose.grounded||pose.launching)landingClipLeft=0;
    presentedGrounded=pose.grounded;
    const rebound=pose.fallBounce&&pose.vz>0?characterConfig.fall_clips?.bounce:undefined;
    const bodyClip=pose.collapsed?rebound:landingClipLeft>0?heavyLanding:undefined;
    const attachment=characterConfig.flight_attachment;
    const flightAnchor=attachment&&!pose.grounded&&!pose.collapsed?(coupled?new T.Vector3(pose.coupled.pilotPosition[0],pose.coupled.pilotPosition[2],-pose.coupled.pilotPosition[1]):rig.localToWorld(new T.Vector3().fromArray(attachment.position_m))):null;
    character.update(dt,pose.launching&&pose.launchStage==='running'?'run':pose.grounded?'idle':'flight',pose.launching?(pose.launchRunSpeed??0):0,{mode:pose.mode,bank:pose.bank,grounded:pose.grounded,bodyClip,
      flightAnchor,
      groundZ:pose.grounded?characterHeight(pose.x,pose.y):undefined,groundHeight:pose.grounded?characterHeight:undefined});
    landingClipLeft=Math.max(0,landingClipLeft-dt);
    if(view==='chase'){
      const heading=pose.rotation&&Math.hypot(frame.left[0],frame.left[1])>.1?
        Math.atan2(-frame.left[0],frame.left[1]):pose.heading;
      follow(dt,(policy().distance+Math.min(3,pose.speed*.08))*Math.max(1,.95/camera.aspect),heading);
    }else{
      character.object.visible=false;
      const head=firstPersonHead.update(pose,dt,effects,snap);
      if(pose.rotation){
        look.set(pitch+head.pitch,yaw+head.yaw,head.roll);
        camera.quaternion.setFromRotationMatrix(pilotMatrix).multiply(cockpitForward)
          .multiply(headAttitude.setFromEuler(look));
      }else{
        look.set(pitch+pose.pitch*.2+head.pitch,pose.heading-Math.PI/2+yaw+head.yaw,head.roll);
        camera.quaternion.setFromEuler(look);
      }
      const eye=coupled&&options.firstPersonEye?.();
      if(eye)fitCockpitCamera(camera,pilotMatrix,eye,options.firstPersonCollar?.(),.65,characterConfig.scale,head.sink,look.y,
        effects>0?Math.max(camera.fov,80):62,!!pose.rotation);
      else if(coupled)camera.position.set(0,config.landing_clearance_m+.15,0).applyMatrix4(pilotMatrix);
      else camera.position.set(pose.x,pose.z+.15,-pose.y);
      snap=false;
    }
    const presentation=options.flightPresentation?.(pose,view,dt,effects);
    const desired=presentation?.fov??(62+Math.min(18,Math.max(0,pose.speed-12)*.8)*effects);
    camera.fov=effects>0?camera.fov+(desired-camera.fov)*(1-Math.exp(-dt*3)):62;camera.updateProjectionMatrix();
    let pilotOffset;
    if(pose.launching&&attachment&&character.model){
      rig.updateMatrixWorld(true);character.object.updateMatrixWorld(true);
      const hips=character.model.getObjectByName(attachment.bone);
      if(hips)pilotOffset=rig.worldToLocal(hips.getWorldPosition(new T.Vector3())).sub(new T.Vector3().fromArray(attachment.position_m)).toArray();
    }
    const lineSagDirection=coupled?new T.Vector3(0,-1,0).transformDirection(new T.Matrix4().copy(flightMatrix).invert()).toArray():undefined;
    rig.userData.flightUpdate?.(dt,{...pose,harnessed:true},{pilotScale:characterConfig.scale,pilotAttachment:attachment?.position_m,pilotOffset,pilotTransform:coupled?pilotTransform:undefined,lineSagDirection,closeView:view==='first'&&coupled});
    const pilotVelocity=pose.coupled?.pilotVelocity;
    const previousVelocity=pose!==state?previousFlight?.coupled?.pilotVelocity:null;
    const velocity=previousVelocity&&pilotVelocity?
      pilotVelocity.map((value,i)=>previousVelocity[i]+(value-previousVelocity[i])*accumulator*120):pilotVelocity;
    options.firstPersonBody?.({active:!pose.grounded&&!pose.collapsed&&!pose.launching,view,pilotMatrix,
      pilotScale:characterConfig.scale,state:pose,dt,reset:resetBody,velocity,lean:-(pose.weightShift??turn)});
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
    const profile=policy();
    if(view==='chase'){
      chase.set(p.x-Math.cos(h+yaw)*profile.distance,p.y+2.6-pitch*4,p.z+Math.sin(h+yaw)*profile.distance);
      if(snap)camera.position.copy(chase);else camera.position.lerp(chase,1-Math.exp(-dt*6));
      clearTerrainBoom(camera.position,new T.Vector3(p.x,p.y+1.2,p.z),height,cameraTerrainRadius(camera));
      camera.lookAt(p.x,p.y+1.2,p.z);
    }else{
      camera.position.set(p.x+Math.cos(h)*.15,p.y+1.62,p.z-Math.sin(h)*.15);
      look.set(pitch+state.pitch*.6,h-Math.PI/2+yaw,-state.lean*.5);camera.quaternion.setFromEuler(look);
    }
    snap=false;orbit.target.copy(p);
  }
  function setWeather(name){if(!config.weather[name])return;flightLesson=null;weather=name;if(state&&config.modes[mode])state={...state,weather};else if(mode==='walk'&&state?.harnessMode)state={...state,harnessWeather:weather};options.onFlightChange?.(mode,siteIndex,weather);}
  function prepareFlightLesson(id,guided=false){
    const practiceSite=config.launches.indexOf(config.parakite_practice_launch);
    if(!guided&&(!config.experimentalParakite||practiceSite<0||mode!=='parakite'))return false;
    const progress=startParakiteLesson(id);
    const primaryHeld=keys.has('Space')||[...(navigator.getGamepads?.()??[])].some(pad=>pad?.connected&&pad.buttons[0]?.pressed);
    challengeId='';
    setWeather('calm');
    if(guided){
      const launch=launchFlight(config,'parakite',config.parakite_practice_launch,height,weather);
      placeGuidedFlight(launch);
    }else select('parakite',practiceSite);
    flightLesson={ready:true,progress,guided};
    actionArmed=!primaryHeld;
    return true;
  }
  function placeGuidedFlight(pose){
    if(mode!=='orbit'&&mode!=='parakite')select('orbit');
    if(mode==='orbit')select('parakite');
    clear();challengeId='';flightLesson=null;view='chase';siteIndex='here';
    state={...pose,guidedParakite:true};weather=state.weather;
    snap=true;yaw=0;pitch=-.34;message='';
    updateFlightPresentation(0);
    options.onFlightChange?.(mode,siteIndex,weather);
  }
  function endGuidedFlight(){
    flightLesson=null;
    if(state?.guidedParakite)state={...state,guidedParakite:false,followStep:undefined};
  }
  function beginFlightLesson(){
    if(!flightLesson?.ready)return;
    clear();
    flightLesson.ready=false;
  }
  /** Which phase of the day the light depicts; the core's diurnal wind table
   * decides what that means for the air. The phase is a name, never a speed. */
  function setTimeOfDay(name){if(name===timeOfDay)return;timeOfDay=name;refreshAir();}
  function setChallenge(id){if(id&&!config.challenges?.[id])throw new Error(`Unknown flight challenge: ${id}`);flightLesson=null;challengeId=id;if(state&&config.modes[mode])state=startFlightChallenge(state,id,config);}
  function setPilotMotion(value){if(!['steady','physical'].includes(value))throw new Error(`Unknown pilot posture: ${value}`);pilotMotion=value;pilotPosture.reset();}
  // Fixed renderer fields share the live wind clock/weather, while their
  // immutable floor/trail queries may be reused for this scene's lifetime.
  function fixedEnvironmentSampler(options){
    return createFixedAirSampler((x,y,z,terrain)=>sampleAir(config,air,{x,y,z,weather},time,terrain),height,options);
  }
  /** Stand him at [x, y] facing `heading` (rad, from east), the chase camera behind him. */
  function placeOnFoot(x,y,heading){
    if(mode!=='walk')select('walk');
    state={x,y,z:height(x,y),heading,speed:0};yaw=Math.atan2(-Math.cos(heading),Math.sin(heading));pitch=-.3;snap=true;
    character.object.rotation.set(0,heading+Math.PI/2,0);updateWalk(0,0,0);
  }
  /** Input tapes (balance.js playTape): record what walking is fed, frame by frame, then replay
   * it from the same start against the same rules. Identical inputs on consecutive frames merge. */
  function recordTape(){tape={start:{...state,balance:undefined},frames:[]};}
  function stopTape(){
    const t=tape;tape=null;if(!t)return null;
    const frames=[];for(const f of t.frames){const last=frames.at(-1);if(last&&last[2]===f[2]&&JSON.stringify(last[1])===JSON.stringify(f[1]))last[0]++;else frames.push(f);}
    return {...t,frames,end:{x:state.x,y:state.y,phase:state.balance?.phase??'steady'}};
  }
  function replayTape(t){
    const world={height:walkHeight,hitTest,waterAt:options.walkHeight?.waterAt,floorHeight:options.walkHeight?.floorHeight??options.floorHeight??height,balance:options.balance};
    return playTape(t,{...t.start},(s,input,h)=>stepMoves(s,input,h,characterConfig.walk,world));
  }
  function setPlayerMode(on){playerMode=!!on;}
  /** Open on foot with an authored tour: `waypoints` (scene coordinates, the first is the opening
   * camera) lead round to the live chase view over `seconds`, the camera watching `focus` until it
   * hands the aim to him. Input is held until it lands; mode stays walk throughout. */
  function introShot(waypoints,focus,seconds,fov=camera.fov){
    if(mode!=='walk')return;
    const points=waypoints.map(p=>p.clone());  // the last is replaced by the live chase pose each frame
    shot={path:true,curve:new T.CatmullRomCurve3(points,false,'centripetal'),focus:focus.clone(),look:new T.Vector3(),basis:new T.Matrix4(),
      seconds,fov,raw:new T.Vector3(),aim:new T.Quaternion(),t:0,intro:true};
    camera.position.copy(points[0]);camera.lookAt(focus);
    keys.clear();queuedPrimary=queuedHarness=hop=queuedSlide=false;drag=false;
  }
  /** Start the walk-in glide from a held pose (the trail map's overhead view) instead of where the
   * camera was: one straight, eased move to the live chase view over `seconds`. */
  function glideFrom(position,quaternion,seconds){
    if(mode!=='walk')return;
    shot={from:position.clone(),q:quaternion.clone(),fov:camera.fov,raw:new T.Vector3(),aim:new T.Quaternion(),t:0,seconds};
    camera.position.copy(position);camera.quaternion.copy(quaternion);
  }
  function suspend(on){suspended=!!on;if(suspended){keys.clear();queuedPrimary=queuedHarness=hop=queuedSlide=false;}}
  return {setPlayerMode,suspend,get suspended(){return suspended;},placeOnFoot,recordTape,stopTape,replayTape,constrainCamera(){clearCameraTerrain(camera.position,height,cameraTerrainRadius(camera));},cameraProfile:policy,select,warmArrival,introShot,glideFrom,update,poll,clear,changeHarness,launchHere,launchFromTree,get preferredFlightMode(){return preferredFlightMode;},set preferredFlightMode(next){if(config.modes[next])preferredFlightMode=next;},carry,alight,setWeather,setTimeOfDay,setChallenge,setPilotMotion,fixedEnvironmentSampler,sampleFloor:height,sampleEnvironment(x,y,z){return renderAir.sample(x,y,z);},setEffects(value){effects=value;},get message(){return message;},get underwater(){return mode==='walk'&&underwater;},get weather(){return weather;},get siteIndex(){return siteIndex;},get view(){return view;},get mode(){return mode;},get state(){return state;},get shot(){return shot;},cancelShot(){shot=null;},get shotActive(){return shot!==null;},get air(){return state&&config.modes[mode]?sampleAir(config,air,state,time,height):null;},get timeOfDay(){return timeOfDay;},
    prepareFlightLesson,beginFlightLesson,placeGuidedFlight,endGuidedFlight,endFlightLesson(){flightLesson=null;},get flightLesson(){return flightLesson;},
    dispose(){renderAir.dispose();window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',clear);window.removeEventListener('gamepaddisconnected',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('pointercancel',cancel);canvas.removeEventListener('lostpointercapture',cancel);canvas.removeEventListener('wheel',wheel);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointermove',move);}};
}

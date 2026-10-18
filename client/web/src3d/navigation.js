/** Keyboard, pointer and Gamepad input; flight, ski and bike rules live in shared/. */
import * as T from '../vendor/three.module.min.js';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {rideStart,startRide,stepRide} from '../../../shared/activities/ride.js';
import {flightInput} from './flight-input.js';
import {stepWalk} from '../../../shared/activities/walk.js';
export function createNavigation(camera,canvas,orbit,ground,config,worldmap,rig,hitTest,ride,character,characterConfig,options={}){
  let mode='orbit',state=null,previousFlight=null,accumulator=0,time=0,yaw=0,pitch=0,drag=false,view='chase',hop=false,snap=true;
  let weather='soaring',siteIndex=0,feedbackTime=0,effects=1;
  const flightPressed=new Set(),flightModes=Object.keys(config.modes);
  const pressed=new Set(),riding=()=>ride.config.modes[mode]!==undefined,chase=new T.Vector3();
  const keys=new Set(),look=new T.Euler(0,0,0,'YXZ');
  const height=(x,y)=>ground.height(x,y)??0;
  const forward=new T.Vector3(),side=new T.Vector3();
  const target=new T.Vector3();
  const clear=()=>{keys.clear();drag=false;accumulator=0;previousFlight=null;};
  function key(e,down){if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if(down&&!e.repeat&&e.code==='Space')hop=true;if(down&&!e.repeat&&e.code==='KeyV'&&(riding()||config.modes[mode]))toggleView();
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','ShiftRight','KeyR','KeyF'].includes(e.code)){if(down)keys.add(e.code);else keys.delete(e.code);if(e.target===canvas)e.preventDefault();}}
  const kd=e=>key(e,true),ku=e=>key(e,false);
  window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);window.addEventListener('gamepaddisconnected',clear);
  const down=e=>{if(mode==='orbit')return;drag=true;canvas.focus();canvas.setPointerCapture(e.pointerId);};
  const up=()=>drag=false;
  const move=e=>{if(mode==='orbit'||(!drag&&document.pointerLockElement!==canvas))return;yaw-=e.movementX*.003;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.003));};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointermove',move);
  const dead=v=>Math.abs(v??0)<.14?0:Math.sign(v)*(Math.abs(v)-.14)/.86;
  function toggleView(){view=view==='chase'?'first':'chase';if(riding())ride.rig.visible=view==='chase';snap=true;}
  function select(next,site='0'){
    const previous=mode==='orbit'?null:state;
    clear();mode=next;camera.fov=62;camera.updateProjectionMatrix();orbit.enabled=next==='orbit';rig.visible=config.modes[next]!==undefined;ride.rig.visible=riding()&&view==='chase';
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
    siteIndex=Number(site)||0;state=launchFlight(config,next,config.launches[siteIndex],height,weather);yaw=0;pitch=-.34;
    options.onFlightChange?.(next,siteIndex,weather);
    updateFlightPresentation(0);
  }
  function update(dt){
    const pad=[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);
    if(!riding()){
      const edge=i=>{const now=pad?.buttons[i]?.pressed??false,was=flightPressed.has(i);now?flightPressed.add(i):flightPressed.delete(i);return now&&!was;};
      const previous=edge(14),next=edge(15),up=edge(12),down=edge(13),restart=edge(0),changeView=edge(3),changeWeather=edge(2);
      if(previous||next){const i=flightModes.indexOf(mode);select(flightModes[(Math.max(0,i)+(next?1:-1)+flightModes.length)%flightModes.length],siteIndex);}
      if(up||down){siteIndex=(siteIndex+(up?-1:1)+config.launches.length)%config.launches.length;if(config.modes[mode])select(mode,siteIndex);}
      if(restart)select(config.modes[mode]?mode:'paraglider',siteIndex);
      if(changeView&&config.modes[mode])toggleView();
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
      updateWalk(dt,x,y,keys.has('ShiftLeft')||(pad?.buttons[10]?.pressed??false));
    }else{
      const input=flightInput(pad,keys);
      accumulator+=Math.min(dt,.05);
      while(accumulator>=1/120){previousFlight=state;state=stepFlight(state,input,1/120,time,config,worldmap.wind.direction_deg,height,hitTest);time+=1/120;accumulator-=1/120;}
      updateFlightPresentation(dt,flightPose());
      feedbackTime+=dt;
      if(options.haptics?.()!==false&&effects&&feedbackTime>.12&&pad?.vibrationActuator?.playEffect){
        feedbackTime=0;const strength=state.grounded?0:Math.min(.45,Math.abs(state.turbulence)*.07+Math.max(0,state.load-1)*.15);
        if(strength>.025)Promise.resolve(pad.vibrationActuator.playEffect('dual-rumble',{duration:110,strongMagnitude:strength*.4,weakMagnitude:strength})).catch(()=>{});
      }
    }
    orbit.target.copy(camera.position);orbit.target.y=height(camera.position.x,-camera.position.z);
  }
  function follow(dt,distance,heading){
    target.copy(character.object.position).add(new T.Vector3(0,config.modes[mode]?2.7:1.1,0));
    const angle=heading-Math.PI/2+yaw;
    chase.set(target.x+Math.sin(angle)*Math.cos(pitch)*distance,target.y-Math.sin(pitch)*distance,target.z+Math.cos(angle)*Math.cos(pitch)*distance);
    chase.y=Math.max(chase.y,height(chase.x,-chase.z)+.45);
    // Pull the camera in along the same view ray when a tree or home blocks it.
    const start=[target.x,-target.z,target.y];
    for(let i=0;i<12&&hitTest?.(start,[chase.x,-chase.z,chase.y],.2);i++)chase.lerp(target,.2);
    if(snap)camera.position.copy(chase);else camera.position.lerp(chase,1-Math.exp(-dt*10));
    camera.lookAt(target);snap=false;
  }
  function updateWalk(dt,x,y,run){
    forward.set(-Math.sin(yaw),0,-Math.cos(yaw));side.set(Math.cos(yaw),0,-Math.sin(yaw));
    const movement=forward.clone().multiplyScalar(y).addScaledVector(side,x);
    state=stepWalk(state,{x:movement.x,y:-movement.z,run},dt,characterConfig.walk,(x,y)=>ground.height(x,y),hitTest);
    character.object.position.set(state.x,state.z,-state.y);
    if(state.speed>0){
      const goal=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),state.heading+Math.PI/2);
      character.object.quaternion.slerp(goal,1-Math.exp(-dt*14));
    }
    character.update(dt,state.speed>.05?(run?'run':'walk'):'idle',state.speed);
    // Walk heading follows movement; the camera's yaw stays independently controllable.
    follow(dt,5.4,Math.PI/2);
  }
  function flightPose(){
    if(!previousFlight||state.grounded)return state;
    // Render between physics ticks so both the pilot and camera aim move on
    // every frame. The simulation and instruments keep the current state.
    const pose={...state},alpha=accumulator*120;
    for(const key of ['x','y','z','heading','pitch','bank','speed'])pose[key]=previousFlight[key]+(state[key]-previousFlight[key])*alpha;
    return pose;
  }
  function updateFlightPresentation(dt,pose=state){
    rig.position.set(pose.x,pose.z-config.landing_clearance_m,-pose.y);
    rig.rotation.set(-pose.pitch,pose.heading+Math.PI/2,-pose.bank*.65);
    character.object.position.copy(rig.position);
    character.object.quaternion.copy(rig.quaternion);
    character.object.rotateZ(pose.bank*.25);character.object.visible=view==='chase';
    character.update(dt,pose.grounded?'idle':'flight',0,{mode:pose.mode,bank:pose.bank,grounded:pose.grounded});
    if(view==='chase'){
      follow(dt,(12+Math.min(3,pose.speed*.08))*Math.max(1,.95/camera.aspect),pose.heading);
    }else{
      character.object.visible=false;camera.position.set(pose.x,pose.z+.15,-pose.y);
      look.set(pitch+pose.pitch*.2,pose.heading-Math.PI/2+yaw,-pose.bank*.08*effects);camera.quaternion.setFromEuler(look);snap=false;
    }
    const desired=62+Math.min(18,Math.max(0,pose.speed-12)*.8)*effects;
    camera.fov+= (desired-camera.fov)*(1-Math.exp(-dt*3));camera.updateProjectionMatrix();
    rig.userData.flightUpdate?.(dt,pose);
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
  function setWeather(name){if(!config.weather[name])return;weather=name;if(state&&config.modes[mode])state={...state,weather};options.onFlightChange?.(mode,siteIndex,weather);}
  return {select,update,clear,setWeather,sampleEnvironment(x,y,z){return sampleAir(config,worldmap.wind.direction_deg,{x,y,z,weather},time,height);},setEffects(value){effects=value;},get weather(){return weather;},get siteIndex(){return siteIndex;},get view(){return view;},get mode(){return mode;},get state(){return state;},get air(){return state&&config.modes[mode]?sampleAir(config,worldmap.wind.direction_deg,state,time,height):null;},dispose(){window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',clear);window.removeEventListener('gamepaddisconnected',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointermove',move);}};
}

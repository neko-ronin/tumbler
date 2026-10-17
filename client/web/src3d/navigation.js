/** Keyboard, pointer and Gamepad input; flight, ski and bike rules live in shared/. */
import * as T from '../vendor/three.module.min.js';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {rideStart,startRide,stepRide} from '../../../shared/activities/ride.js';
import {stepWalk} from '../../../shared/activities/walk.js';
export function createNavigation(camera,canvas,orbit,ground,config,worldmap,rig,hitTest,ride,character,characterConfig){
  let mode='orbit',state=null,accumulator=0,time=0,yaw=0,pitch=0,drag=false,view='chase',hop=false,snap=true;
  const pressed=new Set(),riding=()=>ride.config.modes[mode]!==undefined,chase=new T.Vector3();
  const keys=new Set(),look=new T.Euler(0,0,0,'YXZ');
  const height=(x,y)=>ground.height(x,y)??0;
  const forward=new T.Vector3(),side=new T.Vector3();
  const target=new T.Vector3();
  const clear=()=>{keys.clear();drag=false;accumulator=0;};
  function key(e,down){if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if(down&&!e.repeat&&e.code==='Space')hop=true;if(down&&!e.repeat&&e.code==='KeyV'&&riding())toggleView();
    if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','ShiftLeft','KeyR','KeyF'].includes(e.code)){if(down)keys.add(e.code);else keys.delete(e.code);if(e.target===canvas)e.preventDefault();}}
  const kd=e=>key(e,true),ku=e=>key(e,false);
  window.addEventListener('keydown',kd);window.addEventListener('keyup',ku);window.addEventListener('blur',clear);
  document.addEventListener('visibilitychange',clear);window.addEventListener('gamepaddisconnected',clear);
  const down=e=>{if(mode==='orbit')return;drag=true;canvas.focus();canvas.setPointerCapture(e.pointerId);};
  const up=()=>drag=false;
  const move=e=>{if(mode==='orbit'||(!drag&&document.pointerLockElement!==canvas))return;yaw-=e.movementX*.003;pitch=Math.max(-1.35,Math.min(1.35,pitch-e.movementY*.003));};
  canvas.addEventListener('pointerdown',down);canvas.addEventListener('pointerup',up);canvas.addEventListener('pointermove',move);
  const dead=v=>Math.abs(v??0)<.14?0:Math.sign(v)*(Math.abs(v)-.14)/.86;
  function toggleView(){view=view==='chase'?'first':'chase';ride.rig.visible=view==='chase';snap=true;}
  function select(next,site='0'){
    const previous=mode==='orbit'?null:state;
    clear();mode=next;orbit.enabled=next==='orbit';rig.visible=config.modes[next]!==undefined;ride.rig.visible=riding()&&view==='chase';
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
    state=launchFlight(config,next,config.launches[Number(site)||0],height);yaw=0;pitch=-.18;
    updateFlightPresentation(0);
  }
  function update(dt){
    if(mode==='orbit'){orbit.update();return;}
    const pad=[...(navigator.getGamepads?.()??[])].find(p=>p?.connected);
    const lx=dead(pad?.axes[0]),ly=dead(pad?.axes[1]),rx=dead(pad?.axes[2]),ry=dead(pad?.axes[3]);
    yaw-=rx*dt*1.6;pitch=Math.max(-1.35,Math.min(1.35,pitch-ry*dt*1.4));
    const x=Number(keys.has('KeyD')||keys.has('ArrowRight'))-Number(keys.has('KeyA')||keys.has('ArrowLeft'))+lx;
    const y=Number(keys.has('KeyW')||keys.has('ArrowUp'))-Number(keys.has('KeyS')||keys.has('ArrowDown'))-ly;
    if(riding()){updateRide(dt,pad,x,y);return;}
    if(mode==='walk'){
      updateWalk(dt,x,y,keys.has('ShiftLeft')||(pad?.buttons[10]?.pressed??false));
    }else{
      accumulator+=Math.min(dt,.05);
      while(accumulator>=1/120){state=stepFlight(state,{turn:x,brake:-y,throttle:Number(keys.has('KeyR'))-Number(keys.has('KeyF'))+(pad?.buttons[7]?.value??0)-(pad?.buttons[6]?.value??0)},1/120,time,config,worldmap.wind.direction_deg,height,hitTest);time+=1/120;accumulator-=1/120;}
      updateFlightPresentation(dt);
    }
    orbit.target.copy(camera.position);orbit.target.y=height(camera.position.x,-camera.position.z);
  }
  function follow(dt,distance,heading){
    target.copy(character.object.position).add(new T.Vector3(0,1.1,0));
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
  function updateFlightPresentation(dt){
    rig.position.set(state.x,state.z-config.landing_clearance_m,-state.y);
    rig.rotation.set(-state.pitch,state.heading+Math.PI/2,-state.bank*.65);
    character.object.position.copy(rig.position);
    character.object.quaternion.copy(rig.quaternion);
    character.update(dt,state.grounded?'idle':'flight',0,{mode:state.mode,bank:state.bank,grounded:state.grounded});
    follow(dt,12,state.heading);
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
  return {select,update,clear,get mode(){return mode;},get state(){return state;},get air(){return state&&config.modes[mode]?sampleAir(config,worldmap.wind.direction_deg,state,time,height):null;},dispose(){window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',clear);window.removeEventListener('gamepaddisconnected',clear);document.removeEventListener('visibilitychange',clear);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointermove',move);}};
}

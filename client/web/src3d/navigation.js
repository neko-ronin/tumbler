/** Keyboard, pointer and Gamepad input; flight, ski and bike rules live in shared/. */
import * as T from '../vendor/three.module.min.js';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {rideStart,startRide,stepRide} from '../../../shared/activities/ride.js';
export function createNavigation(camera,canvas,orbit,ground,config,worldmap,rig,hitTest,ride){
  let mode='orbit',state=null,accumulator=0,time=0,yaw=0,pitch=0,drag=false,view='chase',hop=false,snap=true;
  const pressed=new Set(),riding=()=>ride.config.modes[mode]!==undefined,chase=new T.Vector3();
  const keys=new Set(),look=new T.Euler(0,0,0,'YXZ');
  const height=(x,y)=>ground.height(x,y)??0;
  const forward=new T.Vector3(),side=new T.Vector3();
  let walkY=camera.position.y;
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
    clear();mode=next;orbit.enabled=next==='orbit';rig.visible=config.modes[next]!==undefined;ride.rig.visible=riding()&&view==='chase';
    if(next==='orbit'){orbit.setTarget(camera.position.x,camera.position.y,camera.position.z-20);return;}
    const direction=new T.Vector3();camera.getWorldDirection(direction);yaw=Math.atan2(-direction.x,-direction.z);pitch=0;
    if(next==='walk'){walkY=height(camera.position.x,-camera.position.z)+1.8;camera.position.y=walkY;return;}
    if(riding()){
      state=startRide(ride.config,rideStart(ride.config,site,worldmap,ride.snowAt),ride.height);yaw=0;pitch=0;snap=true;hop=false;
      for(const [name,mesh] of Object.entries(ride.meshes))mesh.visible=name===next;return;
    }
    state=launchFlight(config,next,config.launches[Number(site)||0],height);yaw=0;pitch=-.10;
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
      forward.set(-Math.sin(yaw),0,-Math.cos(yaw));side.set(Math.cos(yaw),0,-Math.sin(yaw));
      const speed=(keys.has('ShiftLeft')?9:3.5)*dt;
      const before=camera.position.clone();camera.position.addScaledVector(forward,y*speed).addScaledVector(side,x*speed);
      const h=ground.height(camera.position.x,-camera.position.z);
      if(h===null||Math.abs(h+1.8-walkY)>Math.max(.7,speed*1.8)||hitTest?.([before.x,-before.z,before.y-.9],[camera.position.x,-camera.position.z,(h??0)+.9],.35)){camera.position.copy(before);}else{walkY=h+1.8;camera.position.y=walkY;}
      look.set(pitch,yaw,0);camera.quaternion.setFromEuler(look);
    }else{
      accumulator+=Math.min(dt,.05);
      while(accumulator>=1/120){state=stepFlight(state,{turn:x,brake:-y,throttle:Number(keys.has('KeyR'))-Number(keys.has('KeyF'))+(pad?.buttons[7]?.value??0)-(pad?.buttons[6]?.value??0)},1/120,time,config,worldmap.wind.direction_deg,height,hitTest);time+=1/120;accumulator-=1/120;}
      camera.position.set(state.x,state.z,-state.y);
      look.set(pitch,state.heading-Math.PI/2+yaw,-state.bank*.28);camera.quaternion.setFromEuler(look);
      rig.position.set(state.x,state.z-2.1,-state.y);rig.rotation.set(-state.pitch,state.heading+Math.PI/2,-state.bank*.65);
    }
    orbit.target.copy(camera.position);orbit.target.y=height(camera.position.x,-camera.position.z);
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
  return {select,update,clear,get mode(){return mode;},get state(){return state;},get air(){return state?sampleAir(config,worldmap.wind.direction_deg,state,time,height):null;},dispose(){window.removeEventListener('keydown',kd);window.removeEventListener('keyup',ku);window.removeEventListener('blur',clear);canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('pointerup',up);canvas.removeEventListener('pointermove',move);}};
}

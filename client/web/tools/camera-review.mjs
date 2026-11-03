/** Diagnostic replay in the already loaded game. No extra scene, geometry loads or
 * rendering loop. Import in Playwright/DevTools, call runCameraReview(tumbler,
 * 'forest' | 'climb' | 'backstep' | 'run-turn'), then capture the next displayed frame.
 * It drives real keyboard events/core movement and measures the animated head.
 * This is a staged regression replay, not an uninterrupted human playthrough. */
import * as T from '../vendor/three.module.min.js';
import {attachClimb,trunkRadiusAt} from '../../../shared/activities/climb.js';
let playerConfig;
export async function runCameraReview(game,scenario='forest'){
 playerConfig??=await (await fetch(new URL('../../../'+game.ride.worldmap.activities.character,import.meta.url))).json();
 const {navigation:nav,camera,character}=game,canvas=game.renderer.domElement;
 const held=new Set(),key=(code,down)=>{canvas.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,bubbles:true}));down?held.add(code):held.delete(code);};
 const heels=['heel.L','heel.R'].map(name=>character.model.getObjectByName(name)).filter(Boolean);
 const head=character.model.getObjectByName('head'),place=new T.Vector3(),screen=new T.Vector3(),direction=new T.Vector3(),body=new T.Vector3();
 const result={scenario,frames:0,minHeadDistance:Infinity,minFloorClearance:Infinity,maxHeadScreenExtent:0,maxFootScreenY:0,modes:[]};
 const modes=new Set();
 const sample=()=>{
  character.object.updateWorldMatrix(true,true);head.getWorldPosition(place);camera.updateMatrixWorld();screen.copy(place).project(camera);
  const gap=place.distanceTo(camera.position),floor=camera.position.y-nav.sampleFloor(camera.position.x,-camera.position.z);
  result.frames++;result.minHeadDistance=Math.min(result.minHeadDistance,gap);result.minFloorClearance=Math.min(result.minFloorClearance,floor);
  result.maxHeadScreenExtent=Math.max(result.maxHeadScreenExtent,Math.abs(screen.x),Math.abs(screen.y));modes.add(nav.state.mode??'ground');
  if(!Number.isFinite(gap)||!Number.isFinite(screen.z)||floor<.449||gap<2||screen.z< -1||screen.z>1||Math.abs(screen.x)>.9||Math.abs(screen.y)>.9)throw new Error(`Camera framing failure: ${JSON.stringify({gap,screen:screen.toArray(),state:nav.state.mode,scenario})}`);
  for(const heel of heels){heel.getWorldPosition(place);screen.copy(place).project(camera);const y=(1-screen.y)/2;result.maxFootScreenY=Math.max(result.maxFootScreenY,y);if(y>1)throw new Error(`Feet outside frame: ${y}`);}
 };
 const tick=(frames,measure=true)=>{for(let i=0;i<frames;i++){nav.update(1/30);nav.constrainCamera();if(measure)sample();}};
 const yaw=()=>{camera.getWorldDirection(direction);return Math.atan2(-direction.x,-direction.z);};
 const angle=v=>Math.atan2(Math.sin(v),Math.cos(v));
 const start=(x,y,heading=Math.PI/2)=>{
  nav.clear();nav.select('orbit');const z=nav.sampleFloor(x,y);camera.position.set(x,z+5,-y);camera.lookAt(x+Math.cos(heading),z+5,-y-Math.sin(heading));nav.select('walk');tick(90,false);
 };
 try{
  start(1723.3673,927.1585);
  if(nav.view!=='chase'){key('KeyV',true);key('KeyV',false);}
  if(scenario==='forest'){
   key('KeyW',true);key('ShiftLeft',true);tick(100);key('KeyW',false);key('ShiftLeft',false);
   key('KeyS',true);tick(22);key('KeyS',false);tick(15);
  }else if(scenario==='climb'){
   const shapes=game.ride.hitTest.near([1716.3673,920.1585,270],55).filter(s=>s.trunk&&(s.trunk.climb_top_z??s.trunk.top_z)-s.trunk.base_z>30);
   const box=shapes.sort((a,b)=>b.trunk.top_z-a.trunk.top_z)[0];if(!box)throw new Error('Forest fixture lost its climbable tree');
   const z=box.trunk.base_z+8,x=box.trunk.x+trunkRadiusAt(box.trunk,z)+.3,y=box.trunk.y;
   start(x,y,Math.PI);Object.assign(nav.state,attachClimb({...nav.state,x,y,z},box,playerConfig.walk));
   key('KeyW',true);key('KeyD',true);tick(75);
   result.climbYawError=Math.abs(angle(yaw()-(nav.state.heading-Math.PI/2)));
   head.getWorldPosition(body);for(const heel of heels)body.addScaledVector(heel.getWorldPosition(place),1/heels.length);body.multiplyScalar(.5);camera.updateMatrixWorld();result.finalBodyScreenY=(1-body.project(camera).y)/2;
   if(Math.abs(result.finalBodyScreenY-.5)>.02)throw new Error(`Tree body is not centred: ${result.finalBodyScreenY}`);
   if(nav.state.mode!=='climb'||result.climbYawError>.3)throw new Error(`Climb camera loses the trunk: ${JSON.stringify(result)}`);
  }else if(scenario==='run-turn'){
   key('KeyD',true);key('ShiftLeft',true);let distance=0;
   for(let i=0;i<54;i++){const {x,y}=nav.state;tick(1);distance+=Math.hypot(nav.state.x-x,nav.state.y-y);}
   result.distanceM=distance;result.durationS=1.8;result.runningYawError=Math.abs(angle(yaw()-(nav.state.heading-Math.PI/2)));
   if(distance<8||result.runningYawError>.15)throw new Error(`Running view trails: ${JSON.stringify(result)}`);
  }else if(scenario==='backstep'){
   const before=yaw();key('KeyS',true);tick(21);key('KeyS',false);result.briefTurnRad=Math.abs(angle(yaw()-before));
   if(result.briefTurnRad>.08)throw new Error(`Backstep recenters: ${result.briefTurnRad}`);
  }else throw new Error(`Unknown camera scenario: ${scenario}`);
 }finally{for(const code of held)key(code,false);}
 result.modes=[...modes];return result;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cameraFixture,read,world,player,policy,spacing,viewYaw,angle} from './helpers/camera-fixture.mjs';
import {forestSpacing} from '../../../shared/activities/forest-spacing.js';
import {cameraProfile,cameraMovementProfile} from '../../../shared/activities/camera.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {composeFollowView,createFollowRange,createCameraBoom,createFollowCamera} from '../src3d/follow-camera.js';
import * as T from '../vendor/three.module.min.js';
import {attachClimb} from '../../../shared/activities/climb.js';
function forestGround(){
 const manifest=read('client/web/data/viewer.json'),geology=read(world.mountains.geology);
 const grid=key=>{const d=manifest.height_grids[key],bytes=readFileSync(new URL('../../../'+d.file,import.meta.url));return new HeightGrid({...d,values:applyGeologyTerrain(new Float32Array(Uint8Array.from(bytes).buffer),d,geology.terrain[key])});};
 const river=createRiverGranite(read('shared/world/out/river_granite.json'));
 const ground=new GroundSampler(grid('block'),grid('far_field'),river.height,createGeologySampler(geology));
 return (x,y)=>ground.height(x,y);
}

test('dense-forest running keeps a useful chase distance from the head, including uphill turns',t=>{
 const height=forestGround(),walkHeight=createWalkHeight(world,height),f=cameraFixture(t,{height,walkHeight});
 const trees=read('shared/world/out/placement.json').instances.filter(i=>i.asset.startsWith('redwood/')&&Math.abs(i.position_m[0])<1800&&Math.abs(i.position_m[1])<1800);
 let closest=Infinity,worst=null,frames=0;
 for(let site=0;site<6;site++){
  const tree=trees[Math.floor(site*trees.length/6)], [x,y]=tree.position_m;
  for(let direction=0;direction<8;direction++){
   f.pad.axes.fill(0);f.start(x+7,y+7,direction*Math.PI/4);f.pad.axes[1]=-1;
   for(let i=0;i<90;i++){
    f.nav.update(1/30);const s=f.nav.state;
    const gap=Math.hypot(f.camera.position.x-s.x,f.camera.position.y-s.z-1.65*player.scale,f.camera.position.z+s.y);
    if(gap<closest){closest=gap;worst={site:tree.id,x:s.x,y:s.y,z:s.z,direction,frame:i,gap};}frames++;
   }
  }
 }
 console.log(JSON.stringify({scenario:'forest-run',frames,minHeadDistance:closest,worst}));
 assert.ok(closest>=2*player.scale,`camera enters head framing: ${JSON.stringify(worst)}`);
});

test('camera tracks circling and ascending a real core climb with a tight correction',t=>{
 const trunk={x:0,y:0,base_z:0,top_z:50,profile:[[0,2],[50,1]]},box={min:[-2,-2,0],max:[2,2,50],kind:'tree',trunk};
 const f=cameraFixture(t,{hitTest:createCollisionIndex([box])});f.start(2.5,0);
 Object.assign(f.nav.state,attachClimb({...f.nav.state,z:8},box,player.walk));
 f.pad.axes[1]=-1;f.pad.axes[0]=.65;
 for(let i=0;i<120;i++)f.nav.update(1/60);
 const error=Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2));
 console.log(JSON.stringify({scenario:'climb-circle',yawError:error,height:f.nav.state.z,mode:f.nav.state.mode}));
 assert.equal(f.nav.state.mode,'climb');assert.ok(error<.3,`camera loses climbing side: ${error} rad`);
});

test('a short backstep shows the face without starting automatic ground recentering',t=>{
 const f=cameraFixture(t);f.start();const before=viewYaw(f.camera);f.pad.axes[1]=1;
 for(let i=0;i<42;i++)f.nav.update(1/60);
 const turn=Math.abs(angle(viewYaw(f.camera),before));
 assert.ok(turn<.08,`short backstep rotates view by ${turn} rad`);
});

test('ground travel target completes at 12 metres and the damped view settles at every refresh rate',()=>{
 const profile=cameraProfile(policy,'walk',[0,0,0],spacing.meanNearestM),budget=profile.follow_distance_m;
 assert.equal(budget,12);
 for(const speed of [1.6,3.5,9])for(const hz of [30,60,144]){
  const director=createFollowCamera();let yaw=0,pitch=-.24,distance=0,atQuarter=null,result;
  while(distance<budget){
   const step=Math.min(speed/hz,budget-distance);distance+=step;
   result=director.step(step/speed,yaw,pitch,Math.PI,true,profile,false,false,step);({yaw,pitch}=result);
   if(atQuarter===null&&distance>=budget*.25)atQuarter=yaw;
  }
  assert.ok(Math.abs(result.distanceEase-1)<1e-10,`${speed} m/s, ${hz} Hz: travel target incomplete`);
  for(let i=0;i<hz*2;i++)({yaw,pitch}=director.step(1/hz,yaw,pitch,Math.PI,false,profile));
  assert.ok(Math.abs(angle(yaw,Math.PI))<.001);
  assert.ok(atQuarter<.15,'the first quarter of the distance still exposes his face');
 }
});

test('the displayed ground camera eases into its completed travel target',t=>{
 const f=cameraFixture(t);f.start();f.pad.axes[1]=1;
 let distance=0;
 while(distance<12){
  const old={...f.nav.state};f.nav.update(1/60);distance+=Math.hypot(f.nav.state.x-old.x,f.nav.state.y-old.y);
 }
 f.pad.axes.fill(0);
 for(let i=0;i<120;i++)f.nav.update(1/60);
 assert.ok(Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2))<.001);
});

test('forest spacing measures nearest neighbours exactly, excluding non-forest placements',()=>{
 const trees=[[0,0],[3,0],[10,0]].map(([x,y])=>({asset:'redwood/test.glb',position_m:[x,y,0]}));
 assert.equal(forestSpacing([...trees,{asset:'house.glb',position_m:[.1,0,0]}]).meanNearestM,13/3);
 assert.equal(forestSpacing([]).meanNearestM,0);
 assert.equal(forestSpacing([trees[0],{...trees[0]}]).meanNearestM,0);
});

test('interpolating opposite chase directions follows an arc outside the character',()=>{
 const boom=createCameraBoom(),eye=new T.Vector3(),target=new T.Vector3(0,1.1,0);
 boom.place(eye,target,new T.Vector3(0,2.4,5.2),0,true);
 for(let i=0;i<60;i++){
  boom.place(eye,target,new T.Vector3(0,2.4,-5.2),1/60);
  assert.ok(eye.distanceTo(target)>5,'a reversal never interpolates through the head');
 }
});

test('tight climb follow tracks a small trunk without lag growing with angular speed',t=>{
 const trunk={x:0,y:0,base_z:0,top_z:50,profile:[[0,.45],[50,.35]]},box={min:[-.5,-.5,0],max:[.5,.5,50],kind:'tree',trunk};
 const f=cameraFixture(t,{hitTest:createCollisionIndex([box])});f.start(1,0);
 Object.assign(f.nav.state,attachClimb({...f.nav.state,z:8},box,player.walk));f.pad.axes[1]=-1;f.pad.axes[0]=.65;
 for(let i=0;i<120;i++)f.nav.update(1/60);
 assert.ok(Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2))<.12,'orbit follows the trunk normal without angular-speed lag');
});

test('running during the walk introduction never brings the camera into the head',t=>{
 const height=forestGround(),f=cameraFixture(t,{height,walkHeight:createWalkHeight(world,height)});let closest=Infinity;
 for(let turn=0;turn<8;turn++){
  f.pad.axes.fill(0);f.start(1723.3673,927.1585,turn*Math.PI/4,0);f.pad.axes[1]=-1;
  for(let i=0;i<90;i++){
   f.nav.update(1/30);const s=f.nav.state;
   closest=Math.min(closest,Math.hypot(f.camera.position.x-s.x,f.camera.position.y-s.z-1.65*player.scale,f.camera.position.z+s.y));
  }
 }
 assert.ok(closest>=2,`intro head gap: ${closest}`);
});

test('pauses do not spend or discard the distance budget, and blocked movement cannot recenter',()=>{
 const p=cameraProfile(policy,'walk',[0,0,0],spacing.meanNearestM),d=createFollowCamera();let yaw=0,pitch=0;
 for(let i=0;i<60;i++)({yaw,pitch}=d.step(1/30,yaw,pitch,Math.PI,true,p,false,false,0));
 assert.equal(yaw,0);
 for(let part=0;part<10;part++){
  ({yaw,pitch}=d.step(.1,yaw,pitch,Math.PI,true,p,false,false,p.follow_distance_m/10));
  for(let i=0;i<15;i++)({yaw,pitch}=d.step(1/30,yaw,pitch,Math.PI,false,p));
 }
 for(let i=0;i<60;i++)({yaw,pitch}=d.step(1/30,yaw,pitch,Math.PI,false,p));
 assert.ok(Math.abs(angle(yaw,Math.PI))<.001);
});

test('running during the introduction settles smoothly after the travel window',t=>{
 const f=cameraFixture(t);f.start(0,0,Math.PI/2,0);f.pad.axes[1]=1;
 let distance=0;
 while(distance<12){const old={...f.nav.state};f.nav.update(1/60);distance+=Math.hypot(f.nav.state.x-old.x,f.nav.state.y-old.y);}
 f.pad.axes.fill(0);
 for(let i=0;i<120;i++)f.nav.update(1/60);
 assert.ok(Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2))<.001);
});

test('heading and pitch stay fixed for 2 m and ease smoothly toward the completed 12 m target',()=>{
 const p=cameraProfile(policy,'walk',[0,0,0]),d=createFollowCamera();let yaw=0,pitch=.3;
 for(let i=0;i<20;i++)({yaw,pitch}=d.step(.1,yaw,pitch,Math.PI,true,p,false,false,.1));
 assert.ok(Math.abs(yaw)<1e-12);assert.ok(Math.abs(pitch-.3)<1e-12);
 ({yaw,pitch}=d.step(.1,yaw,pitch,Math.PI,true,p,false,false,.1));assert.ok(yaw>0&&yaw<.001);
 const completed=d.step(1,yaw,pitch,Math.PI,true,p,false,false,9.9);({yaw,pitch}=completed);assert.equal(completed.distanceEase,1);
 for(let i=0;i<120;i++)({yaw,pitch}=d.step(1/60,yaw,pitch,Math.PI,false,p));
 assert.ok(Math.abs(angle(yaw,Math.PI))<.001);assert.ok(Math.abs(pitch-p.pitch)<.001);
});

test('follow range uses the same held-and-eased travel window as heading',()=>{
 const r=createFollowRange(),eye={x:0,y:0,z:5.4},focus={x:0,y:0,z:-2};
 assert.equal(r.update(eye,focus,5.4,0,true,4),7.4,'initial movement leaves range correction at the old camera anchor');
 assert.equal(r.update(eye,{x:0,y:0,z:-7},5.4,.5,false,4),8.9,'range catches up along the same easing curve');
 assert.equal(r.update(eye,{x:0,y:0,z:-12},5.4,1,false,4),5.4,'range finishes at the same deadline');
 assert.equal(r.update(eye,{x:0,y:0,z:5.4},5.4,0,true,4),4,'near-character safety retains priority');
});

test('follow composition moves the tracked point from screen centre to three quarters down',()=>{
 for(const aspect of [16/9,1,9/16]){
  const camera=new T.PerspectiveCamera(62,aspect,.15,100),point=new T.Vector3(0,1.1,0);camera.position.set(0,2.4,5.2);
  composeFollowView(camera,point,0);camera.updateMatrixWorld();assert.ok(Math.abs(point.clone().project(camera).y)<1e-10);
  composeFollowView(camera,point,.5);camera.updateMatrixWorld();assert.ok(Math.abs(point.clone().project(camera).y+.5)<1e-10);
 }
});

test('displayed follow range holds its anchor initially and fully returns at the 12 m deadline',t=>{
 const f=cameraFixture(t);f.start();f.pad.axes[1]=-1;let traveled=0,earlyRange=null;
 while(traveled<12){
  const old={...f.nav.state};f.nav.update(1/60);traveled+=Math.hypot(f.nav.state.x-old.x,f.nav.state.y-old.y);
  const focus=new T.Vector3(f.nav.state.x,f.nav.state.z+1.1,-f.nav.state.y);
  if(earlyRange===null&&traveled>=1.9)earlyRange=f.camera.position.distanceTo(focus);
 }
 const focus=new T.Vector3(f.nav.state.x,f.nav.state.z+1.1,-f.nav.state.y);f.camera.updateMatrixWorld();
 assert.ok(earlyRange>=6.9&&earlyRange<=7+1e-9,'initial range lag opens a bounded gap');
 assert.ok(Math.abs(f.camera.position.distanceTo(focus)-policy.profiles.walk.distance)<1e-8);
 assert.ok(Math.abs(focus.project(f.camera).y+.5)<1e-8,'tracked body anchor stays three quarters down the screen');
});

test('lower framing shifts an already off-centre body halfway toward the bottom',()=>{
 const camera=new T.PerspectiveCamera(62,16/9,.15,100),aim=new T.Vector3(0,1.7,0),body=new T.Vector3(0,.7,0);camera.position.set(0,3,6);
 composeFollowView(camera,aim,0,body);camera.updateMatrixWorld();const before=(1-body.clone().project(camera).y)/2;
 composeFollowView(camera,aim,.5,body);camera.updateMatrixWorld();const after=(1-body.clone().project(camera).y)/2;
 assert.ok(Math.abs(after-(before+1)/2)<1e-10);
});

test('tree traversal centres the body while ground traversal keeps its lower composition',t=>{
 const trunk={x:0,y:0,base_z:0,top_z:50,profile:[[0,2],[50,1]]},box={min:[-2,-2,0],max:[2,2,50],kind:'tree',trunk};
 const f=cameraFixture(t,{hitTest:createCollisionIndex([box])});f.start(2.5,0);
 Object.assign(f.nav.state,attachClimb({...f.nav.state,z:8},box,player.walk));
 for(let i=0;i<120;i++)f.nav.update(1/60);
 f.camera.updateMatrixWorld();
 const body=new T.Vector3(f.nav.state.x,f.nav.state.z+1.1,-f.nav.state.y).project(f.camera);
 assert.ok(Math.abs(body.y)<.02,`climbing body NDC y=${body.y}`);
 for(const mode of ['climb','branch','tree-jump'])assert.equal(policy.profiles[mode].screen_lower_fraction,0);
 assert.equal(policy.profiles.walk.screen_lower_fraction,.5);
});

test('running corrects a side view sooner in time than walking, using actual movement speed',t=>{
 const f=cameraFixture(t);const measure=run=>{
  f.pad.axes.fill(0);f.start();f.pad.axes[0]=run?1:.5;
  for(let frame=0;frame<120*1.8;frame++)f.nav.update(1/120);
  return Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2));
 };
 const walk=measure(false),run=measure(true);
 console.log(JSON.stringify({scenario:'speed-adaptive',walkError:walk,runError:run}));
 assert.ok(run<.15,`running still trails by ${run} radians after 1.8 s`);
 assert.ok(walk>run+.4,'walking retains its gentler correction');
});


test('speed changes keep correction monotone and running reversals respect the turn limit',()=>{
 for(const hz of [30,60,144]){
  const d=createFollowCamera();let yaw=0,pitch=.2,previousEase=0;
  for(let frame=0;frame<hz*4;frame++){
   const speed=frame<hz*.7?9:frame<hz*1.3?3.5:9;
   const p=cameraMovementProfile(cameraProfile(policy,'walk',[0,0,0]),speed,player.walk);
   const before=yaw,result=d.step(1/hz,yaw,pitch,Math.PI,true,p,false,false,speed/hz);
   yaw=result.yaw;pitch=result.pitch;
   assert.ok(result.distanceEase>=previousEase-1e-12,'slowing down never rewinds easing');
   assert.ok(Math.abs(angle(yaw,before))<=p.max_turn_rad_s/hz+1e-12,'no fast reversal whip');
   previousEase=result.distanceEase;
  }
  assert.ok(Math.abs(angle(yaw,Math.PI))<.002);
 }
 const p=cameraProfile(policy,'walk',[0,0,0]);
 assert.equal(cameraMovementProfile(p,0,player.walk).follow_distance_m,12);
 assert.equal(cameraMovementProfile(p,3.5,player.walk).follow_distance_m,12);
 assert.equal(cameraMovementProfile(p,9,player.walk).follow_distance_m,7.5);
});

test('range lag remains bounded and tree composition centres an animated body independently of boom lift',()=>{
 const r=createFollowRange();
 assert.equal(r.update({x:0,y:0,z:5.4},{x:0,y:0,z:-10},5.4,.2,true,4.6,7),7);
 for(const aspect of [16/9,1,9/16]){
  const camera=new T.PerspectiveCamera(62,aspect,.15,100),aim=new T.Vector3(0,2,0),body=new T.Vector3(.1,1.05,.1);
  camera.position.set(0,4,7);composeFollowView(camera,aim,0,body,1);camera.updateMatrixWorld();
  const screen=body.clone().project(camera);
  assert.ok(Math.abs(screen.x)<1e-10&&Math.abs(screen.y)<1e-10);
 }
});

test('ground follow spreads acceleration across running starts and reversals',()=>{
 for(const hz of [30,60,144])for(const heading of [Math.PI/2,Math.PI]){
  const d=createFollowCamera();let yaw=0,pitch=-.24,previousVelocity=0,peakAcceleration=0,peakVelocity=0;
  for(let frame=0;frame<hz*3;frame++){
   const speed=Math.min(9,16*frame/hz),p=cameraMovementProfile(cameraProfile(policy,'walk',[0,0,0]),speed,player.walk);
   const next=d.step(1/hz,yaw,pitch,heading,true,p,false,false,speed/hz);
   const velocity=angle(next.yaw,yaw)*hz;
   peakAcceleration=Math.max(peakAcceleration,Math.abs(velocity-previousVelocity)*hz);
   peakVelocity=Math.max(peakVelocity,Math.abs(velocity));
   previousVelocity=velocity;yaw=next.yaw;pitch=next.pitch;
  }
  console.log(JSON.stringify({scenario:'follow-acceleration',hz,heading,peakVelocity,peakAcceleration}));
  assert.ok(peakAcceleration<14,`harsh angular acceleration: ${peakAcceleration} rad/s²`);
  assert.ok(peakVelocity<3.6,`harsh turn speed: ${peakVelocity} rad/s`);
  assert.ok(Math.abs(angle(yaw,heading))<.02,'still settles behind a sustained run');
 }
});

test('automatic direction changes, stops and run-to-walk transitions retain a smooth response',()=>{
 for(const hz of [30,60,144]){
  const d=createFollowCamera();let yaw=0,pitch=-.24,previousVelocity=0,peakAcceleration=0;
  for(let i=0;i<hz*5;i++){
   const time=i/hz,speed=time<.9?9:time<1.3?3.5:time<1.7?0:9;
   const heading=time<.8?Math.PI/2:time<2.4?-Math.PI/2:0;
   const p=cameraMovementProfile(cameraProfile(policy,'walk',[0,0,0]),speed,player.walk);
   const next=d.step(1/hz,yaw,pitch,heading,speed>0,p,false,false,speed/hz);
   const velocity=angle(next.yaw,yaw)*hz;
   peakAcceleration=Math.max(peakAcceleration,Math.abs(velocity-previousVelocity)*hz);
   previousVelocity=velocity;yaw=next.yaw;pitch=next.pitch;
  }
  assert.ok(peakAcceleration<14,`direction/speed change acceleration ${peakAcceleration} at ${hz} Hz`);
  assert.ok(Math.abs(yaw)<.02,'sustained final direction still settles');
 }
});

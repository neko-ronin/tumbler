import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cameraFixture,read,world,player,policy,spacing,viewYaw,angle} from './helpers/camera-fixture.mjs';
import {forestSpacing} from '../../../shared/activities/forest-spacing.js';
import {cameraProfile} from '../../../shared/activities/camera.js';
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
   f.pad.axes.fill(0);f.start(x+7,y+7,direction*Math.PI/4);f.pad.axes[1]=-1;f.pad.buttons[10].pressed=true;
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

test('ground correction completes at 12 metres, independently of speed and refresh rate',()=>{
 const profile=cameraProfile(policy,'walk',[0,0,0],spacing.meanNearestM),budget=profile.follow_distance_m;
 assert.equal(budget,12);
 for(const speed of [1.6,3.5,9])for(const hz of [30,60,144]){
  const director=createFollowCamera();let yaw=0,pitch=-.24,distance=0,atQuarter=null;
  while(distance<budget){
   const step=Math.min(speed/hz,budget-distance);distance+=step;
   ({yaw,pitch}=director.step(step/speed,yaw,pitch,Math.PI,true,profile,false,false,step));
   if(atQuarter===null&&distance>=budget*.25)atQuarter=yaw;
  }
  assert.ok(Math.abs(angle(yaw,Math.PI))<1e-9,`${speed} m/s, ${hz} Hz: not corrected by ${budget} m`);
  assert.ok(atQuarter<.15,'the first quarter of the distance still exposes his face');
 }
});

test('the displayed ground camera also finishes within the distance budget, with no trailing time smoother',t=>{
 const f=cameraFixture(t);f.start();f.pad.axes[1]=1;
 let distance=0;
 while(distance<12){
  const old={...f.nav.state};f.nav.update(1/60);distance+=Math.hypot(f.nav.state.x-old.x,f.nav.state.y-old.y);
 }
 assert.ok(Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2))<1e-8);
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
  f.pad.axes.fill(0);f.start(1723.3673,927.1585,turn*Math.PI/4,0);f.pad.axes[1]=-1;f.pad.buttons[10].pressed=true;
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
 assert.ok(Math.abs(angle(yaw,Math.PI))<1e-9);
});

test('running during the introduction still completes displayed follow by the distance deadline',t=>{
 const f=cameraFixture(t);f.start(0,0,Math.PI/2,0);f.pad.axes[1]=1;f.pad.buttons[10].pressed=true;
 let distance=0;
 while(distance<12){const old={...f.nav.state};f.nav.update(1/60);distance+=Math.hypot(f.nav.state.x-old.x,f.nav.state.y-old.y);}
 assert.ok(Math.abs(angle(viewYaw(f.camera),f.nav.state.heading-Math.PI/2))<1e-8);
});

test('heading and pitch stay fixed through the first 2 m, then ease to full correction at 12 m',()=>{
 const p=cameraProfile(policy,'walk',[0,0,0]),d=createFollowCamera();let yaw=0,pitch=.3;
 for(let i=0;i<20;i++)({yaw,pitch}=d.step(.1,yaw,pitch,Math.PI,true,p,false,false,.1));
 assert.ok(Math.abs(yaw)<1e-12);assert.ok(Math.abs(pitch-.3)<1e-12);
 ({yaw,pitch}=d.step(.1,yaw,pitch,Math.PI,true,p,false,false,.1));assert.ok(yaw>0&&yaw<.001);
 ({yaw,pitch}=d.step(1,yaw,pitch,Math.PI,true,p,false,false,9.9));assert.ok(Math.abs(angle(yaw,Math.PI))<1e-9);assert.ok(Math.abs(pitch-p.pitch)<1e-12);
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
 assert.ok(earlyRange>7,'range correction waits while the first two metres open a gap');
 assert.ok(Math.abs(f.camera.position.distanceTo(focus)-policy.profiles.walk.distance)<1e-8);
 assert.ok(Math.abs(focus.project(f.camera).y+.5)<1e-8,'tracked body anchor stays three quarters down the screen');
});

test('lower framing shifts an already off-centre body halfway toward the bottom',()=>{
 const camera=new T.PerspectiveCamera(62,16/9,.15,100),aim=new T.Vector3(0,1.7,0),body=new T.Vector3(0,.7,0);camera.position.set(0,3,6);
 composeFollowView(camera,aim,0,body);camera.updateMatrixWorld();const before=(1-body.clone().project(camera).y)/2;
 composeFollowView(camera,aim,.5,body);camera.updateMatrixWorld();const after=(1-body.clone().project(camera).y)/2;
 assert.ok(Math.abs(after-(before+1)/2)<1e-10);
});

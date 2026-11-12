import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createResolutionGovernor,createQualityGate} from '../src3d/flight-quality.js';
import {introShotEase} from '../src3d/navigation.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';
import {cameraFixture,read,world,player} from './helpers/camera-fixture.mjs';

const event=(type,props)=>Object.assign(new Event(type),props);
const uint8=bytes=>new Float32Array(Uint8Array.from(bytes).buffer);
// The same village start the opening pan uses, sampled from the core's data.
function villageGround(){
 const manifest=read('client/web/data/viewer.json'),geology=read(world.mountains.geology);
 const grid=key=>{const d=manifest.height_grids[key];return new HeightGrid({...d,values:applyGeologyTerrain(uint8(readFileSync(new URL('../../../'+d.file,import.meta.url))),d,geology.terrain[key])});};
 const river=createRiverGranite(read('shared/world/out/river_granite.json'));
 const ground=new GroundSampler(grid('block'),grid('far_field'),river.height,createGeologySampler(geology));
 return {height:(x,y)=>ground.height(x,y),walkHeight:createWalkHeight(world,(x,y)=>ground.height(x,y))};
}
const SHOT_FRAMES=90;                       // SHOT_S = 3.0 s at the 1/30 s render cadence
const overloaded=()=>Array.from({length:240},()=>33.3);   // 33.3 ms p95 > 1.35 x the 16.7 ms budget

test('the opening shot holds the render scale and restarts the sample window afterwards',()=>{
 const governor=createResolutionGovernor(),gate=createQualityGate(governor);
 const samples=overloaded();
 gate.reset(0);
 // A shot start may not resize, however bad the frames inside it look.
 for(let time=0;time<2400;time+=100){
  assert.equal(gate.decide(time,samples,true,true),null,`decision during the shot at ${time} ms`);
  assert.equal(governor.scale,1);
  samples.push(33.3);
 }
 // The first frame after it has nothing to decide: the shot's frames are gone.
 assert.equal(gate.decide(2500,samples,true,false),null);
 assert.equal(samples.length,0,'post-shot window starts empty');
 assert.equal(governor.scale,1,'no mid-move resize, and no delayed one either');
 // A clean, overloaded window does reach the governor once it has filled.
 samples.push(...overloaded());
 assert.equal(gate.decide(5600,samples,true,false),.9,'play resumes adapting after the shot');
});

test('a hold never changes the current scale and drops an open trial',()=>{
 const governor=createResolutionGovernor();
 assert.equal(governor.sample(55,3000),.9,'an overloaded window starts a trial');
 assert.equal(governor.sample(33,7000),.9,'improved frames keep the trial scale');
 assert.equal(governor.sample(40,12000),.8,'a second trial lowers it again');
 assert.equal(governor.hold(13000),.8,'the hold keeps the picture it had');
 // A clean window after release recovers one step. If the dropped trial had
 // survived, its old p95 would have kept the scale instead.
 assert.ok(Math.abs(governor.sample(16.6,20000)-.85)<1e-9,'the trial did not outlive the shot');
});

test('a cancelled shot releases the hold immediately, with no leak into play',()=>{
 const governor=createResolutionGovernor(),gate=createQualityGate(governor);
 let samples=overloaded();
 for(let time=0;time<600;time+=100)assert.equal(gate.decide(time,samples,true,true),null);
 // A drag, a view toggle or a mode change clears the shot; the gate sees it end
 // exactly as it would a completed shot and restarts the window from that frame.
 assert.equal(gate.decide(700,samples,true,false),null);
 assert.equal(samples.length,0);
 samples.push(...overloaded());
 assert.equal(gate.decide(4000,samples,true,false),.9,'adaptation is released, not stuck off');
});

test('the shot is live for its authored duration and every interrupt releases it',t=>{
 const f=cameraFixture(t);
 const restart=()=>{f.nav.select('orbit');f.camera.position.set(30,20,40);f.camera.lookAt(60,0,0);f.nav.select('walk');f.pad.axes.fill(0);f.pad.buttons.forEach(b=>b.pressed=false);};
 restart();
 assert.equal(f.nav.shotActive,true,'looking around to walking starts the shot');
 for(let i=0;i<SHOT_FRAMES-1;i++)f.nav.update(1/30);
 assert.equal(f.nav.shotActive,true,'still travelling one frame before 3.0 s');
 // Float accumulation means 1/30 s does not always land exactly on 3.0 s.
 let frames=SHOT_FRAMES-1;
 while(f.nav.shotActive&&frames<SHOT_FRAMES+2){f.nav.update(1/30);frames++;}
 assert.equal(f.nav.shotActive,false,'the shot is complete by 3.1 s');
 assert.ok(frames<=SHOT_FRAMES+1,`the shot ran ${frames} frames, not ${SHOT_FRAMES}`);
 assert.equal(f.nav.mode,'walk');

 restart();
 f.canvas.dispatchEvent(event('pointerdown',{clientX:0,clientY:0,pointerId:1}));
 f.canvas.dispatchEvent(event('pointermove',{movementX:120,movementY:30}));
 assert.equal(f.nav.shotActive,false,'a drag takes the camera from the shot');

 restart();f.win.dispatchEvent(event('keydown',{code:'ArrowRight',repeat:false}));f.nav.update(1/30);
 assert.equal(f.nav.shotActive,false,'the stick or arrow look takes it too');

 restart();f.win.dispatchEvent(event('keydown',{code:'KeyV',repeat:false}));
 assert.equal(f.nav.shotActive,false,'V changes the view, so the shot ends');

 restart();f.nav.select('paraglider');
 assert.equal(f.nav.shotActive,false,'choosing another activity ends the shot');

 restart();f.nav.cancelShot();
 assert.equal(f.nav.shotActive,false,'a context loss cancels it explicitly');

 restart();f.pad.axes[1]=-1;f.nav.update(1/30);
 assert.equal(f.nav.shotActive,true,'walking during the introduction does not fight the camera');
});

test('the shot ends on the chase camera the walk itself would hold, at the new duration',t=>{
 const f=cameraFixture(t);f.camera.position.set(30,20,40);f.camera.lookAt(60,0,0);f.nav.select('walk');
 let frames=0;do{f.nav.update(1/30);frames++;}while(f.nav.shotActive&&frames<200);
 assert.equal(f.nav.shotActive,false);
 assert.ok(frames>=SHOT_FRAMES&&frames<=SHOT_FRAMES+2,`the shot ran ${frames} frames`);
 const arrived=f.camera.position.clone(),arrivedQ=f.camera.quaternion.clone();
 // The arrival is the follow camera's own pose, not a residue of the blend: the
 // shot must not be the thing that decides where it stops.
 for(let i=0;i<600;i++)f.nav.update(1/30);
 assert.ok(arrived.distanceTo(f.camera.position)<.005,`arrival drifted ${arrived.distanceTo(f.camera.position).toFixed(4)} m after the shot`);
 assert.ok(arrivedQ.angleTo(f.camera.quaternion)<1e-3,'arrival orientation is already the settled chase view');
 f.camera.updateMatrixWorld();
 const body=new T.Vector3(f.nav.state.x,f.nav.state.z+1.1*player.scale,-f.nav.state.y).project(f.camera);
 assert.ok(Math.abs(body.x)<.01&&Math.abs(body.y+.5)<.02,`subject framed at ${body.x.toFixed(3)}, ${body.y.toFixed(3)}`);
});

test('the shot easing reaches both ends at rest and never reverses',()=>{
 // Sampled the same way follow() advances it, so a slow first or last frame and
 // a mid-shot reversal both show up here.
 const steps=Array.from({length:SHOT_FRAMES},(_,i)=>introShotEase((i+1)/SHOT_FRAMES)-introShotEase(i/SHOT_FRAMES));
 assert.ok(Math.max(...steps)<.1*steps.reduce((a,b)=>a+b,0),'no single frame carries the move');
 assert.ok(steps[0]<steps[8]&&steps.at(-1)<steps.at(-9),'both ends move slower than the middle');
 for(let i=1;i<steps.length;i++)assert.ok(steps[i]>=0,'progress never reverses');
 assert.equal(introShotEase(0),0);assert.equal(introShotEase(1),1);
});

test('the opening pan still arrives at the pose recorded before the timing change',t=>{
 // Recorded from this worktree's village start with the pre-change shot (2.5 s,
 // symmetric smootherstep). Duration and easing may change; the arrival may not, beyond
 // the millimetres the ground under the village moved when the mountains were grown.
 const {height,walkHeight}=villageGround(),f=cameraFixture(t,{height,walkHeight});
 f.nav.select('orbit');f.camera.position.set(-672,73.8391,-442);f.camera.lookAt(-696,89.8391,-472);f.camera.updateMatrixWorld();
 f.nav.select('walk');
 let frames=0;while(f.nav.shotActive&&frames<200){f.nav.update(1/30);frames++;}
 assert.ok(frames>=SHOT_FRAMES&&frames<=SHOT_FRAMES+2,`the shot ran ${frames} frames`);
 const pos=[-668.7233338790853,56.529278901792225,-437.9041673488567];
 const q=[0.024461544171433813,0.33089570530035856,-0.008580646377993287,0.9433112092932338];
 f.camera.position.toArray().forEach((v,i)=>assert.ok(Math.abs(v-pos[i])<.01,`arrival x${i}: ${v} vs ${pos[i]}`));
 f.camera.quaternion.toArray().forEach((v,i)=>assert.ok(Math.abs(v-q[i])<1e-3,`arrival q${i}: ${v} vs ${q[i]}`));
});

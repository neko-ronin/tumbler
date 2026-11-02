import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createNavigation} from '../src3d/navigation.js';
import {createFollowCamera,clearCameraTerrain,clearTerrainBoom,cameraTerrainRadius} from '../src3d/follow-camera.js';
import {createPlayerVisibility} from '../src3d/player-visibility.js';
import {createTreeSurface,treePlayFocus} from '../src3d/tree-surface.js';
import {spacing} from './helpers/camera-fixture.mjs';
import {cameraProfile} from '../../../shared/activities/camera.js';
const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const flight=read('../../../shared/activities/flight.json');
// The original reduced model's perfectly steady glide remains a compatibility
// regression. Coupled anchor/camera behavior is exercised in its own tests.
const rules={...flight,coupled:undefined,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const world=read('../../../shared/world/worldmap.json'),ride=read('../../../shared/activities/ride.json'),characterConfig=read('../../../shared/characters/player.json');
const flat=()=>0;

function fixture(t,config=rules){
 const previous=new Map(['window','document','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
 const win=new EventTarget(),doc=new EventTarget();
 const pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 for(const [key,value] of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[pad]}}))Object.defineProperty(globalThis,key,{value,configurable:true});
 const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const camera=new T.PerspectiveCamera(62,16/9),rig=new T.Group(),character={object:new T.Group(),update(){}};
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),update(){},setTarget(){}},{height:flat},config,world,rig,()=>null,{config:ride,rig:new T.Group(),meshes:{}},character,characterConfig,{cameraPolicy:policy,forestSpacingM:spacing.meanNearestM});
 t.after(()=>{nav.dispose();for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {nav,camera,rig,pad,win,canvas,character};
}


const policy=read('../../../shared/activities/camera.json');
const profile=policy.profiles.walk;
const event=(type,props)=>Object.assign(new Event(type),props);

test('manual look holds its angle until delay, then follows by shortest arc at every refresh rate',()=>{
 for(const hz of [30,60,144]){
  const d=createFollowCamera();d.manual();let yaw=3.1,pitch=.6;
  for(let i=0;i<hz*1.5;i++)({yaw,pitch}=d.step(1/hz,yaw,pitch,-3.1,true,profile,false,false,3.5/hz));
  assert.equal(yaw,3.1);assert.equal(pitch,.6);
  for(let i=0;i<hz*10;i++)({yaw,pitch}=d.step(1/hz,yaw,pitch,-3.1,true,profile,false,false,3.5/hz));
  assert.ok(Math.abs(yaw-(Math.PI*2-3.1))<.002);assert.ok(Math.abs(pitch-profile.pitch)<.02);
 }
});
test('idle, dragging and gondola never recenter a deliberate view',()=>{
 const d=createFollowCamera();
 for(const [moving,p,held] of [[false,profile,false],[true,profile,true],[true,policy.profiles.gondola,false]]){
  assert.deepEqual(d.step(10,1,.2,0,moving,p,held),{yaw:1,pitch:.2});
 }
});
test('final terrain constraint covers footprint and boom crossing a ridge',()=>{
 const p=new T.Vector3(0,-10,0);clearCameraTerrain(p,x=>x>.3?8:0);assert.equal(p.y,8.45);
 const eye=new T.Vector3(0,3,10),target=new T.Vector3(0,2,0);
 clearTerrainBoom(eye,target,(x,y)=>y< -4&&y> -6?10:0);
 assert.equal(eye.z,10,'clearing a ridge must retain chase distance');
 for(let i=1;i<=50;i++){const t=i/50,h=t>.4&&t<.6?10:0;assert.ok(target.y+(eye.y-target.y)*t>=h+.45);}
});
test('camera areas feather by height and location, restrict activity, and apply in authored order',()=>{
 const area={id:'test',min:[0,0,0],max:[10,10,10],feather_m:2,activities:['walk'],settings:{distance:9.4}};
 const data={...policy,areas:[area]};
 assert.equal(cameraProfile(data,'walk',[5,5,5]).distance,9.4);
 assert.equal(cameraProfile(data,'walk',[1,5,5]).distance,7.4);
 assert.equal(cameraProfile(data,'walk',[0,5,5]).distance,5.4);
 assert.equal(cameraProfile(data,'walk',[5,5,11]).distance,5.4);
 assert.equal(cameraProfile(data,'climb',[5,5,5]).distance,6.9);
 assert.throws(()=>cameraProfile({...data,version:2},'walk',[0,0,0]));
});
test('right stick and arrow look delay movement follow, left stick resumes it without curving a held run',t=>{
 const {nav,camera,pad,win}=fixture(t);nav.select('walk');
 // Finish the introduction before examining chase dynamics.
 for(let i=0;i<200;i++)nav.update(1/60);
 pad.axes[0]=1;
 for(let i=0;i<60;i++)nav.update(1/60);
 const direction=nav.state.heading;
 const yaw=()=>{const f=camera.getWorldDirection(new T.Vector3());return Math.atan2(-f.x,-f.z);};
 const before=yaw();pad.axes[2]=1;nav.update(.05);pad.axes[2]=0;
 for(let i=0;i<50;i++)nav.update(1/60);
 const manual=yaw();assert.ok(Math.abs(manual-before)>.02);
 for(let i=0;i<600;i++)nav.update(1/60);
 assert.ok(Math.abs(Math.atan2(Math.sin(nav.state.heading-direction+.08),Math.cos(nav.state.heading-direction+.08)))<.01,'only manual rotation changes the held movement basis');
 assert.ok(Math.abs(Math.atan2(Math.sin(yaw()-(nav.state.heading-Math.PI/2)),Math.cos(yaw()-(nav.state.heading-Math.PI/2))))<.04);
 // Native keyboard event target is the window (with no tagName).
 win.dispatchEvent(event('keydown',{code:'ArrowLeft',repeat:false}));nav.update(.05);win.dispatchEvent(event('keyup',{code:'ArrowLeft'}));
 for(let i=0;i<30;i++)nav.update(1/60);const look=yaw();for(let i=0;i<30;i++)nav.update(1/60);
 assert.ok(Math.abs(yaw()-look)<.025,'released arrow look remains held through the quiet delay');
});
test('whole scenery parts hide for an obstructed player, restore outside chase, and do not mutate tree leaf code',()=>{
 const camera=new T.PerspectiveCamera(62,1,.15,100);camera.position.set(0,2,6);camera.lookAt(0,1,0);
 const mesh=new T.InstancedMesh(new T.BoxGeometry(2,4,1),new T.MeshBasicMaterial(),1);mesh.setMatrixAt(0,new T.Matrix4().makeTranslation(0,2,3));
 const group=new T.Group();group.add(mesh);
 const visibility=createPlayerVisibility(camera,{getDrawingBufferSize:p=>p.set(100,100)},[group],[group]);
 visibility.update(new T.Vector3(0,1,0),true);assert.equal(mesh.geometry.attributes.sightHidden.getX(0),1);
 visibility.update(new T.Vector3(0,1,0),false);assert.equal(mesh.geometry.attributes.sightHidden.getX(0),0);
 const shader={uniforms:{},vertexShader:'void main() {\n}',fragmentShader:'#include <clipping_planes_fragment>\nvoid main() {}'};
 mesh.material.onBeforeCompile(shader);assert.match(shader.vertexShader,/vSightHidden=sightHidden/);assert.match(shader.fragmentShader,/if\(vSightHidden>.5\)discard/);
});

test('mouse drag and trackpad scroll override following; cancel and blur retire input',t=>{
 const {nav,camera,canvas,win}=fixture(t);nav.select('walk');for(let i=0;i<180;i++)nav.update(1/60);
 const direction=()=>camera.getWorldDirection(new T.Vector3());
 const before=direction();canvas.dispatchEvent(event('pointerdown',{clientX:0,clientY:0,pointerId:1}));
 canvas.dispatchEvent(event('pointermove',{movementX:120,movementY:30}));
 canvas.dispatchEvent(event('pointerup',{clientX:120,clientY:30,button:0}));
 for(let i=0;i<60;i++)nav.update(1/60);assert.ok(before.angleTo(direction())>.2);
 const drag=direction();canvas.dispatchEvent(event('wheel',{deltaX:100,deltaY:-40,deltaMode:0,ctrlKey:false}));
 for(let i=0;i<60;i++)nav.update(1/60);assert.ok(drag.angleTo(direction())>.2);
 win.dispatchEvent(new Event('blur'));assert.doesNotThrow(()=>nav.update(1/60));
});
test('navigation corrects an interpolated camera below the terrain',t=>{
 const {nav,camera}=fixture(t);nav.select('walk');for(let i=0;i<180;i++)nav.update(1/60);
 camera.position.y=-20;nav.update(1/60);assert.ok(camera.position.y>=.45);
});

test('terrain footprint grows to enclose an ultrawide near plane',()=>{
 assert.equal(cameraTerrainRadius({near:.15,fov:62,aspect:16/9}),.45);
 assert.ok(cameraTerrainRadius({near:.5,fov:80,aspect:5})>2);
});

test('climbing foliage retains its separate spotlight with a soft falloff and bypasses general scenery clearing',()=>{
 const camera=new T.PerspectiveCamera(),material=createTreeSurface({leafProfile:'redwood',toonBands:4,rimStrength:0,canopyShade:.85,transmission:0,leafThickness:.4},{sun:{value:new T.Vector3(1,1,1)}});
 const mesh=new T.Mesh(new T.BoxGeometry(),material),group=new T.Group();group.add(mesh);
 const visibility=createPlayerVisibility(camera,{getDrawingBufferSize:p=>p.set(100,100)},[group]);
 visibility.update(new T.Vector3(0,1,0),true,1,true);
 const shader={uniforms:{},vertexShader:'void main() {\n#include <begin_vertex>\n}',fragmentShader:'void main() {\n#include <clipping_planes_fragment>\n#include <alphatest_fragment>\n#include <opaque_fragment>\n}'};
 material.onBeforeCompile(shader);
 assert.equal(shader.uniforms.uTreePlayFocus,treePlayFocus);
 assert.match(shader.fragmentShader,/uSightEnabled>.5&&\!\(uSightTreePlay>.5&&vTreeLeaf>.5\)/);
 assert.match(shader.fragmentShader,/visibilityOpening\(nearView,1.1,.65\)/);
 assert.match(shader.fragmentShader,/visibilityOpening\(distance\(vTreeWorld,uTreePlayFocus.xyz\),uTreePlayFocus.w,.65\)/);
 assert.equal(shader.uniforms.uVisibilityFeather.value,1);
 assert.equal(shader.uniforms.uSightTreePlay.value,1);
});

test('a legacy policy and a zero-time update keep the camera finite',()=>{
 const d=createFollowCamera(),p={follow_rate:1.1,pitch:-.24,return_delay_s:0};
 assert.deepEqual(d.step(0,0,0,1,true,p),{yaw:0,pitch:0});
 assert.deepEqual(d.step(.01,0,0,1,true,{...p,follow_hold_s:1}),{yaw:0,pitch:0});
});

test('new commitment settings feather onto an older version-one profile without missing numeric bases',()=>{
 const data={version:1,profiles:{walk:{distance:5.4,lift:0,pitch:-.24,follow_rate:1.1,return_delay_s:1.8}},areas:[{min:[0,0,0],max:[10,10,10],feather_m:2,settings:{follow_hold_s:1,follow_ramp_s:2,max_turn_rad_s:.5}}]};
 const selected=cameraProfile(data,'walk',[1,5,5]);assert.equal(selected.follow_hold_s,.5);assert.equal(selected.follow_ramp_s,1);assert.equal(selected.max_turn_rad_s,2);
});

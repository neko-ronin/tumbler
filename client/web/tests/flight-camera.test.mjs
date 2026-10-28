import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createNavigation} from '../src3d/navigation.js';
import {launchFlight,stepFlight,canopySegment} from '../../../shared/activities/flight.js';

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
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),update(){},setTarget(){}},{height:flat},config,world,rig,()=>null,{config:ride,rig:new T.Group(),meshes:{}},character,characterConfig);
 t.after(()=>{nav.dispose();for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return {nav,camera,rig,pad,win};
}

test('rendered rigid canopy frame agrees with collision across heading, bank and pitch',t=>{
 const {nav,rig}=fixture(t);
 for(const mode of Object.keys(rules.modes)){
  nav.select(mode,0);
  const m=rules.modes[mode];
  for(const heading of [0,.7,Math.PI,-2])for(const bank of [-1.1,0,1.1])for(const pitch of [-.65,0,.65]){
   Object.assign(nav.state,{heading,bank,pitch});nav.update(0);rig.updateMatrixWorld(true);
   const capsule=canopySegment(nav.state,rules);
   for(const [x,expected] of [[m.span_m/2,capsule.a],[-m.span_m/2,capsule.b]]){
    const actual=rig.localToWorld(new T.Vector3(x,m.canopy_height_m,0));
    assert.ok(actual.distanceTo(new T.Vector3(expected[0],expected[2],-expected[1]))<1e-9,`${mode}: tip at heading ${heading}, bank ${bank}, pitch ${pitch}`);
   }
  }
 }
});

test('steady flight keeps the chase aim still between physics ticks at different refresh rates',t=>{
 const {nav,camera,rig}=fixture(t);
 for(const hz of [60,90,120,144]){
  nav.select('paraglider',0);
  for(let i=0;i<hz*5;i++)nav.update(1/hz);
  let lastPose=rig.position.clone(),lastView=camera.quaternion.clone();
  const speeds=[],angles=[];
  for(let i=0;i<hz*2;i++){
   nav.update(1/hz);
   speeds.push(rig.position.distanceTo(lastPose)*hz);
   angles.push(camera.quaternion.angleTo(lastView)*180/Math.PI);
   lastPose.copy(rig.position);lastView.copy(camera.quaternion);
  }
  assert.ok(Math.max(...speeds)-Math.min(...speeds)<.001,`${hz} Hz: the rendered glider must move every frame at a steady speed`);
  assert.ok(Math.max(...angles)<.001,`${hz} Hz: a steady glide must not shake the chase camera`);
 }
});

test('render interpolation leaves the authoritative fixed-step flight state intact',t=>{
 const {nav}=fixture(t);nav.select('paraglider',0);
 let expected=launchFlight(rules,'paraglider',rules.launches[0],flat),accumulator=0,time=0;
 for(let frame=0;frame<200;frame++){
  const dt=frame%2?1/144:1/90;accumulator+=dt;
  while(accumulator>=1/120){expected=stepFlight(expected,{},1/120,time,rules,world.wind.direction_deg,flat,()=>null);accumulator-=1/120;time+=1/120;}
  nav.update(dt);
  assert.deepEqual(nav.state,expected,'presentation must not feed interpolated values into simulation or instruments');
 }
});

test('retry, site changes and focus reset discard old flight poses',t=>{
 const {nav,rig,win}=fixture(t);
 const assertAtState=()=>assert.ok(rig.position.distanceTo(new T.Vector3(nav.state.x,nav.state.z-rules.landing_clearance_m,-nav.state.y))<1e-9);
 nav.select('paraglider',0);for(let i=0;i<150;i++)nav.update(1/90);
 nav.select('paraglider',1);assertAtState();
 nav.update(1/144);win.dispatchEvent(new Event('blur'));nav.update(0);assertAtState();
 nav.select('paraglider',0);assertAtState();
});

test('landing displays the settled pose immediately',t=>{
 const low={...rules,launches:[{...rules.launches[0],clearance_m:2}]};
 const landing=fixture(t,low);landing.nav.select('paraglider',0);
 for(let i=0;i<1000&&!landing.nav.state.grounded;i++)landing.nav.update(1/144);
 assert.equal(landing.nav.state.grounded,true);
 assert.equal(landing.rig.position.y,landing.nav.state.z-low.landing_clearance_m,'ground contact must display the settled pose immediately');
});

test('first-person camera and glider use the same continuous flight position',t=>{
 const {nav,camera,rig,pad}=fixture(t);nav.select('paraglider',0);
 pad.buttons[3].pressed=true;nav.update(1/90);pad.buttons[3].pressed=false;
 assert.equal(nav.view,'first');
 for(let i=0;i<144;i++){
  nav.update(1/144);
  assert.ok(Math.abs(camera.position.x-rig.position.x)<1e-9);
  assert.ok(Math.abs(camera.position.z-rig.position.z)<1e-9);
  assert.ok(Math.abs(camera.position.y-rig.position.y-rules.landing_clearance_m-.15)<1e-9);
 }
});

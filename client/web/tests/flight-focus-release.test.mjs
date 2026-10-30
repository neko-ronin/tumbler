import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {createNavigation} from '../src3d/navigation.js';
import {stepFlight} from '../../../shared/activities/flight.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const player=read('../../../shared/characters/player.json'),flight=read('../../../shared/activities/flight.json');
const ride=read('../../../shared/activities/ride.json'),world=read('../../../shared/world/worldmap.json');
const rules={...flight,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};

for(const tagName of ['INPUT','SELECT','TEXTAREA'])test(`flight keys released over ${tagName} return to neutral`,()=>{
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v] of Object.entries({window:new EventTarget(),document:new EventTarget(),navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const cat=createCharacter(parseGLB(readFileSync(new URL('../../../shared/geometry/'+player.asset,import.meta.url))),player);
 const nav=createNavigation(new T.PerspectiveCamera(),canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},rules,world,new T.Group(),()=>null,
  {config:ride,rig:new T.Group(),meshes:{}},cat,player);
 const key=(type,code,target)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:target}});window.dispatchEvent(e);};
 try{
  nav.select('paramotor');Object.assign(nav.state,{x:0,y:0,z:1000});
  for(const code of ['KeyD','KeyS','KeyR'])key('keydown',code,canvas);
  for(let i=0;i<60;i++)nav.update(1/120);
  assert.ok(nav.state.bank>0&&nav.state.brakeLeft>0&&nav.state.throttle>0,'controls actually engaged');
  for(const code of ['KeyD','KeyS','KeyR'])key('keyup',code,{tagName});
  const expected=stepFlight(nav.state,{},1/120,.5,rules,world.wind.direction_deg,()=>0,()=>null);
  nav.update(1/120);
  for(const field of ['bank','brakeLeft','brakeRight','throttle'])assert.equal(nav.state[field],expected[field],`${field} must follow released controls`);
  const before=structuredClone(nav.state);
  key('keydown','KeyR',{tagName});nav.update(1/120);
  assert.equal(nav.state.throttle,before.throttle,'typing in a form cannot start a flight control');
 }finally{nav.dispose();cat.dispose();for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
});

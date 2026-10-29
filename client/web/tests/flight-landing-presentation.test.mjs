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

for(const hz of [60,120,144])for(const [velocity,quality] of [[-1,'smooth'],[-6,'hard']])test(`${quality} flight touchdown at ${hz}Hz selects its visual without changing the measured landing`,()=>{
  const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  for(const [key,value] of Object.entries({window:new EventTarget(),document:new EventTarget(),navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,key,{value,configurable:true});
  const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
  const cat=createCharacter(parseGLB(readFileSync(new URL('../../../shared/geometry/'+player.asset,import.meta.url))),player);
  const nav=createNavigation(new T.PerspectiveCamera(),canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},rules,world,new T.Group(),()=>null,
    {config:ride,rig:new T.Group(),meshes:{}},cat,player);
  try{
    nav.select('paraglider');Object.assign(nav.state,{x:0,y:0,z:rules.landing_clearance_m+.001,vertical:velocity,vario:velocity});
    window.dispatchEvent(new Event('blur'));
    const expected=stepFlight(nav.state,{},1/120,0,rules,world.wind.direction_deg,()=>0,()=>null);
    nav.update(1/120);assert.deepEqual(nav.state,expected,'clip selection cannot alter the shared touchdown');
    assert.equal(nav.state.grounded,true);assert.equal(nav.state.landingQuality,quality);
    for(const key of ['vx','vy','vz'])assert.equal(nav.state[key],0,'stopped telemetry is separate from the retained measured touchdown');
    assert.equal(cat.clip,quality==='hard'?player.landing.heavy:player.clips.idle);
    const landing={speed:nav.state.landingSpeed,ground:nav.state.landingGroundSpeed};
    let actionTime=cat.actions[player.landing.heavy].time;
    for(let i=0;i<hz;i++){
      nav.update(1/hz);const nextTime=cat.actions[player.landing.heavy].time;
      if(quality==='hard')assert.ok(nextTime>=actionTime-1e-10,'the impact must not restart during its fade to idle');
      actionTime=nextTime;
    }
    assert.equal(cat.clip,player.clips.idle,'the one landing response returns to idle');
    assert.equal(nav.state.landingSpeed,landing.speed);assert.equal(nav.state.landingGroundSpeed,landing.ground);
  }finally{nav.dispose();cat.dispose();for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
});

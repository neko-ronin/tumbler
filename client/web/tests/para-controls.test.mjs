import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';

const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const flat=()=>0,site={xy_m:[0,0],heading_deg:0};
const start=mode=>({...launchFlight(still,mode,site,flat),z:1200,engine:0,throttle:0});
function run(s,input,seconds=2,dt=1/120){
 for(let i=0;i<Math.round(seconds/dt);i++)s=stepFlight(s,input,dt,i*dt,still,270,flat);
 return s;
}

test('assisted turns pull the inside brake on conventional wings and release the outside on parakites',()=>{
 for(const mode of Object.keys(config.modes))for(const turn of [-1,1]){
  const s=run(start(mode),{turn});
  const inside=turn>0?'Right':'Left',outside=turn>0?'Left':'Right';
  assert.equal(Math.sign(s.bank),turn);
  assert.equal(Math.sign(s.heading),-turn);
  if(mode==='parakite'){
   assert.ok(s['handle'+outside]<.1,'raise outside handle');
   assert.equal(s['handle'+inside],.45,'keep inside handle at best glide');
   assert.equal(s.brakeLeft+s.brakeRight,0,'no hidden inside braking');
  }else{
   assert.ok(s['brake'+inside]>.3,'visible inside brake');
   assert.equal(s['brake'+outside],0,'outside remains free');
   assert.ok(s.speed/Math.sqrt(s.load)<config.modes[mode].trim_mps,'steering brake reduces speed relative to the loaded trim');
  }
 }
});

test('parakite handle travel is progressive and both dynamics and cloth receive the same travel',()=>{
 const s=start('parakite'),one=run(s,{brake:1},1/120);
 assert.ok(one.handleLeft>.45&&one.handleLeft<.5,'pull does not jump instantly to the end stop');
 assert.equal(one.handleLeft,one.handleRight);
 assert.ok(Math.abs(one.brakeLeft-(one.handleLeft-.45)/.55)<1e-12);
 const deep=run(s,{brake:1}),release=run(deep,{brake:-1},1/120);
 assert.ok(release.handleLeft>0&&release.handleLeft<deep.handleLeft,'release is progressive too');
 const at30=run(s,{brake:.6},1,1/30),at120=run(s,{brake:.6},1);
 assert.ok(Math.abs(at30.handleLeft-at120.handleLeft)<1e-12,'travel does not depend on refresh rate');
});

test('full-release parakite rolls by weight shift without inventing extra inside pull',()=>{
 const fast=run(start('parakite'),{brake:-1},4),turn=run(fast,{brake:-1,turn:1},2);
 assert.ok(turn.handleLeft<1e-8&&turn.handleRight<1e-8);
 assert.ok(turn.bank>.3);
 assert.equal(turn.brakeLeft+turn.brakeRight,0);
});

test('opposed independent pulls cancel the assisted turn and left/right flight remains symmetric',()=>{
 for(const mode of Object.keys(config.modes)){
  const left=run(start(mode),{brakeLeft:.7}),right=run(start(mode),{brakeRight:.7});
  assert.ok(Math.abs(left.bank+right.bank)<1e-12,mode);
  assert.ok(Math.abs(left.heading+right.heading)<1e-12,mode);
  assert.ok(Math.abs(left.z-right.z)<1e-9,mode);
  assert.ok(Math.abs(run(start(mode),{brakeLeft:.7,brakeRight:.7}).bank)<1e-12,mode);
 }
});

const assets=Object.fromEntries([config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset].map(p=>[p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));
// Compare real sail vertices at the same clock so ripple cannot mask which
// anatomical side moved. With +Z forward, positive model X is pilot-left.
function difference(mode,extra,region){
 const a=createFlightRig(assets,config),b=createFlightRig(assets,config),state=start(mode);
 try{
  a.update(.1,state);b.update(.1,{...state,...extra});
  const name=mode==='parakite'?'parakite':'paraglider',rest=a.wings[name].rest;
  const p=a.wings[name].mesh.geometry.attributes.position,q=b.wings[name].mesh.geometry.attributes.position;
  let sum=0,count=0;
  for(let i=0;i<p.count;i++)if(region(rest[i*3],rest[i*3+1],rest[i*3+2])){sum+=q.getY(i)-p.getY(i);count++;}
  assert.ok(count>0,'sample real canopy vertices');return sum/count;
 }finally{a.dispose();b.dispose();}
}

test('independent brake pulls depress the correct anatomical trailing edge in every wing',()=>{
 for(const mode of Object.keys(config.modes))for(const side of ['Left','Right']){
  const sign=side==='Left'?1:-1,extra={['brake'+side]:1};
  const inside=difference(mode,extra,(x,y,z)=>x*sign>2&&y>3.6&&z<-.8);
  const outside=difference(mode,extra,(x,y,z)=>x*sign<-2&&y>3.6&&z<-.8);
  assert.ok(inside<-.2,`${mode} ${side}: pulled trailing edge lowers`);
  assert.ok(Math.abs(outside)<.02,`${mode} ${side}: opposite trailing edge stays free`);
 }
});

test('parakite release lowers incidence on the outside half without a bank-driven twist',()=>{
 const side=(x,y)=>x>2&&y>3.6;
 const front=difference('parakite',{handleLeft:.05},(x,y,z)=>side(x,y)&&z>0);
 const rear=difference('parakite',{handleLeft:.05},(x,y,z)=>side(x,y)&&z<-.8);
 assert.ok(front-rear<-.04,'raising the left handle decreases left nose-to-tail incidence');
 const opposite=difference('parakite',{handleLeft:.05},(x,y,z)=>x<-2&&y>3.6&&z<-.8);
 assert.ok(Math.abs(opposite)<.02,'opposite incidence remains stable');
 const a=difference('parakite',{bank:.6},(x,y,z)=>side(x,y)&&z<-.8);
 const b=difference('parakite',{bank:-.6},(x,y,z)=>side(x,y)&&z<-.8);
 assert.ok(Math.abs(a-b)<1e-6,'bank alone adds symmetric flex, not a hidden handle twist');
});

test('parakite accelerator telemetry does not add a second speedbar deformation',()=>{
 const a=createFlightRig(assets,config),b=createFlightRig(assets,config);
 try{
  const s=start('parakite');a.update(.1,s);b.update(.1,{...s,accelerator:1});
  assert.deepEqual(a.wings.parakite.mesh.geometry.attributes.position.array,b.wings.parakite.mesh.geometry.attributes.position.array);
 }finally{a.dispose();b.dispose();}
});

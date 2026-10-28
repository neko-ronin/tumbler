import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {createNavigation} from '../src3d/navigation.js';
import {createFlightRig} from '../src3d/flight-rig.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const player=read('../../../shared/characters/player.json'),flight=read('../../../shared/activities/flight.json');
const ride=read('../../../shared/activities/ride.json'),worldmap=read('../../../shared/world/worldmap.json');
function game(t,scale){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget();
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const config={...player,scale},cat=createCharacter(parseGLB(readFileSync(new URL('../../../shared/geometry/'+player.asset,import.meta.url))),config),rig=new T.Group();
 let presented;
 rig.userData.flightUpdate=(dt,state)=>{presented=state;};
 const nav=createNavigation(new T.PerspectiveCamera(),canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},flight,worldmap,rig,()=>null,
  {config:ride,rig:new T.Group(),meshes:{ski:new T.Group(),bike:new T.Group()},height:()=>0,snowAt:()=>1,surfaceAt:()=>'snow'},cat,config);
 t.after(()=>{nav.dispose();cat.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 const hips=()=>{rig.updateMatrixWorld(true);cat.object.updateMatrixWorld(true);return rig.worldToLocal(cat.model.getObjectByName('hips').getWorldPosition(new T.Vector3()));};
 const attachment=()=>{rig.updateMatrixWorld(true);return presented?.coupled&&!presented.grounded&&!presented.collapsed?rig.worldToLocal(new T.Vector3(presented.coupled.pilotPosition[0],presented.coupled.pilotPosition[2],-presented.coupled.pilotPosition[1])):new T.Vector3(0,.65,0);};
 return {nav,cat,rig,config,hips,attachment};
}
for(const mode of ['paraglider','parakite','paramotor'])for(const scale of [1,.52])test(`${mode}, scale ${scale}: hips stay in the harness through animation and banking`,t=>{
 const {nav,hips,attachment}=game(t,scale);nav.select(mode);
 Object.assign(nav.state,{x:10,y:20,z:500,heading:.7,bank:.5,grounded:false});
 for(let i=0;i<90;i++){
  nav.update(1/30);
  const p=hips(),expected=attachment();assert.ok(p.distanceTo(expected)<.005,`hips at ${p.toArray()}, expected physical attachment ${expected.toArray()}`);
 }
});
test('changing size in flight keeps the attachment while landing and a collapse release the pose',t=>{
 const {nav,config,hips,cat,attachment}=game(t,1);nav.select('paraglider');Object.assign(nav.state,{z:500,grounded:false});
 for(let i=0;i<10;i++)nav.update(1/30);
 config.scale=.52;nav.update(1/30);
 assert.ok(hips().distanceTo(attachment())<.005);
 Object.assign(nav.state,{collapsed:true,grounded:false});nav.update(1/30);assert.equal(cat.clip,'fall_tumble');
 Object.assign(nav.state,{grounded:true,z:flight.landing_clearance_m,speed:0,vertical:0,vario:0});
 for(let i=0;i<60;i++)nav.update(1/30);
 assert.equal(cat.clip,'sit');assert.ok(hips().y<.3,'ground sitting is not pinned to the flight attachment');
});

const assets=Object.fromEntries([flight.wing_asset,flight.motor_asset,flight.modes.parakite.wing_asset].map(p=>[p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));
for(const mode of ['paraglider','parakite','paramotor'])test(`${mode}: straps fit the small pilot without shrinking the sail or upper lines`,()=>{
 const full=createFlightRig(assets,flight),small=createFlightRig(assets,flight),state={mode,pressure:1,grounded:false};
 try{
  full.update(.1,state,{pilotScale:1,pilotAttachment:player.flight_attachment.position_m});
  small.update(.1,state,{pilotScale:.52,pilotAttachment:player.flight_attachment.position_m});
  const name=mode==='parakite'?'parakite':'paraglider',a=full.wings[name],b=small.wings[name],p=a.mesh.geometry.attributes.position,q=b.mesh.geometry.attributes.position;
  const anchor=new T.Vector3().fromArray(player.flight_attachment.position_m);let fitted=0,unchanged=0;
  for(let i=0;i<p.count;i++){
   const index=a.indices[i],fit=a.pilotFit[index],before=new T.Vector3().fromBufferAttribute(p,i),after=new T.Vector3().fromBufferAttribute(q,i);
   if(fit===1){assert.ok(after.distanceTo(before.sub(anchor).multiplyScalar(.52).add(anchor))<1e-6);fitted++;}
   if(a.points[index].y>2.6){assert.ok(after.distanceTo(before)<1e-6);unchanged++;}
  }
  assert.ok(fitted>100&&unchanged>1000,'exercise real straps and fabric');
  if(mode==='paramotor'){assert.equal(small.motor.scale.x,.52);assert.ok(Math.abs(small.motor.position.y-(.65+(.95-.65)*.52))<1e-9);}
 }finally{full.dispose();small.dispose();}
});
for(const mode of ['paraglider','parakite'])test(`${mode}: an open strap harness has no seat pan across its centre`,()=>{
 const source=assets[flight.modes[mode].wing_asset??flight.wing_asset].primitives.filter(p=>p.materialName==='harness');
 const meshes=source.map(p=>new T.Mesh(p.geometry,new T.MeshBasicMaterial({side:T.DoubleSide})));
 try{
  for(const z of [-.05,0,.05]){
   const ray=new T.Raycaster(new T.Vector3(0,.3,z),new T.Vector3(0,1,0),0,.6);
   assert.equal(ray.intersectObjects(meshes).length,0,'the harness centre stays open between the leg loops');
  }
 }finally{for(const mesh of meshes)mesh.material.dispose();}
});

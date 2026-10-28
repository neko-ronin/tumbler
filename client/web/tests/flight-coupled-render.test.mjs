import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {createNavigation} from '../src3d/navigation.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {canopySegment,pilotFrame} from '../../../shared/activities/flight.js';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const flight=read('../../../shared/activities/flight.json'),player=read('../../../shared/characters/player.json');
const ride=read('../../../shared/activities/ride.json'),world=read('../../../shared/world/worldmap.json');
const assets=Object.fromEntries([flight.wing_asset,flight.motor_asset,flight.modes.parakite.wing_asset].map(p=>[p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));
const worldPoint=p=>new T.Vector3(p[0],p[2],-p[1]);

for(const mode of Object.keys(flight.modes))for(const scale of [1,.52])test(`${mode}, scale ${scale}: rendered hips and canopy use their separate physical anchors`,t=>{
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 for(const [k,v] of Object.entries({window:new EventTarget(),document:new EventTarget(),navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const rules={...flight,coupled:{...flight.coupled,harness_height_m:.65}},config={...player,scale};
 const character=createCharacter(parseGLB(readFileSync(new URL('../../../shared/geometry/'+player.asset,import.meta.url))),config),flightRig=createFlightRig(assets,rules),rig=flightRig.group;
 let presentation;
 rig.userData.flightUpdate=(dt,state,view)=>{presentation=view;flightRig.update(dt,state,view);};
 const camera=new T.PerspectiveCamera(),nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},rules,world,rig,()=>null,
  {config:ride,rig:new T.Group(),meshes:{}},character,config);
 t.after(()=>{nav.dispose();character.dispose();flightRig.dispose();for(const [k,v] of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 nav.select(mode);
 const pilotPosition=[10,20,500],wingPosition=[11.1,19.4,504.4];
 Object.assign(nav.state,{x:10,y:20,z:501.15,heading:.7,bank:.5,pitch:.15,grounded:false,
  coupled:{pilotPosition,wingPosition,lineSlackM:0}});
 nav.update(.001); // No simulation tick: exercise the supplied core anchors.
 rig.updateMatrixWorld(true);character.object.updateMatrixWorld(true);
 const hip=character.model.getObjectByName(player.flight_attachment.bone).getWorldPosition(new T.Vector3());
 assert.ok(hip.distanceTo(worldPoint(pilotPosition))<1e-6,'the animated hip follows the independent pilot point');
 const m=rules.modes[mode],capsule=canopySegment(nav.state,rules);
 for(const [x,expected] of [[m.span_m/2,capsule.a],[-m.span_m/2,capsule.b]])assert.ok(rig.localToWorld(new T.Vector3(x,m.canopy_height_m,0)).distanceTo(worldPoint(expected))<1e-8,'the sail and collision share the independent wing point');
 const actual=rig.localToWorld(new T.Vector3().fromArray(player.flight_attachment.position_m).applyMatrix4(presentation.pilotTransform));
 assert.ok(actual.distanceTo(hip)<1e-7,'the lower equipment transform lands at the same hip');
 const pilot=pilotFrame(nav.state,rules),actualUp=new T.Vector3(0,1,0).applyQuaternion(character.object.quaternion);
 assert.ok(actualUp.distanceTo(worldPoint(pilot.up))<1e-8,'character orientation follows the shared pilot frame');
 const changeView=new Event('keydown');Object.defineProperty(changeView,'code',{value:'KeyV'});window.dispatchEvent(changeView);nav.update(0);
 const eye=pilot.origin.map((v,i)=>v+pilot.up[i]*(rules.landing_clearance_m+.15));
 assert.equal(nav.view,'first');
 assert.ok(camera.position.distanceTo(worldPoint(eye))<1e-8,'first-person eye follows the pilot rather than the independent wing');
});

test('coupled harness and motor follow the full pilot transform; only slack cascades sag',()=>{
 const rigs=[createFlightRig(assets,flight),createFlightRig(assets,flight),createFlightRig(assets,flight)];
 try{
  const [baseline,coupled,slack]=rigs,state={mode:'paramotor',pressure:1,grounded:false,pilotPitch:0,pilotRoll:0};
  const transform=new T.Matrix4().compose(new T.Vector3(.8,-.2,.4),new T.Quaternion().setFromEuler(new T.Euler(.18,0,-.23)),new T.Vector3(1,1,1));
  const view={pilotAttachment:player.flight_attachment.position_m,pilotScale:.52};
  baseline.update(.1,state,view);
  coupled.update(.1,{...state,coupled:{lineSlackM:0}},{...view,pilotTransform:transform});
  const sagDirection=new T.Vector3(.1,-1,.2).normalize();
  slack.update(.1,{...state,coupled:{lineSlackM:.4}},{...view,pilotTransform:transform,lineSagDirection:sagDirection.toArray()});
  const a=baseline.wings.paraglider,b=coupled.wings.paraglider,c=slack.wings.paraglider;
  const p=a.mesh.geometry.attributes.position,q=b.mesh.geometry.attributes.position,r=c.mesh.geometry.attributes.position;
  let full=0,blended=0,upper=0;
  for(let i=0;i<p.count;i++){
   const weight=a.coupledFit[a.indices[i]],before=new T.Vector3().fromBufferAttribute(p,i),actual=new T.Vector3().fromBufferAttribute(q,i);
   const expected=before.clone().lerp(before.clone().applyMatrix4(transform),weight);
   assert.ok(actual.distanceTo(expected)<2e-6,'taut equipment uses only the physical relative transform');
   expected.addScaledVector(sagDirection,.8*weight*(1-weight));
   assert.ok(new T.Vector3().fromBufferAttribute(r,i).distanceTo(expected)<2e-6,'slack sag leaves both endpoints attached');
   if(weight===1)full++;else if(weight>0)blended++;
   if(a.rest[i*3+1]>3.1){assert.ok(actual.equals(before),'upper attachment ends and sail retain the wing frame');upper++;}
  }
  assert.ok(full>100&&blended>0&&upper>1000,'exercise actual harness, cascades and sail');
  assert.ok(coupled.motor.position.distanceTo(baseline.motor.position.clone().applyMatrix4(transform))<1e-8);
  assert.ok(coupled.motor.quaternion.angleTo(new T.Quaternion().setFromRotationMatrix(transform))<1e-7);
 }finally{rigs.forEach(r=>r.dispose());}
});

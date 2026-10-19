import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const assets=Object.fromEntries([config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset].map(p=>[p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));

// Same sewn point is duplicated for cell/material/triangle boundaries in glTF.
// Those copies must remain together even if their float x has opposite signs.
function seamGap(w){
 const groups=new Map(),p=w.mesh.geometry.attributes.position;let worst=0;
 for(let i=0;i<p.count;i++){
  const r=Array.from(w.rest.slice(i*3,i*3+3));if(r[1]<3)continue;
  const key=r.map(v=>Math.round(v*1e5)).join(','),first=groups.get(key);
  const point=[p.getX(i),p.getY(i),p.getZ(i)];
  if(first)worst=Math.max(worst,Math.hypot(...point.map((v,j)=>v-first[j])));else groups.set(key,point);
 }
 return worst;
}
function centreJump(w){
 const groups=new Map(),p=w.mesh.geometry.attributes.position;let worst=0;
 for(let i=0;i<p.count;i++){
  const [x,y,z]=w.rest.slice(i*3,i*3+3);if(y<3||z>-.3||Math.abs(x)>.15)continue;
  const key=[y,z].map(v=>Math.round(v*1e4)).join(',');
  if(!groups.has(key))groups.set(key,[null,null]);const pair=groups.get(key),side=x<0?0:1;
  if(!pair[side]||Math.abs(x)<Math.abs(pair[side].x))pair[side]={x,i};
 }
 for(const [a,b] of groups.values())if(a&&b){
  const distance=Math.abs(a.x-b.x),da=p.getY(a.i)-w.rest[a.i*3+1],db=p.getY(b.i)-w.rest[b.i*3+1];
  worst=Math.max(worst,Math.abs(da-db)-distance*2);
 }
 return worst;
}
test('sewn cell boundaries remain continuous under full independent pulls and recovery in every flight mode',()=>{
 for(const mode of Object.keys(config.modes))for(const side of ['brakeLeft','brakeRight']){
  const rig=createFlightRig(assets,config);let state={...launchFlight(config,mode,{xy_m:[0,0],heading_deg:0},()=>0),z:1500};
  for(let i=0;i<360;i++)state=stepFlight(state,{[side]:1},1/120,i/120,config,270,()=>0);
  rig.update(.1,state);
  const wing=rig.wings[mode==='parakite'?'parakite':'paraglider'];
  assert.ok(seamGap(wing)<.0001,`${mode} ${side}: sewn vertices separate ${seamGap(wing).toFixed(6)} m`);
  assert.ok(centreJump(wing)<.001,`${mode} ${side}: centre has a step, excess ${centreJump(wing)} m`);
  for(let i=0;i<360;i++)state=stepFlight(state,{},1/120,3+i/120,config,270,()=>0);
  rig.update(.1,state);assert.ok(seamGap(wing)<.0001,'recovery seam');rig.dispose();
 }
});

test('landed cloth settles on sloping ground, catches headwind, and releases when unharnessed',()=>{
 for(const mode of Object.keys(config.modes)){
  const rig=createFlightRig(assets,config),s={...launchFlight(config,mode,{xy_m:[0,0],heading_deg:0},()=>0),grounded:true};
  const w=rig.wings[mode==='parakite'?'parakite':'paraglider'];
  const floor=(x,z)=>.13*x+.07*z,view={groundAt:floor,localAir:{x:0,y:0,z:0}};
  for(let i=0;i<80;i++)rig.update(.1,s,view);
  assert.ok(w.inflation<.001,'still air releases inflation');
  const p=w.mesh.geometry.attributes.position;
  let top=-Infinity;
  for(let i=0;i<p.count;i++){
   assert.ok([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));
   if(w.rest[i*3+1]<1.3)assert.equal(p.getY(i),w.rest[i*3+1]);
   else assert.ok(p.getY(i)>=floor(p.getX(i),p.getZ(i))+.024,'cloth and lines stay above the ground');
   if(w.rest[i*3+1]>3.6)top=Math.max(top,p.getY(i)-floor(p.getX(i),p.getZ(i)));
  }
  assert.ok(top<.9,'canopy loses height and volume instead of hanging overhead');
  view.localAir.z=-7;rig.update(.1,s,view);assert.ok(w.inflation<.2,'reinflation is progressive');
  for(let i=0;i<60;i++)rig.update(.1,s,view);
  assert.ok(w.inflation>.99,'headwind fills the wing');assert.ok(seamGap(w)<.0001);
  view.harnessed=false;for(let i=0;i<80;i++)rig.update(.1,s,view);
  assert.ok(w.inflation<.001,'unharnessed cloth does not stay overhead');rig.dispose();
 }
});

test('sewn skin normals agree across material boundaries during loaded turns',()=>{
 const rig=createFlightRig(assets,config),state={...launchFlight(config,'paraglider',{xy_m:[0,0],heading_deg:0},()=>0),brakeLeft:1,bank:.6};
 rig.update(.1,state);const w=rig.wings.paraglider,n=w.mesh.geometry.attributes.normal;
 // Locate duplicated skin points by source primitive rather than normal sign:
 // the rib and skin can share a position but need different lighting normals.
 let offset=0;const groups=new Map();
 for(const primitive of assets[config.wing_asset].primitives){
  const count=primitive.geometry.index?.count??primitive.geometry.attributes.position.count;
  if(/^(upper|lower)_/.test(primitive.materialName))for(let i=offset;i<offset+count;i++){
   const key=Array.from(w.rest.slice(i*3,i*3+3)).map(v=>Math.round(v*1e5)).join(',')+primitive.materialName.split('_')[0];
   const normal=[n.getX(i),n.getY(i),n.getZ(i)],first=groups.get(key);
   assert.ok(normal.every(Number.isFinite));
   // A zero-area nose triangle has no lighting normal to compare. Exercise
   // the visible sewn surface rather than failing on that unrelated topology.
   if(Math.hypot(...normal)<.99)continue;
   if(first)assert.ok(Math.hypot(...normal.map((v,j)=>v-first[j]))<1e-5);else groups.set(key,normal);
  }
  offset+=count;
 }
 rig.dispose();
});

test('intake lining leaves the forward upper mouth open and places its back wall deeper in the cell',()=>{
 for(const name of ['paraglider','parakite']){
  const mode=config.modes[name],primitives=assets[mode.wing_asset??config.wing_asset].primitives;
  let forwardFloor=false,deepWall=false;
  for(const primitive of primitives.filter(p=>/^intake/.test(p.materialName))){
   const p=primitive.geometry.attributes.position,n=primitive.geometry.attributes.normal;
   for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i))<.2){
    if(p.getZ(i)>mode.chord_m*.35){
     forwardFloor=true;assert.ok(p.getY(i)<mode.canopy_height_m-.03,'front opening contains no opaque upper cap');
    }
    if(n.getZ(i)>.7){deepWall=true;assert.ok(p.getZ(i)<mode.chord_m*.25,'back wall is actually recessed');}
   }
  }
  assert.ok(forwardFloor&&deepWall,'mouth has a lit floor and a recessed wall');
 }
});

test('settling on a steep plane preserves span length instead of stretching up its face',()=>{
 const rig=createFlightRig(assets,config),s={...launchFlight(config,'paraglider',{xy_m:[0,0],heading_deg:0},()=>0),grounded:true};
 for(let i=0;i<80;i++)rig.update(.1,s,{groundAt:x=>x*4});
 const w=rig.wings.paraglider,p=w.mesh.geometry.attributes.position,along=[];
 for(let i=0;i<p.count;i++)if(w.rest[i*3+1]>3.6)along.push((p.getX(i)+p.getY(i)*4)/Math.sqrt(17));
 assert.ok(Math.max(...along)-Math.min(...along)<config.modes.paraglider.span_m*1.2,'cloth must fold onto the slope without multiplying its length');rig.dispose();
});


test('a parked unharnessed wing releases in strong wind and restores equipment on rehook',()=>{
 for(const mode of Object.keys(config.modes)){
  const rig=createFlightRig(assets,config);
  const state={...launchFlight(config,mode,{xy_m:[0,0],heading_deg:0},()=>0),grounded:true,harnessed:false};
  const wing=rig.wings[mode==='parakite'?'parakite':'paraglider'];
  const presentation={localAir:{x:0,y:0,z:-7},groundAt:()=>0};
  for(let i=0;i<80;i++)rig.update(.1,state,presentation);
  assert.ok(wing.inflation<.001,'parked pose cannot refill after the pilot unhooks');
  const released=wing.mesh.geometry.index;
  assert.ok(released,'parked draw excludes the standing harness and attached lines');
  for(const i of released.array)assert.ok(wing.rest[i*3+1]>=1.3,'no body-space harness remains drawn');
  assert.ok(!rig.motor.visible,'disconnected motor is not left floating against the walking pilot');
  state.harnessed=true;rig.update(.1,state,presentation);
  assert.equal(wing.mesh.geometry.index,null,'rehooking restores the complete original equipment draw');
  assert.equal(rig.motor.visible,mode==='paramotor');
  for(let i=0;i<60;i++)rig.update(.1,state,presentation);
  assert.ok(wing.inflation>.99,'attached wing catches wind again');
  rig.dispose();
 }
});

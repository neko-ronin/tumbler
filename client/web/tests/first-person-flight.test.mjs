import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {DEFAULT_APPEARANCE,APPEARANCE_PRESETS} from '../../../shared/characters/appearance.js';
import {resolveFirstPersonDesign,generateFirstPerson,firstPersonPose,solveArm} from '../../../shared/geometry/first-person/recipe.js';
import {controlGrip} from '../../../shared/geometry/flight/contacts.js';
import {createFirstPersonFlight} from '../src3d/first-person-flight.js';
const config={asset:'cat-ronin/ronin.glb'},design=()=>resolveFirstPersonDesign(config);
const gap=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('deterministic anatomy recipe preserves palette identity without inferring anatomy from imported meshes',()=>{
 const a=generateFirstPerson(design()),b=generateFirstPerson(design());assert.deepEqual(a,b);assert.equal(a.anatomy.digits,4);
 assert.ok(a.geometry.indices.every(i=>i>=0&&i<a.geometry.positions.length/3));assert.ok(a.geometry.positions.every(Number.isFinite));
 assert.equal(resolveFirstPersonDesign({asset:'unknown/visitor.glb'}).supported,false);
 const ember=resolveFirstPersonDesign({...config,appearance:APPEARANCE_PRESETS[2].recipe});assert.notEqual(ember.key,design().key);assert.equal(generateFirstPerson(ember).materials.coat.tint,APPEARANCE_PRESETS[2].recipe.palette.coat);assert.equal(generateFirstPerson(ember).materials.knit.tint,APPEARANCE_PRESETS[2].recipe.palette.outfit);assert.ok(Object.isFrozen(a.anatomy.eye));
 assert.equal(resolveFirstPersonDesign({...config,appearance:{...DEFAULT_APPEARANCE,name:'Renamed'}}).key,design().key);
});
test('both paws wrap independently around shared contacts at every control extreme without stretching either arm',()=>{
 const recipe=generateFirstPerson(design());
 for(const mode of ['paraglider','parakite','paramotor'])for(const left of [0,.45,1])for(const right of [0,.45,1]){
  const state={mode,handleLeft:left,handleRight:right,brakeLeft:left,brakeRight:right,load:2},before=structuredClone(state),grips=[controlGrip(state,1),controlGrip(state,-1)],pose=firstPersonPose(recipe,state,grips,2);
  assert.deepEqual(state,before);assert.ok(grips[0][0]>0&&grips[1][0]<0);
  for(const j of pose.joints){assert.equal(j.clamped,false);assert.ok(Math.abs(gap(j.shoulder,j.elbow)-recipe.anatomy.upperArm)<1e-9);assert.ok(Math.abs(gap(j.elbow,j.wrist)-recipe.anatomy.forearm)<1e-9);}
  assert.equal(pose.parts.filter(p=>p.id.includes('_digit_')).length,16);assert.ok(pose.parts.every(p=>[...p.position,...p.scale,...p.quaternion].every(Number.isFinite)));
 }
 const far=solveArm([0,0,0],[0,0,5],.3,.3,[.2,-.2,0]);assert.equal(far.clamped,true);assert.ok(gap([0,0,0],far.wrist)<.6);
});
test('chase view needs only the same equipment contacts, without generating unseen limb poses',()=>{
 const recipe=generateFirstPerson(design()),s={mode:'parakite'},grips=[controlGrip(s,1),controlGrip(s,-1)];
 const a=firstPersonPose(recipe,s,grips),b=firstPersonPose(recipe,s,grips,0,{body:false});assert.deepEqual(b.parts,a.parts.filter(p=>p.material==='webbing'));assert.equal(b.joints.length,0);
});
test('lazy requests reuse one model, reject stale design output and dispose pending resources',async()=>{
 const a=createFirstPersonFlight(config);assert.equal(a.stats.builds,0);
 const old=a.request(design()),newest=a.setDesign(APPEARANCE_PRESETS[2].recipe);await Promise.all([old,newest]);assert.equal(a.stats.builds,1);assert.equal(a.ready,true);
 await a.setDesign(APPEARANCE_PRESETS[2].recipe);assert.equal(a.stats.builds,1);
 a.update({active:true,view:'first',pilotMatrix:new T.Matrix4(),state:{mode:'parakite'},grips:[new T.Vector3(.4,1.25,.45),new T.Vector3(-.4,1.25,.45)]});assert.equal(a.group.visible,true);assert.ok(a.stats.triangles<24000);
 a.update({active:false});assert.equal(a.group.visible,false);a.dispose();assert.equal(a.group.children.length,0);
 const pending=createFirstPersonFlight(config),request=pending.request(design());pending.dispose();await request;assert.equal(pending.group.children.length,0);assert.equal(pending.stats.builds,0);
});

test('vertical or coincident arm targets keep finite fixed-length bones with a degenerate bend hint',()=>{
 for(const target of [[0,.2,0],[0,-.2,0],[0,0,0]]){
  const p=solveArm([0,0,0],target,.18,.18,[0,1,0]);assert.ok(Math.abs(gap([0,0,0],p.elbow)-.18)<1e-8);assert.ok(Math.abs(gap(p.elbow,p.wrist)-.18)<1e-8);
 }
});
test('a failed shader preparation releases the unattached model and preserves failure state',async()=>{
 const body=createFirstPersonFlight(config,{compile:async()=>{throw Error('compile fixture');}});
 await assert.rejects(body.request(design()),/compile fixture/);assert.equal(body.group.children.length,0);assert.equal(body.stats.builds,0);assert.equal(body.stats.status,'failed');body.dispose();
});

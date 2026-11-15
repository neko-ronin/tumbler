import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {generateFirstPerson,resolveFirstPersonDesign} from '../../../shared/geometry/first-person/recipe.js';
import {createFirstPersonHead,createCockpitCamera} from '../src3d/first-person-head.js';
const settle=(state,strength=1)=>{const h=createFirstPersonHead();let p;for(let i=0;i<240;i++)p=h.update(state,1/60,strength);return {...p};};
test('the head looks into the turn and leans with it, opposite for an opposite bank',()=>{
 const right=settle({bank:.8,speed:0}),left=settle({bank:-.8,speed:0});
 assert.ok(right.yaw<0&&left.yaw>0);assert.ok(right.roll<0&&left.roll>0);assert.ok(Math.abs(right.yaw)<.3);
});
test('load sinks the head; reduced motion holds it still',()=>{
 assert.ok(settle({load:2,speed:0}).sink>settle({load:1,speed:0}).sink);
 const off=settle({bank:1,load:3,speed:40,turbulence:2},0);for(const v of Object.values(off))assert.equal(Math.abs(v),0);
});
test('buffet stays a tremor at top speed',()=>{
 const h=createFirstPersonHead();let peak=0;for(let i=0;i<600;i++)peak=Math.max(peak,Math.abs(h.update({speed:50,turbulence:1.5},1/60).roll));
 assert.ok(peak>0&&peak<.02,String(peak));
});

test('cockpit look keeps the collar outside the frustum on steep and banked looks',()=>{
 const fit=createCockpitCamera(),recipe=generateFirstPerson(resolveFirstPersonDesign({asset:'cat-ronin/ronin.glb'}));
 const {eye,hip,collarBounds}=recipe.anatomy;
 const collar=[],hipVector=new T.Vector3(...hip),centre=new T.Vector3(...collarBounds.centre);
 for(let i=0;i<recipe.torso.positions.length;i+=3){
  const vertex=new T.Vector3().fromArray(recipe.torso.positions,i);
  if(vertex.y<.975)continue;
  assert.ok(vertex.distanceTo(centre)<collarBounds.radius,'bound contains the cutaway');
  const delta=vertex.clone().sub(centre);
  assert.ok(delta.toArray().every((v,axis)=>Math.abs(v)<collarBounds.halfSize[axis]));
  collar.push(vertex);
 }
 const pilot=new T.Matrix4(),projected=new T.Vector3();
 const rad=degrees=>degrees*Math.PI/180;
 for(const [aspect,fov] of [[.8,62],[1,62],[1.6,62],[1.6,80],[21/9,80]])for(const scale of [.52,1]){
  const camera=new T.PerspectiveCamera(fov,aspect,.15,60000);
  for(const bank of [-115,-65,-25,0,25,65,115])for(const tilt of [-32,0,32]){
   pilot.makeRotationFromEuler(new T.Euler(rad(tilt),0,rad(bank),'YXZ'));
   for(let yaw=-180;yaw<180;yaw+=12)for(let pitch=-83;pitch<=77;pitch+=8){
    camera.quaternion.setFromEuler(new T.Euler(rad(pitch),rad(yaw),rad(bank*.25),'YXZ'));
    fit(camera,pilot,eye,collarBounds,hip[1],scale,.055,rad(yaw));
    camera.updateMatrixWorld();
    for(const vertex of collar){
     projected.copy(vertex).sub(hipVector).multiplyScalar(scale).add(hipVector).applyMatrix4(pilot).project(camera);
     assert.ok(Math.abs(projected.x)>1||Math.abs(projected.y)>1||Math.abs(projected.z)>1,
      `collar at yaw ${yaw}, pitch ${pitch}, bank ${bank}, tilt ${tilt}, aspect ${aspect}, scale ${scale}, FOV ${fov}`);
    }
   }
  }
 }
});

test('cockpit keeps the neutral eye and can still look down at the instrument and knees',()=>{
 const {eye,collarBounds:collar}=generateFirstPerson(resolveFirstPersonDesign({asset:'cat-ronin/ronin.glb'})).anatomy;
 const camera=new T.PerspectiveCamera(62,1.6,.15,60000),pilot=new T.Matrix4(),fit=createCockpitCamera();
 const neutral=new T.Quaternion().setFromEuler(new T.Euler(-.2,Math.PI,0,'YXZ'));
 camera.quaternion.copy(neutral);
 fit(camera,pilot,eye,collar,.65,1,0,Math.PI);
 assert.ok(camera.quaternion.angleTo(neutral)<1e-7);
 assert.ok(camera.position.distanceTo(new T.Vector3(...eye))<1e-10);
 camera.quaternion.setFromEuler(new T.Euler(-1.35,Math.PI,0,'YXZ'));
 fit(camera,pilot,eye,collar,.65,1,0,Math.PI);
 camera.updateMatrixWorld();
 for(const target of [[0,.90,.15],[.144,.55,.385]]){
  const point=new T.Vector3(...target).project(camera);
  assert.ok(Math.abs(point.x)<1&&Math.abs(point.y)<1&&Math.abs(point.z)<1);
 }
});


test('crossing the pilot-relative down pole keeps the camera continuous',()=>{
 const {eye,hip,collarBounds}=generateFirstPerson(resolveFirstPersonDesign({asset:'cat-ronin/ronin.glb'})).anatomy;
 const camera=new T.PerspectiveCamera(62,1.6,.15,60000),fit=createCockpitCamera();
 const rad=degrees=>degrees*Math.PI/180;
 for(const bank of [25,65]){
  const pilot=new T.Matrix4().makeRotationZ(rad(bank)),yaw=-Math.PI/2;
  const inspect=pitch=>{
   camera.quaternion.setFromEuler(new T.Euler(rad(pitch),yaw,0,'YXZ'));
   fit(camera,pilot,eye,collarBounds,hip[1],1,.055,yaw);
   return camera.quaternion.clone();
  };
  for(const offset of [0,Math.asin(.24)*180/Math.PI]){
   const crossing=bank-90-offset;
   assert.ok(inspect(crossing-.01).angleTo(inspect(crossing+.01))<rad(1));
  }
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {mirrorView,mirrorWorthDrawing,farTreeForm} from '../src3d/mirror.js';

const level=30;
const camera=()=>{const c=new T.PerspectiveCamera(62,1.6,.15,60000);c.position.set(-380,34,-250);c.lookAt(-390,80,-860);c.updateMatrixWorld();return c;};
const uv=(m,p)=>{const v=new T.Vector4(p.x,p.y,p.z,1).applyMatrix4(m);return [v.x/v.w,v.y/v.w];};

test('a point above the water is looked up where the eye sees the water mirror it',()=>{
 const c=camera(),{textureMatrix}=mirrorView(c,level);
 for(const a of [new T.Vector3(-390,120,-860),new T.Vector3(-200,45,-500),new T.Vector3(-600,300,-1200)]){
  // The eye's ray to the point's mirror image crosses the water where the reflection shows it.
  const image=new T.Vector3(a.x,2*level-a.y,a.z),t=(c.position.y-level)/(c.position.y-image.y);
  const surface=c.position.clone().lerp(image,t);
  assert.ok(Math.abs(surface.y-level)<1e-6);
  const [u0,v0]=uv(textureMatrix,a),[u1,v1]=uv(textureMatrix,surface);
  assert.ok(Math.abs(u0-u1)<1e-6&&Math.abs(v0-v1)<1e-6,`${a.toArray()}`);
  assert.ok(u0>0&&u0<1&&v0>0&&v0<1,'in view');
 }
});

test('the oblique near plane cuts the world at the water: nothing below it is drawn',()=>{
 const c=camera(),{virtual}=mirrorView(c,level),m=new T.Matrix4().multiplyMatrices(virtual.projectionMatrix,virtual.matrixWorldInverse);
 const ndcZ=p=>{const v=new T.Vector4(p.x,p.y,p.z,1).applyMatrix4(m);return v.z/v.w;};
 for(const x of [-500,-390,-250]){
  const above=ndcZ(new T.Vector3(x,level+.5,-800)),below=ndcZ(new T.Vector3(x,level-.5,-800));
  assert.ok(above>-1&&above<1,`above ${above}`);
  assert.ok(below<-1||below>1,`below ${below}`);
 }
});

test('the pass is skipped under the water and where the lake is seen steeper than 45 degrees',()=>{
 assert.equal(mirrorWorthDrawing(29,level,1000),false);
 assert.equal(mirrorWorthDrawing(31.7,level,1000),true);
 assert.equal(mirrorWorthDrawing(630,level,3000),true);
 assert.equal(mirrorWorthDrawing(3500,level,3000),false);
});

test('near tree batches are reflected in their far form, keeping their own instances',()=>{
 const geometry=(n,intervals)=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(new Array(n*3).fill(0),3));g.setAttribute('forestInterval',new T.InstancedBufferAttribute(new Float32Array(intervals*2),2));return g;};
 const card=new T.MeshBasicMaterial(),far=new T.InstancedMesh(geometry(4,9),card,9),pool={meshes:[null,null,null,far]};
 const near=new T.InstancedMesh(geometry(900,3),new T.MeshBasicMaterial(),3);near.name='studio_lod0_0,0';near.userData.pool=pool;
 const root=new T.Group(),form=farTreeForm(near,root);
 assert.equal(form.material,card);
 assert.equal(form.geometry.attributes.position,far.geometry.attributes.position);
 assert.equal(form.geometry.attributes.forestInterval,near.geometry.attributes.forestInterval,'its own fade intervals');
 const oldNear=new T.InstancedMesh(geometry(900,0),new T.MeshBasicMaterial(),2),oldFar=new T.InstancedMesh(geometry(4,0),card,2);
 oldNear.name='forest_near_a.glb_0,0';oldFar.name='forest_far_a.glb_0,0';root.add(oldNear,oldFar);
 assert.equal(farTreeForm(oldNear,root).geometry,oldFar.geometry);
 const lod2=new T.InstancedMesh(geometry(40,3),card,3);lod2.name='studio_lod2_distant_0,0';
 assert.equal(farTreeForm(lod2,root),null,'mid and far stages draw as they are');
});

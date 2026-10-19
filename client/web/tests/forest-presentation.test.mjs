import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {buildStylizedForest} from '../src3d/forest.js';
import {instanceMatrix} from '../src3d/world.js';
const path='redwood/giant_redwood.glb';
const asset=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)));
const renderer={getRenderTarget:()=>null,getClearColor:c=>c.set(0),getClearAlpha:()=>1,setRenderTarget(){},setClearColor(){},render(){}};
const tree={asset:path,position_m:[120,50,200],yaw_deg:37,scale:[1.3,1.1,1.65],tags:[]};
const source=new T.Box3();asset.primitives.forEach(p=>source.union(p.geometry.boundingBox));
const bounds=source.clone().applyMatrix4(instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale));
const build=(record=tree,options={})=>buildStylizedForest({instances:[record]},{[path]:asset},renderer,options);

test('a giant crown approached vertically gets shared volume, including on first load',()=>{
  const forest=build(),camera=new T.PerspectiveCamera();
  camera.position.copy(bounds.getCenter(new T.Vector3())).setY(bounds.max.y+2);
  forest.update(camera);
  assert.equal(forest.stats.near,1,'a camera 2 m above the real crown must not see a card');
});

test('world-space tree source gets represented without repeating the placement transform',()=>{
  const record={...tree,tags:['world_space']},forest=build(record);
  assert.equal(forest.stats.trees,1,'world-space trees must not vanish from the dedicated path');
  const camera=new T.PerspectiveCamera();camera.position.copy(source.getCenter(new T.Vector3()));forest.update(camera);
  const mesh=forest.group.children.find(m=>m.name.startsWith('forest_near_'));
  assert.ok(mesh?.count);
  const matrix=new T.Matrix4();mesh.getMatrixAt(0,matrix);
  assert.ok(matrix.equals(asset.primitives[0].local),'world-space coordinates get no second translation, turn or scale');
});

// The regular forest/village shadow paths share this contract. Render resources
// are mocked only for the offscreen bake; selection, transforms and bounds run.
test('shader-rotated far trees have conservative bounds through camera rotation',()=>{
  const forest=build(),camera=new T.PerspectiveCamera();camera.position.set(1000,1000,1000);forest.update(camera);
  const far=forest.group.children.find(m=>m.name.startsWith('forest_far_'));
  const sphere=far.boundingSphere;
  for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
    assert.ok(sphere.containsPoint(new T.Vector3(x,y,z)),'CPU bound must cover the source at every billboard rotation');
  }
});

test('sub-eight-metre entry updates, then an empty fade margin provides hysteresis',()=>{
  const forest=build(),camera=new T.PerspectiveCamera();
  const height=bounds.max.y-bounds.min.y,near=42+Math.min(30,height*.2),end=near+22;
  camera.position.copy(bounds.getCenter(new T.Vector3())).setX(bounds.max.x+end+.4);forest.update(camera);
  assert.equal(forest.stats.near,0);
  camera.position.x-=1;forest.update(camera);assert.equal(forest.stats.near,1,'a one metre walk can enter detail');
  camera.position.x+=6;forest.update(camera);assert.equal(forest.stats.near,1,'allocation survives outside the fade boundary');
  camera.position.x=bounds.max.x+near+35;forest.update(camera);assert.equal(forest.stats.near,0);
});

test('LOD overlap conserves coverage and the unchanged core matrix on every approach',()=>{
  const forest=build(),camera=new T.PerspectiveCamera(),matrix=new T.Matrix4();
  const expected=instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale,asset.primitives[0].local);
  for(const distance of [0,40,75,90,110,200,270,310,450,600,90,0]){
    camera.position.copy(bounds.getCenter(new T.Vector3())).setX(bounds.max.x+distance);forest.update(camera);
    let weight=0;
    for(const mesh of forest.group.children.filter(m=>/^forest_(near|mid|far)_/.test(m.name))){
      for(let i=0;i<mesh.count;i++){
        mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every((n,j)=>Math.abs(n-expected.elements[j])<1e-4));
        const range=mesh.geometry.attributes.forestInterval;const lo=range.getX(i),hi=range.getY(i);
        assert.ok(lo>=0&&hi<=1&&hi>=lo);weight+=hi-lo;
      }
    }
    assert.ok(Math.abs(weight-1)<1e-6,`coverage at ${distance}: ${weight}`);
  }
});

test('middle crown has spatial volume and distant trees survive every selection',()=>{
  const forest=build(),camera=new T.PerspectiveCamera();camera.position.copy(bounds.getCenter(new T.Vector3())).setX(bounds.max.x+170);forest.update(camera);
  assert.equal(forest.stats.mid,1);assert.equal(forest.stats.near,0);
  const mid=forest.group.children.find(m=>m.name.startsWith('forest_mid_'));
  const size=mid.geometry.boundingBox.getSize(new T.Vector3());assert.ok(size.x>1&&size.y>1&&size.z>1);
  camera.position.set(20000,20000,20000);forest.update(camera);assert.equal(forest.stats.far,1);
});

test('changing near/proxy casters and restoration invalidate cached shadows',()=>{
  const forest=build(),camera=new T.PerspectiveCamera();camera.position.copy(bounds.getCenter(new T.Vector3()));forest.update(camera);
  const revision=forest.stats.shadowRevision;assert.ok(revision>0);
  camera.position.x=bounds.max.x+170;forest.update(camera);assert.equal(forest.stats.shadowProxies,1);assert.ok(forest.stats.shadowRevision>revision);
  const next=forest.stats.shadowRevision;forest.rebuildImpostors(new T.Vector3(-.4,.8,-.4));assert.ok(forest.stats.shadowRevision>next);
  const near=forest.group.children.find(m=>m.name.startsWith('forest_near_'));assert.ok(near.castShadow&&near.receiveShadow);
  assert.ok(!forest.group.children.find(m=>m.name.startsWith('forest_far_')).castShadow,'cards must not cast camera-facing plane shadows');
});

import {buildTreeGroundShadows,treeLodDistances,treeLodWeights} from '../src3d/forest.js';
test('size-aware fade weights stay complementary, monotone and bounded',()=>{
  const limits=treeLodDistances(bounds),small=treeLodDistances(new T.Box3(new T.Vector3(),new T.Vector3(8,20,8)));
  assert.ok(limits.near>small.near&&limits.mid>small.mid);
  let previousNear=1,previousFar=0;
  for(let distance=0;distance<700;distance+=.7){const weights=treeLodWeights(distance,limits);assert.ok(weights.every(w=>w>=0&&w<=1));assert.ok(Math.abs(weights.reduce((a,b)=>a+b)-1)<1e-12);assert.ok(weights[0]<=previousNear&&weights[2]>=previousFar);[previousNear,,previousFar]=weights;}
});
test('coarse ground shadows follow slopes, source transforms and light changes without accumulation',()=>{
  const ground={height:(x,y)=>.15*x+.09*y};
  const village={...tree,kind:'arboreal_tree',asset:'arboreal/test.glb',position_m:[160,80,31]};
  const shadows=buildTreeGroundShadows({instances:[tree,village]},{[path]:asset,'arboreal/test.glb':asset},ground);
  const golden=new T.Vector3(-.64,.48,-.55).normalize(),day=new T.Vector3(-.35,.84,-.42).normalize();
  shadows.setSun(golden);assert.equal(shadows.stats.patches,2);
  const first=shadows.group.children[0].geometry.attributes.position.array.slice();
  for(const mesh of shadows.group.children){const p=mesh.geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-ground.height(p.getX(i),-p.getZ(i))-.12)<1e-4);}
  assert.equal(shadows.setSun(golden),false);assert.equal(shadows.stats.revision,1);
  shadows.setSun(day);assert.equal(shadows.stats.patches,2);assert.equal(shadows.stats.revision,2);assert.notDeepEqual(shadows.group.children[0].geometry.attributes.position.array,first);
});

test('rebaking for a sun preset or restoration does not apply the instance-only fade to source pixels',()=>{
  let renders=0;
  const bakeRenderer={...renderer,render(scene){
    const mesh=scene.children.find(c=>c.isMesh),shader={uniforms:{},vertexShader:'#include <begin_vertex>\n#include <project_vertex>',fragmentShader:'#include <alphatest_fragment>'};
    mesh.material.onBeforeCompile(shader);renders++;
    assert.ok(!shader.vertexShader.includes('forestInterval'),'a source bake has no per-instance coverage attribute');
  }};
  const forest=buildStylizedForest({instances:[tree]},{[path]:asset},bakeRenderer);
  forest.rebuildImpostors(new T.Vector3(-.4,.8,-.4));assert.ok(renders>=4);
});

test('an authored world-space source keeps its real horizontal origin in all three representations',()=>{
  const shifted={...asset,primitives:asset.primitives.map(p=>({...p,geometry:p.geometry.clone().translate(900,200,-600)}))};
  const forest=buildStylizedForest({instances:[{...tree,tags:['world_space']}]},{[path]:shifted},renderer);
  for(const mesh of forest.group.children){
    const centre=mesh.geometry.boundingBox.getCenter(new T.Vector3());
    assert.ok(centre.x>850&&centre.x<950&&centre.z<-550&&centre.z>-650,`${mesh.name} retained the source origin`);
  }
  const camera=new T.PerspectiveCamera();camera.position.set(900,300,-600);forest.update(camera);assert.equal(forest.stats.near,1);
});

test('the bank-planting caller still accepts its non-tree sources',()=>{
  const habitats=JSON.parse(readFileSync(new URL('../../../shared/ecology/habitats.json',import.meta.url)));
  const record=habitats.plantings[0],path=record.asset;
  const bankAsset=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)));
  const planting={...record,scale:[record.scale,record.scale,record.scale]};
  const plants=buildStylizedForest({instances:[planting]},{[path]:bankAsset},renderer,{filter:()=>true,name:'bank_plantings',enterM:85,leaveM:110});
  const camera=new T.PerspectiveCamera();camera.position.set(record.position_m[0],record.position_m[2]+2,-record.position_m[1]);plants.update(camera);
  assert.equal(plants.stats.near,1);assert.ok(plants.group.children.every(m=>!m.name.startsWith('forest_mid_')),'tree-only middle crowns must not replace reeds/rocks');
});

test('the actual largest published giant remains spatial just above its crown',()=>{
  const placement=JSON.parse(readFileSync(new URL('../../../shared/world/out/placement.json',import.meta.url)));
  const giant=placement.instances.filter(t=>t.asset===path).sort((a,b)=>b.scale[2]-a.scale[2])[0];
  const forest=build(giant),camera=new T.PerspectiveCamera();
  const box=source.clone().applyMatrix4(instanceMatrix(giant.position_m,giant.yaw_deg,giant.scale));
  camera.position.copy(box.getCenter(new T.Vector3())).setY(box.max.y+14);forest.update(camera);
  assert.equal(forest.stats.near,1,'the published giant must be a shared mesh at a 14 m crown clearance');
});

import {clusteredTreeGeometry} from '../src3d/forest.js';
test('middle meshes retain source colour/space with a bounded triangle budget',()=>{
  const shared=build().group.children.find(m=>m.name.startsWith('forest_near_')).geometry;
  const middle=clusteredTreeGeometry(shared),p=middle.geometry.attributes.position,c=middle.geometry.attributes.color;
  assert.ok(middle.triangles>0&&middle.triangles<=8000&&middle.triangles<shared.attributes.position.count/3/4,'middle source mesh has a strict submission budget');
  assert.equal(c.itemSize,4);let bark=false,leaves=false;
  for(let i=0;i<p.count;i++){
    assert.ok(source.containsPoint(new T.Vector3(p.getX(i),p.getY(i),p.getZ(i))),'simplification stays in the source envelope');
    leaves||=c.getY(i)>c.getX(i)*1.1;bark||=c.getX(i)>c.getY(i);
  }
  assert.ok(bark&&leaves,'source bark and foliage colours both survive');
});

test('a bounded projection miss retains local under-canopy darkening',()=>{
  const ground={height:(x,y)=>Math.abs(x-120)<40&&Math.abs(y-50)<40?30:null};
  const shadows=buildTreeGroundShadows({instances:[tree]},{[path]:asset},ground);
  shadows.setSun(new T.Vector3(-.64,.48,-.55).normalize());
  assert.equal(shadows.stats.contactFallbacks,1);assert.equal(shadows.stats.patches,1,'a bounded ray miss must not silently remove all tree ground support');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {checkLodGeometry,inspectLodGeometry,checkVisualLods} from '../tools/lod-contract.mjs';
import {parseGLB} from '../src3d/glb.js';
import {buildRockLod} from '../src3d/rock-lod.js';
import {instanceMatrix} from '../src3d/world.js';

test('the reusable geometry contract rejects bad indices, nonfinite data, flattened volume and shifted contact',()=>{
 const reference=new T.BoxGeometry(2,4,2).translate(0,2,0),reduced=reference.clone();
 assert.equal(checkLodGeometry([reference,reduced],{anchorPolicy:'base-centroid',anchorToleranceM:.001})[1].anchorErrorM,0);
 const shifted=reduced.clone().translate(3,0,0);assert.throws(()=>checkLodGeometry([reference,shifted],{anchorPolicy:'base-centroid',anchorToleranceM:.001}),/ground contact shifted/);
 const flat=reduced.clone().scale(1,1,0);assert.throws(()=>inspectLodGeometry(flat),/lost an axis/);
 assert.equal(inspectLodGeometry(flat,{requireVolume:false}).size[2],0,'planar representations must declare that policy explicitly');
 const nan=reduced.clone();nan.attributes.position.setX(0,NaN);assert.throws(()=>inspectLodGeometry(nan),/Nonfinite/);
 const index=reduced.clone();index.index.setX(0,index.attributes.position.count);assert.throws(()=>inspectLodGeometry(index),/outside vertex/);
 assert.throws(()=>checkLodGeometry([reference,reduced]),/Declare a finite/);
 for(const g of [reference,reduced,shifted,flat,nan,index])g.dispose();
});

test('actual river rock and gravel LODs retain volume and bounded ground contact',()=>{
 for(const path of ['waterside/river_rock.glb','waterside/gravel.glb']){
  const asset=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url))),record={asset:path,position_m:[11,23,7],yaw_deg:37,scale:[1.3,1.65,1.1]},rocks=buildRockLod([record],{[path]:asset});
  try{
   const geometries=[0,1,2].map(lod=>rocks.group.children.find(m=>m.name.startsWith('rock_lod'+lod+'_')).geometry);
   // A multi-stone cluster has no unique trunk-like base center. Its support
   // height and authored instance origin are separate, explicit obligations.
   const report=checkLodGeometry(geometries,{anchorPolicy:'support-height',anchorToleranceM:.12});
   assert(report[2].triangles<report[0].triangles);
   const camera=new T.PerspectiveCamera(),matrix=new T.Matrix4(),expected=instanceMatrix(record.position_m,record.yaw_deg,record.scale,asset.primitives[0].local),seen=new Set();
   for(const distance of [0,50,200,2000]){camera.position.set(11,10,distance-23);rocks.update(camera);for(const mesh of rocks.group.children)if(mesh.count){mesh.getMatrixAt(0,matrix);matrix.elements.forEach((v,i)=>assert(Math.abs(v-expected.elements[i])<1e-5,'LOD keeps rotated/nonuniform instance placement'));seen.add(mesh.name.match(/rock_lod(\d)/)[1]);}}
   assert.equal(seen.size,3,'exercise placement through every actual rock stage');
  }finally{rocks.dispose();}
 }
});

test('visual drift guard catches blank/dark/degraded trees even if final stages agree',()=>{
 const baseline={species:'fixture',asset:'fixture',anchorPolicy:'trunk-base',sampleSize:256,rotation:0,stretch:false,cases:[{yaw:0,elevation:0,pixels:180,counts:[100,100,100,100],meanColor:Array.from({length:4},()=>[30,60,20]),adjacentMismatch:[.1,.1,0],rootDriftM:[0,0,0,0]}]},limits={coveragePixels:4,coverageFraction:.15,colorBytes:5,colorFraction:.2,silhouetteIncrease:.06,rootMeters:.5};
 assert.equal(checkVisualLods(structuredClone(baseline),baseline,limits),1);
 for(const [mutate,pattern]of [[a=>a.cases[0].counts.fill(0),/coverage drift/],[a=>a.cases[0].meanColor.forEach(c=>c.fill(0)),/color drift/],[a=>a.cases[0].adjacentMismatch[1]=.6,/silhouette degradation/],[a=>a.cases[0].rootDriftM[3]=3,/root drift/],[a=>a.cases=[],/case coverage/]]){const changed=structuredClone(baseline);mutate(changed);assert.throws(()=>checkVisualLods(changed,baseline,limits),pattern);}
});

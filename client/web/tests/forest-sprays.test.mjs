import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import{createHash}from'node:crypto';
import{FOREST_PROFILES,forestRecipe,buildForestSprays,fitForestCrown}from'../../../shared/geometry/tree-design/forest-sprays.js';
import{rasterSprayAtlas}from'../../../shared/geometry/tree-design/redwood-sprays.js';
const hash=a=>createHash('sha256').update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
function reversed(tree){let bad=0,leaves=0;const p=tree.positions,n=tree.normals;for(let i=tree.branchIndexCount;i<tree.indices.length;i+=3){const [a,b,c]=tree.indices.subarray(i,i+3),u=[0,1,2].map(k=>p[b*3+k]-p[a*3+k]),v=[0,1,2].map(k=>p[c*3+k]-p[a*3+k]),face=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(face.reduce((s,x,k)=>s+x*(n[a*3+k]+n[b*3+k]+n[c*3+k]),0)<-1e-10)bad++;leaves++;}return {bad,leaves};}
test('all species have connected irregular crowns, coherent LODs and outward leaf normals',()=>{
 const signatures=new Set();for(const[species,p]of Object.entries(FOREST_PROFILES)){
  const a=buildForestSprays(p,0),b=buildForestSprays(p,1);signatures.add(hash(a.positions));
  assert.deepEqual(a.structure.branchTips,b.structure.branchTips);assert.deepEqual(a.fitBounds,b.fitBounds);for(let i=0;i<a.positions.length;i++)assert(a.positions[i]>=a.fitBounds.min[i%3]-1e-4&&a.positions[i]<=a.fitBounds.max[i%3]+1e-4);for(let i=0;i<b.positions.length;i++)assert(b.positions[i]>=b.fitBounds.min[i%3]-1e-4&&b.positions[i]<=b.fitBounds.max[i%3]+1e-4);assert.equal(a.structure.sprays,b.structure.sprays);assert(a.structure.omittedBranches>0);assert(a.structure.deadBranches>0);
  assert(a.positions.every(Number.isFinite));assert(a.normals.every(Number.isFinite));assert(a.indices.every(i=>i<a.positions.length/3));assert(a.leafKind.includes(1)&&a.leafKind.includes(2));assert(!b.leafKind.includes(1));assert(b.structure.triangles<a.structure.triangles/5);
  const facing=reversed(a);assert.equal(facing.bad,0,species+' normals must agree with actual triangle winding');assert.equal(reversed(b).bad,0);
  const perBand=Array.from({length:8},()=>[]);for(const[x,y,z]of a.structure.branchTips){const f=(y/p.heightM-p.crownBase)/(1-p.crownBase),band=Math.max(0,Math.min(7,Math.floor(f*8)));perBand[band].push(Math.hypot(x,z));}
  assert(perBand.some(r=>r.length>3&&Math.max(...r)/Math.min(...r)>1.5),'crown reaches cannot collapse to an ideal cone');
  const unbroken=buildForestSprays({...p,crownGaps:0,deadwood:0},1);assert.equal(unbroken.structure.omittedBranches,0);assert.equal(unbroken.structure.deadBranches,0);
  const edited=buildForestSprays({...p,seed:p.seed+1},1);assert.notEqual(hash(b.positions),hash(edited.positions));
 }
 assert.equal(signatures.size,4);
});
test('pine fascicles, fir combs and redwood sprays have distinct porous alpha silhouettes',()=>{
 const fingerprints=new Set();for(const profile of ['redwood','pine','fir']){const a=rasterSprayAtlas(undefined,profile),alpha=[];let transparent=0,opaque=0;for(let i=3;i<a.pixels.length;i+=4){alpha.push(a.pixels[i]);transparent+=a.pixels[i]===0;opaque+=a.pixels[i]>200;}fingerprints.add(hash(new Uint8Array(alpha)));assert(transparent>a.width*a.height*.4);assert(opaque>a.width*a.height*.07);}
 assert.equal(fingerprints.size,3);
});
test('fitting anchors branch roots on the bole, respects asymmetric bounds and transforms normals exactly',()=>{
 const bounds={min:[-5,30,-3],max:[7,90,4]},positions=new Float32Array([-2,0,-1,3,10,2,0,4,0,1,2,1,1,2.01,1,1,2,1.01]),normals=new Float32Array(positions.length);for(let i=0;i<normals.length;i+=3)normals[i]=1;
 const fitted=fitForestCrown(positions,normals,bounds);assert.equal(fitted.positions[6],0);assert.equal(fitted.positions[8],0);assert.deepEqual(Array.from(fitted.normals.slice(9,12)),[1,0,0]);
 for(let i=0;i<fitted.positions.length;i++)assert(fitted.positions[i]>=bounds.min[i%3]-1e-5&&fitted.positions[i]<=bounds.max[i%3]+1e-5);
 assert.deepEqual(Array.from(positions.slice(0,3)),[-2,0,-1]);
});

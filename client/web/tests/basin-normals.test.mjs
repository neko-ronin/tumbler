import test from 'node:test';
import assert from 'node:assert/strict';
import {HeightGrid} from '../src3d/heights.js';
import {buildTerrainGeometry} from '../src3d/terrain.js';

function fixture(){
 const n=65,q=8,offset=1000,values=new Float32Array(n*n);
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const distance=x*q,cell=Math.floor(distance/56),f=distance/56-cell;
  values[y*n+x]=cell*32+f*(cell%2?52:12)+y*.8;
 }
 return new HeightGrid({resolution:n,quad_size_m:q,offset_xy_m:[offset,2200],values});
}
const region={centre:[1256,2456],radii:[240,240],edgeBlend:.25,radiusM:56};

test('integrated native-cell normals remove the sharp slope steps without moving any terrain vertex',()=>{
 const grid=fixture(),a=buildTerrainGeometry(grid).geometry,b=buildTerrainGeometry(grid,{normalRegion:region}).geometry;
 try{
  for(const attribute of ['position','color'])assert.deepEqual(b.attributes[attribute].array,a.attributes[attribute].array);
  assert.deepEqual(b.index.array,a.index.array);
  const jumps=geometry=>{const n=geometry.attributes.normal.array,values=[];for(let x=23;x<41;x++){const i=(32*65+x)*3,j=i+3;values.push(Math.hypot(n[i]-n[j],n[i+1]-n[j+1],n[i+2]-n[j+2]));}return Math.max(...values);};
  assert.ok(jumps(b)<jumps(a)*.6,`${jumps(b)} versus ${jumps(a)}`);
  for(let y=0;y<65;y++)for(let x=0;x<65;x++)if(Math.hypot((1000+x*8-1256)/240,(2200+y*8-2456)/240)>1.1){
   const i=(y*65+x)*3;assert.deepEqual(b.attributes.normal.array.slice(i,i+3),a.attributes.normal.array.slice(i,i+3));
  }
 }finally{a.dispose();b.dispose();}
});

test('the protected southern edge keeps its original shading as well as its physical floor',()=>{
 const grid=fixture(),a=buildTerrainGeometry(grid).geometry,b=buildTerrainGeometry(grid,{normalRegion:{...region,southM:2456}}).geometry;
 try{for(let y=0;y<32;y++)for(let x=0;x<65;x++){const i=(y*65+x)*3;assert.deepEqual(a.attributes.normal.array.slice(i,i+3),b.attributes.normal.array.slice(i,i+3));}}
 finally{a.dispose();b.dispose();}
});

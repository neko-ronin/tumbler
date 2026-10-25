import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {decodeGroundCover,mergeGroundCover,landscapeHeightGrid,HeightGrid,GroundSampler} from '../src3d/heights.js';
import {buildTerrainLod} from '../src3d/terrain-lod.js';
import * as T from '../vendor/three.module.min.js';
const repo=new URL('../../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,repo));
const manifest=JSON.parse(read('client/web/data/viewer.json'));
const block=new HeightGrid({...manifest.height_grids.block,values:new Float32Array(Uint8Array.from(read('client/web/data/heightmap.f32')).buffer)});
const far=new HeightGrid({...manifest.height_grids.far_field,values:new Float32Array(Uint8Array.from(read('client/web/data/farfield.f32')).buffer)});
const transition=JSON.parse(read('shared/world/out/landscape_transition.json'));

test('outer habitat continues across dry block edges while primary exclusions retain ownership',()=>{
 const primary={covered:new Uint8Array(4*4).fill(1),resolution:4,quad:8,offsetX:-16,offsetY:-16};primary.covered[5]=0;
 const outer={covered:new Uint8Array(8*8).fill(1),resolution:8,quad:8,offsetX:-32,offsetY:-32};
 const merged=mergeGroundCover(primary,outer),at=(x,y)=>merged.covered[Math.floor((y-merged.offsetY)/8)*merged.resolution+Math.floor((x-merged.offsetX)/8)];
 assert.equal(at(-4,-4),0,'an outer grass stamp cannot fill a primary path/water/home exclusion');
 assert.equal(at(12,4),1);assert.equal(at(20,4),1,'grass continues outside the old square');
 assert.deepEqual(primary.covered,new Uint8Array([1,1,1,1,1,0,1,1,1,1,1,1,1,1,1,1]));
});

test('published grass joins all four lowland edges without inventing cover on rock or water',()=>{
 const primary=decodeGroundCover(JSON.parse(read('shared/world/out/ground_cover.json'))),outer=decodeGroundCover(transition.grass),merged=mergeGroundCover(primary,outer);
 const at=(cover,x,y)=>{const c=Math.floor((x-cover.offsetX)/cover.quad),r=Math.floor((y-cover.offsetY)/cover.quad);return c>=0&&r>=0&&c<cover.resolution&&r<cover.resolution?cover.covered[r*cover.resolution+c]:0;};
 let adjacent=0;
 for(let k=-1900;k<=1900;k+=56)for(const [a,b]of [[[-2036,k],[-2060,k]],[[2036,k],[2060,k]],[[k,-2036],[k,-2060]],[[k,2036],[k,2060]]]){
  if(!at(primary,...a)||!at(outer,...b))continue;
  assert.equal(at(merged,...a),1);assert.equal(at(merged,...b),1);adjacent++;
 }
 assert.ok(adjacent>70,'the continuation must have a real subject on the current map');
 let copied=0;for(let row=0;row<primary.resolution;row+=5)for(let col=0;col<primary.resolution;col+=5){
  const x=primary.offsetX+(col+.5)*primary.quad,y=primary.offsetY+(row+.5)*primary.quad;assert.equal(at(merged,x,y),primary.covered[row*primary.resolution+col]);copied++;
 }
 assert.ok(copied>10000);
});

test('one terrain lattice preserves every original height and continuously represents the shared sampler',()=>{
 const grid=landscapeHeightGrid(block,far),sampler=new GroundSampler(block,far);
 for(let row=0;row<block.resolution;row++)for(let col=0;col<block.resolution;col++)assert.equal(grid.sample(block.offsetX+col*8,block.offsetY+row*8),block.at(row,col));
 for(let k=-1900;k<=1900;k+=56)for(const [x,y]of [[2044,k],[-2044,k],[k,2044],[k,-2044],[2052,k],[-2052,k],[k,2052],[k,-2052]])assert.ok(Math.abs(grid.sample(x,y)-sampler.height(x,y))<.00015);
 const smallBlock=new HeightGrid({resolution:17,quad_size_m:8,offset_xy_m:[-64,-64],values:new Float32Array(17*17).fill(40)}),smallFar=new HeightGrid({resolution:33,quad_size_m:8,offset_xy_m:[-128,-128],values:new Float32Array(33*33).fill(40)});
 const terrain=buildTerrainLod(landscapeHeightGrid(smallBlock,smallFar)),camera=new T.PerspectiveCamera(62,1.6,.1,10000);camera.position.set(0,400,500);terrain.update(camera);
 try{assert.equal(terrain.stats.tiles,1);assert.ok(terrain.stats.maxProjectedError<=2.3);}finally{terrain.dispose();}
});

test('terrain batches submit the exact same selected triangles with shared vertices and retained buffers',()=>{
 const n=65,grid=new HeightGrid({resolution:n,quad_size_m:8,offset_xy_m:[0,0],values:Float32Array.from({length:n*n},(_,i)=>Math.sin(i%n*.14)*12+Math.cos(Math.floor(i/n)*.17)*17)});
 const separate=buildTerrainLod(grid),batched=buildTerrainLod(grid,{batchTiles:2}),camera=new T.PerspectiveCamera(62,1.6,.1,20000),buffers=batched.group.children.map(m=>m.geometry.index);
 const faces=terrain=>{const result=[];for(const mesh of terrain.group.children){const g=mesh.geometry,p=g.attributes.position;for(let i=0;i<Math.min(g.index.count,g.drawRange.count);i+=3)result.push([0,1,2].map(k=>{const id=g.index.getX(i+k);return [p.getX(id),p.getY(id),p.getZ(id)].join(',');}).join('|'));}return result.sort();};
 try{
  for(const pose of [[100,40,-100],[100,4000,4000],[400,100,-300]]){camera.position.fromArray(pose);separate.update(camera);batched.update(camera);assert.deepEqual(faces(batched),faces(separate));}
  assert.equal(batched.stats.batches,1);assert.equal(separate.group.children.length,4);
  batched.group.children.forEach((m,i)=>assert.equal(m.geometry.index,buffers[i]));
  assert.ok(batched.stats.maxProjectedError<=2.3);
 }finally{separate.dispose();batched.dispose();}
});

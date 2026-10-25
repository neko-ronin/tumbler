import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {HeightGrid} from '../src3d/heights.js';
import {terrainTileLevels,buildTerrainLod} from '../src3d/terrain-lod.js';
import {buildRockLod} from '../src3d/rock-lod.js';
import {parseGLB} from '../src3d/glb.js';
import {instanceMatrix} from '../src3d/world.js';
const gridFor=(n=65)=>new HeightGrid({resolution:n,quad_size_m:8,offset_xy_m:[0,0],values:Float32Array.from({length:n*n},(_,i)=>Math.sin(i%n*.19)*18+Math.cos(Math.floor(i/n)*.17)*15+(i%n)*.2)});

test('every terrain LOD covers the tile once and retains every source rim segment',()=>{
 const grid=gridFor();
 for(const size of [32,31,17]){
  const levels=terrainTileLevels(grid,0,0,size,size),n=size+1;
  for(const level of levels){
   const edges=new Map();let area=0;
   for(let i=0;i<level.index.count;i+=3){
    const ids=[0,1,2].map(k=>level.index.getX(i+k)),p=ids.map(id=>[id%n,Math.floor(id/n)]);
    const twice=(p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]);
    assert.ok(twice>0,'all triangles face upward and have area');area+=twice/2;
    for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');edges.set(key,(edges.get(key)??0)+1);}
   }
   assert.equal(area,size*size);
   for(const [key,count]of edges){
    assert.ok(count<=2,'no overlapping faces');if(count===2)continue;
    const [a,b]=key.split(',').map(Number),ax=a%n,ay=Math.floor(a/n),bx=b%n,by=Math.floor(b/n);
    assert.ok((ax===bx&&(ax===0||ax===size))||(ay===by&&(ay===0||ay===size)),'only the outer rim is open');
    assert.equal(Math.abs(ax-bx)+Math.abs(ay-by),1,'a coarse neighbor retains every original rim segment');
   }
   assert.ok(Number.isFinite(level.error));
  }
  assert.ok(levels.at(-1).triangles<levels[0].triangles/5,'distant interior is substantially cheaper');
 }
});

test('terrain LOD uses only core samples, stays fine nearby, and reuses its GPU index buffer',()=>{
 const grid=gridFor(),terrain=buildTerrainLod(grid),camera=new T.PerspectiveCamera(62,1.6,.1,20000);
 const first=terrain.tiles[0],index=first.mesh.geometry.index;
 try{
  for(const {mesh}of terrain.tiles){const p=mesh.geometry.attributes.position;
   for(let i=0;i<p.count;i++)assert.ok(Math.abs(p.getY(i)-grid.sample(p.getX(i),-p.getZ(i)))<1e-6);
  }
  camera.position.set(100,40,-100);terrain.update(camera);assert.equal(first.level,0);
  camera.position.set(100,4000,4000);terrain.update(camera);
  assert.ok(terrain.stats.triangles<terrain.stats.sourceTriangles*.35);
  assert.ok(terrain.stats.maxProjectedError<=2.3);
  assert.equal(first.mesh.geometry.index,index,'LOD changes do not allocate orphaned GPU index buffers');
  camera.position.set(100,40,-100);terrain.update(camera);assert.equal(first.level,0);
  assert.equal(first.mesh.geometry.drawRange.count,first.levels[0].index.count);
 }finally{terrain.dispose();}
});

test('bank rocks keep spatial source geometry, source transforms and complementary LOD coverage',()=>{
 const path='waterside/river_rock.glb',asset=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)));
 const records=[0,1,2].map(i=>({asset:path,position_m:[i*3,0,30],yaw_deg:i*17,scale:[1,1,1]}));
 const rocks=buildRockLod(records,{[path]:asset}),camera=new T.PerspectiveCamera(),m=new T.Matrix4();
 try{
  const levels=rocks.stats.levels[path];assert.ok(levels[1]<levels[0]&&levels[2]<levels[1]);
  for(const distance of [0,30,80,150,700]){
   camera.position.set(0,30,distance);rocks.update(camera);const coverage=new Map();
   for(const mesh of rocks.group.children){
    const box=mesh.geometry.boundingBox,size=box.getSize(new T.Vector3());assert.ok(size.x>0&&size.y>0&&size.z>0,'even the distant level is a volume');
    for(let i=0;i<mesh.count;i++){
     mesh.getMatrixAt(i,m);const record=records.find(r=>Math.abs(r.position_m[0]-m.elements[12])<.001);assert.ok(record);
     const expected=instanceMatrix(record.position_m,record.yaw_deg,record.scale,asset.primitives[0].local);
     m.elements.forEach((n,k)=>assert.ok(Math.abs(n-expected.elements[k])<1e-5));
     const interval=mesh.geometry.attributes.forestInterval,weight=interval.getY(i)-interval.getX(i),key=record.position_m[0];coverage.set(key,(coverage.get(key)??0)+weight);
    }
   }
   for(const r of records)assert.ok(Math.abs(coverage.get(r.position_m[0])-1)<1e-5,'one stone remains fully represented through each transition');
  }
 }finally{rocks.dispose();}
});

test('the refined granite source contains three closed, outward stone volumes',()=>{
 const asset=parseGLB(readFileSync(new URL('../../../shared/geometry/waterside/river_rock.glb',import.meta.url)));
 const g=asset.primitives.find(p=>p.materialName==='river_stone').geometry,p=g.attributes.position,edges=new Map(),parent=new Map(),faces=[];
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(6)).join(',');
 const root=k=>{if(!parent.has(k))parent.set(k,k);if(parent.get(k)!==k)parent.set(k,root(parent.get(k)));return parent.get(k);};
 for(let i=0;i<(g.index?.count??p.count);i+=3){
  const ids=[0,1,2].map(k=>g.index?g.index.getX(i+k):i+k),keys=ids.map(key);
  parent.set(root(keys[1]),root(keys[0]));parent.set(root(keys[2]),root(keys[0]));
  for(let k=0;k<3;k++){const edge=[keys[k],keys[(k+1)%3]].sort().join('|');edges.set(edge,(edges.get(edge)??0)+1);}
  const [a,b,c]=ids.map(id=>new T.Vector3().fromBufferAttribute(p,id));
  assert.ok(new T.Vector3().crossVectors(b.clone().sub(a),c.clone().sub(a)).length()>1e-10,'no collapsed faces');
  faces.push({key:keys[0],volume:a.dot(new T.Vector3().crossVectors(b,c))/6});
 }
 assert.ok([...edges.values()].every(n=>n===2),'the stone shell has no open or nonmanifold edge');
 const volumes=new Map();for(const face of faces){const component=root(face.key);volumes.set(component,(volumes.get(component)??0)+face.volume);}
 assert.equal(volumes.size,3);assert.ok([...volumes.values()].every(v=>v>0),'all three closed shells face outward');
});

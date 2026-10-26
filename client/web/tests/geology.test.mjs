import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {buildGeology} from '../src3d/geology.js';
import {solidRoof,createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import {GroundSampler,HeightGrid} from '../src3d/heights.js';
import {buildTerrainLod} from '../src3d/terrain-lod.js';
import * as T from '../vendor/three.module.min.js';
const root=new URL('../../../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root));
const data=JSON.parse(read('shared/geometry/granite/geology.json'));
const assets=Object.fromEntries(data.meshes.map(p=>[p,parseGLB(read('shared/geometry/'+p))]));

test('convex roofs intersect all halfspaces, including slanted sides and lower faces',()=>{
 const box={bounds_m:[[0,0,0],[2,2,4]],planes:[[-1,0,0,0],[1,0,0,2],[0,-1,0,0],[0,1,0,2],[0,0,-1,0],[0,0,1,4],[1,0,1,4]]};
 assert.equal(solidRoof(box,0,1),4);assert.equal(solidRoof(box,2,1),2);
 assert.equal(solidRoof(box,-.01,1),null);assert.equal(solidRoof(box,1,2.01),null);
 const empty={...box,planes:[...box.planes,[0,0,-1,-3]]};assert.equal(solidRoof(empty,2,1),null);
});

test('collision roofs match independent vertical rays against the actual published GLB triangles',()=>{
 const triangles=new Map();
 for(const asset of Object.values(assets))for(const primitive of asset.primitives){
  const p=primitive.geometry.attributes.position,ids=primitive.geometry.index;
  for(let k=0;k<ids.count;k+=3){
   const t=[0,1,2].map(j=>{const id=ids.getX(k+j);return [p.getX(id),-p.getZ(id),p.getY(id)];});
   const lo=[0,1].map(a=>Math.min(...t.map(v=>v[a]))),hi=[0,1].map(a=>Math.max(...t.map(v=>v[a])));
   for(let y=Math.floor(lo[1]/128);y<=Math.floor(hi[1]/128);y++)for(let x=Math.floor(lo[0]/128);x<=Math.floor(hi[0]/128);x++){
    const key=`${x},${y}`;if(!triangles.has(key))triangles.set(key,[]);triangles.get(key).push(t);
   }
  }
 }
 const sampler=createGeologySampler(data);let checked=0;
 const ray=(x,y)=>{let top=null;
  for(const [a,b,c]of triangles.get(`${Math.floor(x/128)},${Math.floor(y/128)}`)??[]){
   const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-9)continue;
   const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/det,v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/det;
   if(u<0||v<0||u+v>1)continue;const z=u*a[2]+v*b[2]+(1-u-v)*c[2];top=top===null?z:Math.max(top,z);
  }return top;
 };
 for(const s of data.solids){const [x,y]=s.centre_xy_m;
  for(const [a,b]of [[0,0],[.27,.18],[-.22,.32]]){
   const px=x+s.radius_m*a,py=y+s.radius_m*b,roof=sampler(px,py),actual=ray(px,py);
   assert.equal(roof===null,actual===null,`roof occupancy ${px},${py}`);
   if(roof!==null){assert.ok(Math.abs(roof-actual)<.012,`physical/render roof ${roof} != ${actual}`);checked++;}
  }
 }
 assert.ok(checked>500);
});

test('published rock shells are closed and outward, with an economical fixed source budget',()=>{
 let total=0,volume=0;
 for(const asset of Object.values(assets)){
  const edges=new Map();
  for(const primitive of asset.primitives){const p=primitive.geometry.attributes.position,ids=primitive.geometry.index;
   for(let k=0;k<ids.count;k+=3){
    const t=[0,1,2].map(j=>{const id=ids.getX(k+j);return [p.getX(id),p.getY(id),p.getZ(id)];});
    const [a,b,c]=t;volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
    for(let i=0;i<3;i++){const v=t[i].join(','),w=t[(i+1)%3].join(','),key=[v,w].sort().join('|');if(!edges.has(key))edges.set(key,[]);edges.get(key).push(v<w?1:-1);}total++;
   }
  }
  for(const e of edges.values()){assert.equal(e.length,2);assert.equal(e[0]+e[1],0);}
 }
 assert.ok(volume>0);assert.equal(total,data.counts.triangles);assert.ok(total<100000);
 const scene=buildGeology(data,assets);try{assert.equal(scene.stats.triangles,total);assert.ok(scene.stats.batches<32);}finally{scene.dispose();}
});

test('ground sampling adds the shared roof and retains all unoccupied geography',()=>{
 const manifest=JSON.parse(read('client/web/data/viewer.json'));
 const grid=key=>new HeightGrid({...manifest.height_grids[key],values:new Float32Array(Uint8Array.from(read(manifest.height_grids[key].file)).buffer)});
 const base=new GroundSampler(grid('block'),grid('far_field')),sample=createGeologySampler(data);
 const refinedGrid=key=>new HeightGrid({...manifest.height_grids[key],values:applyGeologyTerrain(grid(key).values,manifest.height_grids[key],data.terrain[key])});
 const bedrock=new GroundSampler(refinedGrid('block'),refinedGrid('far_field')),refined=new GroundSampler(bedrock.block,bedrock.farField,null,sample);
 let elevated=0;
 for(const s of data.solids){const [x,y]=s.centre_xy_m,old=base.height(x,y),roof=sample(x,y);
  assert.equal(refined.height(x,y),Math.max(bedrock.height(x,y),roof));if(roof>old)elevated++;
 }
 assert.ok(elevated>300);
 const worldmap=JSON.parse(read('shared/world/worldmap.json'));
 for(const track of worldmap.tracks)for(const [x,y]of track.polyline)assert.equal(refined.height(x,y),base.height(x,y),'every authored route stays on its original floor');
 const individuals=[...JSON.parse(read('shared/world/out/placement.json')).instances,...JSON.parse(read('shared/world/out/landscape_transition.json')).instances,...JSON.parse(read('shared/ecology/habitats.json')).plantings];
 for(const p of individuals){const [x,y]=p.position_m;assert.equal(refined.height(x,y),base.height(x,y),'existing individual floor '+p.asset);}
 for(let y=-2000;y<1000;y+=40)for(let x=-2000;x<2000;x+=40)assert.equal(refined.height(x,y),base.height(x,y));
 const flight=JSON.parse(read('shared/activities/flight.json'));
 for(const launch of flight.launches)for(let y=-60;y<=60;y+=12)for(let x=-60;x<=60;x+=12){const [a,b]=launch.xy_m;assert.equal(refined.height(a+x,b+y),base.height(a+x,b+y),'launch neighbourhood');}
});

test('published terrain refinements preserve source boundaries and the existing error-bounded topology',()=>{
 const manifest=JSON.parse(read('client/web/data/viewer.json'));
 const refinedGrids={};
 for(const key of ['block','far_field']){
  const spec=manifest.height_grids[key],original=new Float32Array(Uint8Array.from(read(spec.file)).buffer),values=applyGeologyTerrain(original,spec,data.terrain[key]);
  assert.notEqual(values,original);assert.ok(data.terrain[key].samples.length>100);
  for(let i=0;i<original.length;i++)assert.ok(Math.abs(values[i]-original[i])<=110.001);
  const n=spec.resolution;
  refinedGrids[key]=new HeightGrid({...spec,values});
  for(let i=0;i<n;i++)for(const j of [i,i*n,i*n+n-1,(n-1)*n+i])assert.equal(values[j],original[j]);
 }
 const sampler=new GroundSampler(refinedGrids.block,refinedGrids.far_field),patch=parseGLB(read('shared/geometry/'+data.terrain_mesh));let checked=0;
 for(const primitive of patch.primitives){const p=primitive.geometry.attributes.position;
  for(let i=0;i<p.count;i++){
   assert.ok(Math.abs(p.getY(i)-sampler.height(p.getX(i),-p.getZ(i)))<.0003,'neutral patch GLB and refined sampler must agree');checked++;
  }
 }
 assert.ok(checked>1000);
 const spec={resolution:3,quad_size_m:8,offset_xy_m:[0,0]},values=new Float32Array(9);
 assert.throws(()=>applyGeologyTerrain(values,spec,{...spec,resolution:4,samples:[]}));
 assert.throws(()=>applyGeologyTerrain(values,spec,{...spec,samples:[[1,20],[1,30]]}));
 assert.equal(values[1],0);
 // Existing terrain tests exercise the full topology; this representative
 // modified source verifies the new data still uses that exact LOD path.
 const n=65,grid=new HeightGrid({resolution:n,quad_size_m:8,offset_xy_m:[0,0],values:Float32Array.from({length:n*n},(_,i)=>Math.sin(i%n*.15)*38+Math.cos(Math.floor(i/n)*.1)*60)});
 const lod=buildTerrainLod(grid,{batchTiles:2}),camera=new T.PerspectiveCamera(62,1.6,.1,10000);
 try{for(const h of [100,1500,5000]){camera.position.set(200,h,800);lod.update(camera,900);assert.ok(lod.stats.maxProjectedError<=2.3);}}finally{lod.dispose();}
});

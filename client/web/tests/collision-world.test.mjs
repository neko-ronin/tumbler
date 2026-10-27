import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {instanceMatrix} from '../src3d/world.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {surfaceGap} from '../../../shared/activities/collision.js';
import {trunkRadiusAt} from '../../../shared/activities/climb.js';
const placement=JSON.parse(readFileSync(new URL('../../../shared/world/out/placement.json',import.meta.url)));
const parsed=new Map(),glb=p=>{if(!parsed.has(p)){const b=readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url));parsed.set(p,parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}return parsed.get(p);};
const world=instances=>buildWorldCollision({instances},Object.fromEntries(instances.map(i=>[i.asset,glb(i.asset)])));
const first=asset=>placement.instances.find(i=>i.asset===asset);

test('a pine is solid only at its bark',()=>{
 const pine=first('redwood/mountain_pine.glb'),hit=world([pine]);
 const [x,y,z]=pine.position_m,[trunk]=hit.near([x,y,z+1],3).filter(s=>s.trunk),t=trunk.trunk;
 const mid=(t.base_z+t.top_z)/2,r=trunkRadiusAt(t,mid),p=[x+r+.36,y,mid];
 assert.equal(hit(p,p,.35),null,'free 1 cm beyond the radius halfway up');
 assert.ok(trunkRadiusAt(t,t.base_z)+.35>r+.36,'the old root-flare box would have blocked here');
 assert.ok(hit([x+r+.3,y,mid],[x+r+.3,y,mid],.35),'blocked 5 cm inside the radius');
});

test('a pine crown is soft',()=>{
 const pine=first('redwood/mountain_pine.glb'),hit=world([pine]);
 const [x,y]=pine.position_m;
 const base=hit.near([x,y,pine.position_m[2]+1],3).find(s=>s.trunk).trunk.top_z,p=[x+2,y,base+1];
 const soft=hit.soft(p,.35);
 assert.equal(soft.length,1);assert.ok(soft[0].depth>0);assert.equal(soft[0].shape.type,'crown');
 assert.equal(hit(p,p,.35),null);
});

test('a homestead wall is where it is drawn',()=>{
 const home=placement.instances.find(i=>i.tags?.includes('HS001')),hit=world([home]);
 const toCore=v=>{const s=v.applyMatrix4(instanceMatrix(home.position_m,home.yaw_deg,home.scale));return [s.x,-s.z,s.y];};
 // Between the window frame (x -1.09) and the door frame (x -0.56) as built; the wall face is z = 3.65.
 const out=toCore(new T.Vector3(-.83,1.69,3.65+.36)),inside=toCore(new T.Vector3(-.83,1.69,3.65-.1));
 assert.equal(hit(out,out,.35),null,'free 0.36 m in front of the wall');
 assert.ok(hit(inside,inside,.35),'0.1 m inside the wall hits');
});

test("the tree village's foliage does not block the camera",()=>{
 const tree=first('arboreal/village_tree.glb'),hit=world([tree]);
 const mesh=hit.near(tree.position_m,200).find(s=>s.type==='mesh');
 const asset=glb(tree.asset),m=instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale),v=new T.Vector3();
 let probe=null;
 for(const p of asset.primitives.filter(p=>/foliage/.test(p.materialName))){
  const a=p.geometry.attributes.position;
  for(let i=0;i<a.count&&!probe;i+=97){v.fromBufferAttribute(a,i).applyMatrix4(p.local).applyMatrix4(m);const c=[v.x,-v.z,v.y];
   if(surfaceGap(mesh,c)>1&&hit.soft(c,.2).length)probe=c;}
  if(probe)break;
 }
 assert.ok(probe,'a foliage point at least 1 m from trunk and dwellings');
 assert.equal(hit(probe,[probe[0]+.5,probe[1],probe[2]],.2),null);
});

test('hopping in beside a village tree never traps him',async()=>{
 const {stepMoves}=await import('../../../shared/activities/moves.js');
 const walk={...JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url))).walk,climb:undefined};
 for(const asset of ['arboreal/village_tree.glb','arboreal/village_tree_low.glb']){
  const env={height:()=>0,hitTest:world([{...first(asset),position_m:[0,0,0]}])};
  for(let k=0;k<36;k++){
   const a=k*Math.PI/18,d=a+Math.PI;let s={x:Math.cos(a)*25,y:Math.sin(a)*25,z:0,heading:d,speed:0};
   for(let i=0;i<60*8;i++)s=stepMoves(s,{x:Math.cos(d),y:Math.sin(d),run:true,jump:(i%30)<10,stick:[0,1]},1/60,walk,env);
   let free=0;
   for(let j=0;j<8&&free<=.5;j++){let t=s;const b=j*Math.PI/4;for(let i=0;i<120;i++)t=stepMoves(t,{x:Math.cos(b),y:Math.sin(b),stick:[0,1]},1/60,walk,env);free=Math.max(free,Math.hypot(t.x-s.x,t.y-s.y));}
   assert.ok(free>.5,`${asset}: trapped after hopping in from ${k*10} degrees`);
  }
 }
});

test('building the whole placement takes under 300 ms',()=>{
 const assets=Object.fromEntries([...new Set(placement.instances.filter(i=>!['river','lake','hardstanding'].includes(i.kind)).map(i=>i.asset))].map(a=>[a,glb(a)]));
 // Best of three: the suite runs files in parallel, and the budget is the browser's quiet load.
 const ms=Math.min(...[0,1,2].map(()=>{const start=performance.now();buildWorldCollision(placement,assets);return performance.now()-start;}));
 console.log(`buildWorldCollision: ${ms.toFixed(0)} ms for ${placement.instances.length} instances`);
 assert.ok(ms<300,`${ms.toFixed(0)} ms`);
});

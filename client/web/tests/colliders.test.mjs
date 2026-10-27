import test from 'node:test';
import assert from 'node:assert/strict';
import {radialProfile,trunkShape,crownShape,meshAsset,meshShape,cellKey} from '../../../shared/activities/colliders.js';
import {createCollisionIndex,surfaceGap,knockDirection} from '../../../shared/activities/collision.js';

// A ring of vertices of radius r at height h, in glTF local axes (x, y up, z).
const ring=(r,h,n=12)=>Array.from({length:n},(_,i)=>[r*Math.cos(i*2*Math.PI/n),h,r*Math.sin(i*2*Math.PI/n)]).flat();

test("radialProfile reads a cone's taper",()=>{
 const cone=Array.from({length:10},(_,k)=>ring(2*(1-(k+.5)/10),k+.5)).flat();
 const rows=radialProfile(cone,{band_m:1});
 const near=rows.find(([h])=>Math.abs(h-.5)<1e-9);
 assert.ok(near,'a row at the first band middle');
 assert.ok(Math.abs(near[1]-1.9)<=.05,`r ${near[1]}`);
 for(let i=1;i<rows.length;i++){assert.ok(rows[i][0]>rows[i-1][0],'rows ascend');assert.ok(rows[i][1]<rows[i-1][1],'radius strictly decreases');}
});

test('the 90th percentile ignores one stray spray',()=>{
 const band=[...Array.from({length:99},(_,i)=>[Math.cos(i),.5,Math.sin(i)]).flat(),5,.5,0];
 assert.equal(radialProfile(band,{band_m:1,percentile:.9})[0][1],1);
 assert.equal(radialProfile(band,{band_m:1,percentile:1})[0][1],5);
});

test('trunkShape scales and places its profile',()=>{
 const s=trunkShape({id:'t',x:3,y:4,base_z:10,scale:2,profile:[[1,.5]],top_h:6});
 assert.equal(s.type,'trunk');assert.equal(s.kind,'tree');
 assert.deepEqual(s.trunk.profile,[[12,1]]);
 assert.equal(s.trunk.top_z,22);assert.equal(s.trunk.base_z,10);assert.equal(s.trunk.x,3);assert.equal(s.trunk.y,4);
 assert.deepEqual(s.min,[2,3,10]);assert.deepEqual(s.max,[4,5,22]);
});

test('crownShape is soft and bounds its widest band',()=>{
 const s=crownShape({id:'c',x:0,y:0,base_z:5,scale:1,profile:[[2,4],[12,1]]});
 assert.equal(s.type,'crown');assert.equal(s.soft,true);
 assert.deepEqual(s.crown.profile,[[7,4],[17,1]]);
 assert.deepEqual(s.min,[-4,-4,7]);assert.deepEqual(s.max,[4,4,17]);
});

test('meshShape rejects non-uniform scale',()=>{
 const asset=meshAsset([0,0,0,1,0,0,0,1,0]);
 assert.throws(()=>meshShape({id:'m',asset,matrix:[1,0,0,0, 0,2,0,0, 0,0,1,0, 0,0,0,1],kind:'structure'}));
});

test('meshShape keeps the inverse and the world bounds of a turned, scaled mesh',()=>{
 const asset=meshAsset([0,0,0,1,0,0,0,1,0]);
 // A quarter turn about z, scale 2, moved to (10, 0, 0).
 const s=meshShape({id:'m',asset,matrix:[0,2,0,0, -2,0,0,0, 0,0,2,0, 10,0,0,1],kind:'structure'});
 assert.equal(s.mesh.scale,2);
 assert.deepEqual(s.min.map(v=>+v.toFixed(9)),[8,0,0]);assert.deepEqual(s.max.map(v=>+v.toFixed(9)),[10,2,0]);
 const m=s.mesh.matrix,inv=s.mesh.inverse,p=[.3,.6,.1];
 const apply=(a,[x,y,z])=>[0,1,2].map(r=>a[r]*x+a[4+r]*y+a[8+r]*z+a[12+r]);
 apply(inv,apply(m,p)).forEach((v,i)=>assert.ok(Math.abs(v-p[i])<1e-9));
});

test('meshAsset bins every triangle',()=>{
 // A 3 m x 3 m quad at y = 0 in two triangles, 2 m cells.
 const quad=[0,0,0, 3,0,0, 3,0,3, 0,0,0, 3,0,3, 0,0,3];
 const a=meshAsset(quad,2);
 assert.equal(a.cell_m,2);assert.deepEqual(a.bounds,{min:[0,0,0],max:[3,0,3]});
 for(const tri of [0,1])for(const [x,y,z] of [[0,0,0],[1,0,0],[0,0,1],[1,0,1]])
  assert.ok(a.cells.get(cellKey(x,y,z))?.includes(tri),`triangle ${tri} in cell ${x},${y},${z}`);
});

// ── The index over typed shapes. A trunk of radius 0.5 from z 0 to 20 at the origin.
const trunk=(r=.5)=>trunkShape({id:'t',x:0,y:0,base_z:0,scale:1,profile:[[0,r],[20,r]],top_h:20});
const identity=[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

test('a trunk is round, not square',()=>{
 const hit=createCollisionIndex([trunk()]),at=d=>[d*Math.SQRT1_2,d*Math.SQRT1_2,1];
 assert.equal(hit(at(.86),at(.86),.35),null);
 assert.ok(hit(at(.84),at(.84),.35));
});

test('near-touching is not blocked',()=>{
 const hit=createCollisionIndex([trunk()]);
 for(let k=0;k<16;k++){
  const a=k*Math.PI/8,p=d=>[d*Math.cos(a),d*Math.sin(a),1];
  assert.equal(hit(p(.86),p(.86),.35),null,`free at angle ${k}`);
  assert.ok(hit(p(.86),p(.81),.35),`blocked moving in at angle ${k}`);
 }
});

test("a crown's empty corner is air",()=>{
 const crown=crownShape({id:'c',x:0,y:0,base_z:0,scale:1,profile:[[2,4],[12,0]]}),hit=createCollisionIndex([crown]);
 assert.deepEqual(hit.soft([3.5,3.5,3],.35),[]);
 assert.equal(hit([3.5,3.5,3],[3.5,3.5,3],.35),null);
 const [inside]=hit.soft([0,1,3],.35);
 assert.equal(inside.shape,crown);assert.ok(inside.depth>0);
});

test('crowns never block',()=>{
 const hit=createCollisionIndex([crownShape({id:'c',x:0,y:0,base_z:0,scale:1,profile:[[2,4],[12,0]]})]);
 assert.equal(hit([-6,0,4],[6,0,4],.45),null);
});

test('a mesh wall pushes out along its normal',()=>{
 const wall=meshShape({id:'w',kind:'structure',matrix:identity,asset:meshAsset([1,-2,0, 1,2,0, 1,2,3, 1,-2,0, 1,2,3, 1,-2,3])});
 const hit=createCollisionIndex([wall]),c=hit.contact([.8,0,1.5],.35);
 assert.equal(c.shape,wall);
 assert.ok(Math.abs(c.normal[0]+1)<1e-9&&Math.abs(c.normal[1])<1e-9&&Math.abs(c.normal[2])<1e-9,`normal ${c.normal}`);
 assert.ok(Math.abs(c.depth-.15)<1e-9,`depth ${c.depth}`);
 assert.ok(hit([.5,0,1.5],[.9,0,1.5],.35),'a sphere moving into the wall hits it');
 assert.equal(hit([.5,0,1.5],[.6,0,1.5],.35),null,'one that stops short does not');
});

test('knockDirection is stable',()=>{
 const a=crownShape({id:'a',x:0,y:0,base_z:0,scale:1,profile:[[2,4],[12,0]]}),b={...a,id:'b'},p=[1.2,.3,4];
 const u=knockDirection(a,p);
 assert.deepEqual(knockDirection(a,p),u);
 assert.ok(Math.abs(Math.hypot(...u)-1)<1e-9);
 assert.notDeepEqual(knockDirection(b,p),u);
});

test('surfaceGap measures to the bark at that height',()=>{
 const t=trunkShape({id:'t',x:0,y:0,base_z:0,scale:1,profile:[[0,1],[10,.5]],top_h:10});
 assert.ok(Math.abs(surfaceGap(t,[2,0,5])-1.25)<1e-9);
 assert.ok(Math.abs(surfaceGap({min:[0,0,0],max:[1,1,1]},[2,.5,.5])-1)<1e-9,'a legacy box measures to its face');
});

test('near on a large mesh reads only what is near',()=>{
 // 60,000 small triangles in a 100 m field; the query point is 15 m clear of all of them.
 const tri=[];for(let i=0;i<60000;i++){const x=(i%300)/3,y=Math.floor(i/300)/2;tri.push(x,y,0,x+.2,y,0,x,y+.2,0);}
 const hit=createCollisionIndex([meshShape({id:'m',kind:'structure',matrix:identity,asset:meshAsset(tri)})]),p=[50,50,15];
 const t0=performance.now();for(let i=0;i<600;i++)assert.deepEqual(hit.near(p,.5),[]);const ms=performance.now()-t0;
 assert.ok(ms<60,`600 near queries took ${ms.toFixed(0)} ms`);
});

test('surfaceGap measures to a mesh at any distance',{timeout:2000},()=>{
 const wall=meshShape({id:'w',kind:'structure',matrix:identity,asset:meshAsset([1,-2,0, 1,2,0, 1,2,3, 1,-2,0, 1,2,3, 1,-2,3])});
 assert.ok(Math.abs(surfaceGap(wall,[-9,0,1.5])-10)<1e-9);
});

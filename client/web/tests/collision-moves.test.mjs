import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stepWalk} from '../../../shared/activities/walk.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {attachClimb} from '../../../shared/activities/climb.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {trunkShape,crownShape,meshAsset,meshShape} from '../../../shared/activities/colliders.js';
const player=JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url)));
const {foliage:_,...older}=player.walk;
const walk={...older,foliage:{drag_per_s:1.5,knock:.15,slow:.7}},r=walk.radius_m,flat=()=>0;
const trunk=(x,y,radius=.5)=>trunkShape({id:'t',x,y,base_z:0,scale:1,profile:[[0,radius],[20,radius]],top_h:20});
const steps=(s,input,seconds,config,hit,each=()=>{})=>{for(let i=0;i<Math.round(seconds*60);i++){s=stepWalk(s,input,1/60,config,flat,hit);each(s);}return s;};
const start=(x=0,y=0)=>({x,y,z:0,heading:0,speed:0});

test('walking into a trunk stops within 2 cm',()=>{
 // From ten starting points, so a step that happens to end flush cannot pass by luck.
 const hit=createCollisionIndex([trunk(5,0)]);
 for(let k=0;k<10;k++){
  const s=steps(start(k*.01,0),{x:1,y:0,run:true},2,walk,hit),gap=Math.hypot(s.x-5,s.y)-.5;
  assert.ok(gap>=r-1e-6&&gap<=r+.02,`from x ${k*.01}: gap ${gap.toFixed(4)} against radius ${r}`);
 }
});

test('a diagonal approach slides round the trunk',()=>{
 const hit=createCollisionIndex([trunk(5,0)]),offset=(.5+r)*Math.SQRT1_2;
 const ys=[];const s=steps(start(0,offset),{x:1,y:0},4,walk,hit,s=>ys.push(s.y));
 assert.ok(new Set(ys.map(y=>y.toFixed(3))).size>3,'his y changes as he goes round');
 assert.ok(s.x>5+.5+r,`he passes the trunk (x ${s.x.toFixed(2)})`);
});

test('sliding along a rotated wall does not stick at the triangle seam',()=>{
 // A 20 m wall, 3 m high, along 30 degrees, in two triangles whose seam is the diagonal.
 const a=30*Math.PI/180,u=[Math.cos(a),Math.sin(a)],n=[-u[1],u[0]],end=k=>[10*k*u[0],10*k*u[1]];
 const [p,q]=[end(-1),end(1)],tri=[p[0],p[1],0, q[0],q[1],0, q[0],q[1],3, p[0],p[1],0, q[0],q[1],3, p[0],p[1],3];
 const wall=meshShape({id:'w',kind:'structure',matrix:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],asset:meshAsset(tri)}),hit=createCollisionIndex([wall]);
 const d=(30+20)*Math.PI/180,s0=start(-.6*n[0]-3*u[0],-.6*n[1]-3*u[1]);
 const s=steps(s0,{x:Math.cos(d),y:Math.sin(d)},2,walk,hit);
 const along=(s.x-s0.x)*u[0]+(s.y-s0.y)*u[1],off=s.x*n[0]+s.y*n[1];
 assert.ok(along>=3,`travelled ${along.toFixed(2)} m along the wall`);
 assert.ok(off<=-r+1e-6,'and stayed on his own side of it');
});

test('foliage slows and nudges, never stops',()=>{
 const crown=crownShape({id:'c',x:5,y:0,base_z:0,scale:1,profile:[[0,3],[10,3]]}),hit=createCollisionIndex([crown]);
 const go=()=>{let fastest=0,knocked=0;const s=steps(start(0,.5),{x:1,y:0},4,walk,hit,s=>{if(s.x>3&&s.x<7)fastest=Math.max(fastest,s.speed);knocked=Math.max(knocked,s.knock??0);});return {s,fastest,knocked};};
 const a=go(),b=go();
 assert.ok(a.fastest<.85*walk.walk_mps,`fastest inside ${a.fastest.toFixed(2)} m/s`);
 assert.ok(a.s.x>8,'he comes out the far side');
 assert.ok(Math.abs(a.s.y-.5)>1e-3,'the knock moved him sideways');
 assert.ok(a.knocked>0,'and was recorded for presentation');
 assert.deepEqual(a.s,b.s,'the same path gives the same knock');
});

test('the push-off from the perch is not stalled by his own crown',()=>{
 const t=trunkShape({id:'7:trunk',x:0,y:0,base_z:0,scale:1,profile:[[0,.75],[20,.5]],top_h:20});
 const crown=crownShape({id:'7:crown',x:0,y:0,base_z:0,scale:1,profile:[[20,4],[30,1]]});
 const world={height:flat,hitTest:createCollisionIndex([t,crown])};
 let s=attachClimb({x:1.3,y:0,z:0,heading:Math.PI,speed:0},t,walk);
 for(let i=0;i<60*10;i++)s=stepMoves(s,{x:0,y:0,stick:[0,1]},1/60,walk,world);
 assert.equal(s.climbPhase,'perch');
 s=stepMoves(s,{x:0,y:0,stick:[0,0]},1/60,walk,world);
 s=stepMoves(s,{x:0,y:0,stick:[0,0],jump:true},1/60,walk,world);
 assert.equal(s.mode,'ground');
 assert.ok(Math.abs(Math.hypot(s.vx,s.vy)-walk.climb.jump_out_mps)<1e-9,'leaves at jump_out_mps');
 let last=Math.hypot(s.x,s.y);
 for(let i=0;i<60;i++){s=stepMoves(s,{x:0,y:0,stick:[0,0]},1/60,walk,world);assert.notEqual(s.mode,'climb','not re-grabbed');const d=Math.hypot(s.x,s.y);assert.ok(d>=last-1e-9,'still moving away');last=d;}
 assert.ok(last>=.75+1.5,`${last.toFixed(2)} m out after a second`);
});

test('pushing head-on into a flared trunk still climbs it',()=>{
 // Wider at the foot than at the chest, as every placed tree is: the flare is what stops him.
 const t=trunkShape({id:'9:trunk',x:3,y:0,base_z:0,scale:1,profile:[[0,1.2],[1,.9],[20,.6]],top_h:20});
 const world={height:flat,hitTest:createCollisionIndex([t])};let s=start();
 for(let i=0;i<90&&s.mode!=='climb';i++)s=stepMoves(s,{x:1,y:0,stick:[0,1]},1/60,walk,world);
 assert.equal(s.mode,'climb');
});

test('older contracts walk field for field as before',()=>{
 const boxes=createCollisionIndex([{min:[3,-1,0],max:[4,1,3],kind:'structure'},{min:[2,2,0],max:[6,6,10],kind:'tree'}]);
 const plain=(f,t,rad)=>boxes(f,t,rad);
 let a=start(0,.2),b=start(0,.2);
 for(let i=0;i<180;i++){
  a=stepWalk(a,{x:1,y:.4},1/60,older,flat,boxes);b=stepWalk(b,{x:1,y:.4},1/60,older,flat,plain);
  assert.deepEqual(a,b);
 }
 assert.ok(!('foliage' in a)&&!('knock' in a),'no new fields without the contract');
});

test('the shipped contract carries the foliage tuning',()=>{
 assert.deepEqual(player.walk.foliage,{drag_per_s:1.5,knock:.15,slow:.7});
});

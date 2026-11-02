import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {branchLanding,createBranchIndex,mountNearbyBranch,stepBranch,stepTreeJump} from '../../../shared/activities/branches.js';
import {attachClimb,stepClimb,climbRadiusAt} from '../../../shared/activities/climb.js';
import {launchTreeFlight} from '../../../shared/activities/flight.js';
import {forestBranchScaffold} from '../../../shared/geometry/tree-design/forest-sprays.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const config=read('../../../shared/characters/player.json').walk;
const matrix=x=>[1,0,0,0,0,0,1,0,0,-1,0,0,x,0,0,1];
const tree=(id,x,direction)=>({id,matrix:matrix(x),min:[x-8,-8,0],max:[x+8,8,20],trunkBox:{type:'trunk',min:[x-.5,-.5,0],max:[x+.5,.5,4],trunk:{x,y:0,base_z:0,top_z:4,climb_top_z:15,profile:[[0,.5],[15,.5]]}},graph:[{id:0,stiffness:1,path:[[0,10,0,.4],[direction*3,10,0,.3],[direction*6,10,0,.1]]}]});
function fixture(){const trees=[tree('a',0,1),tree('b',10,-1)],hitTest=()=>null;hitTest.branchesNear=createBranchIndex(trees);return {trees,world:{height:()=>0,hitTest}};}
test('published branches come directly from the committed mesh scaffold',()=>{
 const data=read('../../../shared/geometry/tree-design/branch-graphs.json'),plan=read('../../../shared/geometry/tree-design/adopted-redwoods.json');
 for(const [name,p] of Object.entries(plan.profiles)){
  const scaffold=[...forestBranchScaffold(p.geometryRecipe)],graph=data.profiles[name].branches;
  assert.equal(graph.length,scaffold.length);
  for(let i=0;i<graph.length;i++)for(let j=0;j<7;j++){
   assert.deepEqual(graph[i].path[j].slice(0,3),scaffold[i].branch(j/6));assert.ok(graph[i].path[j][3]>0);
   assert.equal(graph[i].parent,'trunk');assert.ok(graph[i].stiffness>0);
  }
 }
});
test('trunk-to-branch mount, running and return to trunk use real support heights',()=>{
 const {trees,world}=fixture(),s={mode:'climb',trunk:trees[0].trunkBox.trunk,trunkBox:trees[0].trunkBox,x:.72,y:0,z:10,heading:0};
 let b=mountNearbyBranch(s,config,world);assert.equal(b.mode,'branch');assert.ok(b.z>10,'feet on wood, not its centre');
 const before=b.x;for(let i=0;i<30;i++)b=stepBranch(b,{x:1,y:0,run:true},1/60,config,world);
 assert.ok(b.x-before>2,'runs outward along the branch');assert.ok(Math.abs(b.z-(10+.3-(b.x-3)*.2/3))<1e-9);
 for(let i=0;i<100;i++)b=stepBranch(b,{x:-1,y:0},1/60,config,world);
 b=stepBranch(b,{branch:true},1/60,config,world);assert.equal(b.mode,'climb');
});
test('directed leap reaches another tree without teleporting and holds a pressed jump on arrival',()=>{
 const {trees,world}=fixture();let s=mountNearbyBranch({mode:'climb',trunkBox:trees[0].trunkBox,x:.72,y:0,z:10,heading:0},config,world);
 for(let i=0;i<30;i++)s=stepBranch(s,{x:1,y:0,run:true},1/60,config,world);
 s=stepBranch(s,{x:1,y:0,jump:true},1/60,config,world);assert.equal(s.mode,'tree-jump');let maxStep=0;
 for(let i=0;i<180&&s.mode==='tree-jump';i++){const prev=s;s=stepTreeJump(s,{jump:true},1/120,config,world);maxStep=Math.max(maxStep,Math.hypot(s.x-prev.x,s.y-prev.y,s.z-prev.z));}
 assert.equal(s.mode,'branch');assert.equal(s.branch.treeId,'b');assert.ok(maxStep<.2);assert.equal(s.jumpHeld,true);
 s=stepBranch(s,{jump:true},1/60,config,world);assert.equal(s.mode,'branch','held input cannot immediately leap again');
});
test('giant perch launches at actual height and rejects other perches',()=>{
 const flight=read('../../../shared/activities/flight.json'),state={mode:'climb',climbPhase:'perch',x:2,y:0,z:100,trunk:{x:0,y:0,launch_mode:'para'}};
 for(const mode of Object.keys(flight.modes)){const f=launchTreeFlight(flight,mode,state,()=>20);assert.equal(f.z,100+flight.landing_clearance_m);assert.equal(f.heading,0);assert.equal(f.grounded,false);}
 assert.throws(()=>launchTreeFlight(flight,'paraglider',{...state,trunk:{}},()=>20));
 assert.throws(()=>launchTreeFlight(flight,'paraglider',{...state,climbPhase:'climb'},()=>20));
});

test('descending feet land on branches, while an upward crossing does not catch',()=>{
 const {world}=fixture(),previous={x:2,y:0,z:11},state={x:2,y:0,z:9.8,vz:-5,grounded:false};
 const landed=branchLanding(previous,state,config,world);assert.equal(landed.mode,'branch');assert.equal(landed.grounded,true);assert.equal(landed.jumpPhase,'landing');
 assert.equal(branchLanding(previous,{...state,vz:5},config,world),null);
});
test('branch queries filter distant limbs and bound the expanded-tree cache',()=>{
 const trees=Array.from({length:40},(_,i)=>tree('tree'+i,i*100,1)),near=createBranchIndex(trees);
 for(let i=0;i<40;i++){const found=near([i*100+2,0,10],1);assert.ok(found.some(b=>b.treeId==='tree'+i));}
 assert.equal(near.stats().cachedTrees,24);assert.deepEqual(near([0,0,18],.1),[],'a tree envelope is not itself branch support');
});

test('climbing continues beyond the physical crown base and follows the full bole taper',()=>{
 const box={type:'trunk',min:[-4,-4,0],max:[4,4,40],trunk:{x:0,y:0,base_z:0,top_z:40,climb_top_z:100,launch_mode:'para',profile:[[0,4],[40,2]],climb_profile:[[0,4],[40,2],[100,.08]]}};
 const hitTest=()=>null;hitTest.near=()=>[];const world={height:()=>0,hitTest};
 for(const dt of [1/60,1/120]){
  let s=attachClimb({x:4.22,y:0,z:0,heading:0,speed:0},box,config);s=stepClimb(s,{},.31,config,world);
  for(let t=0;t<20;t+=dt)s=stepClimb(s,{stick:[0,1],run:true},dt,config,world);
  assert.equal(s.climbPhase,'perch');assert.ok(Math.abs(s.z-(100-config.climb.top_clearance_m))<1e-9);assert.equal(s.launchReady,true);
  assert.ok(Math.abs(Math.hypot(s.x,s.y)-climbRadiusAt(box.trunk,s.z)-config.climb.hold_m)<1e-9);assert.ok(Math.hypot(s.x,s.y)<.5,'paws follow the narrow leader');
  s=stepClimb(s,{jump:true},dt,config,world);assert.equal(s.mode,'ground');assert.equal(s.launchReady,false);
 }
});


test('tree leap has a fresh running-leap cycle and a cancellable landing at each refresh rate',()=>{
 for(const hz of [30,60,120]){
  const {trees,world}=fixture();let s=mountNearbyBranch({mode:'climb',trunkBox:trees[0].trunkBox,x:.72,y:0,z:10,heading:0,jumpCount:4},config,world);
  s=stepBranch(s,{x:1,jump:true},1/hz,config,world);
  assert.equal(s.jumpStyle,'leap');assert.equal(s.jumpCount,5);
  while(s.mode==='tree-jump')s=stepTreeJump(s,{jump:true},1/hz,config,world);
  assert.equal(s.jumpPhase,'landing');assert.equal(s.jumpProgress,0);assert.ok(s.landingSpeed>0);
  const landed=s;let time=0;
  const blocked=stepBranch(s,{x:1},1/hz,config,{hitTest:()=>({})});
  assert.equal(blocked.x,s.x);assert.ok(blocked.jumpProgress>0,'blocked movement still recovers from landing');
  while(s.jumpPhase==='landing'){s=stepBranch(s,{jump:true},1/hz,config,world);time+=1/hz;}
  assert.ok(time>=config.jump.landing_s&&time<config.jump.landing_s+1/hz+1e-9);
  assert.equal(s.mode,'branch');assert.equal(s.jumpCount,5);
  s=stepBranch(landed,{jump:false},1/hz,config,world);
  s=stepBranch(s,{x:-1,jump:true},1/hz,config,world);
  assert.equal(s.mode,'tree-jump','fresh press can chain out of the landing');assert.equal(s.jumpCount,6);
 }
});


test('leap animation hangs at the ballistic apex for raised and lower target limbs',()=>{
 for(const dz of [-3,2]){
  const trees=[tree('a',0,1),tree('b',10,-1)];trees[1].matrix[14]=dz;trees[1].min[2]+=dz;trees[1].max[2]+=dz;
  const hitTest=()=>null;hitTest.branchesNear=createBranchIndex(trees);const world={hitTest};
  let s=mountNearbyBranch({mode:'climb',trunkBox:trees[0].trunkBox,x:.72,y:0,z:10,heading:0},config,world);
  s=stepBranch(s,{x:1,jump:true},.02,config,world);assert.equal(s.mode,'tree-jump');
  for(let i=0;i<25;i++)s=stepTreeJump(s,{},.02,config,world);
  assert.ok(Math.abs(s.vz)<1e-9);assert.ok(Math.abs(s.jumpProgress-.5)<1e-9);
  while(s.mode==='tree-jump')s=stepTreeJump(s,{},.02,config,world);
  assert.equal(s.branch.treeId,'b');assert.equal(s.jumpPhase,'landing');
 }
});

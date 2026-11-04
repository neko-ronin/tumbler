import test from 'node:test';
import assert from 'node:assert/strict';
import {allocateTreeLods,treeTransitionDraws,TREE_FADE_MS} from '../src3d/tree-budget.js';
const weights=(result,tree)=>{const w=[0,0,0,0];for(const d of result.draws)if(d.tree===tree)w[d.lod]+=d.hi-d.lo;return w;};
const check=(trees,budgets,steps)=>{let prior;for(const [now,update]of steps){update?.();const result=treeTransitionDraws(allocateTreeLods(trees,budgets),budgets,now),ws=trees.map(t=>weights(result,t));
 for(const w of ws)assert.ok(Math.abs(w.reduce((a,b)=>a+b)-1)<1e-9);
 for(let lod=0;lod<3;lod++)assert.ok(result.used[lod]<=budgets[lod],`budget ${lod}`);
 if(prior)for(let i=0;i<trees.length;i++)for(let lod=0;lod<4;lod++)assert.ok(Math.abs(ws[i][lod]-prior.ws[i][lod])<=1.51*(now-prior.now)/TREE_FADE_MS+1e-7,`tree ${i} LOD ${lod} cut ${prior.ws[i][lod]} → ${ws[i][lod]} in ${now-prior.now} ms`);
 prior={now,ws};}return prior;};

test('saturated middle meshes exchange priority without a one-frame cut',()=>{
 const a={id:0,priority:200,pixels:300,clearance:30,previous:-1,costs:[100,60,10,2]},b={...a,id:1,priority:100};
 const steps=[[0],...Array.from({length:35},(_,i)=>[(i+1)*33,i===0?()=>{b.priority=300;}:undefined])];
 check([a,b],[0,60,20],steps);
});

test('reversing an unfinished fade keeps the displayed coverage continuous',()=>{
 const a={id:0,priority:200,pixels:300,clearance:30,previous:-1,costs:[100,60,10,2]};
 check([a],[100,60,20],[[0],[33,()=>a.pixels=30],[66],[99],[132,()=>a.pixels=300],[165],[198],[231]]);
});

import {treeTransitionBudgets} from '../src3d/tree-budget.js';
test('quality reductions drain residents through fades then reach the lower budget',()=>{
 const trees=Array.from({length:8},(_,id)=>({id,priority:200-id,pixels:300,clearance:30,previous:-1,costs:[100,60,10,2]}));
 let previous,settled;
 for(let frame=0;frame<80;frame++){
  const now=frame*33,requested=frame?[0,60,20]:[0,300,40],budgets=treeTransitionBudgets(trees,requested,now);
  const result=treeTransitionDraws(allocateTreeLods(trees,requested),budgets,now),w=trees.map(t=>weights(result,t));
  assert(result.used.slice(0,3).every((n,lod)=>n<=budgets[lod]&&n<=[0,300,40][lod]));
  if(previous)for(let i=0;i<w.length;i++)for(let lod=0;lod<4;lod++)assert(Math.abs(w[i][lod]-previous[i][lod])<.14);
  previous=w;settled=result;
 }
 assert(settled.used[1]<=60&&settled.used[2]<=20,'lower requested budget is eventually honored');
 assert.equal(settled.transitioning,0);
});

test('saturated exchanges converge, preserve every tree and report submitted geometry exactly',()=>{
 const trees=Array.from({length:200},(_,id)=>({id,priority:1000-id,pixels:900-id*4,clearance:id,previous:-1,costs:[770848,105636,6472,2]}));
 const budgets=[800000,1050000,550000];let previous,last;
 for(let frame=0;frame<150;frame++){
  const now=frame*33;if(frame===1)for(const tree of trees)tree.priority=tree.id*20;
  const result=treeTransitionDraws(allocateTreeLods(trees,budgets),budgets,now),w=trees.map(t=>weights(result,t)),actual=[0,0,0,0];
  for(const d of result.draws)actual[d.lod]+=d.tree.costs[d.lod];
  assert.deepEqual(actual,result.used);assert(actual.slice(0,3).every((n,lod)=>n<=budgets[lod]));
  for(let i=0;i<w.length;i++){assert(Math.abs(w[i].reduce((a,b)=>a+b)-1)<1e-9);if(previous)for(let lod=0;lod<4;lod++)assert(Math.abs(w[i][lod]-previous[i][lod])<.14);}
  previous=w;last=result;
 }
 assert.equal(last.transitioning,0);assert.equal(last.pending,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {treeCaptureRect} from '../src3d/tree-capture.js';
import {allocateTreeLods} from '../src3d/tree-budget.js';

test('atlas rectangles address identical physical texels at every render scale',()=>{
 for(const ratio of [.45,.7,1,1.125,1.5,2,2.25]){
  const rectangles=[],renderer={getPixelRatio:()=>ratio,setViewport:(...r)=>rectangles.push(r.map(v=>Math.round(v*ratio))),setScissor:(...r)=>rectangles.push(r.map(v=>Math.round(v*ratio)))};
  for(const r of [[0,0,80,80],[240,160,80,80],[384,256,128,128]]){treeCaptureRect(renderer,...r);assert.deepEqual(rectangles.splice(0),[r,r]);}
 }
});

test('a nearby tree owns detail before distant tall crowns exhaust the budgets',()=>{
 const distant=Array.from({length:100},(_,id)=>({id,priority:5000-id,pixels:700,clearance:100,previous:-1,costs:[429868,49440,6472,2]}));
 const close={id:101,priority:900,pixels:800,clearance:2,previous:-1,costs:[429868,49440,6472,2]};
 const allocation=allocateTreeLods([...distant,close]);
 assert(allocation.result.find(e=>e.tree===close).lod<=1,'nearby geometry cannot lose priority to a remote giant');
});

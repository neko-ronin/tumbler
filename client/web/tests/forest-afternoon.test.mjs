import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {allocateTreeLods,treeTransitionDraws,TREE_BUDGETS,TREE_FADE_MS} from '../src3d/tree-budget.js';
import {buildForestField} from '../src3d/forest-field.js';
import {buildForestFloor} from '../src3d/forest-floor.js';
const declaration=JSON.parse(fs.readFileSync(new URL('../../../shared/world/out/forest_floor.json',import.meta.url)));

test('a saturated hero budget hands over through a spatial mesh without a hard cut',()=>{
 const costs=[429868,49440,6472,2];
 const departing={id:0,priority:100,pixels:500,clearance:20,previous:0,costs};
 const incoming={id:1,priority:1500,pixels:1200,clearance:10,previous:1,costs};
 const run=now=>{const allocation=allocateTreeLods([departing,incoming]);return {allocation,transition:treeTransitionDraws(allocation,TREE_BUDGETS,now)};};
 const first=run(0);
 assert.equal(first.allocation.result.find(r=>r.tree===incoming).lod,1,'hold the arriving hero in the real middle mesh');
 assert(first.transition.draws.some(d=>d.tree===departing&&d.lod===0),'old source remains during the handoff');
 assert(first.transition.transitioning>0);
 const middle=run(TREE_FADE_MS/2);
 assert(middle.transition.draws.some(d=>d.tree===departing&&d.lod===0&&d.hi-d.lo>0&&d.hi-d.lo<1));
 const final=run(TREE_FADE_MS+1);
 assert.equal(final.allocation.result.find(r=>r.tree===incoming).lod,0,'promote after the outgoing source releases its reservation');
 for(const {transition}of [first,middle,final]){
  const coverage=new Map();for(const d of transition.draws)coverage.set(d.tree.id,(coverage.get(d.tree.id)??0)+d.hi-d.lo);
  assert(transition.used.slice(0,3).every((cost,lod)=>cost<=TREE_BUDGETS[lod]));
  assert([...coverage.values()].every(c=>Math.abs(c-1)<1e-10));
 }
});

test('forest shade and ground plants follow existing forest crowns, retain clearings, and stop overhead',()=>{
 const geometry=new T.BoxGeometry(30,60,30);geometry.translate(0,40,0);geometry.computeBoundingBox();
 const assets={tree:{primitives:[{materialName:'foliage',local:new T.Matrix4(),geometry}]}},tree={asset:'tree',tags:['forest_slope'],position_m:[0,0,100],scale:[1,1,1]};
 const before=structuredClone(tree),field=buildForestField({instances:[tree,{...tree,tags:['open_meadow'],position_m:[70,0,100]}]},assets,declaration.habitat,{resolution:128,span:256});
 assert(field.sample(0,0)>.6);assert.equal(field.sample(70,0),0,'a meadow individual cannot create forest cover');assert.equal(field.sample(28,0),0,'do not fill gaps outside the actual crown');
 assert.deepEqual(tree,before);
 const ground={height:()=>100},floor=buildForestFloor(declaration,field,ground,()=>0),camera=new T.PerspectiveCamera();camera.position.set(0,101.7,0);floor.update(camera);
 assert(floor.stats.plants>0);assert(floor.stats.triangles<300000);assert.equal(floor.group.children.length,4,'bounded instanced kits');
 const matrices=floor.group.children.map(m=>m.instanceMatrix.array.slice());
 camera.position.y=220;floor.update(camera);assert.equal(floor.stats.plants,0);assert(floor.group.children.every(m=>m.count===0));
 camera.position.y=101.7;floor.update(camera);floor.group.children.forEach((m,i)=>assert.deepEqual(m.instanceMatrix.array,matrices[i],'stable cells survive re-entry'));
 const snow=buildForestFloor(declaration,field,ground,()=>1);snow.update(camera);assert.equal(snow.stats.plants,0,'no understory above the snow stamp');
 floor.dispose();snow.dispose();field.dispose();geometry.dispose();
});

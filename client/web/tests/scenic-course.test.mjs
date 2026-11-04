import test from 'node:test';
import assert from 'node:assert/strict';
import {stepScenicCourse} from '../../../shared/activities/scenic-course.js';
const course={landmarks:[{position_m:[100,0,900],radius_m:10},{position_m:[200,100,880],radius_m:10}]};
test('course guide catches a swept passage and leaves physical state untouched',()=>{
 const state={x:120,y:0,z:900,heading:0,speed:24},before=structuredClone(state);
 const p=stepScenicCourse(course,{index:0,position:[80,0,900]},state,[0,0]);
 assert.equal(p.index,1);assert.equal(p.complete,false);assert.deepEqual(state,before);
});
test('a broad bypass advances guidance; faraway or vertically unrelated crossings do not',()=>{
 assert.equal(stepScenicCourse(course,null,{x:105,y:25,z:900},[0,0]).index,1);
 assert.equal(stepScenicCourse(course,null,{x:105,y:50,z:900},[0,0]).index,0);
 assert.equal(stepScenicCourse(course,null,{x:105,y:25,z:1200},[0,0]).index,0);
});
test('completed guidance remains complete',()=>{
 const p=stepScenicCourse(course,{index:2,position:[200,100,880]},{x:500,y:300,z:600},[0,0]);
 assert.equal(p.complete,true);assert.equal(p.index,2);
});
const landingCourse={...course,arrival:{modes:['parakite'],entry_xy_m:[250,100],entry_radius_m:20,landing_xy_m:[250,-500],landing_radius_m:50}};
test('arrival requires the exit and a real uncollapsed touchdown inside the authored zone',()=>{
 const end={index:2,position:[200,100,880]},s={mode:'parakite',x:220,y:100,z:500};
 const exit=stepScenicCourse(landingCourse,end,s,[0,0]);assert.equal(exit.phase,'exit');
 const approach=stepScenicCourse(landingCourse,exit,{...s,x:250},[0,0]);assert.equal(approach.phase,'approach');
 const flying=stepScenicCourse(landingCourse,approach,{...s,x:250,y:-500,z:5},[0,0]);assert.equal(flying.phase,'approach');
 const down={...s,x:250,y:-500,z:2,grounded:true};assert.equal(stepScenicCourse(landingCourse,approach,down,[0,0]).phase,'landed');
 assert.equal(stepScenicCourse(landingCourse,approach,{...down,collapsed:true},[0,0]).phase,'retry');
 assert.equal(stepScenicCourse(landingCourse,approach,{...down,x:400},[0,0]).phase,'retry');
 assert.equal(stepScenicCourse(landingCourse,null,down,[0,0]).phase,'retry');
 assert.equal(stepScenicCourse(landingCourse,end,{...s,mode:'paraglider'},[0,0]).phase,'route');
});
test('terminal arrival is latched until the caller resets course progress for retry',()=>{
 const s={mode:'parakite',x:250,y:-500,z:2,grounded:true};
 const landed=stepScenicCourse(landingCourse,{index:2,phase:'approach'},s,[0,0]);
 assert.equal(stepScenicCourse(landingCourse,landed,{...s,grounded:false,y:300},[0,0]).phase,'landed');
 assert.equal(stepScenicCourse(landingCourse,null,{...s,grounded:false},[0,0]).phase,'route');
});

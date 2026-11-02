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

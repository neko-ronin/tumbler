import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirstPersonHead} from '../src3d/first-person-head.js';
const settle=(state,strength=1)=>{const h=createFirstPersonHead();let p;for(let i=0;i<240;i++)p=h.update(state,1/60,strength);return {...p};};
test('the head looks into the turn and leans with it, opposite for an opposite bank',()=>{
 const right=settle({bank:.8,speed:0}),left=settle({bank:-.8,speed:0});
 assert.ok(right.yaw<0&&left.yaw>0);assert.ok(right.roll<0&&left.roll>0);assert.ok(Math.abs(right.yaw)<.3);
});
test('load sinks the head; reduced motion holds it still',()=>{
 assert.ok(settle({load:2,speed:0}).sink>settle({load:1,speed:0}).sink);
 const off=settle({bank:1,load:3,speed:40,turbulence:2},0);for(const v of Object.values(off))assert.equal(Math.abs(v),0);
});
test('buffet stays a tremor at top speed',()=>{
 const h=createFirstPersonHead();let peak=0;for(let i=0;i<600;i++)peak=Math.max(peak,Math.abs(h.update({speed:50,turbulence:1.5},1/60).roll));
 assert.ok(peak>0&&peak<.02,String(peak));
});

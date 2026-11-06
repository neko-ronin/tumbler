import test from 'node:test';import assert from 'node:assert/strict';
import {FLEE,fleeStep} from '../src3d/insect-visits.js';

test('a butterfly flees a passing player, holds off, then drifts back to its wander',()=>{
  const rule=FLEE.butterfly,o=new Float32Array(4),dt=1/30;
  for(let i=0;i<20;i++)fleeStep(o,0,1,0,1,[0,0,1],dt,rule);  // still inside the radius
  const away=Math.hypot(o[0],o[1],o[2]);
  assert.ok(away>1.5&&o[0]>0,`fled ${away}`);assert.ok(away<=rule.max+1e-6);
  for(let i=0;i<rule.hold*30-2;i++)fleeStep(o,0,1,0,1,null,dt,rule);
  assert.ok(Math.abs(Math.hypot(o[0],o[1],o[2])-away)<1e-6,'holds off while alarmed');
  for(let i=0;i<rule.calm*60;i++)fleeStep(o,0,1,0,1,null,dt,rule);
  assert.ok(Math.hypot(o[0],o[1],o[2])<.05,'calm again');
});

test('nobody nearby, or someone standing still, scares nothing',()=>{
  const o=new Float32Array(4);
  assert.equal(fleeStep(o,0,10,0,1,[0,0,1],.1,FLEE.bee),false);
  assert.equal(fleeStep(o,0,1,0,1,null,.1,FLEE.bee),false);
  assert.deepEqual([...o],[0,0,0,0]);
});

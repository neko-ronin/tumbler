import test from 'node:test';
import assert from 'node:assert/strict';
import {createSchool,stepSchool,createRaft,stepRaft,react} from '../../../shared/ecology/aquatic.js';

test('react flees with a positive strength, approaches with a negative one, and is zero beyond its radius', () => {
  const agent={p:[2,0,0]};
  assert.ok(react(agent,[0,0,0],5,1)[0]>0);
  assert.ok(react(agent,[0,0,0],5,-1)[0]<0);
  assert.deepEqual(react(agent,[0,0,0],1.5,1),[0,0,0]);
});

test('every fish carries the agent shape, and trout are scaled', () => {
  const s=createSchool({radii_m:[45,25],depth_range_m:[2.5,12],current_mps:0,fish_count:6,fish_scale:1.8,seed:5});
  for(const f of s.fish){assert.equal(f.p.length,3);assert.equal(f.v.length,3);assert.equal(f.behaviour,'school');assert.ok(f.size>=.7*1.8-1e-9);}
  stepSchool(s,.05,[s.fish[0].p[0]+.5,s.fish[0].p[1],s.fish[0].p[2]]);
  assert.equal(s.fish[0].behaviour,'flee');
});

test('ducks stay afloat near their raft, and swim off from a swimmer at the surface but not from a diver', () => {
  const raft=createRaft({radius_m:22,count:5,seed:9}),far=[500,500,0];
  for(let i=0;i<4000;i++)stepRaft(raft,.05,far);
  for(const d of raft.ducks){assert.equal(d.p[2],0);assert.ok(Math.hypot(d.p[0],d.p[1])<22,'stays near its raft');}
  const duck=raft.ducks[0],before=[...duck.p];
  stepRaft(raft,.05,[duck.p[0]+2,duck.p[1],0]);
  assert.equal(duck.behaviour,'flee');
  const diver=createRaft({radius_m:22,count:5,seed:9});
  stepRaft(diver,.05,[diver.ducks[0].p[0]+2,diver.ducks[0].p[1],-4]);
  assert.equal(diver.ducks[0].behaviour,'paddle');
  assert.ok(Math.hypot(duck.p[0]-before[0],duck.p[1]-before[1])>0);
});

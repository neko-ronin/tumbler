import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {createVisit} from '../src3d/insect-visits.js';

const player=(over={})=>({active:true,moving:false,still:10,sitting:false,yaw:0,top:new T.Vector3(0,1.5,0),nose:new T.Vector3(0,1.1,.2),...over});
const run=(visit,p,seconds,dt=.05,time0=0)=>{for(let t=0;t<seconds;t+=dt)visit.tick(dt,p,time0+t);};

test('a bee near a still player lands on the head, is shooed, and leaves peacefully',()=>{
  const bee=createVisit('bee'),p=player();
  assert.equal(bee.claim(4,0,1.5,.9,p),true);
  run(bee,p,1.9);
  assert.equal(bee.v.state,'perch');assert.ok(bee.v.landed);
  assert.ok(bee.v.pos.distanceTo(p.top)<1e-6,'it sits on the crown of the head');
  run(bee,p,2.4);assert.equal(bee.v.state,'shoo');
  let peak=0;for(let t=0;t<4;t+=.05){bee.tick(.05,p);peak=Math.max(peak,bee.v.gesture);}
  assert.ok(peak>.95,'the shoo wave reaches full strength');
  assert.equal(bee.v.gesture,0,'and ends');
  assert.equal(bee.v.state,'leave');
  const before=bee.v.pos.clone();run(bee,p,5);
  assert.ok(bee.v.pos.distanceTo(before)>6,'it flies off');
  run(bee,p,6,.05,100);assert.equal(bee.v.state,'idle');assert.equal(bee.v.id,-1);
  assert.equal(bee.claim(4,0,1.5,.9,p),false,'and does not come straight back');
});

test('a bee ignores a player who is moving, or a bee that is not very close',()=>{
  const bee=createVisit('bee');
  assert.equal(bee.claim(1,0,1.5,.9,player({moving:true})),false);
  assert.equal(bee.claim(1,0,1.5,.9,player({still:1})),false);
  assert.equal(bee.claim(1,5,1.5,.9,player()),false);
});

test('a player who moves brushes the bee off without a shoo',()=>{
  const bee=createVisit('bee'),p=player();bee.claim(2,0,1.5,.9,p);run(bee,p,2.5);
  assert.ok(bee.v.landed);
  p.moving=true;run(bee,p,.1);
  assert.equal(bee.v.state,'leave');assert.equal(bee.v.landed,false);assert.equal(bee.v.gesture,0);
});

test('a butterfly lands on the nose of a seated player and stays until they move',()=>{
  const butterfly=createVisit('butterfly'),p=player({sitting:true});
  assert.equal(butterfly.claim(3,0,1.3,1,player({sitting:false})),false,'standing players are not visited');
  assert.equal(butterfly.claim(3,0,1.3,1,p),true);
  run(butterfly,p,3);
  assert.equal(butterfly.v.state,'settle');assert.ok(butterfly.v.landed);
  assert.ok(butterfly.v.pos.distanceTo(p.nose)<1e-6);
  run(butterfly,p,30);
  assert.equal(butterfly.v.state,'settle','it stays as long as they sit');
  assert.equal(butterfly.v.focus,1,'and the eye has settled on it');
  p.moving=true;run(butterfly,p,.1);
  assert.equal(butterfly.v.state,'leave');
  run(butterfly,p,9,.05,50);
  assert.equal(butterfly.v.state,'idle');assert.equal(butterfly.v.focus,0);
});

test('standing up (leaving the seated pose) also sends the butterfly away',()=>{
  const butterfly=createVisit('butterfly'),p=player({sitting:true});butterfly.claim(1,0,1.3,1,p);run(butterfly,p,4);
  p.sitting=false;run(butterfly,p,.1);assert.equal(butterfly.v.state,'leave');
});

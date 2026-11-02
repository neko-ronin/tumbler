import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {createVisit} from '../src3d/insect-visits.js';

const player=(over={})=>({active:true,moving:false,still:10,sitting:false,yaw:0,top:new T.Vector3(0,1.5,0),nose:new T.Vector3(0,1.1,.2),...over});
const run=(visit,p,seconds,dt=.05,time0=0)=>{for(let t=0;t<seconds;t+=dt)visit.tick(dt,p,time0+t);};

test('a bee near a still player lands on the head, is shooed, and leaves peacefully',()=>{
  const bee=createVisit('bee'),p=player();
  assert.equal(bee.claim(4,0,1.5,.9,p),true);
  run(bee,p,1.9);
  assert.equal(bee.v.state,'perch');assert.ok(bee.v.landed);
  assert.ok(bee.v.pos.y>p.top.y+.075,'its feet sit above the crown surface');
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
  assert.ok(Math.abs(butterfly.v.pos.distanceTo(p.nose)-.020)<1e-6);
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


test('bee body clears crown and waits for a brisk raised shoo',()=>{
  const bee=createVisit('bee'),p=player();bee.claim(4,0,1.5,.9,p);run(bee,p,1.9);
  assert.ok(bee.v.pos.y-p.top.y>=.075,'body and legs clear crown');
  while(bee.v.state==='perch')bee.tick(.01,p);
  run(bee,p,.5,.01);assert.ok(bee.v.gesture>.95,'arm raised within half a second');
  assert.ok(bee.v.landed,'bee waits for brush');
  while(bee.v.state==='shoo')bee.tick(.01,p);
  assert.ok(bee.v.gesture>.95,'departure during raised gesture');assert.ok(bee.v.wave<1,'prompt brush');
});

test('bee approaches from above rather than through the head',()=>{
  const bee=createVisit('bee'),p=player();bee.claim(4,0,1,.7,p);
  for(let t=0;t<1.8;t+=.01){bee.tick(.01,p);if(Math.hypot(bee.v.pos.x,bee.v.pos.z)<.3)assert.ok(bee.v.pos.y>=p.top.y+.075,'above crown before entering head footprint');}
});

test('perched butterfly stands head-up with its feet toward the nose',()=>{
  const b=createVisit('butterfly'),p=player({sitting:true});b.claim(3,0,1.3,1,p);run(b,p,5);
  const q=new T.Quaternion().setFromEuler(new T.Euler(b.v.pitch,b.v.heading,b.v.roll,'YXZ'));
  const body=new T.Vector3(0,0,1).applyQuaternion(q),feet=new T.Vector3(0,-1,0).applyQuaternion(q);
  assert.ok(body.y>.99,'body is upright, rather than lying across the muzzle');
  assert.ok(feet.z<-.99,'feet point back toward the nose, with folded wings forward of it');
  assert.ok(b.v.pos.z>p.nose.z+.015&&b.v.pos.z<p.nose.z+.025,'small foot contact clearance');
});


test('bee feet clear the actual animated beanie, and the shoo raises the rendered paw',()=>{
  const config=JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url)));
  const assetBytes=readFileSync(new URL('../../../shared/geometry/'+config.asset,import.meta.url));
  const beeAsset=parseGLB(readFileSync(new URL('../../../shared/geometry/flight/bee.glb',import.meta.url)));
  const footY=Math.min(...beeAsset.primitives.flatMap(p=>Array.from(p.geometry.attributes.position.array).filter((_,i)=>i%3===1)));
  for(const scale of [1,.52]){
    const cat=createCharacter(parseGLB(assetBytes),{...config,scale});cat.update(.1,'idle');cat.object.updateMatrixWorld(true);
    const p=player();cat.anchors(p);const bee=createVisit('bee');bee.claim(4,p.top.x,p.top.y+.2,p.top.z+.7,p);run(bee,p,1.9);
    const hat=cat.model.getObjectByName('beanie'),ray=new T.Raycaster(p.top.clone().add(new T.Vector3(0,.4,0)),new T.Vector3(0,-1,0));
    const hit=ray.intersectObject(hat,true)[0];assert.ok(hit,'measure the real crown surface');
    const gap=bee.v.pos.y+footY*1.85-hit.point.y;
    assert.ok(gap>=-.003&&gap<.012,`feet touch the hat without sinking or hovering (${gap})`);
    const paw=cat.model.getObjectByName('paw.R'),before=paw.getWorldPosition(new T.Vector3());
    cat.gesture.shoo=1;cat.gesture.wave=.68;cat.update(.01,'idle');cat.object.updateMatrixWorld(true);
    assert.ok(paw.getWorldPosition(new T.Vector3()).y-before.y>.5*scale,'actual paw is raised before bee departure');
    cat.dispose();
  }
});

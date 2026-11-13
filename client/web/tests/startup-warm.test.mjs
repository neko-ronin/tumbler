/** The opening's warm-up: the village view is warmed where it starts, then the
 * walk view the shot lands on is warmed with Cat Ronin visible and the actor
 * shadow map drawing, and the village view is put back exactly. */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {cameraFixture} from './helpers/camera-fixture.mjs';
import {createActorShadows} from '../src3d/actor-shadow.js';
import {style} from '../src3d/style.js';
import {warmScene} from '../src3d/loading.js';
import {SHOT_S} from '../src3d/navigation.js';

test('the intro warms the walk view it lands on, then restores the village view exactly',async t=>{
 const f=cameraFixture(t),{nav,camera,orbit,character}=f;
 // The authored opening bookmark: the camera the shot starts from, and the
 // look-around target it holds.
 const VIEW={position:[-672,73.8391,-442],target:[-696,89.8391,-472]};
 nav.select('orbit');
 camera.position.fromArray(VIEW.position);camera.lookAt(...VIEW.target);orbit.target.fromArray(VIEW.target);
 // One body mesh, so the actor sun map has a caster to draw while warming.
 const body=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial());character.object.add(body);
 const drawn=[];
 const renderer={shadowMap:{needsUpdate:false},getRenderTarget(){return null;},setRenderTarget(){},render(world){
  drawn.push(world.children.filter(node=>node.isMesh&&node.visible).length);
  world.children.find(node=>node.isDirectionalLight).shadow.map??={texture:{}};
 }};
 const scene=new T.Scene();scene.add(character.object);
 const shadows=createActorShadows(renderer,[character.object],style);
 const before={position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),fov:camera.fov,target:orbit.target.toArray(),mode:nav.mode};
 const arrival={};
 const result=await nav.warmArrival(()=>warmScene({
  // The real warm paints frames and waits on a GPU fence; this fixture only
  // needs the convergence contract: unchanged resources, no pending handoff.
  paint:async()=>{},prepare(){},compile:async()=>{},finish:async()=>{},
  render(){
   arrival.mode=nav.mode;arrival.visible=character.object.visible;arrival.fov=camera.fov;
   arrival.state={...nav.state};arrival.rotation=character.object.rotation.toArray();
   arrival.position=camera.position.toArray();arrival.quaternion=camera.quaternion.toArray();
   const s=nav.state;
   shadows.update(new T.Vector3(s.x,s.z,-s.y),style.sun.value);
  },
  signature:()=>JSON.stringify([shadows.stats.casters,shadows.stats.spanM]),
  pending:()=>false,
 }));
 t.after(()=>{shadows.sun.shadow.map=null;shadows.dispose();});
 // (b) The warm ran on the arrival view, with the body genuinely visible and
 // the actor map drawing a real caster every frame.
 assert.ok(result.frames>=4,`warm did not settle: ${result.frames} frames`);
 assert.equal(drawn.length,result.frames);
 assert.ok(drawn.every(count=>count>0),`actor map drew no caster: ${drawn}`);
 assert.ok(shadows.stats.frame>=result.frames);
 assert.equal(style.actorShadowReady.value,1);
 assert.equal(arrival.mode,'walk');
 assert.equal(arrival.visible,true);
 assert.equal(arrival.fov,62);
 assert.ok(Math.abs(arrival.state.x-VIEW.position[0])<1e-9&&Math.abs(arrival.state.y+VIEW.position[2])<1e-9,'the arrival is not the spawn below the bookmark');
 // (a) The preview put every camera and look-around field back, and owns no shot.
 assert.deepEqual(camera.position.toArray(),before.position);
 assert.deepEqual(camera.quaternion.toArray(),before.quaternion);
 assert.equal(camera.fov,before.fov);
 assert.deepEqual(orbit.target.toArray(),before.target);
 assert.equal(nav.mode,before.mode);
 assert.equal(nav.state,null);
 assert.equal(nav.shot,null);
 assert.equal(character.object.visible,false);
 // (c) The authored shot that follows still starts from the bookmark, with the
 // same turn and field of view. Its arrival is the state the preview warmed, not
 // a second opinion about it. The warm must not shorten the move it warmed for;
 // the exact duration is owned by navigation and pinned in intro-shot.test.mjs.
 assert.ok(SHOT_S>=2.5,`the warm left the shot ${SHOT_S}s long`);
 nav.select('walk');
 assert.ok(nav.shot,'look around → walk must still be one continuous shot');
 assert.deepEqual(nav.shot.from.toArray(),before.position);
 assert.deepEqual(nav.shot.q.toArray(),before.quaternion);
 assert.equal(nav.shot.fov,before.fov);
 assert.equal(nav.shot.t,0);
 assert.deepEqual(camera.position.toArray(),arrival.position);
 assert.deepEqual(camera.quaternion.toArray(),arrival.quaternion);
 assert.deepEqual(character.object.rotation.toArray(),arrival.rotation);
 assert.equal(nav.state.x,arrival.state.x);assert.equal(nav.state.y,arrival.state.y);
});

test('the entry keeps the warmed arrival instead of restoring the bookmark',async t=>{
 const f=cameraFixture(t),{nav,camera}=f;
 const VIEW={position:[-672,73.8391,-442],target:[-696,89.8391,-472]};
 nav.select('orbit');
 camera.position.fromArray(VIEW.position);camera.lookAt(...VIEW.target);
 const arrival={};
 await nav.warmArrival(async()=>{
  arrival.mode=nav.mode;arrival.state={...nav.state};arrival.position=camera.position.toArray();arrival.shot=nav.shot;
  return {frames:4};
 },{restore:false});
 assert.equal(arrival.mode,'walk');
 assert.equal(arrival.shot,null,'the entry owns no interpolated shot');
 assert.equal(nav.mode,'walk','the entry stays in the walk state it warmed');
 assert.deepEqual(camera.position.toArray(),arrival.position,'the first live frame opens on the warmed camera');
 assert.equal(nav.state.x,arrival.state.x);
 assert.equal(nav.state.y,arrival.state.y);
});

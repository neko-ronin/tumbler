import test from 'node:test';import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {createActorShadows,snappedShadowAnchor} from '../src3d/actor-shadow.js';
import {style} from '../src3d/style.js';
test('actor sun map updates moving geometry every frame without invalidating the scenery cache',()=>{
 const scene=new T.Scene(),root=new T.Group();root.visible=true;scene.add(root);
 const base=new T.Mesh(new T.BoxGeometry(),new T.MeshBasicMaterial()),fur=base.clone();fur.name='head.fur1';root.add(base,fur);
 const renderer={getRenderTarget(){return null;},setRenderTarget(){},shadowMap:{needsUpdate:false},render(world,camera){
  assert.equal(base.castShadow,false);assert.equal(fur.castShadow,false);
  const proxies=world.children.filter(n=>n.isMesh);assert.equal(proxies.length,1);assert.equal(proxies[0].geometry,base.geometry);assert.equal(proxies[0].castShadow,true);
  world.children.find(n=>n.isDirectionalLight).shadow.map={texture:{}};this.shadowMap.needsUpdate=false;
 }};
 const shadows=createActorShadows(renderer,scene,[root],style),sun=new T.Vector3(-.4,.8,-.3).normalize();
 for(let i=0;i<12;i++){const point=new T.Vector3(i*.1,10,0);shadows.update(point,sun);assert.ok(shadows.sun.target.position.equals(point),'moving actor map must follow sub-texel motion continuously');assert.equal(renderer.shadowMap.needsUpdate,false);assert.equal(base.castShadow,false);}
 assert.equal(shadows.stats.frame,12);assert.equal(style.actorShadowReady.value,1);
 renderer.shadowMap.needsUpdate=true;shadows.update(new T.Vector3(),sun);assert.equal(renderer.shadowMap.needsUpdate,true,'pending scenery rebuild is preserved');
 root.visible=false;shadows.update(new T.Vector3(),sun);assert.equal(style.actorShadowReady.value,0);
 // The fixture replaces only the GPU target; avoid disposing its stub.
 shadows.sun.shadow.map=null;shadows.dispose();base.geometry.dispose();base.material.dispose();
});
test('light-space anchor moves in whole shadow texels, including across the old forty-metre boundary',()=>{
 const sun=new T.Vector3(-.64,.48,-.55).normalize(),right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),sun).normalize();
 let previous=null;
 for(let x=39.8;x<40.2;x+=.01){const a=snappedShadowAnchor(new T.Vector3(x,30,17),sun);assert.ok(Math.abs(a.dot(right)/(64/1024)-Math.round(a.dot(right)/(64/1024)))<1e-8);if(previous)assert.ok(a.distanceTo(previous)<.2,'crossing a world-grid boundary must not jump forty metres');previous=a;}
});

test('separated visible actors retain their former local shadow coverage',()=>{
 const scene=new T.Scene(),pilot=new T.Group(),parked=new T.Group();scene.add(pilot,parked);
 const geometry=new T.BoxGeometry(),material=new T.MeshBasicMaterial();pilot.add(new T.Mesh(geometry,material));const wing=new T.Mesh(geometry,material);parked.add(wing);parked.position.x=20;
 const renderer={shadowMap:{needsUpdate:false},getRenderTarget(){return null},setRenderTarget(){},render(world){const sun=world.children.find(n=>n.isDirectionalLight);sun.shadow.updateMatrices(sun);sun.shadow.map??={texture:{}};}};
 const shadows=createActorShadows(renderer,scene,[pilot,parked],style),sun=new T.Vector3(0,1,.3).normalize(),point=new T.Vector3();
 shadows.update(point,sun);
 const contains=()=>{const q=wing.getWorldPosition(new T.Vector3()).applyMatrix4(shadows.sun.shadow.matrix);return q.x>.01&&q.x<.99&&q.y>.01&&q.y<.99;};
 assert.ok(contains(),'walking away must not clip a parked wing that was inside the prior actor map');
 const wideTexel=shadows.stats.worldTexelM;parked.position.x=0;shadows.update(point,sun);assert.ok(contains());assert.ok(shadows.stats.worldTexelM<wideTexel,'coupled actors retain concentrated shadow detail');
 shadows.sun.shadow.map=null;shadows.dispose();geometry.dispose();material.dispose();
});

import test from 'node:test';import assert from 'node:assert/strict';import * as T from '../vendor/three.module.min.js';
import {createStaticTreeShadows} from '../src3d/static-shadows.js';import {style} from '../src3d/style.js';
test('each fixed sun preset reuses its baked layer even when source generation is unavailable',()=>{
 const group=new T.Group(),material=new T.MeshBasicMaterial({transparent:true,opacity:.23});material.defines={USE_UV:''};group.add(new T.Mesh(new T.PlaneGeometry(4,4),material));
 const source={group,setSun(){}},ground={farField:{minX:-4,maxX:4,minY:-4,maxY:4}};
 let current=null;const renderer={getRenderTarget(){return current;},setRenderTarget(t){current=t;},getClearAlpha(){return 1;},getClearColor(c){return c.set(0);},setClearColor(){},clear(){},render(scene){assert.equal(scene.children[0].material.defines.USE_UV,'');}};
 const cache=createStaticTreeShadows(renderer,source,ground,style),a=new T.Vector3(1,1,0).normalize(),b=new T.Vector3(-1,1,0).normalize(),c=new T.Vector3(0,1,1).normalize();
 const first=cache.setSun(a);cache.setSun(b);cache.setSun(c);source.setSun=()=>{throw Error('Source must not regenerate for a baked preset');};
 assert.equal(cache.setSun(a),first);assert.equal(cache.stats.bytes,48*1024*1024);assert.equal(group.visible,false);assert.equal(style.staticTreeReady.value,1);
 cache.invalidate();assert.equal(style.staticTreeReady.value,0);assert.equal(cache.stats.bytes,0);group.children[0].geometry.dispose();material.dispose();
});

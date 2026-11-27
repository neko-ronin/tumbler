import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createPlayProps} from '../src3d/play-props.js';

const load=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
test('a swing through grass or fern throws clippings anywhere, and changes no plant or prop',()=>{
  const scene=new T.Scene(),play=createPlayProps({hill:load('../../../shared/play/tumble-hill.json'),table:load('../../../shared/play/reactions.json'),height:()=>100,scene});
  const before=play.props.map(p=>[p.root.position.toArray(),p.gone,p.anim]);
  const camera=new T.PerspectiveCamera();camera.position.set(5000,102,-5000);  // far from the hill: its props are hidden
  assert.equal(play.clippings([5000,5000],0,{grass:0,fern:0}),0,'bare ground: nothing');
  const made=play.clippings([5000,5000],0,{grass:.8,fern:0});assert(made>15,'meadow: blades, chaff and a few petals');
  assert(play.clippings([5000,5000],0,{grass:0,fern:1},true)>made,'a heavy swing in fern throws more');
  play.update(1/60,camera);const pool=scene.getObjectByName('play_particles');
  assert(pool.count>0&&pool.parent===scene,'drawn even where the hill group is hidden');
  assert.deepEqual(play.props.map(p=>[p.root.position.toArray(),p.gone,p.anim]),before,'no prop moved, cut or animated');
  for(let i=0;i<300;i++)play.update(1/60,camera);assert.equal(pool.count,0,'the clippings settle and fade');
  play.dispose();
});

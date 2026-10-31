import test from 'node:test';
import assert from 'node:assert/strict';
import {treeSpots,createTreeIndex,birdPhrase,createBirds} from '../src3d/audio.js';

const tree=(x,y,z,asset='redwood/silver_fir.glb')=>({asset,position_m:[x,y,z],scale:[1,1,1]});
// A fake AudioContext that records what is scheduled; every node chains and accepts any param.
function fakeContext(){
  const log={oscillators:0,panners:[],starts:[]};
  const param=()=>({value:0,setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}});
  const node=extra=>{const n={connect:x=>x,disconnect(){},frequency:param(),gain:param(),...extra};return n;};
  return {log,sampleRate:100,currentTime:0,destination:node(),
    createBuffer:(c)=>({getChannelData:()=>new Float32Array(180)}),createConvolver:()=>node(),createBiquadFilter:()=>node(),createGain:()=>node(),
    createOscillator:()=>node({start(t){log.oscillators++;log.starts.push(t);},stop(){}}),
    createPanner:()=>{const p=node({positionX:param(),positionY:param(),positionZ:param()});log.panners.push(p);return p;}};
}

test('treeSpots maps placement metres to scene space (x, up, -north) and keeps only trees',()=>{
  const spots=treeSpots([tree(10,20,30),{asset:'homestead/hut.glb',position_m:[1,2,3]}]);
  assert.deepEqual([...spots.slice(0,3)],[10,30,-20]);assert.equal(spots.length,4);assert.ok(spots[3]>0);
});
test('the tree index returns exactly the trees within the radius, across cell borders',()=>{
  const spots=treeSpots([tree(31,0,0),tree(33,0,0),tree(100,0,0),tree(-40,0,0)]);
  const near=createTreeIndex(spots).near(32,0,5).map(n=>spots[n]);
  assert.deepEqual(near.sort((a,b)=>a-b),[31,33]);
  assert.deepEqual(createTreeIndex(spots).near(500,500,75),[]);
});
test('a phrase is a handful of notes that never start before it is asked to',()=>{
  const c=fakeContext(),d=birdPhrase(c,c.destination,{n:[3,3],len:.1,gap:.1,hz:[3000,3000],glide:1,step:1,vib:0},2);
  assert.equal(c.log.oscillators,3);assert.ok(Math.min(...c.log.starts)>=2);assert.ok(Math.abs(d-.6)<1e-9);
});
test('birds sing only from a tree in range, at that tree’s position, and stay silent without trees',()=>{
  const far=createTreeIndex(treeSpots([tree(900,0,900)]));
  const lone=fakeContext(),quiet=createBirds(lone,far,{random:()=>.1});
  for(let t=0;t<60;t++){lone.currentTime=t;quiet.update({x:0,y:0,z:0});}
  assert.equal(lone.log.panners.length,0);
  // Dense stand: forty trees around the listener, so recruiting is certain.
  const dense=createTreeIndex(treeSpots(Array.from({length:40},(_,i)=>tree(i,10,0))));
  const c=fakeContext(),birds=createBirds(c,dense,{random:()=>.5});
  for(let t=0;t<30;t++){c.currentTime=t;birds.update({x:0,y:10,z:0});}
  assert.ok(c.log.panners.length>0,'a dense stand sings');
  const treeXs=new Set(Array.from({length:40},(_,i)=>i));
  for(const p of c.log.panners){assert.ok(treeXs.has(p.positionX.value));assert.equal(p.positionZ.value,-10);assert.ok(p.positionY.value>0);}
});

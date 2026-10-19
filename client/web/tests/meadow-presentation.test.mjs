import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {createMeadowAir} from '../src3d/air-cues.js';
import {style} from '../src3d/style.js';

test('meadow wind stays at fixed world positions and preserves the signed shared field',()=>{
  const visited=[];
  const field=createMeadowAir((x,y,z)=>{visited.push([x,y,z]);return {wx:x*.1,wy:y*.2,lift:999,gust:-z,intensity:.3};},
    {height:(x,y)=>x+y},{size:2,span:40,x:-20,z:-20});
  try{
    field.update(0);
    assert.deepEqual(visited,[[-10,10,2],[10,10,22],[-10,-10,-18],[10,-10,2]]);
    assert.deepEqual(style.meadowAirGrid.value.toArray(),[-20,-20,40,2]);
    for(const texture of field.textures){
      assert.equal(texture.minFilter,T.NearestFilter);assert.equal(texture.magFilter,T.NearestFilter);
      visited.forEach(([x,y,z],i)=>{
        const a=texture.image.data.subarray(i*4,i*4+4);
        assert.ok(Math.abs(a[0]-x*.1)<1e-6);assert.ok(Math.abs(a[1]+y*.2)<1e-6);
        assert.equal(a[2],-z);assert.ok(Math.abs(a[3]-.3)<1e-6);
      });
    }
    visited.length=0;field.update(.25);
    assert.deepEqual(visited,[[-10,10,2],[10,10,22],[-10,-10,-18],[10,-10,2]],'moving the observer cannot relocate the field');
  }finally{field.dispose();}
});

test('meadow weather samples crossfade continuously, including a sign reversal',()=>{
  let speed=4;
  const field=createMeadowAir(()=>({wx:speed,wy:0,lift:0,intensity:0}),{height:()=>0},{size:2,hz:4});
  const displayed=()=>T.MathUtils.lerp(style.meadowAirFrom.value.image.data[0],style.meadowAirTo.value.image.data[0],style.meadowAirMix.value);
  try{
    field.update(0);assert.equal(displayed(),4);
    speed=-4;field.update(.25);assert.equal(displayed(),4,'new sample begins at the old visible vector');
    field.update(.125);assert.equal(displayed(),0,'a reversal interpolates signed velocity, not angle');
    field.update(.125);assert.equal(displayed(),-4,'swapping buffers preserves the last interpolated value');
    const disposed=[];for(const t of field.textures)t.addEventListener('dispose',()=>disposed.push(t));
    field.dispose();assert.equal(new Set(disposed).size,2);
  }finally{field.dispose();}
});

test('grass roots follow the supplied terrain plane without changing stamp coverage',async()=>{
  const {buildMeadowTiles,buildMeadowPatch}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array([1,0,0,1]),resolution:2,quad:8,offsetX:-8,offsetY:-8};
  const ground={height:(x,y)=>40+x*.25+y*.4},patch=buildMeadowPatch();
  const meadow=buildMeadowTiles(cover,ground,patch);
  const expected=new T.Vector3(-.25,1,.4).normalize(),matrix=new T.Matrix4(),up=new T.Vector3();
  try{
    let roots=0;
    for(const mesh of meadow.group.children)for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);up.set(0,1,0).transformDirection(matrix);
      assert.ok(up.dot(expected)>.999999,'patch base follows the actual slope');
      const x=matrix.elements[12],y=-matrix.elements[14];
      assert.equal(matrix.elements[13],Math.fround(ground.height(x,y)));
      assert.ok(cover.covered[Math.floor((y+8)/8)*2+Math.floor((x+8)/8)]);
      roots++;
    }
    assert.equal(roots,cover.covered.reduce((a,b)=>a+b,0));
  }finally{
    meadow.group.children.forEach(m=>m.geometry.dispose());patch.geometry.dispose();patch.material.dispose();
  }
});

test('moving the close-meadow window preserves every root in the overlapping interior',async()=>{
  const {buildCloseMeadow}=await import('../src3d/groundcover.js');
  const cover={covered:new Uint8Array(128*128).fill(1),resolution:128,quad:8,offsetX:-512,offsetY:-512};
  const close=buildCloseMeadow(cover,{height:()=>40}),camera={position:new T.Vector3(0,43,0)},matrix=new T.Matrix4();
  const roots=()=>Array.from({length:close.mesh.count},(_,i)=>{close.mesh.getMatrixAt(i,matrix);return [matrix.elements[12],matrix.elements[14]];});
  const key=p=>p.map(v=>v.toFixed(4)).join(',');
  try{
    close.update(camera);const before=new Set(roots().map(key));
    camera.position.x=13;close.update(camera);
    const interior=roots().filter(([x,z])=>Math.hypot(x,z)<30&&Math.hypot(x-12,z)<30);
    assert.ok(interior.length>0,'the two windows have an occupied overlap');
    for(const root of interior)assert.ok(before.has(key(root)),`surviving world root ${key(root)} must not swim with the window`);
  }finally{close.mesh.geometry.dispose();close.mesh.material.dispose();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createAirCues} from '../src3d/air-cues.js';
import {buildEcology} from '../src3d/ecology.js';
import {parseGLB} from '../src3d/glb.js';

test('air cues retain signed velocities with a supported filter, including absent capabilities',()=>{
  const sample=()=>({wx:-2,wy:3,lift:-.5,intensity:.2});
  for(const supported of [undefined,false,true]){
    const renderer=supported===undefined?undefined:{extensions:{has(name){
      assert.equal(name,'OES_texture_float_linear');return supported;
    }}};
    const cue=createAirCues(sample,{height:()=>0},{size:2,span:20,renderer});
    try{
      cue.update({position:{x:0,z:0}},.2);
      const expected=supported?T.LinearFilter:T.NearestFilter;
      assert.equal(cue.texture.minFilter,expected);
      assert.equal(cue.texture.magFilter,expected);
      const values=cue.texture.image.data;
      for(let i=0;i<values.length;i+=4){
        assert.equal(values[i],-2);assert.equal(values[i+1],-3);
        assert.equal(values[i+2],-.5);assert.ok(Math.abs(values[i+3]-.2)<1e-6);
      }
    }finally{cue.dispose();}
  }
});

test('every windborne mote spawns inside its eviction circle and keeps drifting when the camera moves',()=>{
  const assets={};
  for(const path of ['waterside/river_fish.glb','waterside/fish_tail.glb',
    'waterside/frog.glb','waterside/dragonfly.glb','waterside/dragonfly_wings.glb'])
    assets[path]=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)));
  const meadow=JSON.parse(readFileSync(new URL('../../../shared/ecology/meadow.json',import.meta.url)));
  for(const density of [meadow.windborne.per_hectare,400]){
    const ecology=buildEcology({habitats:[],plantings:[]},{species:[],windborne:{per_hectare:density}},
      assets,{height:()=>0},{contains:()=>true},null,()=>({wx:2,wy:1,lift:0}));
    const debris=ecology.group.children.find(c=>c.isInstancedMesh&&c.material.isMeshBasicMaterial);
    const camera={position:new T.Vector3(0,2,0)},matrix=new T.Matrix4();
    const positions=()=>Array.from({length:debris.count},(_,i)=>{
      debris.getMatrixAt(i,matrix);return [matrix.elements[12],matrix.elements[14]];
    });
    ecology.update(camera,0);
    let before=positions();assert.ok(before.length>0);
    for(const [x,z]of before)assert.ok(Math.hypot(x,z)<45,'a fresh mote must not immediately be evicted');
    for(let frame=1;frame<=4;frame++){
      if(frame===3)camera.position.x+=1;
      ecology.update(camera,frame*.05);
      const after=positions();assert.equal(after.length,before.length);
      for(let i=0;i<before.length;i++){
        assert.ok(Math.abs(after[i][0]-before[i][0]-.1)<1e-5,'east drift must follow the wind, including after a camera move');
        assert.ok(Math.abs(after[i][1]-before[i][1]+.05)<1e-5,'south drift must follow the wind');
      }
      before=after;
    }
    const geometries=new Set(),materials=new Set();
    ecology.group.traverse(mesh=>{if(mesh.isMesh){geometries.add(mesh.geometry);materials.add(mesh.material);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());
  }
});

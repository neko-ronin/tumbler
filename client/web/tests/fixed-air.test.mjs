import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {sampleAir} from '../../../shared/activities/flight.js';
import {createFixedAirSampler} from '../src3d/fixed-air.js';
const config=JSON.parse(fs.readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const height=(x,y)=>120+Math.sin(x*.013)*35+Math.cos(y*.017)*19;

test('fixed wind queries reuse terrain while retaining current shared time and weather',()=>{
 let time=0,weather=Object.keys(config.weather)[0],queries=0;
 const sample=(x,y,z,terrain)=>sampleAir(config,285,{x,y,z,weather},time,terrain);
 const fixed=createFixedAirSampler(sample,(x,y)=>{queries++;return height(x,y);});
 try{
  const initial=fixed.sample(100,300,900),firstQueries=queries;assert.ok(firstQueries>0);
  for(const name of Object.keys(config.weather))for(const at of [.25,17,61]){
   weather=name;time=at;assert.deepEqual(fixed.sample(100,300,900),sample(100,300,900,height));
  }
  assert.equal(queries,firstQueries,'the fixed terrain basis is not recomputed as time/weather change');
  assert.notDeepEqual(fixed.sample(100,300,900),initial,'air remains time/weather dependent');
 }finally{fixed.dispose();}
});

test('cached wind remains numerically identical over varied world positions and altitude',()=>{
 let time=0,weather='soaring';
 const sample=(x,y,z,terrain)=>sampleAir(config,285,{x,y,z,weather},time,terrain),fixed=createFixedAirSampler(sample,height);
 try{for(const name of Object.keys(config.weather))for(const at of [0,3,21]){
  weather=name;time=at;
  for(const p of [[100,300,900],[-310,1600,1200],[3400,-640,14],[0,0,0]])assert.deepEqual(fixed.sample(...p),sample(...p,height));
 }}finally{fixed.dispose();}
});

test('a fixed query cache has a hard capacity and releases its world-height data',()=>{
 let queries=0;const sample=(x,y,z,terrain)=>({wx:terrain(x,y)+z});
 const fixed=createFixedAirSampler(sample,(x,y)=>{queries++;return x-y;},{maxTerrainSamples:3});
 for(let x=0;x<20;x++)assert.equal(fixed.sample(x,2,4).wx,x+2);
 assert.equal(fixed.terrainSamples,3);const before=queries;
 for(let x=0;x<3;x++)fixed.sample(x,2,4);
 assert.equal(queries,before,'retained entries remain reusable after capacity is reached');
 fixed.sample(25,2,4);assert.equal(fixed.terrainSamples,3);
 fixed.dispose();assert.equal(fixed.terrainSamples,0);
});

test('moving render samples retain immutable thermal anchors without retaining a moving trail',()=>{
 let time=0,weather='soaring',anchorReads=0;
 const anchors=config.thermals.map(t=>t.xy_m),isAnchor=(x,y)=>anchors.some(p=>p[0]===x&&p[1]===y);
 const terrain=(x,y)=>{if(isAnchor(x,y))anchorReads++;return height(x,y);};
 const sample=(x,y,z,basis)=>sampleAir(config,285,{x,y,z,weather},time,basis);
 const renderer=createFixedAirSampler(sample,terrain,{maxTerrainSamples:anchors.length,terrainAnchors:anchors});
 try{
  for(const name of Object.keys(config.weather))for(let i=0;i<40;i++){
   time=i*.37;weather=name;const p=[-310+i*3.1,1600-i*2.7,1200-i*1.3];
   assert.deepEqual(renderer.sample(...p),sample(...p,height));
  }
  assert.equal(anchorReads,anchors.length,'fixed thermal-base heights must be read once despite changing render positions/time/weather');
  assert.equal(renderer.terrainSamples,new Set(anchors.map(p=>p.join(','))).size,'moving positions must not consume permanent cache space');
 }finally{renderer.dispose();}
});

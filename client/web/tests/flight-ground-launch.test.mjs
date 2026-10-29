import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
import {relaunchGround,unharnessFlight,safeWalkGround} from '../../../shared/activities/walk.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const config=read('../../../shared/activities/flight.json'),walk=read('../../../shared/characters/player.json').walk;
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const flat=()=>0,site={xy_m:[0,0],heading_deg:0};
const ready=mode=>({...launchFlight(still,mode,site,flat),grounded:true,z:config.landing_clearance_m,speed:0,engine:0,throttle:0});

test('inflation stays put and a capped still-air flat run honestly aborts when trim launch airspeed is unavailable',()=>{
 assert.equal(config.ground_launch.max_run_mps,walk.run_mps,'assisted launch uses the existing game running-speed ceiling');
 for(const mode of Object.keys(config.modes)){
  let s=relaunchGround(ready(mode),walk,still,flat),stages=new Set();
  assert.equal(s.speed,0);assert.equal(s.z,config.landing_clearance_m);
  for(let i=0;i<2400&&s.launching;i++){
   const before=s;s=stepFlight(s,{},1/120,i/120,still,270,flat);stages.add(s.launchStage);
   if(s.launchStage==='inflating'){assert.equal(s.x,0);assert.equal(s.y,0);assert.equal(s.z,before.z);}
   assert.equal(s.z,config.landing_clearance_m,'no altitude award during preparation');
   assert.ok(s.launchRunSpeed<=config.ground_launch.max_run_mps,'legs cannot silently accelerate to canopy trim speed');
  }
  assert.deepEqual(stages,new Set(['inflating','running']));assert.ok(s.grounded&&s.launchAborted,mode);
  assert.ok(s.x>3);assert.equal(s.speed,0);assert.equal(s.groundSpeed,0);
  assert.match(s.figure,/headwind|descending ground/);
  assert.ok(s.launchWorkHead>0);assert.ok(s.launchTime>config.ground_launch.inflate_s);
 }
});

test('dry ledges and sufficient headwind still permit capped assisted launches in every mode',()=>{
 const ledge=x=>x<12?0:-10;
 const windy={...still,wind:{speed_mps:15,gust_mps:0},weather:{soaring:{...still.weather.soaring,wind_scale:1}}};
 for(const mode of Object.keys(config.modes))for(const kind of ['ledge','headwind']){
  const rules=kind==='ledge'?still:windy,height=kind==='ledge'?ledge:flat,bearing=kind==='ledge'?270:90;
  const footing=(x,y)=>safeWalkGround(x,y,walk,height,null,{dropOffs:true});
  let s=relaunchGround(ready(mode),walk,rules,height),time=0;
  while(s.launching&&time<20){
   const before=s;s=stepFlight(s,{},1/120,time,rules,bearing,height,null,footing,height);time+=1/120;
   if(before.grounded)assert.equal(s.z,before.z,'neither inflation nor ledge departure awards altitude');
   assert.ok(s.launchRunSpeed<=rules.ground_launch.max_run_mps);
  }
  assert.equal(s.grounded,false,`${mode}: ${kind}`);assert.ok(s.launchWorkHead>0);
  assert.ok(s.vx>0);assert.equal(s.vy,0);
  const next=stepFlight(s,{},1/120,time,rules,bearing,height);
  assert.ok(next.coupled,'the launch enters actual independent-body dynamics');
  if(kind==='headwind')assert.ok(next.z>s.z,'the recorded leg push clears the flat ground');
  else assert.equal(s.z,config.landing_clearance_m,'a dry ledge preserves departure height');
 }
});

test('a ground run stops at a new obstruction and a sustained tailwind cannot run forever',()=>{
 const hit=(a,b)=>a[0]<8&&b[0]>=8&&b[2]<3?{kind:'structure'}:null;
 let s=relaunchGround(ready('paraglider'),walk,still,flat,hit);
 assert.ok(s,'obstruction starts beyond the initial body clearance check');
 for(let i=0;i<1200&&s.launching;i++)s=stepFlight(s,{},1/120,i/120,still,270,flat,hit);
 assert.ok(s.launchAborted&&s.grounded&&s.x<8);assert.equal(s.speed,0);
 const windy={...still,wind:{speed_mps:30,gust_mps:0},weather:{soaring:{...still.weather.soaring,wind_scale:1}}};
 s=relaunchGround(ready('paraglider'),walk,windy,flat);
 for(let i=0;i<2400&&s.launching;i++)s=stepFlight(s,{},1/120,i/120,windy,270,flat);
 assert.ok(s.launchAborted&&s.grounded);assert.ok(s.launchDistance<config.ground_launch.max_run_m+1);
});

test('inflating can be cancelled locally and older contracts retain their assisted hop',()=>{
 const s=relaunchGround(ready('paraglider'),walk,still,flat),foot=unharnessFlight(s,walk,still,flat);
 assert.equal(foot.x,s.x);assert.equal(foot.y,s.y);assert.equal(foot.harnessMode,s.mode);
 const {ground_launch:_,...older}=still;
 assert.equal(relaunchGround(ready('paraglider'),walk,older,flat).grounded,false);
});

test('an uphill launch with no forward progress aborts in bounded time',()=>{
 const hill=x=>x*.7;
 let s={...ready('paraglider'),launching:true,launchTime:0,launchRunSpeed:0};
 for(let i=0;i<2400&&s.launching;i++)s=stepFlight(s,{},1/120,i/120,still,270,hill);
 assert.ok(s.launchAborted&&s.grounded);assert.equal(s.speed,0);
 assert.ok(s.launchTime<config.ground_launch.inflate_s+config.ground_launch.max_run_s+.02);
});

test('a ground run stops before water or missing dry ground instead of following its bed',()=>{
 const dry=(x)=>x<7?0:null;
 let s=relaunchGround(ready('paraglider'),walk,still,dry);
 assert.ok(s,'the initial three metres are dry');
 for(let i=0;i<2400&&s.launching;i++)s=stepFlight(s,{},1/120,i/120,still,270,()=>-20,null,dry);
 assert.ok(s.launchAborted&&s.grounded);assert.ok(s.x<7);assert.equal(s.z,config.landing_clearance_m);
 assert.match(s.figure,/dry ground/);
});

test('relaunch clears the previous touchdown and a collapsed fall records a fresh hard landing',()=>{
 const old={...ready('paraglider'),landingSpeed:1,landingGroundSpeed:5,landingQuality:'smooth'};
 const launch=relaunchGround(old,walk,still,flat);assert.equal(launch.landingQuality,undefined);
 const fall={...launch,launching:false,grounded:false,collapsed:true,z:config.landing_clearance_m+.001,vertical:-8,vx:3,vy:4};
 const s=stepFlight(fall,{},1/120,0,still,270,flat);
 assert.ok(s.grounded);assert.equal(s.landingQuality,'hard');assert.ok(s.landingSpeed>8);
 assert.ok(s.landingGroundSpeed>4&&s.landingGroundSpeed<5);
});

test('touchdown preserves measured descent and ground speed before stopping',()=>{
 for(const [vertical,quality] of [[-1,'smooth'],[-3,'firm'],[-7,'hard']]){
  const start={...launchFlight(still,'paraglider',site,flat),z:config.landing_clearance_m+.001,vertical,vario:vertical};
  const s=stepFlight(start,{},1/120,0,still,270,flat);
  assert.ok(s.grounded);assert.equal(s.landingQuality,quality);assert.ok(s.landingSpeed>0);
  assert.ok(s.landingGroundSpeed>10);assert.equal(s.speed,0);
 }
});

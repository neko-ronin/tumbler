import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{launchFlight,stepFlight}from'../../../shared/activities/flight.js';
import{sha256,verifyFetched,checkVersion}from'../src3d/provenance.js';
import{createCollisionIndex}from'../../../shared/activities/collision.js';
import{createSchool,stepSchool}from'../../../shared/ecology/aquatic.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const flat=()=>0,site={xy_m:[0,0],heading_deg:0};
function run(mode,changes={},seconds=5){const rules={...config,thermals:[],...changes};let s=launchFlight(rules,mode,site,flat);s.z=100;for(let i=0;i<seconds*120;i++)s=stepFlight(s,{turn:.1},1/120,i/120,rules,245,flat);return s;}
test('unpowered flight loses height in still air; motor thrust produces climb',()=>{const glide=run('paraglider');assert.ok(glide.z<100);const powered=run('paramotor');assert.ok(powered.z>100);assert.ok(glide.distance>30);});
test('legacy parakite converts target dive speed into flare height without adding energy',()=>{
  // This is the fallback's direct speed/height exchange, not the coupled
  // model's force-driven flare arc and full mechanical-energy ledger.
  const rules={...config,coupled:undefined,thermals:[],wind:{speed_mps:0,gust_mps:0}};
  let s=launchFlight(rules,'parakite',site,flat);s.z=500;
  for(let i=0;i<240;i++)s=stepFlight(s,{brake:-1},1/120,i/120,rules,245,flat);
  const dive={...s};assert.ok(dive.speed>config.modes.parakite.trim_mps);
  for(let i=0;i<120;i++)s=stepFlight(s,{brake:1},1/120,2+i/120,rules,245,flat);
  assert.ok(s.speed<dive.speed);assert.ok(s.z>dive.z);assert.ok(s.z+config.modes.parakite.flare_efficiency*s.speed*s.speed/(2*9.81)<500+config.modes.parakite.flare_efficiency*config.modes.parakite.trim_mps**2/(2*9.81),'total mechanical energy decreases');
  assert.equal(config.modes.parakite.tether_m,0);
});
test('terrain contact lands and stops the pilot, without mutating prior state',()=>{const s=launchFlight(config,'paraglider',site,flat);s.z=1.0;s.vertical=-3;const landed=stepFlight(s,{},1/120,0,config,245,flat);assert.equal(landed.grounded,true);assert.equal(landed.speed,0);assert.equal(landed.z,config.landing_clearance_m);assert.equal(s.z,1);});
test('thermal location and ceiling are read from core data',()=>{const rising=run('paraglider',{thermals:[{xy_m:[0,0],radius_m:500,lift_mps:6,top_m:1000}]});assert.ok(rising.z>100);assert.throws(()=>launchFlight({...config,version:config.version+1},'paraglider',site,flat),/Unsupported/);});
test('byte provenance fails on a single changed byte and rejects future data',async()=>{const bytes=new Uint8Array([1,2,3]);const expected=[{path:'world',sha256:await sha256(bytes)}];assert.equal(await verifyFetched(expected,new Map([['world',sha256(bytes)]]),()=>{throw Error('not needed')}),1);await assert.rejects(()=>verifyFetched(expected,new Map([['world',sha256(new Uint8Array([1,2,4]))]])),/World data changed/);assert.throws(()=>checkVersion({version:99},1,'habitat'),/unsupported/);});
test('school motion stays finite, submerged and responds to the observer',()=>{const h={radii_m:[9,2],depth_range_m:[.32,1.35],current_mps:.18,seed:42,fish_count:18};const far=createSchool(h),near=createSchool(h);assert.deepEqual(far,near);for(let i=0;i<300;i++){stepSchool(far,1/60,[100,100,100]);stepSchool(near,1/60,[0,0,-.5]);}assert.notDeepEqual(far.fish,near.fish);for(const f of near.fish){assert.ok(f.p.every(Number.isFinite));assert.ok(f.p[2]<=-.32&&f.p[2]>=-1.35);}});

test('swept collision catches thin obstacles and ignores clear travel',()=>{
 const hit=createCollisionIndex([{min:[5,-1,0],max:[5.1,1,10],kind:'tree'}]);
 assert.equal(hit([0,0,5],[10,0,5],.4)?.kind,'tree');assert.equal(hit([0,4,5],[10,4,5],.4),null);
 // Rules without `collapse` keep the original stop on impact (collision-flight.test.mjs has the collapse).
 const {collapse,...older}=config,s=launchFlight(older,'paraglider',site,flat);s.z=5;s.x=4.6;
 const stopped=stepFlight(s,{},.1,0,older,245,flat,hit);assert.equal(stopped.impact,'tree');assert.equal(stopped.grounded,true);
 const bounced=stepFlight(s,{},.1,0,config,245,flat,hit);assert.equal(bounced.impact,undefined);assert.equal(bounced.collapsed,true);
});

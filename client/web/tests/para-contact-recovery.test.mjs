import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
const shipped=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const config={...shipped,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const flat=()=>0,site={xy_m:[0,0],heading_deg:0,clearance_m:80};
function soft(side,broad=false){const hit=()=>null;hit.soft=(p)=>broad||p[1]*side>config.modes.paraglider.span_m*.4?[{shape:{id:'brush'},depth:.1}]:[];return hit;}
test('either wingtip recovers while broad foliage contact still collapses',()=>{
 const start=launchFlight(config,'paraglider',site,flat),left=stepFlight(start,{},1/120,0,config,245,flat,soft(-1)),right=stepFlight(start,{},1/120,0,config,245,flat,soft(1));
 for(const s of [left,right]){assert.ok(!s.collapsed);assert.equal(s.canopyBrush,true);assert.ok(s.coupled);assert.ok(s.pressure<1);}
 assert.ok(left.rollRate*right.rollRate<0,'left and right disturbances have opposite signs');
 assert.equal(stepFlight(start,{},1/120,0,config,245,flat,soft(1,true)).collapsed,true);
 let s=right;for(let i=1;i<90;i++)s=stepFlight(s,{},1/120,i/120,config,245,flat,soft(1));assert.ok(Math.abs(s.bank)<.3,'persistent grazing does not add an impulse every step');
});
test('recoverable body impact updates coupled particles, pose and external-work ledger',()=>{
 const hit=(a,b)=>a.some((v,i)=>v!==b[i])?{min:[0,-1,0],max:[1,1,100]}:null;
 hit.soft=()=>[];hit.contact=()=>({normal:[-1,0,0]});hit.pushOut=()=>({offset:[-.02,0,0]});
 const start={...launchFlight(config,'paraglider',site,flat),speed:2};
 const s=stepFlight(start,{},1/120,0,config,245,flat,hit);
 assert.ok(!s.collapsed);assert.ok(s.coupled.pilotVelocity[0]<0);assert.equal(s.vx,s.coupled.pilotVelocity[0]);
 assert.ok(Math.abs(s.z-s.coupled.pilotPosition[2]-(config.landing_clearance_m-config.coupled.harness_height_m))<1e-9);
 assert.ok(Number.isFinite(s.coupled.contactWorkJ));assert.ok(s.coupled.contactWorkJ<0,'impact removes mechanical energy');assert.equal(start.coupled,undefined);
});
test('long collapsed falls rebound exactly once and settle locally',()=>{
 let s={...launchFlight(config,'paraglider',site,flat),collapsed:true,z:60,vx:0,vy:0,vertical:-15},rebounds=0,was=false,rose=false;
 for(let i=0;i<1800&&!s.grounded;i++){
  s=stepFlight(s,{},1/120,i/120,config,245,flat);if(s.fallBounce&&!was)rebounds++;was=!!s.fallBounce;rose ||= s.fallBounce&&s.vz>0;
 }
 assert.equal(rebounds,1);assert.ok(rose);assert.equal(s.grounded,true);assert.equal(s.z,config.landing_clearance_m);
 let low={...launchFlight(config,'paraglider',site,flat),collapsed:true,z:2,vertical:-1};for(let i=0;i<120&&!low.grounded;i++)low=stepFlight(low,{},1/120,i/120,config,245,flat);
 assert.ok(!low.fallBounce,'a short drop does not bounce');
});

for(const mode of Object.keys(config.modes))test(mode+': a small foliage contact confined to either tip is recoverable',()=>{
 for(const side of [-1,1]){const hit=()=>null;hit.soft=p=>p[1]*side>config.modes[mode].span_m*.36?[{shape:{id:'tip'},depth:.1}]:[];
 const s=stepFlight(launchFlight(config,mode,site,flat),{},1/120,0,config,245,flat,hit);assert.equal(s.canopyBrush,true);assert.ok(!s.collapsed);}
});

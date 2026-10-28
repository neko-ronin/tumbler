import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const flat=()=>0,start=()=>({...launchFlight(still,'paramotor',{xy_m:[0,0],heading_deg:0},flat),z:1500,throttle:0,engine:0});
const head=s=>s.z+s.speed*s.speed/(2*9.81);
test('motor energy gain never exceeds recorded propulsive work through mixed controls',()=>{
 let s=start();
 for(let i=0;i<3600;i++){
  const next=stepFlight(s,{throttle:i<1200?1:-1,brake:Math.sin(i*.009)*.6,turn:Math.sin(i*.004)*.6},1/120,i/120,still,270,flat);
  const work=(next.engineWorkJ-s.engineWorkJ)/(config.propulsion.mass_kg*9.81);
  assert.ok(head(next)-head(s)<=work+1e-9,`step ${i} exceeds engine work`);
  assert.ok(next.thrustN>=0&&next.thrustN<=config.propulsion.max_thrust_n*next.engine+1e-9);
  assert.ok(work*config.propulsion.mass_kg*9.81*120<=config.propulsion.max_power_w*next.engine+1e-6);
  s=next;
 }
 assert.ok(s.engine<1e-8,'engine spools down after cutoff');
});
test('thrust responds to mass and suspended pilot attitude and cannot act with power off',()=>{
 const state={...start(),engine:1,throttle:1};
 const light=stepFlight(state,{},1/120,0,still,270,flat);
 const heavy=stepFlight(state,{},1/120,0,{...still,propulsion:{...still.propulsion,mass_kg:180}},270,flat);
 assert.ok(head(light)>head(heavy));
 const tilted=stepFlight({...state,pilotPitch:.5},{},1/120,0,still,270,flat);
 assert.ok(tilted.engineWorkJ<light.engineWorkJ,'less useful work when thrust is inclined to flight');
 const off=stepFlight(start(),{},1/120,0,still,270,flat);
 assert.equal(off.thrustN,0);assert.equal(off.engineWorkJ,0);assert.ok(head(off)<head(start()));
});

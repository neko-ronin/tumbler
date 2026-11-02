import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';

const source=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const still={...source,ceiling_m:1e6,world_limit_m:1e6,thermals:[],wind:{speed_mps:0,gust_mps:0},
  weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};

// Product target for a small disturbance, not a measured certification limit.
// No steering or camera: isolate the physical lateral suspension mode.
for(const mode of Object.keys(source.modes))test(`${mode}: a small sideways canopy disturbance settles promptly`,()=>{
  let s=launchFlight(still,mode,{xy_m:[0,0],heading_deg:0,clearance_m:2500},()=>0);
  const late=[];
  for(let tick=0;tick<10*120;tick++){
    if(tick===4*120)s.coupled.wingVelocity[1]+=1;
    s=stepFlight(s,{},1/120,tick/120,still,270,()=>0);
    if(tick>=8*120){
      const c=s.coupled,r=c.wingPosition.map((v,i)=>v-c.pilotPosition[i]);
      late.push(Math.atan2(-Math.sin(s.heading)*r[0]+Math.cos(s.heading)*r[1],r[2]));
    }
  }
  const swing=(Math.max(...late)-Math.min(...late))*180/Math.PI;
  assert.ok(swing<.3,`sideways motion four seconds after disturbance: ${swing.toFixed(3)} degrees peak-to-peak`);
});

for(const mode of Object.keys(source.modes))test(`${mode}: steering release settles without suppressing the turn`,()=>{
  for(const direction of [-1,1]){
    let s=launchFlight(still,mode,{xy_m:[0,0],heading_deg:0,clearance_m:2500},()=>0);
    const late=[];let headingAtRelease;
    for(let tick=0;tick<14*120;tick++){
      s=stepFlight(s,{turn:tick>=360&&tick<960?direction*.8:0},1/120,tick/120,still,270,()=>0);
      if(tick===959)headingAtRelease=s.heading;
      if(tick>=10*120){
        const c=s.coupled,r=c.wingPosition.map((v,i)=>v-c.pilotPosition[i]);
        late.push(Math.atan2(-Math.sin(s.heading)*r[0]+Math.cos(s.heading)*r[1],r[2]));
      }
    }
    assert.ok(direction*headingAtRelease<-.2,'the requested bank still turns the actual trajectory');
    const swing=(Math.max(...late)-Math.min(...late))*180/Math.PI;
    assert.ok(swing<1.5,`post-turn lateral motion: ${swing.toFixed(3)} degrees peak-to-peak`);
  }
});

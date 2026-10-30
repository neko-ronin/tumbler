import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
import {coupledLiftDirection,wingBasis} from '../../../shared/activities/coupled-flight.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const flat=()=>0,dot=(a,b)=>a.reduce((sum,v,i)=>sum+v*b[i],0);

test('section lift is normal to flow and span, including sideslip and degenerate flow',()=>{
  for(const heading of [-1,0,2])for(const bank of [-.6,0,.6])for(const slip of [-6,0,6]){
    const b=wingBasis(heading,.1,bank),v=b.forward.map((x,i)=>x*12+b.left[i]*slip-b.up[i]*2);
    const lift=coupledLiftDirection(v,b.left);
    assert.ok(Math.abs(dot(lift,v))<1e-12,'lift does no air-relative work');
    assert.ok(Math.abs(dot(lift,b.left))<1e-12,'lift cannot feed spanwise motion');
    assert.ok(Math.abs(Math.hypot(...lift)-1)<1e-12);
    if(!slip){
      const upFlow=dot(b.up,v)/dot(v,v),projected=b.up.map((x,i)=>x-v[i]*upFlow),size=Math.hypot(...projected);
      assert.ok(Math.hypot(...lift.map((x,i)=>x-projected[i]/size))<1e-12,'zero-sideslip lift retains its original direction');
    }
  }
  assert.deepEqual(coupledLiftDirection([0,0,0],[0,1,0]),[0,0,0]);
  assert.deepEqual(coupledLiftDirection([0,5,0],[0,1,0]),[0,0,0]);
});

// Product regression: a moderate, held turn in still air should settle rather
// than retain conspicuous side-to-side cycling. This is a game acceptance
// target, not a measured real-wing damping coefficient or universal period.
for(const mode of ['paraglider','parakite','paramotor'])test(`${mode}: a held ordinary turn settles its lateral suspension motion`,()=>{
  const rules={...config,ceiling_m:1e6,world_limit_m:1e6,thermals:[],wind:{speed_mps:0,gust_mps:0},
    weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
  let s=launchFlight(rules,mode,{xy_m:[0,0],heading_deg:0,clearance_m:2500},flat);const rows=[];
  for(let tick=0;tick<28*120;tick++){
    s=stepFlight(s,{turn:tick<360?0:.4},1/120,tick/120,rules,270,flat);
    if(tick<=18*120)continue;
    const c=s.coupled,r=c.wingPosition.map((v,i)=>v-c.pilotPosition[i]);
    rows.push({bank:s.bank,line:Math.atan2(-Math.sin(s.heading)*r[0]+Math.cos(s.heading)*r[1],r[2])});
  }
  const range=key=>Math.max(...rows.map(r=>r[key]))-Math.min(...rows.map(r=>r[key]));
  assert.ok(range('bank')<1e-6,'hold an actually steady bank, with no gusts or camera');
  assert.ok(range('line')<3*Math.PI/180,`late lateral swing remains ${(range('line')*180/Math.PI).toFixed(2)} degrees peak-to-peak`);
});

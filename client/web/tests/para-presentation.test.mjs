import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {paraKinematics,paraTargets,createParaSignals} from '../src3d/para-signals.js';
import {paraAudioTargets} from '../src3d/para-audio.js';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
const state=()=>({mode:'parakite',x:0,y:0,z:30,heading:0,speed:999,distance:0,load:1,pressure:1,coupled:{pilotVelocity:[30,0,-10]}});
test('sensation uses measured full pilot velocity relative to three-dimensional air',()=>{
 const s=state(),before=structuredClone(s),k=paraKinematics(s,{wx:10,wy:0,lift:5});
 assert.equal(k.measured,true);assert.equal(k.airSpeed,25);assert.equal(k.groundSpeed,Math.hypot(30,10));assert.deepEqual(s,before);
});
test('near-surface ground travel adds rush while open air retains its airspeed',()=>{
 const k={...paraKinematics(state()),distance:5},open={...k,distance:500};
 assert.ok(paraTargets(k).rush>paraTargets(open).rush);assert.ok(paraTargets(k).smear>paraTargets(open).smear);
 assert.equal(k.airSpeed,open.airSpeed);
 for(const mode of ['parakite','paraglider','paramotor'])for(const view of ['chase','first']){
  const off=paraTargets(k,0,view,mode);assert.equal(off.fov,62);assert.equal(off.smear,0);assert.equal(off.lens,0);
  assert.ok(paraTargets(k,.35,view,mode).smear<paraTargets(k,1,view,mode).smear);
 }
});
test('mode transitions silence stale proximity and reset the lens target',()=>{
 const sample=createParaSignals({height:()=>0}),s=state();sample.update(s,{},.02,1);
 const off=sample.update({mode:'walk'}, {},.02,1);assert.equal(off.active,false);assert.equal(off.fov,62);assert.equal(off.feature,null);assert.equal(paraAudioTargets(off).pass,0);
});
test('close solids use their actual surface, and geometry queries stay at 8 Hz',()=>{
 let calls=0;const shape={type:'trunk',min:[8,-2,0],max:[12,2,50],trunk:{x:10,y:0,base_z:0,top_z:50,profile:[[0,2],[50,2]]}};
 const signals=createParaSignals({height:()=>0,hitTest:{near(){calls++;return [shape];}}});
 for(let i=0;i<120;i++)signals.update({...state(),distance:i/6},{},1/120,1);
 assert.ok(calls>=8&&calls<=9);assert.equal(signals.sample.distance,8);assert.equal(signals.sample.feature.kind,'tree');
});
test('para sound responds to proximity/load, keeps bounded levels, and mutes outside flight',()=>{
 const sample={active:true,airSpeed:30,rush:1,pressure:.5,load:2,loadChange:4,feature:{kind:'ropeway'}};
 const near=paraAudioTargets(sample,.8),far=paraAudioTargets({...sample,rush:0},-.8);
 assert.ok(near.pass>far.pass);assert.equal(near.frequency,2100);assert.equal(near.pan,.8);assert.ok(near.harness<=.012);assert.ok(near.fabric<=.018);assert.equal(paraAudioTargets(null).pass,0);
});
test('reading presentation at every step leaves all three modes and their energy ledger identical',()=>{
 const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url))),rules={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{trial:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
 for(const mode of Object.keys(config.modes)){
  let a=launchFlight(rules,mode,{xy_m:[0,0],heading_deg:0,clearance_m:500},()=>0,'trial'),b=structuredClone(a);const signals=createParaSignals({height:()=>0});
  for(let i=0;i<480;i++){const input={turn:i<240?.4:-.4};a=stepFlight(a,input,1/120,i/120,rules,0,()=>0);b=stepFlight(b,input,1/120,i/120,rules,0,()=>0);signals.update(b,{},1/120,i%3===0?0:1);}
  assert.deepEqual(b,a,mode);
 }
});
test('inside-the-harness voices grow with airspeed, sit back in chase and follow the wind to one ear',()=>{
 const at=(airSpeed,o)=>paraAudioTargets({active:true,airSpeed,rush:0,pressure:1,load:1,loadChange:0},0,o);
 const slow=at(12,{view:'first'}),fast=at(40,{view:'first'}),chase=at(40,{view:'chase'});
 for(const k of ['helmet','buffet','flutter','hum'])assert.ok(fast[k]>slow[k],k);
 for(const k of ['helmet','buffet','flutter','hum'])assert.ok(chase[k]<fast[k],k);
 assert.ok(fast.humHz[0]>slow.humHz[0],'Aeolian line tone rises with speed');assert.ok(fast.helmet<=.15&&fast.buffet<=.16&&fast.flutter<=.09&&fast.hum<=.018);
 assert.ok(at(40,{view:'first',facing:0}).helmetHz<at(40,{view:'first',facing:1}).helmetHz,'facing away darkens the wind');assert.equal(at(40,{windPan:-.5}).windPan,-.5);
 const soft=paraAudioTargets({active:true,airSpeed:30,rush:0,pressure:.4,load:1,loadChange:0}),firm=paraAudioTargets({active:true,airSpeed:30,rush:0,pressure:1,load:1,loadChange:0});
 assert.ok(soft.flutter>firm.flutter,'a soft wing flaps louder');assert.equal(paraAudioTargets(null).helmet,0);
});
test('the parakite has reserve speed sensation above its faster trim; other wings keep their scale',()=>{
 const k=airSpeed=>({active:true,airSpeed,groundSpeed:airSpeed,distance:500});
 assert.ok(paraTargets(k(26),1,'first','parakite').smear<paraTargets(k(40),1,'first','parakite').smear);
 assert.ok(paraTargets(k(30),1,'first','paraglider').smear>paraTargets(k(30),1,'first','parakite').smear);
});

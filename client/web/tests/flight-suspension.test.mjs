import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {launchFlight,stepFlight,canopySegment} from '../../../shared/activities/flight.js';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const shipped=read('../../../shared/activities/flight.json'),player=read('../../../shared/characters/player.json');
// Preserve the optional one-way angular-pose fallback. Coupled suspension has
// independent translational energy/anchors, tested in flight-coupled-*.test.mjs.
const {coupled:ignoredCoupled,...config}=shipped;
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const {suspension:_,...withoutSuspension}=still;
const flat=()=>0,site={xy_m:[0,0],heading_deg:0},poseKeys=['pilotPitch','pilotRoll','pilotPitchRate','pilotRollRate'];
const start=mode=>({...launchFlight(still,mode,site,flat),z:1500,engine:0,throttle:0});
function bounded(s){
 for(const key of poseKeys)assert.ok(Number.isFinite(s[key]),key);
 assert.ok(Math.abs(s.pilotPitch)<=config.suspension.pitch_limit_rad,'bounded pitch');
 assert.ok(Math.abs(s.pilotRoll)<=config.suspension.roll_limit_rad,'bounded roll');
}
function run(s,input,seconds){
 for(let i=0;i<Math.round(seconds*120);i++){
  s=stepFlight(s,input,1/120,i/120,still,270,flat);bounded(s);
 }
 return s;
}

test('legacy angular suspension responds progressively to dive, flare and reversal, then settles repeatably',()=>{
 for(const mode of Object.keys(config.modes)){
  const sequence=()=>{
   const initial=start(mode);poseKeys.forEach(key=>assert.equal(initial[key],0));
   const dive=run(initial,{brake:-1},3);
   assert.ok(Math.abs(dive.pilotPitch)>.01,`${mode}: dive moves the suspended pilot`);
   const firstFlare=run(dive,{brake:.65},1/120);
   assert.ok(Math.abs(firstFlare.pilotPitch-dive.pilotPitch)<.02,'no snap at control reversal');
   const flare=run(dive,{brake:.65},1.2);
   assert.ok(Math.abs(flare.pilotPitch-dive.pilotPitch)>.03,`${mode}: flare changes relative pitch`);
   const right=run(flare,{turn:1},2),left=run(right,{turn:-1},2);
   assert.ok(right.pilotRoll<-.05,`${mode}: pilot lags right bank`);
   assert.ok(left.pilotRoll>.05,`${mode}: pilot response reverses with the wing`);
   const settled=run(left,{},35);
   assert.ok(Math.abs(settled.pilotRoll)<.001,`${mode}: roll settles`);
   assert.ok(Math.abs(settled.pilotPitchRate)<.001,`${mode}: pitch stops oscillating`);
   assert.ok(Math.abs(settled.pilotRollRate)<.001,`${mode}: roll stops oscillating`);
   return settled;
  };
  assert.deepEqual(sequence(),sequence(),`${mode}: identical fixed-step inputs reproduce the pose`);
 }
});

test('legacy angular suspension adds no translational energy and does not change the canopy collision frame',()=>{
 for(const mode of Object.keys(config.modes)){
  let enabled=start(mode),disabled=start(mode);
  for(let i=0;i<2400;i++){
   const input={brake:Math.sin(i*.012),turn:Math.sin(i*.008),maneuver:true};
   enabled=stepFlight(enabled,input,1/120,i/120,still,270,flat);
   disabled=stepFlight(disabled,input,1/120,i/120,withoutSuspension,270,flat);
   bounded(enabled);
   for(const key of Object.keys(enabled))if(!poseKeys.includes(key))assert.deepEqual(enabled[key],disabled[key],`${mode}: ${key}`);
   assert.deepEqual(canopySegment(enabled,still),canopySegment(disabled,still),'suspension cannot move the wing collider');
  }
  const energy=s=>s.z+s.speed*s.speed/(2*9.81);
  assert.equal(energy(enabled),energy(disabled));
  assert.ok(energy(enabled)<energy(start(mode)),'unpowered maneuvering still loses energy');
 }
});

test('ground contact and a collapsed wing clear the angular suspension response',()=>{
 const posed={...start('paraglider'),pilotPitch:.3,pilotRoll:-.2,pilotPitchRate:.4,pilotRollRate:-.3};
 for(const extra of [{grounded:true},{collapsed:true},{z:config.landing_clearance_m+.001,vertical:-5}]){
  const state=stepFlight({...posed,...extra},{},1/120,0,still,270,flat);
  assert.ok(state.grounded||state.collapsed,'test reaches an unsuspended condition');
  for(const key of poseKeys)assert.equal(state[key],0,`${key} clears after ${JSON.stringify(extra)}`);
 }
});

const assets=Object.fromEntries([config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset].map(p=>[p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));
const anchor=new T.Vector3().fromArray(player.flight_attachment.position_m);
const posed={pilotPitch:.22,pilotRoll:-.18};
const rotation=new T.Quaternion().setFromEuler(new T.Euler(-posed.pilotPitch,0,posed.pilotRoll,'XYZ'));

for(const mode of Object.keys(config.modes))for(const scale of [1,.52])test(`${mode}, scale ${scale}: straps and motor pivot about the hip while the upper sail stays fixed`,()=>{
 const baseline=createFlightRig(assets,config),suspended=createFlightRig(assets,config);
 try{
  const presentation={pilotScale:scale,pilotAttachment:player.flight_attachment.position_m},state=start(mode);
  baseline.update(.1,state,presentation);suspended.update(.1,{...state,...posed},presentation);
  const name=mode==='parakite'?'parakite':'paraglider',a=baseline.wings[name],b=suspended.wings[name];
  const p=a.mesh.geometry.attributes.position,q=b.mesh.geometry.attributes.position;
  let fitted=0,upper=0,blended=0;
  for(let i=0;i<p.count;i++){
   const weight=a.pilotFit[a.indices[i]],before=new T.Vector3().fromBufferAttribute(p,i),actual=new T.Vector3().fromBufferAttribute(q,i);
   const rotated=before.clone().sub(anchor).applyQuaternion(rotation).add(anchor);
   const expected=before.clone().lerp(rotated,weight);
   assert.ok(actual.distanceTo(expected)<2e-6,'real strap and riser vertices share the hip pivot');
   if(weight===1)fitted++;else if(weight>0)blended++;
   if(a.rest[i*3+1]>2.6){assert.ok(actual.equals(before),'upper line ends and fabric stay in the wing frame');upper++;}
  }
  assert.ok(fitted>100&&blended>0&&upper>1000,'exercise the actual harness, blended risers and sail');
  assert.ok(suspended.motor.position.distanceTo(baseline.motor.position.clone().sub(anchor).applyQuaternion(rotation).add(anchor))<1e-9);
  assert.ok(suspended.motor.quaternion.angleTo(rotation)<1e-7,'motor follows the pilot rotation');
  assert.equal(suspended.motor.scale.x,scale);
 }finally{baseline.dispose();suspended.dispose();}
});

test('grounded and collapsed presentation bypasses stale suspension angles',()=>{
 for(const flags of [{grounded:true},{collapsed:true}]){
  const baseline=createFlightRig(assets,config),suspended=createFlightRig(assets,config);
  try{
   const presentation={pilotAttachment:player.flight_attachment.position_m},state={...start('paramotor'),...flags};
   baseline.update(.1,state,presentation);suspended.update(.1,{...state,...posed},presentation);
   assert.deepEqual(suspended.wings.paraglider.mesh.geometry.attributes.position.array,baseline.wings.paraglider.mesh.geometry.attributes.position.array);
   assert.ok(suspended.motor.position.equals(baseline.motor.position));
   assert.ok(suspended.motor.quaternion.equals(baseline.motor.quaternion));
  }finally{baseline.dispose();suspended.dispose();}
 }
});

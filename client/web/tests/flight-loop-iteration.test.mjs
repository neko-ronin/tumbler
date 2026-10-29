import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {relaunchGround,safeWalkGround} from '../../../shared/activities/walk.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url)));
const config=read('../../../shared/activities/flight.json'),walk=read('../../../shared/characters/player.json').walk;
const flat=()=>0,dt=1/120;
const rules={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},
  weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const ready=(mode,c=rules)=>({...launchFlight(c,mode,{xy_m:[0,0],heading_deg:0},flat),
  grounded:true,z:c.landing_clearance_m,speed:0,vertical:0,vario:0,engine:0,throttle:0});

test('ground airspeed includes crosswind while a sideways gust cannot satisfy the forward takeoff gate',()=>{
  const windy={...rules,wind:{speed_mps:30,gust_mps:0},weather:{soaring:{...rules.weather.soaring,wind_scale:1}}};
  const start={...ready('paraglider',windy),launching:true,launchTime:windy.ground_launch.inflate_s,launchRunSpeed:5};
  const air=sampleAir(windy,180,start,0,flat),s=stepFlight(start,{},dt,0,windy,180,flat);
  assert.ok(Math.abs(s.speed-Math.hypot(s.vx-air.wx,s.vy-air.wy))<1e-9,'AIR uses the full horizontal relative velocity');
  assert.ok(s.speed>windy.modes.paraglider.trim_mps,'the sideways gust is strong enough to expose a wrong total-speed gate');
  assert.ok(s.grounded&&s.launching,'forward airspeed, not sideways wind magnitude, controls the assisted launch gate');
});
function runLaunch(mode,c=rules,bearing=270,hit=null,dry=flat,{footing=dry,physical=flat}={}){
  let state=relaunchGround(ready(mode,c),walk,c,dry,hit),time=0;
  assert.ok(state,'test begins on a safe local launch');
  while(state.launching&&time<20){state=stepFlight(state,{},dt,time,c,bearing,physical,hit,footing,dry);time+=dt;}
  assert.equal(state.launching,false,'preparation ends in bounded time');
  return {state,time};
}

test('crosswind takeoff preserves the real ground-run velocity into coupled flight',()=>{
  // A dry ledge permits a crosswind launch at the capped running speed; trim
  // airspeed in still/crosswind air is not secretly awarded by faster legs.
  const windy={...rules,wind:{speed_mps:5,gust_mps:0},weather:{soaring:{...rules.weather.soaring,wind_scale:1}}};
  const ledge=x=>x<12?0:-10,footing=(x,y)=>safeWalkGround(x,y,walk,ledge,null,{dropOffs:true});
  for(const bearing of [0,180]){
    const {state,time}=runLaunch('paraglider',windy,bearing,null,ledge,{footing,physical:ledge});
    assert.equal(state.grounded,false);assert.equal(state.vy,0,'the assisted run follows its selected ground heading');
    assert.ok(Math.abs(state.vx-state.launchRunSpeed)<1e-9);
    const next=stepFlight(state,{},dt,time,windy,bearing,ledge);
    assert.ok(next.coupled,'exercise the first actual airborne force tick');
    assert.equal(next.vz,next.coupled.pilotVelocity[2],'world vertical velocity cannot remain at its ground-launch value');
    assert.ok(Math.abs(next.coupled.pilotVelocity[1])<.02,'no instantaneous crosswind velocity is awarded at takeoff');
    assert.ok(Math.abs(next.coupled.pilotVelocity[0]-state.vx)<.04,'forward velocity changes only by the integrated forces');
    assert.ok(Math.abs((next.y-state.y)/dt)<.02,'physical position does not acquire a lateral launch jump');
  }
});

test('motor work accumulated during the ground run survives the first airborne tick',()=>{
  const ledge=x=>x<12?0:-10,footing=(x,y)=>safeWalkGround(x,y,walk,ledge,null,{dropOffs:true});
  const {state,time}=runLaunch('paramotor',rules,270,null,ledge,{footing,physical:ledge});
  assert.equal(state.grounded,false);assert.ok(state.engineWorkJ>100,'the motor performed measured ground-run work');
  const before=structuredClone(state),next=stepFlight(state,{},dt,time,rules,270,ledge);
  assert.ok(next.coupled);assert.ok(next.engineWorkJ>=state.engineWorkJ,'cumulative motor work cannot reset at lift-off');
  assert.ok(next.engineWorkJ-state.engineWorkJ<=rules.propulsion.max_power_w*next.engine*dt+1e-6);
  assert.deepEqual(state,before,'initializing coupled flight must not mutate the launch state');
});

test('a stopped launch clears all reported motion after obstruction, distance, water or timeout aborts',()=>{
  const obstacle=(a,b)=>a[0]<8&&b[0]>=8&&b[2]<3?{kind:'structure'}:null;
  const short={...rules,ground_launch:{...rules.ground_launch,max_run_m:5}};
  const timed={...rules,ground_launch:{...rules.ground_launch,max_run_s:.5}};
  const dry=x=>x<7?0:null;
  for(const [reason,c,hit,height] of [['obstruction',rules,obstacle,flat],['distance',short,null,flat],
    ['water',rules,null,dry],['timeout',timed,null,flat]]){
    const {state}=runLaunch('paraglider',c,270,hit,height);
    assert.ok(state.grounded&&state.launchAborted,`${reason}: aborted on the ground`);
    for(const key of ['speed','groundSpeed','launchRunSpeed','vx','vy','vz','vertical','vario'])
      assert.equal(state[key],0,`${reason}: stale ${key} after stopping`);
  }
});

test('real launch footing permits a dry ledge departure without running into water, a wall or an obstruction',()=>{
  const ledge=x=>x<12?0:-10,water=x=>x<12?0:null,uphill=x=>x<12?0:2;
  const obstacle=(a,b)=>a[0]<12&&b[0]>=12&&b[2]<3?{kind:'structure'}:null;
  const scenarios=[['dry ledge',ledge,ledge,null,true],['water',water,ledge,null,false],
    ['uphill step',uphill,uphill,null,false],['body obstruction',flat,flat,obstacle,false]];
  for(const mode of Object.keys(config.modes))for(const [name,dry,physical,hit,takesOff] of scenarios){
    const footing=(x,y)=>safeWalkGround(x,y,walk,dry,hit,{dropOffs:true});
    const {state}=runLaunch(mode,rules,270,hit,dry,{footing,physical});
    assert.equal(!state.grounded,takesOff,`${mode}: ${name}`);
    if(takesOff){
      assert.equal(state.z,config.landing_clearance_m,'leaving a ledge does not award altitude or teleport onto its lower floor');
      assert.equal(state.vertical,0);assert.equal(state.vz,0);
      assert.ok(state.x>=12&&state.x<12.2);assert.ok(state.vx>0);
    }else{
      assert.ok(state.launchAborted&&state.x<12,`${mode}: ${name} stops before contact`);
      assert.equal(state.groundSpeed,0);assert.equal(state.vx,0);
    }
  }
});

test('ledge clearance tests the real departing path rather than a diagonal teleport down to the lower floor',()=>{
  const ledge=x=>x<12?0:-10;
  const below=(a,b)=>b[0]>=12&&b[2]<0?{kind:'structure'}:null;
  const footing=(x,y)=>safeWalkGround(x,y,walk,ledge,below,{dropOffs:true});
  const {state}=runLaunch('paraglider',rules,270,below,ledge,{footing,physical:ledge});
  assert.equal(state.grounded,false);assert.equal(state.z,config.landing_clearance_m);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
import {constrainSuspension,initializeCoupled,stepCoupled,pilotBasis} from '../../../shared/activities/coupled-flight.js';

const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const G=9.81,flat=()=>0,site={xy_m:[0,0],heading_deg:0,clearance_m:1800};
const modes=Object.keys(config.modes),rules=config.coupled;
const still={...config,ceiling_m:1e6,world_limit_m:1e6,thermals:[],wind:{speed_mps:0,gust_mps:0},
  weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const zeroAir=()=>({wx:0,wy:0,lift:0});
const start=(mode,c=still)=>({...launchFlight(c,mode,site,flat),engine:0,throttle:0});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const kinetic=c=>(rules.pilot_mass_kg*dot(c.pilotVelocity,c.pilotVelocity)+rules.wing_mass_kg*dot(c.wingVelocity,c.wingVelocity))/2;
// Independent definition: include BOTH masses and all three velocity axes.
const energy=c=>kinetic(c)+G*(rules.pilot_mass_kg*c.pilotPosition[2]+rules.wing_mass_kg*c.wingPosition[2]);
const momentum=c=>c.pilotVelocity.map((v,i)=>rules.pilot_mass_kg*v+rules.wing_mass_kg*c.wingVelocity[i]);
const com=c=>c.pilotPosition.map((v,i)=>(rules.pilot_mass_kg*v+rules.wing_mass_kg*c.wingPosition[i])/(rules.pilot_mass_kg+rules.wing_mass_kg));
const near=(actual,expected,tolerance=1e-8,message='values agree')=>assert.ok(Math.abs(actual-expected)<=tolerance,`${message}: ${actual} versus ${expected}`);
const distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('pilot frame stays orthonormal with horizontal, near-horizontal or coincident anchors',()=>{
  for(const wingPosition of [[4.75,0,0],[4.75,0,1e-12],[0,4.75,0],[0,0,0],[0,0,-4.75]]){
    const frame=pilotBasis({heading:0,coupled:{pilotPosition:[0,0,0],wingPosition}}),axes=Object.values(frame);
    for(const a of axes)near(dot(a,a),1,1e-9,'unit axis');
    for(let i=0;i<3;i++)for(let j=i+1;j<3;j++)near(dot(axes[i],axes[j]),0,1e-9,'perpendicular axes');
  }
});
function cable(over=0){
  return {pilotPosition:[1,2,3],wingPosition:[1,2,8+over],pilotVelocity:[3,1,-2],wingVelocity:[2,1,4],
    lineLength:5,lineSlackM:.4,tensionN:0,catchLossJ:0,constraintLossJ:0,maxProjectionM:0};
}

test('slack and inward-moving cables exert no compression impulse',()=>{
  const slack=cable(-.4),before=structuredClone(slack);
  assert.equal(constrainSuspension(slack,rules,1/240),0);
  assert.deepEqual(slack.pilotVelocity,before.pilotVelocity);assert.deepEqual(slack.wingVelocity,before.wingVelocity);
  assert.deepEqual(slack.pilotPosition,before.pilotPosition);assert.deepEqual(slack.wingPosition,before.wingPosition);
  assert.equal(slack.tensionN,0);near(slack.lineSlackM,.4);
  const inward=cable();inward.pilotVelocity=[0,0,0];inward.wingVelocity=[0,0,-3];
  const velocities=[...inward.pilotVelocity,...inward.wingVelocity];
  assert.equal(constrainSuspension(inward,rules,1/240),0);
  assert.deepEqual([...inward.pilotVelocity,...inward.wingVelocity],velocities);
  assert.equal(inward.tensionN,0);assert.equal(inward.catchLossJ,0);
});

test('a slack-line catch preserves momentum and COM and loses the analytic radial kinetic energy',()=>{
  const c=cable(.2),before=structuredClone(c),dt=1/240;
  const w=1/rules.pilot_mass_kg+1/rules.wing_mass_kg,outward=6,impulse=outward/w,loss=impulse*impulse*w/2;
  near(constrainSuspension(c,rules,dt),loss);
  momentum(c).forEach((v,i)=>near(v,momentum(before)[i]));
  com(c).forEach((v,i)=>near(v,com(before)[i]));
  near(distance(c.pilotPosition,c.wingPosition),c.lineLength);
  near(c.wingVelocity[2]-c.pilotVelocity[2],0);
  for(const i of [0,1]){assert.equal(c.pilotVelocity[i],before.pilotVelocity[i]);assert.equal(c.wingVelocity[i],before.wingVelocity[i]);}
  near(kinetic(before)-kinetic(c),loss);near(energy(before)-energy(c),loss);
  near(c.catchLossJ,loss);assert.equal(c.constraintLossJ,0);near(c.tensionN,impulse/dt);
});

test('while lines are slack the pilot cannot receive the wing lift or a hidden reaction',()=>{
  const initial={...start('paraglider'),speed:10,vertical:0,vario:0};
  initial.coupled=initializeCoupled(initial,still,zeroAir());
  initial.coupled.wingPosition=initial.coupled.pilotPosition.map((v,i)=>v+(i===2?2:0));
  initial.coupled.lineSlackM=initial.coupled.lineLength-2;
  const parked=structuredClone(initial),moving=structuredClone(initial);
  parked.coupled.wingVelocity=[0,0,0];moving.coupled.wingVelocity=[20,0,0];
  stepCoupled(parked,1/240,still,zeroAir);stepCoupled(moving,1/240,still,zeroAir);
  assert.equal(parked.coupled.tensionN,0);assert.equal(moving.coupled.tensionN,0);
  parked.coupled.pilotVelocity.forEach((v,i)=>near(v,moving.coupled.pilotVelocity[i],1e-10,'slack pilot velocity is independent of wing state'));
  parked.coupled.pilotPosition.forEach((v,i)=>near(v,moving.coupled.pilotPosition[i],1e-10,'slack pilot position is independent of wing state'));
});

test('still-air unpowered pumping and reversals cannot create full mechanical energy',()=>{
  for(const mode of modes){
    let state=start(mode),previous=null;
    for(let tick=0;tick<2400;tick++){
      const before=structuredClone(state),next=stepFlight(state,{brake:Math.sin(tick*.009)*.7,turn:Math.sin(tick*.004)*.75,maneuver:true},1/120,tick/120,still,270,flat);
      assert.deepEqual(state,before,'integration must not mutate its input state');
      const c=next.coupled;assert.ok(c&&!next.grounded,`${mode} remains airborne in the test`);
      const actual=energy(c);near(c.energyJ,actual,1e-7,'reported full energy matches independent calculation');
      if(previous!==null)assert.ok(actual<=previous+1e-7,`${mode}: energy gain on tick ${tick}`);
      assert.ok(c.tensionN>=0);assert.ok(distance(c.pilotPosition,c.wingPosition)<=c.lineLength+1e-8);
      assert.ok(Math.abs(c.liftVelocityDot)<1e-8,'lift remains perpendicular to the wing air velocity');
      previous=actual;state=next;
    }
    const c=state.coupled,total=rules.pilot_mass_kg+rules.wing_mass_kg,h=(1/120)/Math.ceil((1/120)/rules.max_step_s);
    near(c.numericalJ,-total*G*G*20*h/2,1e-5,'numerical residual is the known dissipative gravity step');
    near(c.windWorkJ,0,1e-5,'still air cannot supply work');assert.equal(c.engineWorkJ,0);
    const predicted=c.initialEnergyJ-c.dragLossJ-c.catchLossJ-c.constraintLossJ+c.numericalJ;
    near(energy(c),predicted,1e-5,'independent energy closes against physical losses and known numerical error');
  }
});

test('motor work is force and useful-power bounded and closes the full moving-air ledger',()=>{
  const windy={...still,wind:{speed_mps:5,gust_mps:0},weather:{soaring:{wind_scale:1,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
  let state=start('paramotor',windy);
  for(let tick=0;tick<2400;tick++){
    const next=stepFlight(state,{throttle:tick<1200?1:-1,turn:Math.sin(tick*.003)*.3,brake:Math.sin(tick*.008)*.3},1/120,tick/120,windy,270,flat);
    const c=next.coupled,work=c.engineWorkJ-(state.coupled?.engineWorkJ??0);
    assert.ok(next.thrustN>=0&&next.thrustN<=config.propulsion.max_thrust_n*next.engine+1e-8,'actual force is bounded');
    assert.ok(work<=config.propulsion.max_power_w*next.engine/120+1e-7,'actual air-relative work is bounded');
    near(c.energyJ,energy(c),1e-7);
    const predicted=c.initialEnergyJ+c.engineWorkJ+c.windWorkJ-c.dragLossJ-c.catchLossJ-c.constraintLossJ+c.numericalJ;
    near(energy(c),predicted,1e-5,'world energy includes moving-air work');state=next;
  }
  assert.ok(state.engine<1e-5,'engine spools down after the cut');assert.ok(state.coupled.engineWorkJ>0);
  assert.ok(Math.abs(state.coupled.windWorkJ)>1,'wind work is separately observable');
});

function replay(mode,dt,turn=.25,maxStep=rules.max_step_s){
  const c={...still,coupled:{...rules,max_step_s:maxStep}};let s=start(mode,c);
  for(let tick=0;tick<Math.round(12/dt);tick++)s=stepFlight(s,{turn:tick*dt>=3?turn:0},dt,tick*dt,c,270,flat);
  return s;
}
test('ordinary left and right coupled turns mirror without scripted heading changes',()=>{
  for(const mode of modes){
    const left=replay(mode,1/120,-.25),right=replay(mode,1/120,.25);
    near(left.x,right.x,1e-7);near(left.y,-right.y,1e-7);near(left.z,right.z,1e-7);
    near(left.heading,-right.heading,1e-8);near(left.speed,right.speed,1e-8);
    assert.ok(left.heading>0&&right.heading<0,`${mode}: control and trajectory directions match`);
  }
});
test('120 and 240 Hz control updates and smaller force steps preserve ordinary trajectories',()=>{
  for(const mode of modes){
    const coarse=replay(mode,1/120),fine=replay(mode,1/240),smaller=replay(mode,1/240,.25,rules.max_step_s/2);
    assert.ok(distance([coarse.x,coarse.y,coarse.z],[fine.x,fine.y,fine.z])<.5,`${mode}: fixed force step is stable across control rates`);
    assert.ok(distance([fine.x,fine.y,fine.z],[smaller.x,smaller.y,smaller.z])<1,`${mode}: halving the force step changes a 12 s flight by less than a metre`);
    assert.ok(Math.abs(fine.speed-smaller.speed)<.15);assert.ok(Math.abs(fine.vario-smaller.vario)<.15);
  }
});

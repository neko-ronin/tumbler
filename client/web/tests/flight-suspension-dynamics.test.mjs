import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeCoupled,stepCoupled,coupledPolar} from '../../../shared/activities/coupled-flight.js';

const source=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const zeroAir=()=>({wx:0,wy:0,lift:0});
const near=(actual,expected,tolerance,label)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual} versus ${expected}`);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

test('trim polar fits a positive wing drag budget and rejects excessive pilot drag explicitly',()=>{
  for(const mode of Object.values(source.modes)){
    const c=source.coupled,p=coupledPolar(mode,c),mass=c.pilot_mass_kg+c.wing_mass_kg;
    const v=Math.hypot(mode.trim_mps,mode.sink_mps),q=.5*1.225*v*v,gamma=Math.atan2(mode.sink_mps,mode.trim_mps);
    assert.ok(p.cd0>=0&&p.induced>=0,'polar has no negative drag coefficient');
    near(q*p.area*p.cl,mass*9.81*Math.cos(gamma),1e-9,'trim lift balances transverse weight');
    near(q*(p.area*(p.cd0+p.induced*p.cl*p.cl)+c.pilot_drag_area_m2),mass*9.81*Math.sin(gamma),1e-9,'wing plus pilot drag fits trim sink');
    const zeroBudget=mass*9.81*Math.sin(gamma)/q;
    assert.throws(()=>coupledPolar(mode,{...c,pilot_drag_area_m2:zeroBudget*1.01}),/Infeasible coupled trim polar.*pilot drag.*total trim drag/);
  }
  assert.throws(()=>coupledPolar(source.modes.parakite,{...source.coupled,pilot_drag_area_m2:.44}),/Infeasible coupled trim polar for Parakiting/);
});

function orbit(relativeSpeed=10){
  // An isolated integration fixture, not a deployable flight configuration:
  // zero CL/CdA and zero profile/induced drag remove every aerodynamic force.
  // The ordinary activity's uniform gravity remains, so only the COM falls.
  const config={...source,coupled:{...source.coupled,max_cl:0,pilot_drag_area_m2:0,induced_share:1,stall_alpha_rad:10}};
  const s={mode:'paraglider',heading:0,pitch:0,bank:0,pitchRate:0,speed:10,
    vertical:0,vario:0,x:0,y:0,z:1800,distance:0,engine:0,brakeLeft:0,brakeRight:0,accelerator:0};
  s.coupled=initializeCoupled(s,config,zeroAir());
  const c=s.coupled,mp=config.coupled.pilot_mass_kg,mw=config.coupled.wing_mass_kg,total=mp+mw;
  c.pilotVelocity=[10-mw/total*relativeSpeed,0,0];c.wingVelocity=[10+mp/total*relativeSpeed,0,0];
  return {s,config,mp,mw,total};
}

test('a taut cable cannot change COM momentum or relative angular momentum in an isolated orbit',()=>{
  for(const relativeSpeed of [1,3,10]){
    const {s,config,mp,mw,total}=orbit(relativeSpeed),initial=structuredClone(s.coupled);
    const momentum=c=>c.pilotVelocity.map((v,i)=>v*mp+c.wingVelocity[i]*mw);
    const angular=c=>cross(c.wingPosition.map((v,i)=>v-c.pilotPosition[i]),c.wingVelocity.map((v,i)=>v-c.pilotVelocity[i]));
    const com=c=>c.pilotPosition.map((v,i)=>(v*mp+c.wingPosition[i]*mw)/total);
    const relativeK=c=>{
      const u=c.wingVelocity.map((v,i)=>v-c.pilotVelocity[i]);return .5*mp*mw/total*u.reduce((sum,v)=>sum+v*v,0);
    };
    const p0=momentum(initial),a0=angular(initial),q0=com(initial),k0=relativeK(initial),dt=1/120,seconds=6;
    for(let tick=0;tick<seconds/dt;tick++)stepCoupled(s,dt,config,zeroAir);
    const c=s.coupled,p=momentum(c),a=angular(c),q=com(c);
    near(p[0],p0[0],1e-7,'internal tension preserves horizontal momentum');
    near(p[1],p0[1],1e-7,'internal tension preserves lateral momentum');
    near(p[2],p0[2]-total*9.81*seconds,1e-6,'only gravity changes vertical momentum');
    a.forEach((v,i)=>near(v,a0[i],1e-7,'central cable force preserves relative angular momentum'));
    near(q[0],q0[0]+p0[0]/total*seconds,1e-7,'COM follows its free horizontal trajectory');
    near(relativeK(c),k0,1e-7,'a continuously taut, frictionless cable removes no relative kinetic energy');
    near(Math.hypot(...c.wingPosition.map((v,i)=>v-c.pilotPosition[i])),c.lineLength,1e-9,'cable stays at its physical length');
    near(c.catchLossJ,0,1e-9,'a taut orbit is not repeatedly treated as an inelastic catch');
  }
});

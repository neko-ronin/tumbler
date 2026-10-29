/** Two translating masses and a tension-only suspension. Core XYZ metres.
 * The force and suspension points are co-located on each body. Wing attitude
 * is an actuated reduced control law, not a six degree-of-freedom rigid body.
 * See docs/design/COUPLED-FLIGHT-2026-10-28.md for derivations and limits.
 */
const G=9.81,RHO=1.225;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const add=(a,b,k=1)=>a.map((v,i)=>v+k*b[i]);
const sub=(a,b)=>add(a,b,-1);
const length=a=>Math.hypot(...a);
const unit=(a,fallback=[0,0,1])=>length(a)>1e-9?a.map(v=>v/length(a)):[...fallback];
const kinetic=(v,m)=>m*dot(v,v)/2;
const airVector=a=>[a.wx,a.wy,a.lift];

export function wingBasis(heading,pitch,bank){
  const f=[Math.cos(heading),Math.sin(heading),0],l=[-f[1],f[0],0];
  const u=[-f[0]*Math.sin(pitch),-f[1]*Math.sin(pitch),Math.cos(pitch)];
  return {forward:[f[0]*Math.cos(pitch),f[1]*Math.cos(pitch),Math.sin(pitch)],
    left:add(l.map(v=>v*Math.cos(bank)),u,Math.sin(bank)),
    up:add(u.map(v=>v*Math.cos(bank)),l,-Math.sin(bank))};
}

export function pilotBasis(state){
  const c=state.coupled,up=unit(sub(c.wingPosition,c.pilotPosition));
  const nose=[Math.cos(state.heading),Math.sin(state.heading),0];
  const seed=Math.abs(up[2])<.9?[0,0,1]:[1,0,0];
  const fallback=unit(add(seed,up,-dot(seed,up)));
  const forward=unit(add(nose,up,-dot(nose,up)),fallback);
  const left=[up[1]*forward[2]-up[2]*forward[1],up[2]*forward[0]-up[0]*forward[2],up[0]*forward[1]-up[1]*forward[0]];
  return {forward,left,up};
}

export function coupledEnergy(c,rules){
  return kinetic(c.pilotVelocity,rules.pilot_mass_kg)+kinetic(c.wingVelocity,rules.wing_mass_kg)+
    G*(rules.pilot_mass_kg*c.pilotPosition[2]+rules.wing_mass_kg*c.wingPosition[2]);
}

/** Near-trim polar fits the existing mode's U/sink, not measured equipment.
 * Area fraction and induced share are explicit tuning: U/sink alone cannot
 * determine a wing's area, efficiency, stall curve or post-stall behavior.
 */
export function coupledPolar(mode,c){
  const mass=c.pilot_mass_kg+c.wing_mass_kg,area=mode.span_m*mode.chord_m*c.area_fraction;
  const v=Math.hypot(mode.trim_mps,mode.sink_mps),gamma=Math.atan2(mode.sink_mps,mode.trim_mps),q=RHO*v*v/2;
  const cl=mass*G*Math.cos(gamma)/(q*area);
  const totalDrag=mass*G*Math.sin(gamma),pilotDrag=q*c.pilot_drag_area_m2,wingDrag=totalDrag-pilotDrag;
  if(!(wingDrag>0)||!Number.isFinite(wingDrag))throw new RangeError(
    `Infeasible coupled trim polar for ${mode.label??'wing'}: pilot drag ${pilotDrag.toFixed(2)} N leaves ${wingDrag.toFixed(2)} N of ${totalDrag.toFixed(2)} N total trim drag. Reduce pilot_drag_area_m2 or revise trim speed/sink.`);
  // A fabricated minimum CD would hide an impossible calibration and prevent
  // the selected trim/sink from being reproduced. Positive budgets fit exactly.
  const cd=wingDrag/(q*area);
  return {area,cl,cd0:cd*(1-c.induced_share),induced:cd*c.induced_share/(cl*cl)};
}

export function initializeCoupled(s,config,air){
  const c=config.coupled,m=config.modes[s.mode];
  const pilotPosition=[s.x,s.y,s.z-config.landing_clearance_m+c.harness_height_m];
  const lineLength=m.canopy_height_m-c.harness_height_m;
  // Ground launch supplies the actual world velocity. Reconstructing a
  // heading-only air vector here would invent a sideways crosswind impulse.
  const velocity=[s.vx??Math.cos(s.heading)*s.speed+air.wx,s.vy??Math.sin(s.heading)*s.speed+air.wy,s.vz??s.vario??s.vertical??0];
  const relative=sub(velocity,airVector(air)),drag=.5*RHO*c.pilot_drag_area_m2*length(relative);
  const up=unit(add(relative.map(v=>v*drag),[0,0,c.pilot_mass_kg*G]));
  const out={pilotPosition,wingPosition:add(pilotPosition,up,lineLength),pilotVelocity:[...velocity],wingVelocity:[...velocity],
    lineLength,massKg:c.pilot_mass_kg+c.wing_mass_kg,tensionN:0,lineSlackM:0,initialEngineWorkJ:s.engineWorkJ??0,engineWorkJ:0,dragLossJ:0,catchLossJ:0,constraintLossJ:0,windWorkJ:0,numericalJ:0,maxProjectionM:0};
  out.energyJ=out.initialEnergyJ=coupledEnergy(out,c);return out;
}

/** Public unilateral cable solve, also used by deterministic slack/catch tests.
 * Inverse-mass projection preserves COM and gravity potential; the impulse
 * removes outward relative velocity only. No compressed cable can push.
 */
export function constrainSuspension(c,rules,dt){
  const r=sub(c.wingPosition,c.pilotPosition),distance=length(r),over=distance-c.lineLength;
  const wasSlack=c.lineSlackM>.001;
  c.lineSlackM=Math.max(0,-over);c.tensionN=0;
  if(over<-1e-8)return 0;
  const n=unit(r),ip=1/rules.pilot_mass_kg,iw=1/rules.wing_mass_kg,w=ip+iw;
  if(over>0){c.pilotPosition=add(c.pilotPosition,n,over*ip/w);c.wingPosition=add(c.wingPosition,n,-over*iw/w);}
  c.maxProjectionM=Math.max(c.maxProjectionM,Math.max(0,over));
  const outward=dot(sub(c.wingVelocity,c.pilotVelocity),n),impulse=Math.max(0,outward)/w;
  c.pilotVelocity=add(c.pilotVelocity,n,impulse*ip);c.wingVelocity=add(c.wingVelocity,n,-impulse*iw);
  c.tensionN=impulse/dt;
  const loss=impulse*impulse*w/2;
  if(wasSlack)c.catchLossJ+=loss;else c.constraintLossJ=(c.constraintLossJ??0)+loss;
  return loss;
}

/** Rotate mass-weighted velocity under lift and its external cable reaction.
 * Total tension includes curvature, but the centripetal part belongs to the
 * exact relative cable drift below. Rotating the entire 6D velocity under a
 * purely internal centripetal force would also scale COM momentum by cos(a).
 * The lift rotation preserves kinetic energy in the constraint tangent space.
 */
function liftStep(c,rules,air,lift,h){
  const mp=rules.pilot_mass_kg,mw=rules.wing_mass_kg,sp=Math.sqrt(mp),sw=Math.sqrt(mw);
  const n=unit(sub(c.wingPosition,c.pilotPosition)),u=sub(c.wingVelocity,c.pilotVelocity),w=1/mp+1/mw;
  const a=[0,0,0,...lift.map(v=>v/sw)],gradient=[...n.map(v=>-v/sp),...n.map(v=>v/sw)];
  const radial=dot(lift,n)/mw/w,candidate=radial+dot(u,u)/c.lineLength/w;
  const taut=c.lineSlackM<1e-6&&dot(u,n)>-1e-6&&candidate>0;
  if(!taut){
    // Without tension the wing cannot alter the pilot's velocity at all.
    const v=sub(c.wingVelocity,air),speed=length(v),force=length(lift);
    if(speed>.01&&force>1e-9){
      const tangent=add(lift,v,-dot(lift,v)/(speed*speed)),f=length(tangent),angle=f/mw/speed*h;
      const next=add(v.map(x=>x*Math.cos(angle)),tangent,f>1e-9?speed*Math.sin(angle)/f:0);
      const before=kinetic(c.wingVelocity,mw);c.wingVelocity=add(next,air);
      c.windWorkJ+=kinetic(c.wingVelocity,mw)-before;
    }
    return 0;
  }
  if(taut)for(let i=0;i<6;i++)a[i]-=gradient[i]*radial;
  const v=[...sub(c.pilotVelocity,air).map(v=>v*sp),...sub(c.wingVelocity,air).map(v=>v*sw)];
  const speed=length(v),accel=length(a),work=dot(v,a);
  // Work from a stale radial component is handled by the unilateral catch,
  // rather than normalized into a fictitious extra lift direction.
  if(speed>.01&&accel>1e-9){
    const tangent=add(a,v,-work/(speed*speed)),an=length(tangent),angle=an/speed*h;
    const next=add(v.map(x=>x*Math.cos(angle)),tangent,an>1e-9?speed*Math.sin(angle)/an:0);
    const before=kinetic(c.pilotVelocity,mp)+kinetic(c.wingVelocity,mw);
    c.pilotVelocity=add(next.slice(0,3).map(v=>v/sp),air);c.wingVelocity=add(next.slice(3).map(v=>v/sw),air);
    c.windWorkJ+=kinetic(c.pilotVelocity,mp)+kinetic(c.wingVelocity,mw)-before;
  }
  return taut?candidate:0;
}

/** Drift a taut cable by its exact central-force orbit about the COM.
 * This geometric curvature preserves both relative kinetic/angular momentum
 * and total linear momentum; it is not a spring or an artificial damper.
 * The small signed velocity correction accounts for the other split forces
 * only while their NET reaction remains tensile. Slack still uses free drift
 * followed by the unilateral inelastic catch in constrainSuspension.
 */
function driftSuspension(c,rules,h,support){
  const mp=rules.pilot_mass_kg,mw=rules.wing_mass_kg,total=mp+mw,w=1/mp+1/mw;
  const r=sub(c.wingPosition,c.pilotPosition),n=unit(r),u=sub(c.wingVelocity,c.pilotVelocity);
  const impulse=dot(u,n)/w,tension=support+impulse/h;
  if(support>0&&c.lineSlackM<1e-6&&tension>0){
    c.pilotVelocity=add(c.pilotVelocity,n,impulse/mp);c.wingVelocity=add(c.wingVelocity,n,-impulse/mw);
    c.constraintLossJ+=impulse*impulse*w/2;
    const velocity=sub(c.wingVelocity,c.pilotVelocity),speed=length(velocity),angle=speed*h/c.lineLength;
    const relative=r.map(v=>v*c.lineLength/length(r));
    const nextR=add(relative.map(v=>v*Math.cos(angle)),velocity,speed>1e-9?c.lineLength*Math.sin(angle)/speed:0);
    const nextU=add(velocity.map(v=>v*Math.cos(angle)),relative,-speed*Math.sin(angle)/c.lineLength);
    const centre=c.pilotPosition.map((v,i)=>(v*mp+c.wingPosition[i]*mw)/total);
    const centreVelocity=c.pilotVelocity.map((v,i)=>(v*mp+c.wingVelocity[i]*mw)/total);
    const nextCentre=add(centre,centreVelocity,h);
    c.pilotPosition=add(nextCentre,nextR,-mw/total);c.wingPosition=add(nextCentre,nextR,mp/total);
    c.pilotVelocity=add(centreVelocity,nextU,-mw/total);c.wingVelocity=add(centreVelocity,nextU,mp/total);
    c.lineSlackM=0;return tension;
  }
  c.pilotPosition=add(c.pilotPosition,c.pilotVelocity,h);c.wingPosition=add(c.wingPosition,c.wingVelocity,h);
  constrainSuspension(c,rules,h);return c.tensionN;
}

/** Force integration changes velocities, never a target speed or height.
 * Lift rotates air-relative velocity exactly, drag shrinks it exactly, so
 * neither operation manufactures still-air kinetic energy. Gravity uses a
 * dissipative symplectic step; residual error is measured, never hidden by
 * clamping the system's energy. Moving-air work is recorded separately.
 */
export function stepCoupled(s,dt,config,sample){
  const rules=config.coupled,m=config.modes[s.mode],polar=coupledPolar(m,rules);
  const firstAir=sample([s.x,s.y,s.z]);
  if(!s.coupled)s.pitch=Math.atan2(s.vario??s.vertical??0,s.speed)+rules.trim_alpha_rad;
  const old=s.coupled??initializeCoupled(s,config,firstAir);
  const c={...old,pilotPosition:[...old.pilotPosition],wingPosition:[...old.wingPosition],
    pilotVelocity:[...old.pilotVelocity],wingVelocity:[...old.wingVelocity]};
  s.coupled=c;
  const before=coupledEnergy(c,rules),dragBefore=c.dragLossJ,catchBefore=c.catchLossJ+(c.constraintLossJ??0),workBefore=c.engineWorkJ,windBefore=c.windWorkJ;
  const wingAir=airVector(sample(c.wingPosition)),pilotAir=airVector(sample(c.pilotPosition));
  const brake=(s.brakeLeft+s.brakeRight)*.5,ratio=Math.max(.5,1-brake*m.brake_fraction+s.accelerator*m.accelerator_fraction);
  const targetCl=polar.cl/(ratio*ratio),alphaTarget=rules.trim_alpha_rad+(targetCl-polar.cl)/rules.lift_slope+
    rules.deep_brake_alpha_rad*clamp((brake-.82)/.18,0,1);
  const count=Math.max(1,Math.ceil(dt/rules.max_step_s)),h=dt/count;
  let tension=0,thrust=0,stall=0,liftDot=0;
  for(let tick=0;tick<count;tick++){
    let relative=sub(c.wingVelocity,wingAir),speed=length(relative);
    // Yaw and pitch stabilization follow the system trajectory, not the
    // light canopy's orbital velocity around the pilot. This is an explicit
    // reduced attitude actuator; otherwise yaw can chase suspension sway.
    const mass=rules.pilot_mass_kg+rules.wing_mass_kg;
    const trajectory=c.pilotVelocity.map((v,i)=>(v*rules.pilot_mass_kg+c.wingVelocity[i]*rules.wing_mass_kg)/mass-wingAir[i]);
    if(Math.hypot(trajectory[0],trajectory[1])>.5)s.heading=Math.atan2(trajectory[1],trajectory[0]);
    const path=Math.atan2(trajectory[2],Math.hypot(trajectory[0],trajectory[1]));
    const pitchGoal=clamp(path+Math.atan(Math.tan(alphaTarget)/Math.max(.25,Math.cos(s.bank))),-1.3,1.3);
    s.pitchRate=((s.pitchRate??0)+(pitchGoal-s.pitch)*rules.pitch_gain*h)*Math.exp(-rules.pitch_damping*h);
    s.pitch+=s.pitchRate*h;
    const basis=wingBasis(s.heading,s.pitch,s.bank);
    const alpha=Math.atan2(-dot(relative,basis.up),dot(relative,basis.forward));
    stall=clamp((Math.abs(alpha)-rules.stall_alpha_rad)/.3,0,1);
    const cl=clamp(polar.cl+rules.lift_slope*(alpha-rules.trim_alpha_rad),-rules.max_cl,rules.max_cl)*(1-stall*.8);
    const liftUnit=unit(add(basis.up,relative,-dot(basis.up,relative)/Math.max(1e-9,speed*speed)));
    liftDot=dot(liftUnit,relative);
    const q=RHO*speed*speed/2;
    const support=liftStep(c,rules,wingAir,liftUnit.map(v=>v*q*polar.area*cl),h);
    let prior;
    const cd=polar.cd0+polar.induced*cl*cl+brake*brake*.025+stall*.7;
    // Exact quadratic drag, with air-relative dissipation and world wind work.
    for(const [key,air,mass,areaCd] of [['wingVelocity',wingAir,rules.wing_mass_kg,polar.area*cd],
      ['pilotVelocity',pilotAir,rules.pilot_mass_kg,rules.pilot_drag_area_m2]]){
      prior=[...c[key]];relative=sub(prior,air);const k=1/(1+RHO*areaCd*length(relative)*h/(2*mass));
      const next=relative.map(v=>v*k);c[key]=add(next,air);
      const loss=kinetic(relative,mass)-kinetic(next,mass);c.dragLossJ+=loss;
      c.windWorkJ+=kinetic(c[key],mass)-kinetic(prior,mass)+loss;
    }
    if(s.mode==='paramotor'&&config.propulsion){
      const motor=config.propulsion,dir=pilotBasis(s).forward,mass=rules.pilot_mass_kg;
      const along=dot(sub(c.pilotVelocity,pilotAir),dir),available=motor.max_power_w*s.engine*h;
      let impulse=motor.max_thrust_n*s.engine*h/mass;
      const airWork=mass*(impulse*along+.5*impulse*impulse);
      if(airWork>available)impulse=Math.max(0,-along+Math.sqrt(along*along+2*available/mass));
      prior=[...c.pilotVelocity];c.pilotVelocity=add(prior,dir,impulse);
      const actual=kinetic(c.pilotVelocity,mass)-kinetic(prior,mass);
      c.engineWorkJ+=mass*(impulse*along+.5*impulse*impulse);
      c.windWorkJ+=actual-mass*(impulse*along+.5*impulse*impulse);thrust+=impulse*mass/dt;
    }
    c.pilotVelocity[2]-=G*h;c.wingVelocity[2]-=G*h;
    tension+=driftSuspension(c,rules,h,support)/count;
  }
  c.tensionN=tension;c.energyJ=coupledEnergy(c,rules);c.liftVelocityDot=liftDot;
  c.numericalJ+=(c.energyJ-before)-(c.engineWorkJ-workBefore)-(c.windWorkJ-windBefore)+(c.dragLossJ-dragBefore)+(c.catchLossJ+c.constraintLossJ-catchBefore);
  const [x,y,z]=c.pilotPosition,relative=sub(c.wingVelocity,wingAir),basis=wingBasis(s.heading,s.pitch,s.bank),pilot=pilotBasis(s);
  s.distance+=Math.hypot(x-s.x,y-s.y);s.x=x;s.y=y;s.z=z+config.landing_clearance_m-rules.harness_height_m;
  s.speed=Math.hypot(relative[0],relative[1]);s.vz=s.vertical=s.vario=c.pilotVelocity[2];s.vx=c.pilotVelocity[0];s.vy=c.pilotVelocity[1];
  s.groundSpeed=Math.hypot(s.vx,s.vy);s.load=tension/(rules.pilot_mass_kg*G);s.stall=stall;s.groundEffect=0;
  s.pressure=clamp(s.load,0,1)*(1-stall*.6);s.thrustN=thrust;s.engineWorkJ=(c.initialEngineWorkJ??0)+c.engineWorkJ;
  s.pilotPitch=Math.atan2(dot(pilot.up,basis.forward),dot(pilot.up,basis.up));
  s.pilotRoll=Math.atan2(dot(pilot.up,basis.left),dot(pilot.up,basis.up));
  s.figure=c.lineSlackM>.02?'Lines slack':stall>.2?'Low energy · ease handles':s.engine>.1&&s.vario>.2?'Powered climb':
    s.vario>1?'Flare · climbing':s.accelerator>.65?'Dive · storing speed':Math.abs(s.bank)>.3?'Dynamic S-turn':'Trim glide';
  return s;
}

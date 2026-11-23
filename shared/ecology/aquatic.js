/** Engine-neutral JS counterpart of AquaticLife.h School.
 * Local X along the current, Y across, Z up relative to the water surface.
 *
 * Every aquatic agent has one shape, so later spear-fishing targets, underwater enemies and NPC swimmers
 * reuse it: `{p:[x,y,z], v:[vx,vy,vz], behaviour, phase, size}` in its group's local metres, where
 * `behaviour` names what it is doing now ('school', 'paddle', 'flee'). `react` is the flee or approach hook.
 */
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/Math.max(.00001,length(a)));
/** Flee (strength > 0) or approach (< 0) `observer` within `radius` metres: a force, zero beyond it. */
export function react(agent,observer,radius,strength){
  const away=sub(agent.p,observer),distance=length(away);
  return distance<radius?mul(unit(away),strength*(1-distance/radius)):[0,0,0];
}
export function createSchool(h){
  const s={fish:[],rx:h.radii_m[0],ry:h.radii_m[1],shallow:h.depth_range_m[0],deep:h.depth_range_m[1],current:h.current_mps,time:0,seed:h.seed};
  const random=()=>{s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;};
  for(let i=0;i<h.fish_count;i++){const a=random()*Math.PI*2,r=Math.sqrt(random())*.65;s.fish.push({p:[Math.cos(a)*s.rx*r,Math.sin(a)*s.ry*r,-s.shallow-random()*(s.deep-s.shallow)],v:mul(unit([random()-.5,random()-.5,0]),.45),phase:random()*Math.PI*2,size:(.7+random()*.6)*(h.fish_scale??1),behaviour:'school'});}
  return s;
}
export function stepSchool(s,dt,observer){
  s.time+=dt;const velocities=[];
  s.fish.forEach((f,i)=>{
    let separation=[0,0,0],alignment=[0,0,0],centre=[0,0,0],neighbours=0;
    s.fish.forEach((other,j)=>{if(i===j)return;const d=sub(f.p,other.p),distance=length(d);if(distance<2.5){alignment=add(alignment,other.v);centre=add(centre,other.p);neighbours++;}if(distance<.65)separation=add(separation,mul(d,.6/Math.max(.04,distance*distance)));});
    let force=separation;
    if(neighbours>0)force=add(force,add(mul(sub(mul(alignment,1/neighbours),f.v),.55),mul(sub(mul(centre,1/neighbours),f.p),.12)));
    force=add(force,[Math.sin(s.time*.19+i*.37)*.13-s.current*.12,Math.cos(s.time*.23+i*.53)*.09,0]);
    const edge=f.p[0]**2/s.rx**2+f.p[1]**2/s.ry**2;
    if(edge>.5)force=add(force,mul([-f.p[0]/s.rx**2,-f.p[1]/s.ry**2,0],(edge-.5)*5));
    const desired=-s.shallow-(s.deep-s.shallow)*(.5+.35*Math.sin(s.time*.24+i*.8));force[2]+=(desired-f.p[2])*.7;
    const scare=length(sub(f.p,observer));force=add(force,react(f,observer,5.5,2.2));f.behaviour=scare<5.5?'flee':'school';
    const v=add(f.v,mul(force,dt));velocities.push(mul(unit(v),Math.max(.22,Math.min(scare<5.5?1.6:.72,length(v)))));
  });
  s.fish.forEach((f,i)=>{f.v=velocities[i];f.p=add(f.p,mul(f.v,dt));f.p[2]=Math.max(-s.deep,Math.min(-s.shallow,f.p[2]));});
}

/** Ducks afloat (phase 11): `r` is a raft from aquatic.json ({radius_m, count, seed}). Local X east, Y north,
 * Z up from the surface (ducks stay at 0), centred on the raft. */
export function createRaft(r){
  const s={ducks:[],radius:r.radius_m,time:0,seed:r.seed};
  const random=()=>{s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;};
  for(let i=0;i<r.count;i++){const a=random()*Math.PI*2,d=Math.sqrt(random())*.5*s.radius;
    s.ducks.push({p:[Math.cos(a)*d,Math.sin(a)*d,0],v:mul(unit([random()-.5,random()-.5,0]),.12),phase:random()*Math.PI*2,size:.9+random()*.2,behaviour:'paddle'});}
  return s;
}
/** Paddle about slowly, keep a metre apart and near the raft; swim off from an observer near the surface. */
export function stepRaft(s,dt,observer){
  s.time+=dt;
  // An observer 2 m or more under the water goes unnoticed.
  const seen=observer[2]>-2;
  for(const d of s.ducks){
    let force=[Math.sin(s.time*.11+d.phase*3)*.05,Math.cos(s.time*.09+d.phase*5)*.05,0];
    for(const other of s.ducks){if(other===d)continue;const gap=sub(d.p,other.p),distance=length(gap);if(distance<1.2)force=add(force,mul(unit(gap),.25*(1.2-distance)));}
    const out=length(d.p)/s.radius;if(out>.6)force=add(force,mul(unit(d.p),-.12*(out-.6)));
    const fleeing=seen&&length(sub(d.p,observer))<9;if(seen)force=add(force,react(d,[observer[0],observer[1],0],9,.9));
    d.behaviour=fleeing?'flee':'paddle';
    const v=add(d.v,mul(force,dt));v[2]=0;
    d.v=mul(unit(v),Math.max(.06,Math.min(fleeing?.9:.22,length(v))));d.p=add(d.p,mul(d.v,dt));d.p[2]=0;
  }
}

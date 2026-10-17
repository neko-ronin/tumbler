/** Engine-neutral JS counterpart of AquaticLife.h School.
 * Local X along the current, Y across, Z up relative to the water surface.
 */
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const mul=(a,s)=>a.map(v=>v*s);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const length=a=>Math.hypot(...a);
const unit=a=>mul(a,1/Math.max(.00001,length(a)));
export function createSchool(h){
  const s={fish:[],rx:h.radii_m[0],ry:h.radii_m[1],shallow:h.depth_range_m[0],deep:h.depth_range_m[1],current:h.current_mps,time:0,seed:h.seed};
  const random=()=>{s.seed=(Math.imul(1664525,s.seed)+1013904223)>>>0;return s.seed/4294967296;};
  for(let i=0;i<h.fish_count;i++){const a=random()*Math.PI*2,r=Math.sqrt(random())*.65;s.fish.push({p:[Math.cos(a)*s.rx*r,Math.sin(a)*s.ry*r,-s.shallow-random()*(s.deep-s.shallow)],v:mul(unit([random()-.5,random()-.5,0]),.45),phase:random()*Math.PI*2,size:.7+random()*.6});}
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
    const away=sub(f.p,observer),scare=length(away);
    if(scare<5.5)force=add(force,mul(unit(away),2.2*(1-scare/5.5)));
    const v=add(f.v,mul(force,dt));velocities.push(mul(unit(v),Math.max(.22,Math.min(scare<5.5?1.6:.72,length(v)))));
  });
  s.fish.forEach((f,i)=>{f.v=velocities[i];f.p=add(f.p,mul(f.v,dt));f.p[2]=Math.max(-s.deep,Math.min(-s.shallow,f.p[2]));});
}

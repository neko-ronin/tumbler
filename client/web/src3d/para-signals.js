/** Browser sensation/optics only. Reads physical motion and existing geometry;
 * never writes flight state or authors world objects. XYZ remains core Z-up. */
import {surfaceGap} from '../../../shared/activities/collision.js';
import {cabinsAt} from '../../../shared/activities/gondola.js';
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
const length=v=>Math.hypot(...v);
export function paraKinematics(state,air={}){
 const active=['parakite','paraglider','paramotor'].includes(state?.mode)&&!state.grounded&&!state.launching&&!state.collapsed;
 if(!active)return {active:false,airSpeed:0,groundSpeed:0,velocity:[0,0,0],load:1,pressure:0};
 const wind=[air.wx??0,air.wy??0,air.lift??0];
 const measured=!!state.coupled?.pilotVelocity;
 const velocity=measured?[...state.coupled.pilotVelocity]:[Math.cos(state.heading)*state.speed+wind[0],Math.sin(state.heading)*state.speed+wind[1],state.vario??state.vertical??0];
 return {active:true,measured,velocity,groundSpeed:length(velocity),airSpeed:length(velocity.map((v,i)=>v-wind[i])),load:clamp(state.load??1,0,4),pressure:clamp(state.pressure??1)};
}
export function paraTargets(sample,strength=1,view='first',mode='parakite'){
 const amount=clamp(strength),speed=clamp((sample.airSpeed-8)/22),rush=sample.proximityRush??(clamp(sample.groundSpeed/30)*clamp(1-sample.distance/65));
 const profile=mode==='parakite'?1:mode==='paraglider'?.8:.9;
 return {fov:62+(view==='first'?18:12)*clamp(speed*.75+rush*.25)*amount*profile,
  smear:sample.active?clamp(speed*.4+rush*.6)*amount*profile:0,
  lens:sample.active?clamp(speed*.35+rush*.65)*amount*profile:0,
  rush:sample.active?rush:0};
}
const nearestPoint=(p,a,b)=>{const v=b.map((x,i)=>x-a[i]),f=clamp(p.reduce((s,x,i)=>s+(x-a[i])*v[i],0)/(v.reduce((s,x)=>s+x*x,0)||1));return a.map((x,i)=>x+v[i]*f);};
export function createParaSignals({height,hitTest,gondola,clock=()=>0}={}){
 let elapsed=1,speed=0,load=1,rush=0,previousDistance=-1,lastMode='',sample={active:false,smear:0,lens:0,fov:62,rush:0,velocity:[0,0,0],airSpeed:0,groundSpeed:0},nearest={distance:Infinity,point:null,kind:'open air'};
 const stats={queries:0,lastMs:0,maxMs:0,totalMs:0};
 function proximity(state){
  const start=performance.now();
  const p=[state.x,state.y,state.z];nearest={distance:Infinity,point:null,kind:'open air'};
  const consider=(point,radius,kind)=>{const d=Math.max(0,length(point.map((v,i)=>v-p[i]))-radius);if(d<nearest.distance)nearest={distance:d,point,kind};};
  for(const r of [0,12,28,48])for(const [dx,dy]of r?[[r,0],[-r,0],[0,r],[0,-r]]:[[0,0]]){
   const z=height?.(p[0]+dx,p[1]+dy);if(Number.isFinite(z))consider([p[0]+dx,p[1]+dy,Math.min(z,p[2])],0,'terrain');
  }
  // Exact near-surface queries are bounded to 40 m and 8 Hz. No long swept ray.
  for(const s of hitTest?.near?.(p,40)??[]){const d=surfaceGap(s,p);if(d<nearest.distance)nearest={distance:Math.max(0,d),point:s.min.map((v,i)=>Math.max(v,Math.min(s.max[i],p[i]))),kind:s.type==='trunk'?'tree':'rock / structure'};}
  for(const {shape,depth}of hitTest?.soft?.(p,40)??[]){const dz=Math.max(0,shape.min[2]-p[2],p[2]-shape.max[2]),d=Math.hypot(Math.max(0,40-depth),dz);if(d<nearest.distance)nearest={distance:d,point:[shape.crown.x,shape.crown.y,Math.max(shape.min[2],Math.min(shape.max[2],p[2]))],kind:'foliage'};}
  if(gondola){
   const a=gondola.stations[0].xy_m,d=(p[0]-a[0])*gondola.u[0]+(p[1]-a[1])*gondola.u[1];
   if(d>=-48&&d<=gondola.length+48){
    for(let k=Math.max(0,d-48);k<Math.min(gondola.length,d+48);k+=4)for(const off of [-gondola.config.track_m/2,gondola.config.track_m/2]){
     const end=Math.min(gondola.length,k+4),a=gondola.at(k),b=gondola.at(end);
     consider(nearestPoint(p,[a[0]+gondola.n[0]*off,a[1]+gondola.n[1]*off,gondola.z(k)],[b[0]+gondola.n[0]*off,b[1]+gondola.n[1]*off,gondola.z(end)]),.15,'ropeway');
    }
    for(const t of gondola.towers)consider(nearestPoint(p,[...t.xy_m,t.base_z],[...t.xy_m,t.top_z]),1.3,'ropeway');
    for(const c of cabinsAt(gondola,clock()))consider([c.x,c.y,c.z-gondola.config.hanger_m/2],2,'ropeway');
   }
  }
  stats.lastMs=performance.now()-start;stats.maxMs=Math.max(stats.maxMs,stats.lastMs);stats.totalMs+=stats.lastMs;stats.queries++;
 }
 return {stats,update(state,air,dt,strength=1,view='first'){
  const raw=paraKinematics(state,air),step=clamp(dt,0,.1);
  if(!raw.active){elapsed=1;rush=0;lastMode='';previousDistance=-1;sample={...raw,fov:62,smear:0,lens:0,rush:0,distance:Infinity,feature:null,loadChange:0};return sample;}
  const reset=lastMode!==state.mode||(state.distance??0)<previousDistance;
  if(reset){speed=raw.airSpeed;load=raw.load;elapsed=1;}
  elapsed+=step;if(elapsed>=.125){proximity(state);elapsed%=.125;}
  const alpha=1-Math.exp(-step/.24),oldLoad=load;speed+=(raw.airSpeed-speed)*alpha;load+=(raw.load-load)*alpha;
  sample={...raw,airSpeed:speed,load,distance:nearest.distance,feature:nearest.point?{kind:nearest.kind,point:nearest.point}:null,loadChange:step>0?clamp(Math.abs(load-oldLoad)/step,0,4):0};
  const targetRush=paraTargets(sample,strength,view,state.mode).rush;
  rush=reset?targetRush:rush+(targetRush-rush)*(1-Math.exp(-step/.12));sample.proximityRush=rush;
  Object.assign(sample,paraTargets(sample,strength,view,state.mode));
  lastMode=state.mode;previousDistance=state.distance??0;return sample;
 },get sample(){return sample;}};
}

/** S0 tumble spike bench (throwaway, docs/design/S0-TUMBLE-SPIKE.md): the same falls on
 * synthetic slopes, posed by S1's scrubbed clips and by S0's spring body, on the real rig and
 * the shared rules. Prints the comparison table; `--json <path>` also writes the traces.
 *
 *   node client/web/tools/s0_tumble_bench.mjs
 */
import {readFileSync,writeFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {gaitFor} from '../../../shared/activities/walk.js';
import {createBalance,DOWN} from '../../../shared/activities/balance.js';

const read=path=>readFileSync(new URL(path,import.meta.url));
const config=JSON.parse(read('../../../shared/characters/player.json'));
const balance=JSON.parse(read('../../../shared/activities/balance.json'));
const ronin=read('../../../shared/geometry/cat-ronin/ronin.glb');
const DT=1/60,UP=new T.Vector3(0,1,0);

// Floors are z(x, y), x east, y north. Each scenario starts him tripping, or tucking.
const lip=x=>x<2?-.15*x:x<14?-.3-.75*(x-2):-9.3-.12*(x-14);
const SCENARIOS=[
  {name:'granite 35° (grade 0.7)',surface:'granite',floor:(x,y)=>-.7*x,v:[3,0]},
  {name:'snow 24° (grade 0.45)',surface:'snow',floor:(x,y)=>-.45*x,v:[3,0]},
  {name:'meadow over a lip',surface:'grass',floor:(x,y)=>lip(x),v:[7,0]},
  {name:'across granite 31°',surface:'granite',floor:(x,y)=>.6*y,v:[4.5,0]},
  {name:'snow moguls',surface:'snow',floor:(x,y)=>-.35*x+.25*Math.sin(x*2.1)*Math.sin(y*1.6),v:[3,.5]},
  {name:'tuck roll, meadow 19°',surface:'grass',floor:(x,y)=>-.35*x,v:[2,0],tuck:2.5},
];

function run(sc,mode,{trace=true,seconds=7}={}){
  const cat=createCharacter(parseGLB(ronin),config);cat.spike.mode=mode;cat.spike.trace=trace?[]:null;
  const world={height:sc.floor,floorHeight:sc.floor,hitTest:()=>false,balance:{config:balance,surfaceAt:()=>sc.surface}};
  const heading=Math.atan2(sc.v[1],sc.v[0]);
  let s={x:0,y:0,z:sc.floor(0,0),heading,speed:Math.hypot(...sc.v),vx:sc.v[0],vy:sc.v[1],
    balance:sc.tuck?createBalance():{...createBalance(),phase:'trip',budget:0,vx:sc.v[0],vy:sc.v[1]}};
  cat.object.quaternion.setFromAxisAngle(UP,heading+Math.PI/2);
  const frames=[];
  for(let i=0,t=0;i<seconds/DT;i++,t+=DT){
    const input=sc.tuck&&t<sc.tuck?{x:sc.v[0],y:0,tuck:true}:{x:0,y:0};
    const before=s.speed??0;s=stepMoves(s,input,DT,config.walk,world);
    cat.object.position.set(s.x,s.z,-s.y);
    if(s.speed>0)cat.object.quaternion.slerp(new T.Quaternion().setFromAxisAngle(UP,s.heading+Math.PI/2),1-Math.exp(-DT*14));
    const bal=s.balance,p=balance.phases;
    if(bal)bal.progress=bal.phase==='trip'?bal.t/p.trip_s:bal.phase==='recover'?bal.t/p.recover_s:0;
    const down=bal&&DOWN.has(bal.phase),pose=down?'balance':s.speed>.05?gaitFor(s.speed,config.walk,config.clips):'idle';
    const t0=process.hrtime.bigint();
    cat.update(DT,pose,s.speed,{turnRate:s.turnRate,accel:(s.speed-before)/DT,facing:0,groundZ:sc.floor(s.x,s.y),groundHeight:sc.floor,balance:bal});
    const us=Number(process.hrtime.bigint()-t0)/1e3;
    frames.push({t,phase:bal?.phase??'steady',down,us,...(trace?cat.spike.trace.at(-1):{})});
  }
  cat.dispose();
  return frames;
}

const pct=(xs,p)=>{const o=[...xs].sort((a,b)=>a-b);return o.length?o[Math.min(o.length-1,Math.floor((o.length-1)*p))]:NaN;};
function summarise(frames){
  const down=frames.filter(f=>f.down);
  const dips=k=>Math.max(0,...down.map(f=>f.dip[k]));
  // Frames within two of a phase change, against the rest of the fall.
  const change=new Set();frames.forEach((f,i)=>{if(i&&f.phase!==frames[i-1].phase)for(let j=i-1;j<=i+2;j++)change.add(j);});
  const near=down.filter(f=>change.has(frames.indexOf(f))).map(f=>f.acc),away=down.filter(f=>!change.has(frames.indexOf(f))).map(f=>f.acc);
  return {downS:down.length*DT,head:dips('head'),paw:dips('paw'),trunk:dips('trunk'),foot:dips('foot'),
    dipped:down.filter(f=>Math.max(f.dip.head,f.dip.paw,f.dip.trunk)>.02).length/Math.max(1,down.length),
    floats:down.filter(f=>f.clear>.05).length/Math.max(1,down.length),
    accAway:pct(away,.5),accAwayP99:pct(away,.99),accChange:Math.max(0,...near),phases:[...new Set(frames.map(f=>f.phase))].join('>')};
}

const json=process.argv.includes('--json')?process.argv[process.argv.indexOf('--json')+1]:null,out={};
const f2=x=>Number.isFinite(x)?x.toFixed(2):'-',cm=x=>(x*100).toFixed(0),pc=x=>(x*100).toFixed(0)+'%';
console.log('| slope | mode | phases | down s | deepest dip cm (head / paw / trunk / foot) | down frames dipping >2 cm | floating >5 cm | part accel m/s² p50 / p99 away from changes | max accel at a phase change |');
console.log('|---|---|---|---|---|---|---|---|---|');
for(const sc of SCENARIOS)for(const mode of ['s1','s0']){
  const frames=run(sc,mode),r=summarise(frames);out[`${sc.name} ${mode}`]=frames;
  console.log(`| ${sc.name} | ${mode} | ${r.phases} | ${r.downS.toFixed(1)} | ${cm(r.head)} / ${cm(r.paw)} / ${cm(r.trunk)} / ${cm(r.foot)} | ${pc(r.dipped)} | ${pc(r.floats)} | ${r.accAway.toFixed(0)} / ${r.accAwayP99.toFixed(0)} | ${r.accChange.toFixed(0)} |`);
}
// CPU: character.update alone, no gauge, three runs of every scenario per mode.
console.log('\n| mode | character.update µs, down frames: mean / p50 / p95 / max | standing frames: mean |');console.log('|---|---|---|');
for(const mode of ['s1','s0']){
  const down=[],up=[];
  for(let k=0;k<3;k++)for(const sc of SCENARIOS)for(const f of run(sc,mode,{trace:false}).slice(30))(f.down?down:up).push(f.us);
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  console.log(`| ${mode} | ${mean(down).toFixed(0)} / ${pct(down,.5).toFixed(0)} / ${pct(down,.95).toFixed(0)} / ${Math.max(...down).toFixed(0)} | ${up.length?mean(up).toFixed(0):'-'} |`);
}
if(json)writeFileSync(json,JSON.stringify(out));

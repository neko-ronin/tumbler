/** Bounded live inspection of the actual instanced draw intervals.
 * Drained by the host every 10 seconds. Candidate bounds are not pixel occlusion. */
import * as T from '../vendor/three.module.min.js';
import {TREE_FADE_MS} from '../src3d/tree-budget.js';
export function installForestProbe(t){
 const r={phase:'warm',frames:[],events:[],coverageErrors:[],budgetErrors:[],previous:new Map(),lastTime:0,lastFrame:-1,recording:false,lastDrawTime:0};
 const update=t.forest.update.bind(t.forest),matrix=new T.Matrix4(),point=new T.Vector3();
 t.forest.update=function(...args){
  update(...args);if(!t.navigation.state){r.previous.clear();return;}if(t.metrics.frame===r.lastFrame)return;r.lastFrame=t.metrics.frame;
  const now=performance.now(),current=new Map();
  t.forest.group.traverse(m=>{const match=m.name.match(/^studio_lod(\d)_.*?(redwood\/.*|arboreal\/.*)$/);if(!match||!m.visible)return;const lod=+match[1],range=m.geometry.attributes.forestInterval;
   for(let i=0;i<m.count;i++){
    m.getMatrixAt(i,matrix);const e=matrix.elements,id=match[2]+':'+[e[12],e[13],e[14]].join(',');let a=current.get(id);
    if(!a){point.set(e[12],e[13]+15,e[14]);const distance=point.distanceTo(t.camera.position);point.project(t.camera);a={weights:[0,0,0,0],distance,screen:point.toArray()};current.set(id,a);}
    a.weights[lod]+=range.getY(i)-range.getX(i);
   }
  });
  const drawTime=t.forest.stats.adopted.selectionTime??now,dt=drawTime-r.lastDrawTime;let cuts=0;
  for(const [id,a]of current){
   const coverage=a.weights.reduce((x,y)=>x+y,0);if(Math.abs(coverage-1)>1e-5)r.coverageErrors.push({time:now,id,coverage});
   const prev=r.previous.get(id);
   if(prev&&dt>0&&dt<150&&a.distance<250&&Math.abs(a.screen[0])<.85&&Math.abs(a.screen[1])<.85&&a.screen[2]>-1&&a.screen[2]<1){
    const change=Math.max(...a.weights.map((w,i)=>Math.abs(w-prev.weights[i])));
    if(change>Math.max(.35,1.51*dt/TREE_FADE_MS+1e-6)){cuts++;r.events.push({time:now,phase:r.phase,id,dt,change,before:prev.weights,after:a.weights,distance:a.distance});}
   }
  }
  const s=t.forest.stats.adopted;
  if(s.trianglesByLod.slice(0,3).some((n,i)=>n>s.budgets[i]+1e-6))r.budgetErrors.push({time:now,used:s.trianglesByLod,budgets:s.budgets});
  r.frames.push({time:now,frame:t.metrics.frame,phase:r.phase,eye:t.camera.position.toArray(),player:[t.navigation.state.x,t.navigation.state.y,t.navigation.state.z],mode:t.navigation.state.mode??'ground',speed:t.navigation.state.speed,clip:t.character.clip,cpu:t.metrics.cpuMs,recording:r.recording,drawTime,selection:s.selectionMs,tri:[...s.trianglesByLod],budgets:[...s.budgets],quality:s.quality??1,cuts});
  r.previous=current;r.lastTime=now;r.lastDrawTime=drawTime;
 };
 return {setPhase:p=>r.phase=p,setRecording:enabled=>r.recording=enabled,reset(){r.previous.clear();r.lastDrawTime=0;},drain(){const value={frames:r.frames,events:r.events,coverageErrors:r.coverageErrors,budgetErrors:r.budgetErrors};r.frames=[];r.events=[];r.coverageErrors=[];r.budgetErrors=[];return value;},restore(){t.forest.update=update;}};
}
export function stageForestWalk(t,x=1723.3673,y=927.1585,heading=Math.PI/2){
 globalThis.forestTrial?.probe.reset();t.navigation.clear();t.navigation.select('orbit');const z=t.navigation.sampleFloor(x,y);
 t.camera.position.set(x,z+5,-y);t.camera.lookAt(x+Math.cos(heading),z+5,-y-Math.sin(heading));t.navigation.select('walk');
}
export async function stageTreeApproach(t){
 const {trunkRadiusAt}=await import('../../../shared/activities/climb.js'),cfg=await(await fetch('/shared/characters/player.json')).json();
 const box=t.ride.hitTest.near([-1594.6959,406.1902,51],20).filter(b=>b.trunk).sort((a,b)=>Math.hypot(a.trunk.x+1594.6959,a.trunk.y-406.1902)-Math.hypot(b.trunk.x+1594.6959,b.trunk.y-406.1902))[0];
 if(!box)throw Error('Missing tree approach');const tr=box.trunk,r=trunkRadiusAt(tr,tr.base_z+.9)+cfg.walk.radius_m+1.2;
 const candidates=Array.from({length:24},(_,i)=>{const angle=i/24*Math.PI*2,x=tr.x+Math.cos(angle)*r,y=tr.y+Math.sin(angle)*r;return {x,y,z:t.navigation.sampleFloor(x,y),angle};}).filter(p=>p.z>=tr.base_z-cfg.walk.max_step_m&&p.z<tr.base_z+3);
 const p=candidates.sort((a,b)=>Math.abs(a.z-tr.base_z)-Math.abs(b.z-tr.base_z))[0];if(!p)throw Error('No stable tree approach');
 stageForestWalk(t,p.x,p.y,p.angle+Math.PI);return {start:p,trunk:[tr.x,tr.y,tr.base_z]};
}

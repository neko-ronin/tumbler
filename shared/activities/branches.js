/** Engine-neutral branch traversal. Core XYZ metres; graph paths originate in
 * the tree generator. Instances are expanded lazily, never persisted per limb. */
import {attachClimb,climbRadiusAt} from './climb.js';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),distance=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
const xyz=s=>[s.x,s.y,s.z];
const transform=(m,p)=>[0,1,2].map(a=>m[a]*p[0]+m[4+a]*p[1]+m[8+a]*p[2]+m[12+a]);
export function branchPoint(branch,d){
  d=clamp(d,0,branch.length);let walked=0;
  for(let i=1;i<branch.path.length;i++){
    const a=branch.path[i-1],b=branch.path[i],length=distance(a.slice(0,3),b.slice(0,3));
    if(walked+length>=d||i===branch.path.length-1){const t=length?(d-walked)/length:0;return {point:a.map((v,k)=>v+(b[k]-v)*t),tangent:b.slice(0,3).map((v,k)=>(v-a[k])/(length||1)),d};}walked+=length;
  }
}
function nearest(branch,p){
  let best=null,walked=0;
  for(let i=1;i<branch.path.length;i++){
    const a=branch.path[i-1],b=branch.path[i],delta=b.slice(0,3).map((v,k)=>v-a[k]),len=distance(a.slice(0,3),b.slice(0,3));
    const t=clamp(delta.reduce((sum,v,k)=>sum+v*(p[k]-a[k]),0)/(len*len||1),0,1),q=a.slice(0,3).map((v,k)=>v+delta[k]*t),gap=distance(p,q);
    if(!best||gap<best.gap)best={gap,d:walked+t*len};walked+=len;
  }return best;
}
/** Spatial index of tree instances; at most 24 expanded trees are retained. */
export function createBranchIndex(trees){
  const cells=new Map(),cache=new Map();
  for(const tree of trees)for(let y=Math.floor(tree.min[1]/64);y<=Math.floor(tree.max[1]/64);y++)for(let x=Math.floor(tree.min[0]/64);x<=Math.floor(tree.max[0]/64);x++){
    const key=x+','+y;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(tree);
  }
  const expand=tree=>{
    if(cache.has(tree.id)){const b=cache.get(tree.id);cache.delete(tree.id);cache.set(tree.id,b);return b;}
    const scale=Math.hypot(tree.matrix[4],tree.matrix[5],tree.matrix[6]);
    const branches=tree.graph.map(b=>{const path=b.path.map(p=>[...transform(tree.matrix,p),p[3]*scale]);return {...b,id:tree.id+':'+b.id,treeId:tree.id,trunkBox:tree.trunkBox,path,min:[0,1,2].map(a=>Math.min(...path.map(p=>p[a]-p[3]))),max:[0,1,2].map(a=>Math.max(...path.map(p=>p[a]+p[3]))),length:path.slice(1).reduce((sum,p,i)=>sum+distance(p.slice(0,3),path[i].slice(0,3)),0)};});
    cache.set(tree.id,branches);if(cache.size>24)cache.delete(cache.keys().next().value);return branches;
  };
  const near=(p,r)=>{
    const set=new Set();for(let y=Math.floor((p[1]-r)/64);y<=Math.floor((p[1]+r)/64);y++)for(let x=Math.floor((p[0]-r)/64);x<=Math.floor((p[0]+r)/64);x++)for(const tree of cells.get(x+','+y)??[])set.add(tree);
    return [...set].filter(t=>t.min.every((v,a)=>p[a]+r>=v&&p[a]-r<=t.max[a])).flatMap(expand).filter(b=>b.min.every((v,a)=>p[a]+r>=v&&p[a]-r<=b.max[a]));
  };
  return Object.assign(near,{stats:()=>({trees:trees.length,cachedTrees:cache.size})});
}
function limits(b,c){
  let start=null,end=null;
  for(let d=0;d<=b.length+.05;d+=.1){const p=branchPoint(b,Math.min(d,b.length)).point,t=b.trunkBox.trunk;
    if(p[3]>=c.min_radius_m&&Math.hypot(p[0]-t.x,p[1]-t.y)>=climbRadiusAt(t,p[2])+.4){start??=d;end=Math.min(d,b.length);}}
  return start!==null&&end-start>.3?{start,end}:null;
}
function onBranch(s,b,d,c){
  const bounds=s.branch===b&&s.branchLimits?s.branchLimits:limits(b,c);if(!bounds)return null;
  d=clamp(d,bounds.start,bounds.end);const {point:p,tangent}=branchPoint(b,d);
  return {...s,heading:s.mode==='branch'?s.heading:Math.atan2(tangent[1],tangent[0]),mode:'branch',branch:b,branchDistance:d,branchLimits:bounds,x:p[0],y:p[1],z:p[2]+p[3],groundZ:p[2]+p[3],grounded:true,jumpPhase:'grounded',jumpHeld:!!s.jumpHeld,launchReady:false,vx:0,vy:0,vz:0,speed:0};
}
export function mountNearbyBranch(state,config,world){
  const c=config.branches;if(!c)return null;let best=null;
  for(const b of world.hitTest.branchesNear?.(xyz(state),c.mount_reach_m+2)??[]){
    if(b.trunkBox!==state.trunkBox)continue;const bounds=limits(b,c);if(!bounds)continue;
    const n=nearest(b,xyz(state)),at=branchPoint(b,clamp(n.d,bounds.start,bounds.end)).point,gap=distance(xyz(state),at.slice(0,3));
    const blockers=world.hitTest.near?.([at[0],at[1],at[2]+.9],config.radius_m)??[];
    if(gap<=c.mount_reach_m&&!blockers.some(box=>box!==state.trunkBox)&&(!best||gap<best.gap))best={b,d:n.d,gap};
  }return best?onBranch(state,best.b,best.d,c):null;
}
export function branchLanding(previous,state,config,world){
  if(!config.branches||state.grounded||state.vz>=0)return null;const c=config.branches;let best=null;
  for(const b of world.hitTest.branchesNear?.(xyz(state),2)??[]){
    const n=nearest(b,xyz(state)),bounds=limits(b,c);if(!bounds||n.d<bounds.start||n.d>bounds.end)continue;
    const p=branchPoint(b,n.d).point,top=p[2]+p[3];
    if(previous.z>=top-.04&&state.z<=top+.04&&Math.hypot(state.x-p[0],state.y-p[1])<=p[3]+config.radius_m&&(!best||top>best.top))best={b,d:n.d,top};
  }return best?onBranch(state,best.b,best.d,c):null;
}
function leap(s,input,c,world,radius){
  const length=Math.hypot(input.x??0,input.y??0),dir=length>.1?[input.x/length,input.y/length]:[Math.cos(s.heading),Math.sin(s.heading)];let best=null;
  for(const b of world.hitTest.branchesNear?.(xyz(s),c.leap_range_m)??[]){
    if(b.treeId===s.branch.treeId)continue;const bounds=limits(b,c);if(!bounds)continue;
    for(let d=bounds.start;d<=bounds.end;d+=.5){const p=branchPoint(b,d).point,target=[p[0],p[1],p[2]+p[3]],dx=target[0]-s.x,dy=target[1]-s.y,h=Math.hypot(dx,dy),align=(dx*dir[0]+dy*dir[1])/(h||1),dz=target[2]-s.z,disc=c.leap_up_mps**2-2*c.gravity_mps2*dz;
      if(h<1||h>c.leap_range_m||align<.5||disc<0)continue;
      const time=(c.leap_up_mps+Math.sqrt(disc))/c.gravity_mps2;if(time<=0||h/time>c.leap_mps)continue;
      const v=[dx/time,dy/time,c.leap_up_mps];let clear=true,prev=[s.x,s.y,s.z+.8];
      for(let t=.04;t<=time+.04;t+=.04){const u=Math.min(time,t),q=[s.x+v[0]*u,s.y+v[1]*u,s.z+v[2]*u-c.gravity_mps2*u*u/2+.8];if(world.hitTest(prev,q,radius)){clear=false;break;}prev=q;}
      const score=h+(1-align)*8+Math.abs(dz)*.2;if(clear&&(!best||score<best.score))best={b,d,time,v,score,target};
    }
  }
  return best?{...s,mode:'tree-jump',grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpTier:1,jumpVz:c.leap_up_mps,jumpHeld:true,jumpTime:0,jumpProgress:0,leap:best,leapOrigin:xyz(s),vx:best.v[0],vy:best.v[1],vz:best.v[2],speed:Math.hypot(...best.v.slice(0,2)),heading:Math.atan2(best.v[1],best.v[0])}:null;
}
export function stepBranch(state,input,dt,config,world){
  const c=config.branches,s={...state},edge=!!input.jump&&!state.jumpHeld;s.jumpHeld=!!input.jump;
  if(input.branch){const box=s.branch.trunkBox,t=box.trunk;if(Math.hypot(s.x-t.x,s.y-t.y)<=climbRadiusAt(t,s.z)+c.mount_reach_m)return attachClimb(s,box,config);}
  if(edge){const target=leap(s,input,c,world,config.radius_m);if(target)return target;
    const n=Math.hypot(input.x??0,input.y??0),dx=n>1e-5?(input.x??0)/n:Math.cos(s.heading),dy=n>1e-5?(input.y??0)/n:Math.sin(s.heading);
    return {...s,mode:'ground',grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpTier:1,jumpTime:0,jumpVz:c.leap_up_mps,vz:c.leap_up_mps,vx:dx*c.leap_mps,vy:dy*c.leap_mps,climbCooldown:.25};}
  const at=branchPoint(s.branch,s.branchDistance),along=(input.x??0)*at.tangent[0]+(input.y??0)*at.tangent[1],speed=(input.run?c.run_mps*Math.max(.5,s.branch.stiffness):c.walk_mps)*clamp(along,-1,1);
  const d=clamp(s.branchDistance+speed*Math.min(.05,dt),s.branchLimits.start,s.branchLimits.end),next=onBranch(s,s.branch,d,c);
  const obstruction=world.hitTest([s.x,s.y,s.z+.8],[next.x,next.y,next.z+.8],config.radius_m);
  if(obstruction&&obstruction!==s.branch.trunkBox)return {...s,speed:0};
  next.jumpHeld=s.jumpHeld;next.speed=dt>0?distance(xyz(s),xyz(next))/dt:0;next.heading=Math.abs(speed)>.05?Math.atan2(at.tangent[1]*Math.sign(speed),at.tangent[0]*Math.sign(speed)):s.heading;
  return next;
}
export function stepTreeJump(state,input,dt,config,world){
  const s={...state},c=config.branches,l=s.leap,t=Math.min(l.time,s.jumpTime+Math.min(dt,.05)),v=l.v,o=s.leapOrigin;
  s.x=o[0]+v[0]*t;s.y=o[1]+v[1]*t;s.z=o[2]+v[2]*t-c.gravity_mps2*t*t/2;s.vz=v[2]-c.gravity_mps2*t;s.jumpTime=t;s.jumpProgress=t/l.time;s.jumpHeld=!!input.jump;
  if(world.hitTest([state.x,state.y,state.z+.8],[s.x,s.y,s.z+.8],config.radius_m))return {...state,mode:'ground',grounded:false,jumpPhase:'airborne',vx:0,vy:0,vz:0,climbCooldown:0};
  return t>=l.time-1e-9?onBranch(s,l.b,l.d,c):s;
}

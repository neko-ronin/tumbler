/** The gondola: a detachable two-track ropeway between two authored stations.
 *
 * Engine-neutral, X east, Y north, Z up, SI units. buildGondola sites the
 * towers against the ground and the world's solids and crowns (the same
 * collision index walking and flight use), so every client draws the same
 * line. Cabins loop on one clock: each creeps around a bullwheel for dwell_s
 * (boarding and stepping off), then rides the cable at speed_mps. A rider is
 * attached to one cabin from boarding until it reaches the far bullwheel;
 * fast travel is simply arriving now.
 */

const lerp=(a,b,t)=>a+(b-a)*t;

/** Site the line. `ground(x, y)` is the terrain; `hitTest` the collision index (optional). */
export function buildGondola(config,ground,hitTest=null){
  if(config.version!==1)throw new Error(`Unsupported gondola version: ${config.version}`);
  const [a,b]=config.stations;
  const length=Math.hypot(b.xy_m[0]-a.xy_m[0],b.xy_m[1]-a.xy_m[1]);
  const u=[(b.xy_m[0]-a.xy_m[0])/length,(b.xy_m[1]-a.xy_m[1])/length],n=[-u[1],u[0]];
  const at=d=>[a.xy_m[0]+u[0]*d,a.xy_m[1]+u[1]*d];
  const g=d=>ground(...at(d));
  // A deck is level over its whole bullwheel loop, so it stands on the highest ground under it.
  const reach=config.track_m/2+config.cabin.length_m;
  const deck=config.stations.map(s=>{
    const z=Math.max(...[[0,0],...Array.from({length:12},(_,k)=>[Math.cos(k*Math.PI/6)*reach,Math.sin(k*Math.PI/6)*reach])].map(([dx,dy])=>ground(s.xy_m[0]+dx,s.xy_m[1]+dy)));
    if(!Number.isFinite(z))throw new Error(`Station ${s.id} is off the map`);return z+config.deck_m;});
  const head=deck.map(z=>z+config.hanger_m);
  const half=config.track_m/2,body=config.hanger_m/2+.6,approach=40;
  const zOn=(s0,s1,d)=>{const t=(d-s0.d)/(s1.d-s0.d);return lerp(s0.z,s1.z,t)-config.sag*(s1.d-s0.d)*4*t*(1-t);};
  // A span is clear when both tracks' cabins miss every solid and crown and ride clear_m over the ground
  // (except on the approach, where they come down to the deck).
  function clear(s0,s1){
    for(let d=s0.d+2;d<s1.d;d+=5){
      const z=zOn(s0,s1,d),floor=z-config.hanger_m,[x,y]=at(d),gz=g(d);
      const ends=Math.min(d,length-d)<approach;
      if(!Number.isFinite(gz)||floor-gz<(ends?1:config.clear_m))return false;
      if(!hitTest)continue;
      for(const side of [-half,half]){
        const p=[x+n[0]*side,y+n[1]*side,z-config.hanger_m/2];
        if(hitTest(p,p,body)||hitTest.soft?.(p,body)?.length)return false;
      }
    }
    return true;
  }
  const towerFree=(d,top)=>{const [x,y]=at(d),gz=g(d);return !hitTest||!hitTest([x,y,gz+1],[x,y,top-1],1.5);};
  const t=config.tower,supports=[{d:0,z:head[0]}],end={d:length,z:head[1]};
  for(let cur=supports[0];;){
    if(length-cur.d<=t.max_span_m&&clear(cur,end)){supports.push(end);break;}
    let next=null;
    for(let d=Math.min(cur.d+t.max_span_m,length-t.min_span_m);d>=cur.d+t.min_span_m&&!next;d-=t.spacing_m)
      for(let h=t.min_m;h<=t.max_m;h+=t.step_m){const s={d,z:g(d)+h,height_m:h};if(towerFree(d,s.z)&&clear(cur,s)){next=s;break;}}
    if(!next)throw new Error(`No clear tower site beyond ${Math.round(cur.d)} m`);
    supports.push(next);cur=next;
  }
  const z=d=>{let i=1;while(i<supports.length-1&&supports[i].d<d)i++;return zOn(supports[i-1],supports[i],Math.max(0,Math.min(length,d)));};
  // Arc length along the cable, for constant speed on steep spans.
  const table=[{d:0,s:0}];
  for(let d=2,p=z(0);d<=length+1e-9;d+=2){const q=z(Math.min(d,length));table.push({d:Math.min(d,length),s:table.at(-1).s+Math.hypot(Math.min(d,length)-table.at(-1).d,q-p)});p=q;}
  const cableM=table.at(-1).s,travel=cableM/config.speed_mps,dwell=config.dwell_s,period=2*(dwell+travel);
  // The deck covers the bullwheel loop with a walkway round it; a ramp runs from its edge to the exit.
  const deckHalf=[config.track_m/2+config.cabin.length_m/2+2.5,config.track_m/2+config.cabin.width_m/2+2.5];
  const stations=config.stations.map((s,i)=>{
    const ex=s.exit_xy_m[0]-s.xy_m[0],ey=s.exit_xy_m[1]-s.xy_m[1],run=Math.hypot(ex,ey),e=[ex/run,ey/run];
    const edge=Math.min(deckHalf[0]/Math.max(1e-6,Math.abs(e[0]*u[0]+e[1]*u[1])),deckHalf[1]/Math.max(1e-6,Math.abs(e[0]*n[0]+e[1]*n[1])));
    return {...s,deck_z:deck[i],cable_z:head[i],ground_z:Math.min(...[[1,1],[1,-1],[-1,1],[-1,-1]].map(([p,q])=>ground(s.xy_m[0]+u[0]*p*deckHalf[0]+n[0]*q*deckHalf[1],s.xy_m[1]+u[1]*p*deckHalf[0]+n[1]*q*deckHalf[1]))),
      half_m:deckHalf,ramp:{dir:e,from_m:edge,to_m:run,width_m:2.4,exit_z:ground(...s.exit_xy_m)}};
  });
  return {config,stations,length,u,n,supports,towers:supports.slice(1,-1).map(s=>({xy_m:at(s.d),d_m:s.d,base_z:g(s.d),top_z:s.z,height_m:s.height_m})),
    cable_m:cableM,travel_s:travel,period_s:period,headway_s:period/config.cabins,at,z,
    dAt(s){let lo=0,hi=table.length-1;while(hi-lo>1){const m=lo+hi>>1;table[m].s<s?lo=m:hi=m;}const p=table[lo],q=table[hi];return lerp(p.d,q.d,q.s>p.s?(s-p.s)/(q.s-p.s):0);}};
}

/** Where cabin `index` hangs at time `t`: cable point, the cabin floor, heading, and its phase.
 * Phases: 0 at the first station's bullwheel, 'up', 1 at the second's, 'down'. */
export function cabinAt(line,index,t){
  const {config:c,period_s:P,travel_s:U,u,n}=line,D=c.dwell_s,r=c.track_m/2;
  const tau=((t+index*P/c.cabins)%P+P)%P;
  let x,y,z,heading,phase;
  const arc=(station,f,sign)=>{
    const s=line.stations[station],al=Math.PI*f,ox=sign*(n[0]*Math.cos(al)+u[0]*Math.sin(al)),oy=sign*(n[1]*Math.cos(al)+u[1]*Math.sin(al));
    x=s.xy_m[0]-ox*r;y=s.xy_m[1]-oy*r;z=s.cable_z;
    heading=Math.atan2(sign*(n[1]*Math.sin(al)-u[1]*Math.cos(al)),sign*(n[0]*Math.sin(al)-u[0]*Math.cos(al)));
  };
  const track=(f,side,dir)=>{const d=line.dAt(f*line.cable_m),dd=dir>0?d:line.length-d,[px,py]=line.at(dd);
    x=px+n[0]*side*r;y=py+n[1]*side*r;z=line.z(dd);heading=Math.atan2(u[1]*dir,u[0]*dir);};
  // Around the first bullwheel from the down side (−n) behind the station to the up side (+n), and the reverse at the top.
  if(tau<D){arc(0,tau/D,1);phase=0;}
  else if(tau<D+U){track((tau-D)/U,1,1);phase='up';}
  else if(tau<2*D+U){arc(1,(tau-D-U)/D,-1);phase=1;}
  else{track((tau-2*D-U)/U,-1,-1);phase='down';}
  return {index,x,y,z,floor_z:z-c.hanger_m,heading,phase,tau};
}

export const cabinsAt=(line,t)=>Array.from({length:line.config.cabins},(_,i)=>cabinAt(line,i,t));

/** The walkable floor a station adds at [x, y]: its deck, or its ramp to the exit; null elsewhere. */
export function deckFloor(line,x,y){
  for(const s of line.stations){
    const dx=x-s.xy_m[0],dy=y-s.xy_m[1];
    if(Math.abs(dx*line.u[0]+dy*line.u[1])<=s.half_m[0]&&Math.abs(dx*line.n[0]+dy*line.n[1])<=s.half_m[1])return s.deck_z;
    const r=s.ramp,along=dx*r.dir[0]+dy*r.dir[1],across=Math.abs(-dx*r.dir[1]+dy*r.dir[0]);
    if(across<=r.width_m/2&&along>=r.from_m-.01&&along<=r.to_m)return lerp(s.deck_z,r.exit_z,(along-r.from_m)/(r.to_m-r.from_m));
  }
  return null;
}

/** The station whose deck [x, y] stands on (within board_m), or null. */
export function stationNear(line,x,y,radius=line.config.board_m){
  return line.stations.find(s=>Math.hypot(x-s.xy_m[0],y-s.xy_m[1])<=radius)??null;
}

/** Board at `station` (an id or index) at time t: the cabin now at its bullwheel, or the next one in.
 * Returns a ride; `wait_s` is how long until that cabin is boardable. */
export function boardGondola(line,station,t){
  const from=typeof station==='number'?station:line.stations.findIndex(s=>s.id===station);
  if(from<0)throw new Error(`Unknown gondola station ${station}`);
  const {period_s:P,travel_s:U}=line,D=line.config.dwell_s,start=from?D+U:0,margin=Math.min(2,D/3);
  let best=null;
  for(let i=0;i<line.config.cabins;i++){
    const tau=cabinAt(line,i,t).tau,into=((tau-start)%P+P)%P;
    const wait=into<D-margin?0:P-into;
    if(!best||wait<best.wait_s)best={cabin:i,wait_s:wait,into};
  }
  const departs=t+best.wait_s,inAt=best.wait_s?0:best.into;
  return {cabin:best.cabin,from,to:1-from,wait_s:best.wait_s,board_t:departs,arrive_t:departs+(D-inAt)+U+1e-6,fast:false};
}

/** The rider's place at time t: their cabin, and whether it has reached the far station. */
export function rideAt(line,ride,t){
  const cabin=cabinAt(line,ride.cabin,Math.min(t,ride.arrive_t));
  const done=ride.fast||t>=ride.arrive_t,waiting=t<ride.board_t;
  const span=ride.arrive_t-ride.board_t;
  return {...cabin,done,waiting,wait_s:Math.max(0,ride.board_t-t),progress:Math.max(0,Math.min(1,(t-ride.board_t)/span)),exit_xy_m:line.stations[ride.to].exit_xy_m,to:line.stations[ride.to]};
}

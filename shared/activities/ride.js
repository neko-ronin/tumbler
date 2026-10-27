/** Engine-neutral skiing and cycling on the core's ground. World axes X east, Y north, Z up.
 * The rider is a point mass on the surface: gravity along the slope, surface rolling or snow
 * friction, braking, air drag, carving or lean-limited steering, pedal power, and free flight
 * off any lip the ground drops away from. The client supplies a height sampler, the surface
 * sampler built here from core data, input and an optional swept hit test.
 * Integrate at a fixed 1/120 s step. Speeds in metres/second, headings radians CCW from east.
 */
import {knockDirection} from './collision.js';
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));

/** Where a mode starts: on a graded track where it melts out (the vertex after its last snow, sampled
 * every 2 m; late spring keeps the upper trails white), or under the headwall of a cirque. */
export function rideStart(config,startId,worldmap,snowAt=()=>0){
  const start=config.starts.find(s=>s.id===startId);
  if(!start)throw new Error(`Unknown ride start: ${startId}`);
  if(start.track){
    const track=worldmap.tracks.find(t=>t.id===start.track);
    if(!track?.profile_z_m)throw new Error(`Track ${start.track} is not graded`);
    const P=track.polyline;let k=0;
    for(let i=0;i<P.length-1;i++){const [a,b]=[P[i],P[i+1]],L=Math.hypot(b[0]-a[0],b[1]-a[1]);
      for(let d=0;d<=L;d+=2)if(snowAt(a[0]+(b[0]-a[0])*d/L,a[1]+(b[1]-a[1])*d/L)>=config.snow_min_depth_m)k=i+1;}
    k=Math.min(k,P.length-2);const [a,b]=[P[k],P[k+1]];
    return {...start,xy_m:a,heading:Math.atan2(b[1]-a[1],b[0]-a[0])};
  }
  const bowl=worldmap.mountains.bowls.find(b=>b.id===start.bowl);
  if(!bowl)throw new Error(`Unknown cirque: ${start.bowl}`);
  const [hx,hy]=bowl.head_xy_m,[lx,ly]=bowl.lip_xy_m,heading=Math.atan2(ly-hy,lx-hx),d=start.below_head_m??0;
  return {...start,xy_m:[hx+Math.cos(heading)*d,hy+Math.sin(heading)*d],heading};
}

export function startRide(config,start,height){
  if(config.version!==1)throw new Error(`Unsupported ride rules version: ${config.version}`);
  if(!config.modes[start.mode])throw new Error(`Unknown ride activity: ${start.mode}`);
  const [x,y]=start.xy_m;
  return {mode:start.mode,x,y,z:height(x,y),vx:0,vy:0,vz:0,heading:start.heading,lean:0,pitch:0,
    grounded:true,airtime:0,crashed:null,surface:null,distance:0,topSpeed:0,startZ:height(x,y)};
}

/** Surface under a point: 'snow' where the stamp is deep enough, 'trail' on a graded tread, else 'ground'. */
export function createSurfaceSampler(config,snowAt,trail){
  return (x,y)=>snowAt(x,y)>=config.snow_min_depth_m?'snow':trail(x,y)?.beyond===0?'trail':'ground';
}

/** The riding surface: each graded track's bench, flat at its profile height to `bench_m` from the
 * centreline and joining the terrain over `shoulder_m` (the same rule `shared/terrain/trails.py`
 * cuts into the 8 m height grid, evaluated here at full resolution, so where switchback legs pass
 * closer than the grid can hold, the wheel or ski still runs on the graded bench). */
export function createRideHeight(terrain,trail){
  return (x,y)=>{const t=trail(x,y),g=terrain(x,y);if(!t)return g;const k=clamp((t.d-t.bench)/t.shoulder,0,1);return t.z+(g-t.z)*k*k*(3-2*k);};
}

/** Bilinear snow depth in metres from `snow_cover.json`'s run-length depth grid; the decoded grid rides along. */
export function createSnowSampler(stamp){
  if(stamp.version!==1)throw new Error(`Unsupported snow cover version: ${stamp.version}`);
  const {resolution:n,quad_size_m:q,offset_xy_m:[ox,oy]}=stamp.grid,depth=new Float32Array(n*n);
  let i=0;for(const [count,value] of stamp.depth.runs){depth.fill(value*stamp.depth.unit_m,i,i+count);i+=count;}
  if(i!==n*n)throw new Error(`snow cover runs cover ${i} of ${n*n} cells`);
  return Object.assign((x,y)=>{
    const gx=clamp((x-ox)/q,0,n-1.001),gy=clamp((y-oy)/q,0,n-1.001),c=Math.floor(gx),r=Math.floor(gy),fx=gx-c,fy=gy-r,k=r*n+c;
    return (depth[k]*(1-fx)+depth[k+1]*fx)*(1-fy)+(depth[k+n]*(1-fx)+depth[k+n+1]*fx)*fy;
  },{depth,resolution:n});
}

/** The nearest graded centreline within its bench and shoulder: {d: metres from it, beyond: metres
 * past the tread's edge (0 on the tread), z: profile height, bench, shoulder}, else null. */
export function createTrailSampler(worldmap,cellM=32){
  const cells=new Map();let reach=0;
  for(const track of worldmap.tracks.filter(t=>t.profile_z_m)){
    const p=track.polyline,z=track.profile_z_m,{bench_m:bench,shoulder_m:shoulder}=track.grading,half=(track.width_m??2.4)/2;
    reach=Math.max(reach,bench+shoulder);
    // Every cell a segment's box touches: a straight leg can run far past its ends' cells.
    for(let k=0;k<p.length-1;k++){const [a,b]=[p[k],p[k+1]];
      for(let i=Math.floor(Math.min(a[0],b[0])/cellM);i<=Math.floor(Math.max(a[0],b[0])/cellM);i++)for(let j=Math.floor(Math.min(a[1],b[1])/cellM);j<=Math.floor(Math.max(a[1],b[1])/cellM);j++){
        const key=`${i},${j}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push([a,b,z[k],z[k+1],half,bench,shoulder]);}}
  }
  const span=Math.ceil(reach/cellM);
  return (x,y)=>{
    const cx=Math.floor(x/cellM),cy=Math.floor(y/cellM);let best=null;
    for(let j=cy-span;j<=cy+span;j++)for(let i=cx-span;i<=cx+span;i++)for(const [[ax,ay],[bx,by],az,bz,half,bench,shoulder] of cells.get(`${i},${j}`)??[]){
      const dx=bx-ax,dy=by-ay,t=clamp(((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy||1),0,1),d=Math.hypot(x-ax-dx*t,y-ay-dy*t);
      if(d<=bench+shoulder&&(!best||d<best.d))best={d,beyond:Math.max(0,d-half),z:az+(bz-az)*t,bench,shoulder};
    }
    return best;
  };
}

/** input: steer -1..1 (positive turns right), push 0..1 (pedal or pole), brake 0..1, tuck 0..1, hop boolean. */
export function stepRide(state,input,dt,config,height,surfaceAt,hitTest=null){
  const s={...state};if(s.crashed)return s;
  const mode=config.modes[s.mode],g=config.gravity_mps2;
  const steer=clamp(input.steer||0,-1,1),push=clamp(input.push||0,0,1),brake=clamp(input.brake||0,0,1),tuck=clamp(input.tuck||0,0,1);
  s.surface=surfaceAt(s.x,s.y);const k=mode.surfaces[s.surface];
  const hx=Math.cos(s.heading),hy=Math.sin(s.heading);
  let u=s.vx*hx+s.vy*hy,w=-s.vx*hy+s.vy*hx;
  const cda=mode.cda_m2*(1-tuck*(1-mode.tuck_cda_fraction));
  const drag=.5*config.air_density_kgpm3*cda*u*Math.abs(u)/mode.mass_kg;
  if(s.grounded){
    const gx=(height(s.x+1,s.y)-height(s.x-1,s.y))/2,gy=(height(s.x,s.y+1)-height(s.x,s.y-1))/2,incline=1+gx*gx+gy*gy;
    // Gravity along the incline, projected to the horizontal: g tan(theta) / (1 + tan^2(theta)).
    u+=-g*(gx*hx+gy*hy)/incline*dt;w+=-g*(-gx*hy+gy*hx)/incline*dt;
    const drive=mode.power_w>0?Math.min(mode.power_w*push/(mode.mass_kg*Math.max(Math.abs(u),1.5)),k.drive_g*g)
      :push*mode.pole_mps2*Math.max(0,1-Math.abs(u)/mode.pole_fade_mps);
    u+=drive*dt-drag*dt;
    const resist=(k.rolling+brake*k.brake_g)*g*dt;u=Math.sign(u)*Math.max(0,Math.abs(u)-resist);
    w*=Math.exp(-(k.grip_rps+brake*mode.brake_grip_rps)*dt);
    if(input.hop){s.vz=mode.hop_mps;s.grounded=false;s.airtime=0;}
    s.pitch=Math.atan(gx*hx+gy*hy);
  }else u-=drag*dt;
  // Lean-limited turning: the tighter of the pivot rate and g tan(max lean) / speed; half rate in the air.
  const rate=Math.min(mode.pivot_rps,g*Math.tan(mode.max_lean_deg*Math.PI/180)/Math.max(Math.abs(u),.1))*(s.grounded?1:.5)*(mode.power_w>0?Math.min(1,Math.abs(u)):1);
  const omega=steer*rate;s.heading-=omega*dt;
  s.lean+=(Math.atan(u*omega/g)-s.lean)*Math.min(1,dt*8);
  const nx=Math.cos(s.heading),ny=Math.sin(s.heading);
  s.vx=u*nx-w*ny;s.vy=u*ny+w*nx;
  const before=[s.x,s.y,s.z];
  s.x=clamp(s.x+s.vx*dt,-config.world_limit_m,config.world_limit_m);s.y=clamp(s.y+s.vy*dt,-config.world_limit_m,config.world_limit_m);
  const ground=height(s.x,s.y);
  if(s.grounded){
    // Leave the ground where, `liftoff_lookahead_s` of travel ahead, it falls away from the free
    // path by more than legs or suspension absorb. Grid creases are soaked up; lips launch harder with speed.
    // Leave the ground at a lip: it falls away under the free path now, and `liftoff_lookahead_s`
    // ahead by more than legs or suspension absorb. Grid creases are soaked up. Otherwise follow it;
    // vertical speed is the slope's, so a step in the surface is climbed, never turned into launch speed.
    const tau=config.liftoff_lookahead_s,free=s.z+s.vz*dt-.5*g*dt*dt;
    if(ground<free&&height(s.x+s.vx*tau,s.y+s.vy*tau)<free+s.vz*tau-.5*g*tau*tau-config.absorb_m){s.grounded=false;s.airtime=0;s.z=free;s.vz-=g*dt;}
    else{
      // The slope just travelled, so a lip launches from the approach; rising no faster than 2 g,
      // so a crease or step in the surface compresses the rider instead of throwing them.
      const v=Math.hypot(s.vx,s.vy),behind=v>.1?height(s.x-s.vx/v,s.y-s.vy/v):ground;
      s.vz=Math.min((ground-behind)*v,s.vz+2*g*dt);s.z=ground;
    }
  }else{
    s.vz-=g*dt;s.z+=s.vz*dt;s.airtime+=dt;
    if(s.z<=ground){
      const gx=(height(s.x+1,s.y)-height(s.x-1,s.y))/2,gy=(height(s.x,s.y+1)-height(s.x,s.y-1))/2,n=Math.hypot(gx,gy,1);
      const into=(s.vz-gx*s.vx-gy*s.vy)/n;
      if(-into>mode.crash_landing_mps){s.crashed='landing';s.vx=s.vy=s.vz=0;s.z=ground;return s;}
      // Keep the speed along the surface; the normal component is absorbed.
      s.vx+=into*gx/n;s.vy+=into*gy/n;s.vz=gx*s.vx+gy*s.vy;s.z=ground;s.grounded=true;
    }
  }
  const hit=hitTest?.([before[0],before[1],before[2]+mode.body_height_m],[s.x,s.y,s.z+mode.body_height_m],mode.body_radius_m);
  if(hit){s.x=before[0];s.y=before[1];s.z=before[2];s.crashed=hit.kind;s.vx=s.vy=s.vz=0;return s;}
  // Foliage (optional `foliage` in the rules) never crashes a rider: it drags at
  // drag_per_s, and each crown entered knocks him sideways by knock times his speed.
  if(config.foliage&&hitTest?.soft){
    const f=config.foliage,inside=hitTest.soft([s.x,s.y,s.z+mode.body_height_m],mode.body_radius_m),was=s.foliage??[];
    if(inside.length){const d=Math.exp(-f.drag_per_s*dt);s.vx*=d;s.vy*=d;}
    for(const {shape} of inside)if(!was.includes(shape.id)){
      const v=Math.hypot(s.vx,s.vy),[ux,uy]=knockDirection(shape,[s.x,s.y,s.z]);
      s.vx+=ux*f.knock*v;s.vy+=uy*f.knock*v;s.knock=Math.max(s.knock??0,f.knock*v);
    }
    s.foliage=inside.map(({shape})=>shape.id);s.knock=(s.knock??0)*Math.exp(-4*dt);
  }
  const speed=Math.hypot(s.vx,s.vy,s.vz);s.distance+=Math.hypot(s.x-before[0],s.y-before[1]);s.topSpeed=Math.max(s.topSpeed,speed);
  return s;
}

/** Stair mode on the tree village's helical stairs, in world metres (x east, y north, z up).
 *
 * A helix is the village's vertical street, not ground to roam: on its treads he is
 * locked to the flight, and the stick only climbs or descends it. He steps off where
 * a gallery spur meets it (stick outward) and at its foot. Three moves leave the treads
 * (player.json walk.stair):
 *   - a jump tap shorter than tap_s, with the stick across the handrail, vaults it;
 *   - any other jump press is an ordinary jump, and walk.js takes him from there;
 *   - the tuck sits him on the handrail and he slides down it while it is held.
 * The geometry is the village tree recipe's own record (village_stairs.json): treads
 * [y, psi, rho_in, rho_out] in the asset's glTF frame (+Y up, psi from +Z toward +X),
 * the handrail's spans in tread indices, and the treads where gallery spurs meet it.
 */
const apply=(m,[x,y,z])=>[0,1,2].map(r=>m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r]);
const defaults={walk_mps:2.4,run_mps:4.5,accel_mps2:12,tap_s:.18,vault_s:.55,vault_out_m:.75,vault_rise_m:1.35,vault_exit_mps:2.6,
  rail_start_mps:2,rail_mps:9,rail_friction_mps2:1.2,seat_m:.5,mount_s:.15,exit_reach:2,cooldown_s:.35};
const rules=config=>({...defaults,...config.stair});
const smooth=t=>t*t*(3-2*t);

/** One placed stair: the asset's record and the column-major matrix taking its glTF frame
 * to the world (yaw-only and unscaled, as placement turns a tree). */
export function stairRecord({id,data,matrix}){
  const m=matrix,inverse=new Array(16).fill(0);
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)inverse[c*4+r]=m[r*4+c];
  for(let r=0;r<3;r++)inverse[12+r]=-(inverse[r]*m[12]+inverse[4+r]*m[13]+inverse[8+r]*m[14]);
  inverse[15]=1;
  const t=data.treads,reach=Math.max(...t.map(r=>r[3]))+.5,base=apply(m,[0,0,0]);
  return {id,...data,matrix:m,inverse,dpsi:t[0][1]-t[1][1],
    min:[base[0]-reach,base[1]-reach,base[2]+t[0][0]-1],max:[base[0]+reach,base[1]+reach,base[2]+t.at(-1)[0]+2]};
}

/** The tread record at a continuous index u, extrapolated past either end. */
function tread(rec,u){
  const t=rec.treads,i=Math.max(0,Math.min(t.length-2,Math.floor(u))),f=u-i,a=t[i],b=t[i+1];
  return a.map((v,k)=>v+(b[k]-v)*f);
}
/** World point at index u, `rho` from the axis (default mid tread), `lift` above the tread top. */
export function stairPoint(rec,u,rho=null,lift=0){
  const [y,psi,ri,ro]=tread(rec,u),r=rho??(ri+ro)/2;
  return apply(rec.matrix,[r*Math.sin(psi),y+lift,r*Math.cos(psi)]);
}
/** Unit world vectors at u: up the flight (across the ground) and outward from the axis; metres of path per tread. */
function frame(rec,u,rho=null){
  const a=stairPoint(rec,u-.5,rho),b=stairPoint(rec,u+.5,rho),p=stairPoint(rec,u,rho),c=apply(rec.matrix,[0,p[2]-rec.matrix[14],0]);
  const ux=b[0]-a[0],uy=b[1]-a[1],h=Math.hypot(ux,uy),ox=p[0]-c[0],oy=p[1]-c[1],o=Math.hypot(ox,oy);
  return {up:[ux/h,uy/h],out:[ox/o,oy/o],length:Math.hypot(ux,uy,b[2]-a[2])};
}
const railSpan=(rec,u)=>rec.rail.spans.find(([a,b])=>u>=a&&u<=b)??null;

/** The tread index under a body at p, if it stands on this flight's treads, else null. */
export function stairAt(rec,p){
  if(p[0]<rec.min[0]||p[0]>rec.max[0]||p[1]<rec.min[1]||p[1]>rec.max[1]||p[2]<rec.min[2]||p[2]>rec.max[2])return null;
  const [lx,ly,lz]=apply(rec.inverse,p),psi=Math.atan2(lx,lz),rho=Math.hypot(lx,lz),t=rec.treads,period=2*Math.PI/rec.dpsi;
  const base=(t[0][1]-psi)/rec.dpsi,wanted=(ly-t[0][0])/(t[1][0]-t[0][0]);
  const u=base+Math.round((wanted-base)/period)*period;
  if(u<-.5||u>t.length-.5)return null;
  const [y,,ri,ro]=tread(rec,u);
  return rho>=ri-.1&&rho<=ro+.05&&Math.abs(ly-y)<.5?Math.max(0,Math.min(t.length-1,u)):null;
}

/** The flight he is standing on, from the collision index's stairs, or null. */
export function findStair(stairs,s){
  for(const rec of stairs??[]){const u=stairAt(rec,[s.x,s.y,s.z]);if(u!==null)return {rec,u};}
  return null;
}

export function attachStair(s,{rec,u},config){
  const f=frame(rec,u),along=(s.vx??0)*f.up[0]+(s.vy??0)*f.up[1],[x,y,z]=stairPoint(rec,u);
  return {...s,mode:'stair',stair:rec,u,x,y,z,stairPhase:'walk',stairTime:0,stairV:Math.max(-rules(config).run_mps,Math.min(rules(config).run_mps,along)),
    vaultPending:null,grounded:true,jumpPhase:'grounded',jumpTime:0,sliding:false,vz:0};
}

/** Off the stair onto whatever floor is under (x, y): a gallery spur, the foot landing. */
function stepOff(s,[x,y,z],[vx,vy],world,c){
  const floor=world.hitTest?.floor?.(x,y,z+.7,z-1.5),terrain=world.height(x,y),gz=floor??(Number.isFinite(terrain)?Math.max(terrain,z-1.5):z);
  return clear(s,{x,y,z:gz,groundZ:gz,vx,vy,speed:Math.hypot(vx,vy),grounded:true,jumpPhase:'grounded',jumpTime:0,stairCooldown:c.cooldown_s});
}
/** Into the air from the stair: a jump (vz from walk.jump) or the end of a vault. */
function airborne(s,[x,y,z],[vx,vy],vz,style,config,c,extra={}){
  return clear(s,{x,y,z,vx,vy,vz,jumpVz:vz,speed:Math.hypot(vx,vy),grounded:false,jumpPhase:'airborne',jumpStyle:style,jumpTier:1,jumpTime:0,
    jumpCount:(s.jumpCount??0)+1,jumpBuffer:0,stairCooldown:c.cooldown_s,...extra});
}
const clear=(s,fields)=>{const out={...s,...fields,mode:undefined};for(const k of ['stair','u','stairPhase','stairTime','stairV','vaultPending','railV','vaultFrom'])delete out[k];return out;};

export function stepStair(state,input,dt,config,world){
  if(!(dt>0))return {...state};
  const c=rules(config),j=config.jump??{},s={...state},rec=s.stair,n=rec.treads.length;
  const edge=!!input.jump&&!s.jumpHeld;s.jumpHeld=!!input.jump;
  const tuckEdge=!!input.tuck&&!s.tuckHeld;s.tuckHeld=!!input.tuck;
  s.stairTime+=dt;
  const f=frame(rec,s.u),mag=Math.hypot(input.x??0,input.y??0);
  const along=mag?((input.x??0)*f.up[0]+(input.y??0)*f.up[1]):0,out=mag?((input.x??0)*f.out[0]+(input.y??0)*f.out[1])/mag:0;
  const jumpUp=(vel,from)=>airborne(s,from,vel,(j.hop_mps??4.8)+(j.speed_lift??0)*Math.hypot(...vel),Math.hypot(...vel)>.5?'leap':'hop',config,c);

  if(s.stairPhase==='vault'){
    // Hand on the rail, body over it: out past the handrail and down the far side, then falling.
    const t=Math.min(1,s.stairTime/c.vault_s),[,psi,,ro]=tread(rec,s.u),from=s.vaultFrom,rho=from.rho+(ro+c.vault_out_m-from.rho)*smooth(t);
    const z=(1-t)**2*from.z+2*t*(1-t)*(from.z+c.vault_rise_m)+t*t*(from.z+.25);
    const p=apply(rec.matrix,[rho*Math.sin(psi),0,rho*Math.cos(psi)]);
    Object.assign(s,{x:p[0],y:p[1],z,heading:Math.atan2(f.out[1],f.out[0]),speed:c.vault_exit_mps,stairProgress:t});
    if(t<1)return s;
    return airborne(s,[s.x,s.y,s.z],[f.out[0]*c.vault_exit_mps,f.out[1]*c.vault_exit_mps],-1,'leap',config,c);
  }

  if(s.stairPhase==='rail'){
    const span=railSpan(rec,s.u),rail=frame(rec,s.u,tread(rec,s.u)[3]-rec.rail.inset_m);
    if(edge)return jumpUp([-rail.up[0]*s.railV,-rail.up[1]*s.railV],stairPoint(rec,s.u,tread(rec,s.u)[3]-rec.rail.inset_m,rec.rail.height_m-c.seat_m));
    if(!input.tuck||!span||s.u<=span[0]){
      // Off the rail onto the treads, still going down at the pace he had (a walk can't keep more).
      Object.assign(s,{stairPhase:'walk',stairTime:0,stairV:-Math.min(s.railV,c.run_mps),u:span?Math.max(span[0],s.u):s.u});
      delete s.railV;
    }else{
      const g=j.gravity_mps2??9.81,slope=(rec.treads[1][0]-rec.treads[0][0])/rail.length;
      s.railV=Math.min(c.rail_mps,s.railV+(g*slope-c.rail_friction_mps2)*dt);
      s.u=Math.max(span[0],s.u-s.railV*dt/rail.length);
      const seat=Math.min(1,s.stairTime/c.mount_s),[,,,ro]=tread(rec,s.u),on=stairPoint(rec,s.u,ro-rec.rail.inset_m,rec.rail.height_m-c.seat_m),tr=stairPoint(rec,s.u);
      const k=smooth(seat);
      Object.assign(s,{x:tr[0]+(on[0]-tr[0])*k,y:tr[1]+(on[1]-tr[1])*k,z:tr[2]+(on[2]-tr[2])*k,heading:Math.atan2(-rail.up[1],-rail.up[0]),speed:s.railV,stairProgress:(s.stairTime%1)});
      return s;
    }
  }

  // Walking the flight. A press with the stick across a stretch of handrail waits tap_s to learn
  // whether it is a tap (vault) or a held jump; any other press jumps at once.
  const railed=!!railSpan(rec,s.u);
  if(edge){if(out>.5&&railed)s.vaultPending=0;else return jumpUp([f.up[0]*s.stairV,f.up[1]*s.stairV],[s.x,s.y,s.z]);}
  if(s.vaultPending!==null&&s.vaultPending!==undefined){
    s.vaultPending+=dt;
    if(!input.jump&&s.vaultPending<=c.tap_s+1e-9){
      const [,,ri,ro]=tread(rec,s.u);
      return {...s,stairPhase:'vault',stairTime:0,vaultPending:null,vaultFrom:{rho:(ri+ro)/2,z:s.z},jumpCount:(s.jumpCount??0)+1,stairProgress:0};
    }
    if(!input.jump||s.vaultPending>c.tap_s)return jumpUp([f.up[0]*s.stairV,f.up[1]*s.stairV],[s.x,s.y,s.z]);
  }
  if(tuckEdge&&railed&&s.u>railSpan(rec,s.u)[0]+.5){
    return {...s,stairPhase:'rail',stairTime:0,railV:Math.max(c.rail_start_mps,-s.stairV),stairV:0,vaultPending:null};
  }
  const runAmount=Math.max(0,Math.min(1,input.run_amount??(input.run?1:0)));
  const target=along*(c.walk_mps+(c.run_mps-c.walk_mps)*runAmount);
  s.stairV+=Math.max(-c.accel_mps2*dt,Math.min(c.accel_mps2*dt,target-s.stairV));
  s.u+=s.stairV*dt/f.length;
  // Off at the foot (walking down off it), or onto a gallery spur (stick out, where the rail is open).
  const [,,,ro]=tread(rec,Math.max(0,s.u));
  if(s.u<0&&s.stairV<0){
    const land=rec.landing,p=apply(rec.matrix,[land.rho_m*Math.sin(land.psi),land.y_m,land.rho_m*Math.cos(land.psi)]);
    const from=stairPoint(rec,0),dx=p[0]-from[0],dy=p[1]-from[1],d=Math.hypot(dx,dy),v=Math.max(1,Math.abs(s.stairV));
    return stepOff(s,stairPoint(rec,-1.2),[dx/d*v,dy/d*v],world,c);
  }
  const exit=rec.exits.find(e=>Math.abs(e.tread-s.u)<=c.exit_reach);
  if(exit&&out>.6&&!railed){
    const p=stairPoint(rec,exit.tread,ro+.45),v=c.walk_mps*Math.min(1,mag);
    return stepOff(s,p,[f.out[0]*v,f.out[1]*v],world,c);
  }
  if(s.u>n-1){s.u=n-1;s.stairV=Math.min(0,s.stairV);}
  if(s.u<0){s.u=0;s.stairV=Math.max(0,s.stairV);}
  const [x,y,z]=stairPoint(rec,s.u);
  const moving=Math.abs(s.stairV)>.05;
  Object.assign(s,{x,y,z,groundZ:z,speed:Math.abs(s.stairV),vx:f.up[0]*s.stairV,vy:f.up[1]*s.stairV,
    heading:moving?Math.atan2(f.up[1]*Math.sign(s.stairV),f.up[0]*Math.sign(s.stairV)):s.heading,stairProgress:0});
  return s;
}

/** Tread-top height under (x, y) near the flight at index u, for feet: the step he stands on, not the ramp. */
export function stairFloor(rec,u,x,y){
  const [lx,,lz]=apply(rec.inverse,[x,y,0]),psi=Math.atan2(lx,lz),t=rec.treads;
  let best=Math.round(u),gap=Infinity;
  for(let i=Math.max(0,Math.floor(u)-3);i<=Math.min(t.length-1,Math.ceil(u)+3);i++){const d=Math.abs(Math.atan2(Math.sin(psi-t[i][1]),Math.cos(psi-t[i][1])));if(d<gap){gap=d;best=i;}}
  return rec.matrix[14]+t[best][0];
}

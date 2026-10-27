/** Engine-neutral collision in world metres (x east, y north, z up).
 * Solid shapes stop and slide: untyped {min, max} boxes, trunks and meshes
 * (colliders.js). Crowns are soft: they never block, they report how deep a
 * sphere is in them (docs/design/COLLISION.md).
 */
import {trunkRadiusAt} from './climb.js';
import {cellKey} from './colliders.js';

const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const along=(a,d,s)=>[a[0]+d[0]*s,a[1]+d[1]*s,a[2]+d[2]*s];
const apply=(m,[x,y,z])=>[0,1,2].map(r=>m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r]);
const turn=(m,[x,y,z])=>[0,1,2].map(r=>m[r]*x+m[4+r]*y+m[8+r]*z);

/** Closest point on triangle abc to p (Ericson, Real-Time Collision Detection 5.1.5). */
function closestOnTriangle(p,a,b,c){
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);
  if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);
  if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;
  if(vc<=0&&d1>=0&&d3<=0)return along(a,ab,d1/(d1-d3));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);
  if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;
  if(vb<=0&&d2>=0&&d6<=0)return along(a,ac,d2/(d2-d6));
  const va=d3*d6-d5*d4;
  if(va<=0&&d4-d3>=0&&d5-d6>=0)return along(b,sub(c,b),(d4-d3)/((d4-d3)+(d5-d6)));
  const denom=1/(va+vb+vc);
  return along(along(a,ab,vb*denom),ac,vc*denom);
}

/** The nearest surface point of a mesh within `radius` of `point`: world distance and outward normal. */
function meshNearest(shape,point,radius){
  const {asset,inverse,matrix,scale}=shape.mesh,p=apply(inverse,point),r=radius/scale,cell=asset.cell_m,seen=new Set(),tri=asset.triangles;
  let best=Infinity,q=null,face=null;
  const test=t=>{
    if(seen.has(t))return;seen.add(t);
    const v=[0,1,2].map(k=>[tri[t*9+k*3],tri[t*9+k*3+1],tri[t*9+k*3+2]]),near=closestOnTriangle(p,...v),d=Math.hypot(...sub(p,near));
    if(d<best){best=d;q=near;face=v;}
  };
  // An unbounded search (surfaceGap) reads every triangle; a bounded one only the cells it reaches.
  if(!Number.isFinite(r))for(let t=0;t*9<tri.length;t++)test(t);
  else{
    const [a0,b0,c0]=p.map(v=>Math.floor((v-r)/cell)),[a1,b1,c1]=p.map(v=>Math.floor((v+r)/cell));
    for(let a=a0;a<=a1;a++)for(let b=b0;b<=b1;b++)for(let c=c0;c<=c1;c++)for(const t of asset.cells.get(cellKey(a,b,c))??[])test(t);
  }
  if(best>r)return null;
  let n=best>1e-9?sub(p,q).map(v=>v/best):(()=>{const ab=sub(face[1],face[0]),ac=sub(face[2],face[0]);
    const x=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],l=Math.hypot(...x);return x.map(v=>v/l);})();
  n=turn(matrix,n).map(v=>v/scale);
  return {distance:best*scale,normal:n};
}

const inTrunk=(t,z,radius)=>z>=t.base_z-radius&&z<=t.top_z+radius;

/** Distance from `point` to a solid's surface: horizontal to the bark at that height
 * for a trunk, to the nearest face for a box (negative inside), to the nearest
 * triangle for a mesh.
 */
export function surfaceGap(shape,point){
  if(shape.type==='trunk'){const t=shape.trunk,z=Math.min(t.top_z,Math.max(t.base_z,point[2]));return Math.hypot(point[0]-t.x,point[1]-t.y)-trunkRadiusAt(t,z);}
  if(shape.type==='mesh')return meshNearest(shape,point,Infinity)?.distance??Infinity;
  const q=point.map((v,a)=>Math.min(shape.max[a],Math.max(shape.min[a],v))),d=Math.hypot(...sub(point,q));
  return d>0?d:-Math.min(...point.map((v,a)=>Math.min(v-shape.min[a],shape.max[a]-v)));
}

/** A unit horizontal direction for a knock, fixed by the crown and where he met it. */
export function knockDirection(shape,point){
  let h=2166136261;
  for(const ch of `${shape.id}|${point.map(v=>Math.round(v/.5)).join(',')}`){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}
  const angle=(h>>>0)/4294967296*2*Math.PI;
  return [Math.cos(angle),Math.sin(angle)];
}

/** Penetration of a sphere into one solid: {depth, normal} or null. */
function penetration(shape,point,radius){
  if(shape.type==='trunk'){
    const t=shape.trunk;if(!inTrunk(t,point[2],radius))return null;
    const gap=surfaceGap(shape,point);if(gap>=radius)return null;
    const dx=point[0]-t.x,dy=point[1]-t.y,h=Math.hypot(dx,dy);
    return {depth:radius-gap,normal:h>1e-9?[dx/h,dy/h,0]:[1,0,0]};
  }
  if(shape.type==='mesh'){const m=meshNearest(shape,point,radius);return m&&m.distance<radius?{depth:radius-m.distance,normal:m.normal}:null;}
  const q=point.map((v,a)=>Math.min(shape.max[a],Math.max(shape.min[a],v))),d=Math.hypot(...sub(point,q));
  if(d>0)return d<radius?{depth:radius-d,normal:sub(point,q).map(v=>v/d)}:null;
  const faces=point.flatMap((v,a)=>[[v-shape.min[a],a,-1],[shape.max[a]-v,a,1]]).sort((x,y)=>x[0]-y[0]),[inside,axis,sign]=faces[0];
  return {depth:radius+inside,normal:[0,1,2].map(a=>a===axis?sign:0)};
}

/** Entry fraction of a sphere swept from `from` to `to` into an untyped box (slab test), or null. */
function sweptBox(box,from,to,radius){
  let entry=0,exit=1;
  for(let axis=0;axis<3;axis++){
    const delta=to[axis]-from[axis],lo=box.min[axis]-radius,hi=box.max[axis]+radius;
    if(Math.abs(delta)<1e-10){if(from[axis]<lo||from[axis]>hi)return null;}
    else {const a=(lo-from[axis])/delta,b=(hi-from[axis])/delta;entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));}
  }
  return entry<=exit&&exit>=0?entry:null;
}

export function createCollisionIndex(shapes,cellM=64){
  const cells=new Map();
  for(const shape of shapes)for(let y=Math.floor(shape.min[1]/cellM);y<=Math.floor(shape.max[1]/cellM);y++)for(let x=Math.floor(shape.min[0]/cellM);x<=Math.floor(shape.max[0]/cellM);x++){
    const key=`${x},${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(shape);
  }
  const gather=(from,to,radius)=>{
    const candidates=new Set();
    for(let y=Math.floor((Math.min(from[1],to[1])-radius)/cellM);y<=Math.floor((Math.max(from[1],to[1])+radius)/cellM);y++)for(let x=Math.floor((Math.min(from[0],to[0])-radius)/cellM);x<=Math.floor((Math.max(from[0],to[0])+radius)/cellM);x++)for(const b of cells.get(`${x},${y}`)??[])candidates.add(b);
    return candidates;
  };
  const reaches=(shape,from,to,radius)=>[0,1,2].every(a=>Math.max(from[a],to[a])+radius>=shape.min[a]&&Math.min(from[a],to[a])-radius<=shape.max[a]);
  /** The first solid a sphere moving from `from` to `to` touches; crowns never count.
   * Typed shapes are sampled in steps no longer than half the radius.
   */
  const hit=(from,to,radius=.4)=>{
    const d=sub(to,from),n=Math.max(1,Math.ceil(Math.hypot(...d)/(radius/2)));
    let best=null,first=Infinity;
    for(const shape of gather(from,to,radius)){
      if(shape.soft||!reaches(shape,from,to,radius))continue;
      let t=null;
      if(!shape.type)t=sweptBox(shape,from,to,radius);
      else for(let i=0;i<=n&&i/n<first;i++)if(penetration(shape,along(from,d,i/n),radius)){t=i/n;break;}
      if(t!==null&&t<first){first=t;best=shape;}
    }
    return best;
  };
  /** Solids whose surface is within `radius` of `point` (an untyped box: its extent grown by `radius`). */
  hit.near=(point,radius)=>[...gather(point,point,radius)].filter(shape=>!shape.soft&&reaches(shape,point,point,radius)&&(
    shape.type==='trunk'?inTrunk(shape.trunk,point[2],radius)&&surfaceGap(shape,point)<=radius:
    shape.type==='mesh'?meshNearest(shape,point,radius)!==null:true));
  /** Crowns a sphere overlaps, with depth = crown radius + `radius` − horizontal distance. */
  hit.soft=(point,radius)=>{
    const out=[];
    for(const shape of gather(point,point,radius)){
      if(!shape.soft||point[2]<shape.min[2]-radius||point[2]>shape.max[2]+radius)continue;
      const c=shape.crown,depth=trunkRadiusAt(c,point[2])+radius-Math.hypot(point[0]-c.x,point[1]-c.y);
      if(depth>0)out.push({shape,depth});
    }
    return out;
  };
  /** Push a body (spheres at `points`, moving together) out of the trunks and meshes it
   * is inside, along their contact normals (only across the ground with `horizontal`).
   * Returns {offset, normals} once clear; null when it is inside nothing typed, which
   * leaves an untyped box to its caller's older handling; {stuck: true} if three
   * pushes do not clear it.
   */
  hit.pushOut=(points,radius,{horizontal=false}={})=>{
    const offset=[0,0,0],normals=[];
    for(let pass=0;pass<3;pass++){
      let worst=null;
      for(const p of points){const c=hit.contact([p[0]+offset[0],p[1]+offset[1],p[2]+offset[2]],radius);if(c&&(!worst||c.depth>worst.depth))worst=c;}
      if(!worst)return pass?{offset,normals}:null;
      if(!worst.shape.type)return pass?{stuck:true}:null;
      let n=worst.normal,push=worst.depth;
      if(horizontal){const l=Math.hypot(n[0],n[1]);if(l<.3)return pass?{stuck:true}:null;n=[n[0]/l,n[1]/l,0];push=worst.depth/l;}
      for(let i=0;i<3;i++)offset[i]+=n[i]*(push+1e-4);
      normals.push(n);
    }
    return {stuck:true};
  };
  /** The deepest solid penetration of a sphere at `point`, with the outward normal. */
  hit.contact=(point,radius)=>{
    let best=null;
    for(const shape of gather(point,point,radius)){
      if(shape.soft)continue;
      const p=penetration(shape,point,radius);
      if(p&&(!best||p.depth>best.depth))best={shape,...p};
    }
    return best;
  };
  return hit;
}

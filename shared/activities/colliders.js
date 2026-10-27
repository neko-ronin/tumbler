/** Engine-neutral collision shapes in world metres (x east, y north, z up),
 * built from raw glTF-local vertex arrays (x, y up, z). Clients supply the
 * arrays; the shapes and their rules stay in the core (docs/design/COLLISION.md).
 */

/** Radius about the local y axis, banded by height: one [h, r] row per band that
 * holds vertices, h at the band's middle and r the nearest-rank `percentile` of
 * hypot(x, z) in it. Rows ascend.
 */
export function radialProfile(positions,{band_m,from_h=-Infinity,to_h=Infinity,percentile=1}){
  const bands=new Map();
  for(let i=0;i+2<positions.length;i+=3){
    const h=positions[i+1];if(h<from_h||h>=to_h)continue;
    const band=Math.floor(h/band_m);
    if(!bands.has(band))bands.set(band,[]);
    const x=positions[i],z=positions[i+2];
    bands.get(band).push(Math.sqrt(x*x+z*z));
  }
  return [...bands.keys()].sort((a,b)=>a-b).map(band=>{
    const radii=Float64Array.from(bands.get(band)).sort();
    return [(band+.5)*band_m,radii[Math.max(0,Math.ceil(percentile*radii.length)-1)]];
  });
}

const placed=({x,y,base_z,scale},profile)=>profile.map(([h,r])=>[base_z+h*scale,r*scale]);
const widest=profile=>Math.max(...profile.map(([,r])=>r));

/** A solid tapering trunk; `trunk` is the climb record (climb.js). */
export function trunkShape({id,x,y,base_z,scale,profile,top_h}){
  const p=placed({x,y,base_z,scale},profile),r=widest(p),top_z=base_z+top_h*scale;
  return {id,type:'trunk',kind:'tree',min:[x-r,y-r,base_z],max:[x+r,y+r,top_z],trunk:{x,y,base_z,top_z,profile:p}};
}

/** A soft crown: foliage that knocks and slows, never stops. */
export function crownShape({id,x,y,base_z,scale,profile}){
  const p=placed({x,y,base_z,scale},profile),r=widest(p);
  return {id,type:'crown',kind:'tree',soft:true,min:[x-r,y-r,p[0][0]],max:[x+r,y+r,p.at(-1)[0]],crown:{x,y,profile:p}};
}

/** The key of grid cell (a, b, c) in a meshAsset's `cells`. Numeric: an asset
 * holds tens of thousands of triangle-cell pairs, and string keys cost the most.
 */
export const cellKey=(a,b,c)=>((a+1024)*2048+(b+1024))*2048+(c+1024);

/** One asset's triangles (9 local numbers each), binned into cell_m cubes by
 * their bounds so a query reads only the triangles near it. Shared by every
 * instance of the asset.
 */
export function meshAsset(triangles,cell_m=2){
  const cells=new Map(),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],lo=[0,0,0],hi=[0,0,0];
  for(let t=0;t*9<triangles.length;t++){
    for(let a=0;a<3;a++){
      const p=triangles[t*9+a],q=triangles[t*9+3+a],r=triangles[t*9+6+a];
      lo[a]=p<q?(p<r?p:r):(q<r?q:r);hi[a]=p>q?(p>r?p:r):(q>r?q:r);
      if(lo[a]<min[a])min[a]=lo[a];if(hi[a]>max[a])max[a]=hi[a];
    }
    const a0=Math.floor(lo[0]/cell_m),b0=Math.floor(lo[1]/cell_m),c0=Math.floor(lo[2]/cell_m),a1=Math.floor(hi[0]/cell_m),b1=Math.floor(hi[1]/cell_m),c1=Math.floor(hi[2]/cell_m);
    for(let a=a0;a<=a1;a++)for(let b=b0;b<=b1;b++)for(let c=c0;c<=c1;c++){
      const key=cellKey(a,b,c),list=cells.get(key);if(list)list.push(t);else cells.set(key,[t]);
    }
  }
  return {triangles,bounds:{min,max},cell_m,cells};
}

/** A solid instance of a meshAsset. `matrix` (column-major) maps glTF-local to
 * world and must be a rotation, a uniform scale and a translation, so a sphere
 * stays a sphere in local space.
 */
export function meshShape({id,asset,matrix,kind}){
  const m=matrix,col=c=>[m[c*4],m[c*4+1],m[c*4+2]],cols=[0,1,2].map(col);
  const lengths=cols.map(v=>Math.hypot(...v)),scale=lengths[0];
  const dot=(u,v)=>u[0]*v[0]+u[1]*v[1]+u[2]*v[2];
  if(lengths.some(l=>Math.abs(l-scale)>1e-6*scale)||[[0,1],[0,2],[1,2]].some(([i,j])=>Math.abs(dot(cols[i],cols[j]))>1e-6*scale*scale)||m[3]||m[7]||m[11]||m[15]!==1)
    throw new Error(`${id}: a mesh collider needs rotation, uniform scale and translation only`);
  // Inverse of [sR | t]: [R^T/s | -R^T t/s].
  const inverse=new Array(16).fill(0),t=[m[12],m[13],m[14]];
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)inverse[c*4+r]=m[r*4+c]/(scale*scale);
  for(let r=0;r<3;r++)inverse[12+r]=-(inverse[r]*t[0]+inverse[4+r]*t[1]+inverse[8+r]*t[2]);
  inverse[15]=1;
  const {min:lo,max:hi}=asset.bounds,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const x of [lo[0],hi[0]])for(const y of [lo[1],hi[1]])for(const z of [lo[2],hi[2]])
    for(let r=0;r<3;r++){const v=m[r]*x+m[4+r]*y+m[8+r]*z+m[12+r];min[r]=Math.min(min[r],v);max[r]=Math.max(max[r],v);}
  return {id,type:'mesh',kind,min,max,mesh:{asset,matrix,inverse,scale}};
}

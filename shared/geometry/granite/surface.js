/** Core convex bedrock surfaces. Coordinates and planes are world Z-up metres.
 * The vertical interval is intersected against every source halfspace. The
 * result is the exact roof of the closed GLB solid, including oblique joints.
 */
export function solidRoof(solid,x,y){
 const [lo,hi]=solid.bounds_m;
 if(x<lo[0]||x>hi[0]||y<lo[1]||y>hi[1])return null;
 let bottom=-Infinity,top=Infinity;
 for(const [nx,ny,nz,d]of solid.planes){
  const rest=d-nx*x-ny*y;
  if(Math.abs(nz)<1e-10){if(rest<-.00001)return null;}
  else if(nz>0)top=Math.min(top,rest/nz);
  else bottom=Math.max(bottom,rest/nz);
 }
 return top>=bottom-.00001&&Number.isFinite(top)?top:null;
}

export function createGeologySampler(data){
 if(data.version!==1||!Array.isArray(data.solids))throw Error('Unsupported granite geology');
 const cells=new Map(),pitch=128;
 for(const solid of data.solids){
  const [lo,hi]=solid.bounds_m;
  for(let y=Math.floor(lo[1]/pitch);y<=Math.floor(hi[1]/pitch);y++)for(let x=Math.floor(lo[0]/pitch);x<=Math.floor(hi[0]/pitch);x++){
   const key=`${x},${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(solid);
  }
 }
 return (x,y)=>{
  let height=null;
  for(const solid of cells.get(`${Math.floor(x/pitch)},${Math.floor(y/pitch)}`)??[]){
   const z=solidRoof(solid,x,y);if(z!==null)height=height===null?z:Math.max(height,z);
  }
  return height;
 };
}

/** Apply published sparse replacement heights, never infer relief in a client. */
export function applyGeologyTerrain(values,grid,patch){
 if(!patch)return values;
 if(grid.resolution!==patch.resolution||grid.quad_size_m!==patch.quad_size_m||grid.offset_xy_m.some((v,i)=>v!==patch.offset_xy_m[i]))throw Error('Geology terrain grid does not match its source');
 const refined=values.slice();let previous=-1;
 for(const [index,height]of patch.samples){
  if(!Number.isInteger(index)||index<=previous||index>=refined.length||!Number.isFinite(height))throw Error('Invalid geology terrain sample');
  refined[index]=height;previous=index;
 }
 return refined;
}

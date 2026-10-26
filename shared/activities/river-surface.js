/** Read the generated physical surface; engine-neutral metres, x east/y north.
 * The glTF and this triangle sampler share every top vertex and diagonal.
 */
export function createRiverGranite(data){
 if(data.version!==1)throw Error(`Unsupported river granite version ${data.version}`);
 const g=data.grid,{columns:cols,rows,sample_m:pitch,offset_xy_m:[x0,y0]}=g,count=cols*rows;
 if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<2||rows<2||!(pitch>0)||['heights_m','granite','water_surface_m','riparian'].some(k=>g[k]?.length!==count||!g[k].every(Number.isFinite)))throw Error('Invalid river granite grid');
 const contains=(x,y)=>x>=x0&&y>=y0&&x<=x0+(cols-1)*pitch&&y<=y0+(rows-1)*pitch;
 function sample(field,x,y){
  if(!contains(x,y))return null;
  const gx=(x-x0)/pitch,gy=(y-y0)/pitch,c=Math.min(cols-2,Math.floor(gx)),r=Math.min(rows-2,Math.floor(gy)),u=gx-c,v=gy-r,i=r*cols+c,a=g[field][i],b=g[field][i+1],d=g[field][i+cols+1],e=g[field][i+cols];
  return u>=v?a+(b-a)*u+(d-b)*v:a+(e-a)*v+(d-e)*u;
 }
 return {data,contains,height:(x,y)=>sample('heights_m',x,y),granite:(x,y)=>sample('granite',x,y),riparian:(x,y)=>sample('riparian',x,y),surface:(x,y)=>sample('water_surface_m',x,y)};
}

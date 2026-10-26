/** Fixed renderer queries may reuse immutable world heights, never air values.
 * The caller continues to supply current core time and weather on every sample.
 */
export function createFixedAirSampler(sample,height,{maxTerrainSamples=32768}={}){
 if(!Number.isInteger(maxTerrainSamples)||maxTerrainSamples<0)throw Error('Invalid fixed-air terrain capacity');
 const rows=new Map();let count=0;
 function terrain(x,y){
  let row=rows.get(x);
  if(row?.has(y))return row.get(y);
  const value=height(x,y);
  if(count<maxTerrainSamples){
   if(!row){row=new Map();rows.set(x,row);}
   row.set(y,value);count++;
  }
  return value;
 }
 return {sample:(x,y,z)=>sample(x,y,z,terrain),get terrainSamples(){return count;},dispose(){rows.clear();count=0;}};
}

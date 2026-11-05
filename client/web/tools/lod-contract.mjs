/** Test-only checks reusable by each asset's LOD fixture. No renderer/Node API.
 * Structural bounds are not a substitute for rendered or human visual review. */
const requireThat=(condition,message)=>{if(!condition)throw Error(message);};
export function inspectLodGeometry(geometry,{requireVolume=true}={}){
 const p=geometry.attributes.position,count=geometry.index?.count??p?.count;
 requireThat(p?.itemSize===3&&p.count>0,'LOD requires nonempty 3D positions');
 requireThat(count>0&&count%3===0,'LOD requires complete triangles');
 for(const [name,a]of Object.entries(geometry.attributes))for(let i=0;i<a.count;i++)for(let c=0;c<a.itemSize;c++)requireThat(Number.isFinite(a.getComponent(i,c)),`Nonfinite LOD attribute: ${name}`);
 const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity],used=new Set();
 for(let i=0;i<count;i++){
  const id=geometry.index?geometry.index.getX(i):i;requireThat(Number.isInteger(id)&&id>=0&&id<p.count,'LOD index outside vertex buffer');used.add(id);
  for(let a=0;a<3;a++){const v=p.getComponent(id,a);low[a]=Math.min(low[a],v);high[a]=Math.max(high[a],v);}
 }
 const size=high.map((v,a)=>v-low[a]);if(requireVolume)requireThat(size.every(v=>v>1e-7),'Spatial LOD lost an axis of volume');
 const ring=[...used].filter(id=>p.getY(id)<=low[1]+1e-5);
 const anchor=[ring.reduce((n,id)=>n+p.getX(id),0)/ring.length,low[1],ring.reduce((n,id)=>n+p.getZ(id),0)/ring.length];
 return {triangles:count/3,low,high,size,anchor};
}

/** Ground contact is an explicit per-asset policy, never a universal quality score. */
export function checkLodGeometry(lods,{anchorPolicy,anchorToleranceM,requireVolume=true}={}){
 requireThat(lods.length>=2,'A LOD contract needs a reference and reduced level');
 requireThat(Number.isFinite(anchorToleranceM)&&anchorToleranceM>=0,'Declare a finite ground-contact tolerance in meters');
 requireThat(['base-centroid','support-height'].includes(anchorPolicy),'Declare the asset ground-contact policy');
 const reference=inspectLodGeometry(lods[0],{requireVolume});
 return lods.map(g=>{const result=inspectLodGeometry(g,{requireVolume}),anchorErrorM=anchorPolicy==='support-height'?Math.abs(result.low[1]-reference.low[1]):Math.hypot(...result.anchor.map((v,i)=>v-reference.anchor[i]));requireThat(anchorErrorM<=anchorToleranceM,`LOD ground contact shifted ${anchorErrorM.toFixed(6)} m`);return {...result,anchorErrorM};});
}

/** Compare injections for otherwise equivalent base materials. Three.js also
 * keys built-in flags; callers group those flags before invoking this check. */
export function checkShaderCache(materials,makeShader){
 const programs=new Map();
 for(const material of materials){
  const shader=makeShader();material.onBeforeCompile(shader);
  const key=material.type+':'+material.customProgramCacheKey(),source=shader.vertexShader+'\n'+shader.fragmentShader;
  requireThat(!programs.has(key)||programs.get(key)===source,'Shader cache key collision: source varies without a different program key');programs.set(key,source);
 }
 return programs.size;
}

/** Drift guards against recorded source, not an automatic aesthetic judgment. */
export function checkVisualLods(actual,baseline,limits){
 for(const field of ['species','asset','anchorPolicy','sampleSize','rotation','stretch'])requireThat(actual[field]===baseline[field],`Visual profile mismatch: ${field}`);
 const key=c=>[c.yaw,c.elevation,c.pixels].join('/'),expected=new Map(baseline.cases.map(c=>[key(c),c])),seen=new Set();
 requireThat(actual.cases.length===expected.size&&expected.size>0,'Visual case coverage changed');
 for(const c of actual.cases){
  const id=key(c),b=expected.get(id);requireThat(b&&!seen.has(id),'Missing or duplicate visual case');seen.add(id);
  requireThat(c.counts.length===b.counts.length&&c.meanColor.length===b.meanColor.length,'Visual stage coverage changed');
  for(let lod=0;lod<b.counts.length;lod++){
   requireThat(c.counts[lod]>0&&Math.abs(c.counts[lod]-b.counts[lod])<=Math.max(limits.coveragePixels,b.counts[lod]*limits.coverageFraction),`Visual coverage drift: ${actual.species}/${id}/LOD${lod}`);
   for(let a=0;a<3;a++)requireThat(Number.isFinite(c.meanColor[lod][a])&&Math.abs(c.meanColor[lod][a]-b.meanColor[lod][a])<=Math.max(limits.colorBytes,Math.abs(b.meanColor[lod][a])*limits.colorFraction),`Visual color drift: ${actual.species}/${id}/LOD${lod}`);
  }
  for(let i=0;i<b.adjacentMismatch.length;i++)requireThat(Number.isFinite(c.adjacentMismatch[i])&&c.adjacentMismatch[i]<=b.adjacentMismatch[i]+limits.silhouetteIncrease,`Adjacent silhouette degradation: ${actual.species}/${id}`);
  if(actual.anchorPolicy==='trunk-base'&&c.pixels===180&&c.elevation<=40)for(let lod=1;lod<b.rootDriftM.length;lod++)requireThat(Number.isFinite(c.rootDriftM[lod])&&Math.abs(c.rootDriftM[lod]-b.rootDriftM[lod])<=limits.rootMeters,`Rendered root drift: ${actual.species}/${id}`);
 }
 return seen.size;
}

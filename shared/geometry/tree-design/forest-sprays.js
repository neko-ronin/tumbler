/** Species-specific, weathered forest crowns. Pure arrays, seeded geometry.
 * Separate from the preserved connected-redwood study. Each LOD shares branch
 * occupancy and shoot placement; only the leaf carriers change. */
import {SprayMesh} from './redwood-sprays.js';
export const FOREST_PROFILES={
  giant:{heightM:106,crownWidthM:23,crownBase:.45,taper:.34,seed:130,primaryBranches:236,secondaryPairs:6,explicitSprayStride:4,wildness:.92,crownGaps:.28,windSweep:.46,deadwood:.12,leafProfile:'redwood'},
  redwood:{heightM:70,crownWidthM:20,crownBase:.4,taper:.28,seed:211,primaryBranches:210,secondaryPairs:6,explicitSprayStride:4,wildness:.92,crownGaps:.27,windSweep:.36,deadwood:.10,leafProfile:'redwood'},
  pine:{heightM:45,crownWidthM:14.5,crownBase:.25,taper:.16,seed:307,primaryBranches:96,secondaryPairs:8,explicitSprayStride:3,wildness:1,crownGaps:.38,windSweep:.62,deadwood:.18,leafProfile:'pine'},
  fir:{heightM:54,crownWidthM:13.5,crownBase:.12,taper:.49,seed:419,primaryBranches:204,secondaryPairs:5,explicitSprayStride:4,wildness:.78,crownGaps:.20,windSweep:.35,deadwood:.08,leafProfile:'fir'}
};
export const forestSprayCutoff=(species,lod)=>species==='fir'&&Number(lod)>0?.33:.3;
export const FOREST_GEOMETRY_KEYS=['seed','primaryBranches','secondaryPairs','explicitSprayStride','wildness','crownGaps','windSweep','deadwood'];
export function forestRecipe(species,patch={}){return {...FOREST_PROFILES[species==='village'?'giant':species],...Object.fromEntries(FOREST_GEOMETRY_KEYS.filter(k=>patch[k]!==undefined).map(k=>[k,patch[k]]))};}
const TAU=Math.PI*2,add=(a,b)=>a.map((v,i)=>v+b[i]),mul=(a,n)=>a.map(v=>v*n),sub=(a,b)=>a.map((v,i)=>v-b[i]),unit=a=>mul(a,1/(Math.hypot(...a)||1));
const random=(seed,id)=>{const n=Math.sin(seed*17.137+id*127.13)*43758.5453;return n-Math.floor(n);};
export function buildForestSprays(p,lod=0){
  if(![0,1].includes(lod))throw new Error('Forest source LOD must be 0 or 1');
  for(const k of FOREST_GEOMETRY_KEYS)if(!Number.isFinite(p[k]))throw new Error('Invalid forest parameter '+k);
  if(p.primaryBranches<64||p.primaryBranches>400||p.secondaryPairs<2||p.secondaryPairs>9||p.explicitSprayStride<2)throw new Error('Forest recipe exceeds the bounded geometry budget');
  for(const k of ['wildness','crownGaps','windSweep','deadwood'])if(p[k]<0||p[k]>1)throw new Error('Invalid forest parameter '+k);
  const fitBounds={min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]},support=(point,pad=0)=>{for(let a=0;a<3;a++){fitBounds.min[a]=Math.min(fitBounds.min[a],point[a]-pad);fitBounds.max[a]=Math.max(fitBounds.max[a],point[a]+pad);}},supportTube=(path,radius)=>{for(let j=0;j<=12;j++)support(path(j/12),radius);};
  const m=new SprayMesh({repairFacing:true,profile:p.leafProfile,support}),r=id=>random(p.seed,id),sprays=[],branches=[],limbs=Math.round(p.primaryBranches),pairs=Math.round(p.secondaryPairs),wind=r(27)*TAU,phase=r(33)*TAU;
  let dead=0,omitted=0;
  for(let i=0;i<limbs;i++){
    const f=(i+.3+r(i)*.45)/limbs,a=i*137.507764*Math.PI/180+(r(i+1)-.5)*p.wildness*1.8;
    const patch=Math.sin(f*23+phase)+Math.cos(a*2+f*9+phase),missing=p.crownGaps>0&&patch<(-1.65+p.crownGaps*2.7)&&i>5&&i<limbs-4;
    if(missing&&(p.deadwood===0||r(i+63)>.27)){omitted++;continue;}
    const dry=missing||r(i+64)<p.deadwood*(1-f)*.55;if(dry)dead++;
    const radial=[Math.cos(a),0,Math.sin(a)],side=[-Math.sin(a),0,Math.cos(a)];
    const ageLobe=.78+p.wildness*(.26*Math.sin(f*17+a*1.7+phase)+.13*Math.sin(f*39-phase));
    const directional=1+p.windSweep*.28*Math.cos(a-wind),reach=p.crownWidthM*.45*(1-f)**p.taper*ageLobe*directional*(.77+r(i+10)*.44)*(dry?.68:1);
    const base=p.heightM*(p.crownBase+(1-p.crownBase)*f),lift=(r(i+81)-.5)*p.wildness*.52,sideBend=(r(i+99)-.5)*p.wildness*.65;
    const droop=p.leafProfile==='fir'?-.37:p.leafProfile==='pine'?-.12:-.24;
    const branch=t=>add(mul(radial,reach*t),add(mul(side,reach*(Math.sin(t*Math.PI)*sideBend+p.windSweep*.13*Math.sin(wind-a)*t*t)),[0,base+reach*((droop+lift)*t+(.38+r(i+82)*.18)*t*t*t),0]));
    const path=Array.from({length:lod===0?7:5},(_,j)=>branch(j/(lod===0?6:4)));m.tube(path,(p.leafProfile==='pine'?.035+reach*.015:.055+reach*.025)*(1-f*.3),lod===0?7:5);supportTube(branch,(p.leafProfile==='pine'?.035+reach*.015:.055+reach*.025)*(1-f*.3));branches.push({base:[0,base,0],tip:branch(1),dry});
    if(dry)continue;
    for(let j=0;j<pairs;j++)for(const flank of [-1,1]){
      const id=i*137+j*11+(flank+1)*3,t=.16+j/pairs*.77+(r(id+1)-.5)*.035,at=branch(t),len=(.40+reach*(p.leafProfile==='pine'?.42:.27))*(1-t*.38)*(.72+r(id+22)*.5);
      const tangent=unit(sub(branch(Math.min(1,t+.01)),branch(Math.max(0,t-.01)))),direction=unit(add(mul(tangent,.33+t*.43),add(mul(side,flank*(.88-.25*t)),[0,-.08-r(id+32)*(p.leafProfile==='fir'?.37:.22),0])));
      const path=u=>add(at,add(mul(direction,len*u),[0,len*(-.1*Math.sin(u*Math.PI)+.22*u*u*u),0]));
      supportTube(path,.009+len*.01);m.tube(lod===0?[path(0),path(.33),path(.7),path(1)]:[path(0),path(.5),path(1)],.009+len*.01,3);
      const roll=(r(id+45)-.5)*(p.leafProfile==='pine'?4.2:p.leafProfile==='fir'?2.8:3.2),normal=unit(add([0,Math.cos(roll),0],mul(side,Math.sin(roll))));
      sprays.push({at,axis:direction,normal,length:len*1.48,variant:id%8,tone:r(id+93)<.14+f*.15?3:r(id+41)<.35?1:2,ao:.66+.30*t,seed:id});
    }
  }
  const wood=[...m.indices];m.indices=[];
  for(const s of sprays)m.bough(s.at,s.axis,s.normal,s.length,s.variant,s.tone,lod,s.ao,s.seed,p.explicitSprayStride);
  const indices=new Uint32Array([...wood,...m.indices]);
  return {positions:new Float32Array(m.positions),normals:new Float32Array(m.normals),colors:new Float32Array(m.colors),leafUV:new Float32Array(m.uv),canopyAO:new Float32Array(m.ao),leafKind:new Uint8Array(m.kind),leafTone:new Uint8Array(m.tone),indices,branchIndexCount:wood.length,
    fitBounds,structure:{architecture:'feral',leafProfile:p.leafProfile,primaryBranches:branches.length,deadBranches:dead,omittedBranches:omitted,secondaryBoughs:sprays.length,sprays:sprays.length*9,triangles:indices.length/3,lod,branchTips:branches.map(b=>b.tip)}};
}
/** Anchor the new branches on the original bole axis. Independent half-axis
 * scales preserve an asymmetric crown's footprint without translating its
 * roots off the trunk. With no added ideal taper, inverse-scale normals are
 * the exact inverse transpose of this piecewise-affine fit. */
export function fitForestCrown(positions,normals,bounds,axis=[0,0],canonical=null){
  const low=[Infinity,Infinity,Infinity],high=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i+=3)for(let a=0;a<3;a++){low[a]=Math.min(low[a],positions[i+a]);high[a]=Math.max(high[a],positions[i+a]);}
  if(canonical){for(let a=0;a<3;a++){if(!Number.isFinite(canonical.min?.[a])||!Number.isFinite(canonical.max?.[a])||canonical.min[a]>low[a]+1e-4||canonical.max[a]<high[a]-1e-4)throw new Error('Invalid forest fitting envelope');low[a]=canonical.min[a];high[a]=canonical.max[a];}}
  const sy=(bounds.max[1]-bounds.min[1])/(high[1]-low[1]),scales={};for(const a of [0,2]){const centre=axis[a===0?0:1];scales[a]=[(centre-bounds.min[a])/Math.max(.001,-low[a]),(bounds.max[a]-centre)/Math.max(.001,high[a])];}
  const p=new Float32Array(positions.length),n=new Float32Array(normals.length);
  for(let i=0;i<p.length;i+=3){const sx=scales[0][positions[i]<0?0:1],sz=scales[2][positions[i+2]<0?0:1];p[i]=axis[0]+positions[i]*sx;p[i+1]=bounds.min[1]+(positions[i+1]-low[1])*sy;p[i+2]=axis[1]+positions[i+2]*sz;
    const v=[normals[i]/sx,normals[i+1]/sy,normals[i+2]/sz],l=Math.hypot(...v)||1;for(let a=0;a<3;a++)n[i+a]=v[a]/l;}
  return {positions:p,normals:n};
}

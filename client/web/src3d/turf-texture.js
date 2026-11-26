/** Vegetated ground under the grass: a baked turf material (albedo, normal, ambient occlusion,
 * roughness) drawn with the grass's own blade colours. Pixels are generated
 * here, like granite-shading.js: no download, no dependency.
 *
 * LOD: near (to ~25 m) a 0.9 m tile of blades; mid (to ~600 m) a 7.3 m tile of
 * tussocks and soil; beyond, style.js's non-repeating clump and drift noise only.
 * Every tap is stochastically tiled (random offsets on a triangle grid, as
 * forest-field.js does for litter), so no tile period shows from overhead.
 * Each texture stores albedo relative to its own mean (with its AO), so bands,
 * mips and the far noise all average to the same colour.
 */
import {Color,DataArrayTexture,RGBAFormat,RepeatWrapping,LinearFilter,LinearMipmapLinearFilter} from '../vendor/three.module.min.js';

// The grass blades' own gradient (formerly grass-canopy.js). The turf is drawn in it,
// so blades and the ground under them cannot drift apart.
export const GRASS_DARK=new Color('#385a28'),GRASS_LIGHT=new Color('#819e4b');
const vec3=c=>`vec3(${c.toArray().map(v=>v.toFixed(4)).join(',')})`;

export const TURF_NEAR_M=.9,TURF_MID_M=7.3;
/** Footprint is metres per pixel (about distance/750 on a 900 px, 62 degree view).
 * uGroundLayers is declared by GRANITE_GLSL, which the terrain shader includes first. */
export const TURF_SURFACE_GLSL=`
// The meadow green the blade gradient was drawn against; ground under grass is this x turf x uTurfGround.
const vec3 TURF_REFERENCE=${vec3(new Color('#82a94e'))};
struct Turf{vec3 albedo;vec2 slope;float ao;float roughness;};
vec2 turfCellOffset(vec2 c){return fract(sin(vec2(dot(c,vec2(127.1,311.7)),dot(c,vec2(269.5,183.3))))*43758.5453);}
// Three randomly offset copies blended over a triangle grid. Cells must be smaller
// than the tile: a 17 m cell over a 7.3 m tile repeated it as a lattice that read as
// diagonal rows from overhead (round 2, v3). Cubed weights keep blend zones narrow.
// Gradients come from the caller: these taps sit behind per-band branches.
void turfStochastic(vec2 uv,vec2 dx,vec2 dy,vec2 cellPos,float layer,out vec4 shape,out vec4 albedo){
 vec2 skew=mat2(1.,0.,-.57735027,1.15470054)*cellPos,cell=floor(skew),f=fract(skew),a,b,c;vec3 w;
 if(f.x+f.y<1.){a=cell;b=cell+vec2(1.,0.);c=cell+vec2(0.,1.);w=vec3(1.-f.x-f.y,f.x,f.y);}
 else{a=cell+1.;b=cell+vec2(0.,1.);c=cell+vec2(1.,0.);w=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
 w=w*w*w;w/=w.x+w.y+w.z;shape=vec4(0.);albedo=vec4(0.);
 if(w.x>.01){vec2 o=uv+turfCellOffset(a);shape+=textureGrad(uGroundLayers,vec3(o,layer),dx,dy)*w.x;albedo+=textureGrad(uGroundLayers,vec3(o,layer+1.),dx,dy)*w.x;}
 if(w.y>.01){vec2 o=uv+turfCellOffset(b);shape+=textureGrad(uGroundLayers,vec3(o,layer),dx,dy)*w.y;albedo+=textureGrad(uGroundLayers,vec3(o,layer+1.),dx,dy)*w.y;}
 if(w.z>.01){vec2 o=uv+turfCellOffset(c);shape+=textureGrad(uGroundLayers,vec3(o,layer),dx,dy)*w.z;albedo+=textureGrad(uGroundLayers,vec3(o,layer+1.),dx,dy)*w.z;}
 float sum=dot(w,step(.01,w));shape/=sum;albedo/=sum;
}
Turf turfSurface(vec2 ground,float footprint){
 Turf t=Turf(vec3(1.),vec2(0.),1.,.96);
 float near=1.-smoothstep(.012,.035,footprint),mid=1.-smoothstep(.35,.9,footprint);
 vec2 uvMid=mat2(.8,-.6,.6,.8)*ground/${TURF_MID_M.toFixed(2)},uvNear=ground/${TURF_NEAR_M.toFixed(2)};
 vec2 mx=dFdx(uvMid),my=dFdy(uvMid),nx=dFdx(uvNear),ny=dFdy(uvNear);
 vec4 s,a;
 if(mid>0.){
  turfStochastic(uvMid,mx,my,ground/3.1,2.,s,a);
  t.albedo=mix(vec3(1.),a.rgb*4.,mid);t.slope=(s.rg*2.-1.)*mid;t.ao=mix(1.,s.b,mid);t.roughness=mix(t.roughness,a.a,mid);
 }
 if(near>0.){
  turfStochastic(uvNear,nx,ny,ground/.42,0.,s,a);
  t.albedo*=mix(vec3(1.),a.rgb*4.,near);t.slope+=(s.rg*2.-1.)*near;t.ao*=mix(1.,s.b,near);t.roughness=mix(t.roughness,a.a,near);
 }
 return t;
}
`;

/** Deterministic PRNG (mulberry32): the same pixels on every load. */
function prng(seed){return()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/** A tileable turf patch drawn blade by blade into height and colour, in the
 * grass blades' own gradient (base dark, tip light, per-clump tone 0.87 to 1.13
 * like meadowTraits). Lengths and widths are in pixels; `tussock` (0 to 1) makes
 * blades within clumps taller and lighter than the closed sward around them. */
export function bakeTurf({size,blades,length,width,tussock=0,seed=1}){
 const rand=prng(seed),height=new Float32Array(size*size),albedo=new Float32Array(size*size*3),rough=new Float32Array(size*size).fill(1);
 // Between blades lies old thatch over humus: dark olive, not bare brown earth, which read as
 // clover blobs through the grass (round 2, v1).
 const wrap=v=>((v%size)+size)%size,soil=[.054,.065,.029],colour=new Color();
 for(let i=0;i<size*size;i++){const g=.85+rand()*.3;for(let c=0;c<3;c++)albedo[i*3+c]=soil[c]*g;}
 const centres=Array.from({length:Math.max(1,Math.round(tussock*40))},()=>[rand()*size,rand()*size,size*(.05+rand()*.07)]);
 const clumpAt=(x,y)=>{let best=0;for(const [cx,cy,r]of centres){let dx=Math.abs(x-cx),dy=Math.abs(y-cy);dx=Math.min(dx,size-dx);dy=Math.min(dy,size-dy);best=Math.max(best,1-Math.hypot(dx,dy)/r);}return best;};
 for(let b=0;b<blades;b++){
  const x=rand()*size,y=rand()*size;
  // Tussocks stand taller and lighter within a closed sward; islands of blades on
  // bare ground read as blobs (round 2, v3).
  const clump=tussock?clumpAt(x,y):1,angle=rand()*Math.PI*2,len=(length[0]+rand()*(length[1]-length[0]))*(1-tussock*.4*(1-clump)),w=width[0]+rand()*(width[1]-width[0]);
  const top=(.3+rand()*.7)*(1-tussock*.6*(1-clump)),tone=(.87+rand()*.26)*(1-tussock*.25*(1-clump)),dx=Math.cos(angle),dy=Math.sin(angle),steps=Math.ceil(len*2);
  for(let s=0;s<=steps;s++){
   const t=s/steps,px=x+dx*len*t,py=y+dy*len*t,half=Math.max(.5,w*(1-t*.85)*.5),h=top*(.65+.35*t);
   // Seen from above a blade shows more tip than base; the tip is the light end.
   colour.copy(GRASS_DARK).lerp(GRASS_LIGHT,.35+.65*t).multiplyScalar(tone);
   for(let oy=-Math.ceil(half);oy<=Math.ceil(half);oy++)for(let ox=-Math.ceil(half);ox<=Math.ceil(half);ox++){
    const d=Math.hypot(ox,oy)/half;if(d>1)continue;
    const i=wrap(Math.round(py+oy))*size+wrap(Math.round(px+ox)),v=h+.04*(1-d*d);
    if(v<=height[i])continue;
    height[i]=v;albedo[i*3]=colour.r;albedo[i*3+1]=colour.g;albedo[i*3+2]=colour.b;rough[i]=.9;
   }
  }
 }
 return {size,height,albedo,rough};
}

/** Wrapped box blur, separable. */
function blur(src,size,r){
 const tmp=new Float32Array(src.length),out=new Float32Array(src.length),n=2*r+1;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let s=0;for(let k=-r;k<=r;k++)s+=src[y*size+((x+k+size)%size)];tmp[y*size+x]=s/n;}
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){let s=0;for(let k=-r;k<=r;k++)s+=tmp[((y+k+size)%size)*size+x];out[y*size+x]=s/n;}
 return out;
}

/** Shape: RG slope (0.5 flat), B ambient occlusion (floor 0.55). Albedo: RGB at
 * quarter scale relative to the tile's mean albedo x AO (0.25 = the mean), A roughness.
 * The absolute colour is style.js's: TURF_REFERENCE x uTurfGround, calibrated on screen. */
export function turfTextures({size,height,albedo,rough},{slopeScale,aoRadius,aoStrength}){
 const count=size*size,at=(x,y)=>height[((y+size)%size)*size+(x+size)%size],local=blur(height,size,aoRadius);
 const shape=new Uint8Array(count*4),colour=new Uint8Array(count*4),byte=v=>Math.round(Math.max(0,Math.min(1,v))*255);
 const occlusion=i=>1-.45*Math.min(1,Math.max(0,local[i]-height[i])*aoStrength),mean=[0,0,0];
 for(let i=0;i<count;i++)for(let c=0;c<3;c++)mean[c]+=albedo[i*3+c]*occlusion(i)/count;
 for(let y=0,i=0;y<size;y++)for(let x=0;x<size;x++,i++){
  shape[i*4]=byte(.5+(at(x+1,y)-at(x-1,y))*slopeScale);shape[i*4+1]=byte(.5+(at(x,y+1)-at(x,y-1))*slopeScale);
  shape[i*4+2]=byte(occlusion(i));shape[i*4+3]=255;
  for(let c=0;c<3;c++)colour[i*4+c]=byte(albedo[i*3+c]/mean[c]*.25);colour[i*4+3]=byte(rough[i]);
 }
 return {shape,colour};
}

let layers;
/** The ground's one array texture. The terrain shader sits at the 16 sampler-unit
 * limit, so turf shares a unit with granite's creases (passed in by granite-shading.js,
 * which owns them; 512 px RGBA). Layers: 0/1 near shape/albedo, 2/3 mid, 4 creases. */
export function groundLayers(creases){
 if(layers)return layers;
 // Near: 0.9 m over 512 px, about 1.8 mm a pixel, blades 2 to 9 cm. Mid: 7.3 m, 1.4 cm, tussocks 0.4 to 0.9 m in a thinner sward.
 const size=512,near=turfTextures(bakeTurf({size,blades:12000,length:[10,48],width:[1.5,3.5],seed:11}),{slopeScale:7,aoRadius:6,aoStrength:2.2});
 const mid=turfTextures(bakeTurf({size,blades:40000,length:[6,18],width:[1.5,3],tussock:.8,seed:23}),{slopeScale:6,aoRadius:10,aoStrength:2.4});
 const data=new Uint8Array(size*size*20);[near.shape,near.colour,mid.shape,mid.colour,creases].forEach((layer,i)=>data.set(layer,i*size*size*4));
 layers=new DataArrayTexture(data,size,size,5);layers.format=RGBAFormat;layers.wrapS=layers.wrapT=RepeatWrapping;layers.generateMipmaps=true;layers.minFilter=LinearMipmapLinearFilter;layers.magFilter=LinearFilter;layers.anisotropy=8;layers.needsUpdate=true;
 return layers;
}

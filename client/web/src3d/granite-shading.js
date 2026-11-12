/** Browser granite surface: metre-scale joint sets and mip-filtered mineral grain.
 * Texture pixels are generated here; no downloaded texture or new world geometry.
 */
import {DataTexture,RGBAFormat,RepeatWrapping,ClampToEdgeWrapping,LinearFilter,LinearMipmapLinearFilter,SRGBColorSpace,Vector4} from '../vendor/three.module.min.js';
let minerals;
// Neutral until the world's heights arrive: no gully, mid exposure, flat slope.
const neutralMap=new DataTexture(new Uint8Array([0,128,128,128]),1,1,RGBAFormat);neutralMap.needsUpdate=true;
export const mountainUniforms={uMountainMap:{value:neutralMap},uMountainGrid:{value:new Vector4(0,0,0,0)}};
export const mountainMapStats={ms:0,size:0};
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Value noise on a wrapped lattice: deterministic and cheap per sample. */
function latticeNoise(x,y,seed){
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,u=fx*fx*(3-2*fx),v=fy*fy*(3-2*fy),at=(a,b)=>random(a+seed,b-seed*.7);
 const top=at(ix,iy)*(1-u)+at(ix+1,iy)*u,bottom=at(ix,iy+1)*(1-u)+at(ix+1,iy+1)*u;return top*(1-v)+bottom*v;
}
export const MOUNTAIN_SLOPE_RANGE=1.5;
let creases;
/** Tileable ridged creases and pits: RG slope, B height. The band family follows
 * Prima's granite relief map (experiments/virtual-geometry/src/granite-map.js);
 * every frequency is whole cycles per tile, so the tile is exactly periodic.
 */
export function bakeCreaseHeights(size=512){
 const raw=new Float32Array(size*size);
 // Periodic gradient noise: value noise's axis-aligned lattice reads as woven cloth here.
 const gradient=(u,v,cycles,seed)=>{
  const x=u*cycles,y=v*cycles,ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,a=fx*fx*(3-2*fx),b=fy*fy*(3-2*fy);
  const corner=(i,j)=>{const t=random(((i%cycles)+cycles)%cycles+seed,((j%cycles)+cycles)%cycles-seed*.7)*6.2832;return Math.cos(t)*(x-i)+Math.sin(t)*(y-j);};
  return (corner(ix,iy)*(1-a)+corner(ix+1,iy)*a)*(1-b)+(corner(ix,iy+1)*(1-a)+corner(ix+1,iy+1)*a)*b;
 };
 const ridge=(u,v,cycles,seed)=>1-Math.min(1,Math.abs(gradient(u,v,cycles,seed))*2.1);
 for(let r=0;r<size;r++)for(let c=0;c<size;c++){
  const u0=c/size,v0=r/size,u=u0+gradient(u0,v0,4,31)*.025,v=v0+gradient(u0,v0,4,37)*.025;
  const big=ridge(u,v,7,1),mid=ridge(u,v,17,2),fine=ridge(u,v,41,3),pit=Math.max(0,gradient(u,v,89,4));
  // Each finer crease cuts mostly where the coarser one already does.
  raw[r*size+c]=big*big*.5+mid*(.3*big+.08)+fine*(.1*mid+.03)-pit*pit*.12;
 }
 // One wrapped box pass: the finest band otherwise weaves where a texel meets a pixel.
 const heights=new Float32Array(size*size);
 for(let r=0;r<size;r++)for(let c=0;c<size;c++){let sum=0;for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=raw[((r+j+size)%size)*size+(c+i+size)%size];heights[r*size+c]=sum/9;}
 return heights;
}
function creaseRelief(){
 if(creases)return creases;
 const size=512,heights=bakeCreaseHeights(size),data=new Uint8Array(size*size*4),at=(r,c)=>heights[((r+size)%size)*size+(c+size)%size];
 let low=Infinity,high=-Infinity;for(const h of heights){low=Math.min(low,h);high=Math.max(high,h);}
 const span=Math.max(1e-6,high-low);
 for(let r=0,i=0;r<size;r++)for(let c=0;c<size;c++,i+=4){
  data[i]=Math.round(Math.max(0,Math.min(1,(at(r,c+1)-at(r,c-1))/span*6+.5))*255);
  data[i+1]=Math.round(Math.max(0,Math.min(1,(at(r+1,c)-at(r-1,c))/span*6+.5))*255);
  data[i+2]=Math.round((heights[r*size+c]-low)/span*255);data[i+3]=255;
 }
 creases=new DataTexture(data,size,size,RGBAFormat);creases.wrapS=creases.wrapT=RepeatWrapping;
 creases.generateMipmaps=true;creases.minFilter=LinearMipmapLinearFilter;creases.magFilter=LinearFilter;creases.anisotropy=8;creases.needsUpdate=true;
 return creases;
}
export const graniteTextures=()=>({uGraniteMinerals:{value:graniteMinerals()},uGraniteCreases:{value:creaseRelief()}});
/** Derive mountain-scale shading from the real heights, one texel per sample.
 * R gully strength, G exposure (0 valley, 1 ridge), BA the slope (dh/dx, dh/dy)
 * added by erosion that the height grid is too smooth to hold. Drainage runs on
 * the heights plus a little noise, so gullies follow each face's true fall line
 * and cannot detach from the terrain. Presentation only: ground and collision
 * never see it, and mips filter it across every distance and terrain LOD.
 */
export function bakeMountainMap({values,resolution:n,quad}){
 const count=n*n,height=new Float64Array(count),base=values,slopeOf=(i,r,c)=>Math.hypot(base[r*n+Math.min(n-1,c+1)]-base[r*n+Math.max(0,c-1)],base[Math.min(n-1,r+1)*n+c]-base[Math.max(0,r-1)*n+c])/(2*quad);
 for(let r=0,i=0;r<n;r++)for(let c=0;c<n;c++,i++){
  const x=c*quad,y=r*quad,steep=smooth(.12,.5,slopeOf(i,r,c));
  height[i]=base[i]+steep*((latticeNoise(x/140,y/140,3)-.5)*9+(latticeNoise(x/60,y/60,11)-.5)*5+(latticeNoise(x/26,y/26,23)-.5)*2.5);
 }
 // Counting sort by height: O(n) where a comparator over a million cells stalls loading.
 let low=Infinity,high=-Infinity;for(let i=0;i<count;i++){low=Math.min(low,height[i]);high=Math.max(high,height[i]);}
 const buckets=1<<18,scale=(buckets-1)/Math.max(1e-6,high-low),starts=new Uint32Array(buckets+1),order=new Uint32Array(count);
 for(let i=0;i<count;i++)starts[((height[i]-low)*scale|0)+1]++;
 for(let i=0;i<buckets;i++)starts[i+1]+=starts[i];
 for(let i=0;i<count;i++)order[starts[(height[i]-low)*scale|0]++]=i;
 // Multiple-flow routing, highest first: runoff divides among lower neighbours
 // by slope^6, which avoids the eight-direction streaks of single-flow routing
 // while still gathering into channels.
 const flow=new Float32Array(count).fill(1),dr=[-1,-1,-1,0,0,1,1,1],dc=[-1,0,1,-1,1,-1,0,1],share=new Float64Array(8);
 for(let k=count-1;k>=0;k--){
  const i=order[k],r=i/n|0,c=i%n;let total=0;
  for(let d=0;d<8;d++){
   const rr=r+dr[d],cc=c+dc[d];share[d]=0;if(rr<0||cc<0||rr>=n||cc>=n)continue;
   const drop=(height[i]-height[rr*n+cc])/(dr[d]&&dc[d]?Math.SQRT2:1);
   if(drop>0){const w=drop*drop*drop;share[d]=w*w;total+=w*w;}
  }
  if(total>0)for(let d=0;d<8;d++)if(share[d]>0)flow[(r+dr[d])*n+c+dc[d]]+=flow[i]*share[d]/total;
 }
 const carved=new Float64Array(count),gully=new Float32Array(count);
 for(let r=0,i=0;r<n;r++)for(let c=0;c<n;c++,i++){
  const steep=smooth(.16,.55,slopeOf(i,r,c));
  gully[i]=smooth(.9,3.1,Math.log10(flow[i]))*steep;
  // The routing noise steers water only; the surface takes just what the water cuts.
  carved[i]=base[i]-Math.min(24,.9*Math.pow(flow[i],.4))*steep;
 }
 // Summed-area table: a height's standing against its surroundings at three radii.
 const w=n+1,area=new Float64Array(w*w);
 for(let r=0;r<n;r++)for(let c=0;c<n;c++)area[(r+1)*w+c+1]=carved[r*n+c]+area[r*w+c+1]+area[(r+1)*w+c]-area[r*w+c];
 const mean=(r,c,radius)=>{
  const a=Math.max(0,r-radius),b=Math.min(n,r+radius+1),d=Math.max(0,c-radius),e=Math.min(n,c+radius+1);
  return (area[b*w+e]-area[a*w+e]-area[b*w+d]+area[a*w+d])/((b-a)*(e-d));
 };
 const near=Math.max(1,Math.round(24/quad)),mid=Math.max(2,Math.round(96/quad)),far=Math.max(3,Math.round(320/quad));
 const data=new Uint8Array(count*4),clamp01=x=>x<0?0:x>1?1:x,encode=x=>Math.round(clamp01(x)*255);
 for(let r=0,i=0;r<n;r++)for(let c=0;c<n;c++,i++){
  const h=carved[i],exposure=.5+(h-mean(r,c,near))/9*.14+(h-mean(r,c,mid))/30*.3+(h-mean(r,c,far))/120*.3;
  // Only what erosion adds to the source heights: the mesh already owns its own slope.
  const addedAt=(rr,cc)=>{const j=Math.max(0,Math.min(n-1,rr))*n+Math.max(0,Math.min(n-1,cc));return carved[j]-base[j];};
  // Plus the rock's own breaks, as far as a coarse terrain tile's normals would smooth them away:
  // the 8 m slope less the slope over ~130 m, so structure holds its shading at every distance.
  const fine=(rr,cc)=>base[Math.max(0,Math.min(n-1,rr))*n+Math.max(0,Math.min(n-1,cc))];
  const wide=8,relief=.7*smooth(.35,.8,slopeOf(i,r,c));
  const dx=(addedAt(r,c+1)-addedAt(r,c-1))/(2*quad)+relief*((fine(r,c+1)-fine(r,c-1))/(2*quad)-(mean(r,c+wide,wide)-mean(r,c-wide,wide))/(2*wide*quad)),dy=(addedAt(r+1,c)-addedAt(r-1,c))/(2*quad)+relief*((fine(r+1,c)-fine(r-1,c))/(2*quad)-(mean(r+wide,c,wide)-mean(r-wide,c,wide))/(2*wide*quad));
  data[i*4]=encode(gully[i]);data[i*4+1]=encode(exposure);data[i*4+2]=encode(dx/MOUNTAIN_SLOPE_RANGE*.5+.5);data[i*4+3]=encode(dy/MOUNTAIN_SLOPE_RANGE*.5+.5);
 }
 return data;
}
/** Bake the map for this landscape and publish it to every granite material. */
export function setMountainMap(grid){
 const start=performance.now(),n=grid.resolution,data=bakeMountainMap({values:grid.values,resolution:n,quad:grid.quad});
 const texture=new DataTexture(data,n,n,RGBAFormat);texture.wrapS=texture.wrapT=ClampToEdgeWrapping;
 texture.generateMipmaps=true;texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.anisotropy=8;texture.needsUpdate=true;
 mountainUniforms.uMountainMap.value=texture;
 // Texels are centred on samples, so the map starts half a quad before the first.
 mountainUniforms.uMountainGrid.value.set(grid.offsetX-grid.quad/2,grid.offsetY-grid.quad/2,n*grid.quad,0);
 mountainMapStats.ms=performance.now()-start;mountainMapStats.size=n;
 return texture;
}
const fract=x=>x-Math.floor(x);
const random=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453);
export function graniteMinerals(){
 if(minerals)return minerals;
 const size=256,cells=72,data=new Uint8Array(size*size*4),wrap=n=>(n%cells+cells)%cells;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=x/size*cells,py=y/size*cells,cx=Math.floor(px),cy=Math.floor(py);let best=Infinity,kind=0,facet=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
   const a=cx+i,b=cy+j,ax=wrap(a),by=wrap(b),dx=px-a-random(ax,by),dy=py-b-random(ax+19,by+7),d=dx*dx+dy*dy;
   if(d<best){best=d;kind=random(ax+71,by-43);facet=random(ax-23,by+59);}
  }
  // Feldspar and quartz with sparse biotite, rather than uniform grey paint.
  const color=kind<.13?[63,67,65]:kind<.46?[177,168,155]:[193,195,187];
  const grit=.91+random(x,y)*.14+facet*.08,offset=(y*size+x)*4;
  for(let c=0;c<3;c++)data[offset+c]=Math.min(255,Math.round(color[c]*grit));
  data[offset+3]=Math.round(255*(.3+facet*.42-Math.min(1,best)*.13));
 }
 minerals=new DataTexture(data,size,size,RGBAFormat);minerals.wrapS=minerals.wrapT=RepeatWrapping;
 minerals.colorSpace=SRGBColorSpace;minerals.generateMipmaps=true;minerals.minFilter=LinearMipmapLinearFilter;minerals.magFilter=LinearFilter;minerals.anisotropy=4;minerals.needsUpdate=true;
 return minerals;
}
export const GRANITE_GLSL=`
uniform sampler2D uGraniteMinerals;uniform sampler2D uGraniteCreases;uniform sampler2D uMountainMap;uniform vec4 uMountainGrid;
float graniteHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float graniteNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(graniteHash(i),graniteHash(i+vec3(1,0,0)),f.x),mix(graniteHash(i+vec3(0,1,0)),graniteHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(graniteHash(i+vec3(0,0,1)),graniteHash(i+vec3(1,0,1)),f.x),mix(graniteHash(i+vec3(0,1,1)),graniteHash(i+1.),f.x),f.y),f.z);}
float graniteJoint(float p,float width){
 float d=abs(fract(p)-.5),aa=max(fwidth(p),.00001);
 // Conserve line coverage as it becomes subpixel; a growing AA width must
 // not turn distant hairline joints into a dark wire grid.
 return (1.-smoothstep(max(0.,width-aa*.5),width+aa*.5,d))*min(1.,width*2./aa);
}
struct GraniteSurface{vec3 color;float relief;float roughness;float joints;float farRelief;vec3 detail;float ambient;};
// Blend decoded slopes, never heights: differentiating a triplanar height blend
// prints a crosshatch from the blend weights (Prima's relief-map finding).
vec4 graniteCreases(vec3 p,vec3 w,float scale){
 vec2 ax=p.yz*scale,ay=p.xz*scale,az=p.xy*scale;
 vec3 x=textureGrad(uGraniteCreases,ax,dFdx(ax),dFdy(ax)).rgb,y=textureGrad(uGraniteCreases,ay,dFdx(ay),dFdy(ay)).rgb,z=textureGrad(uGraniteCreases,az,dFdx(az),dFdy(az)).rgb;
 vec3 sx=(vec3(0.,x.rg)-vec3(0.,.5,.5))*w.x,sy=(vec3(y.r,0.,y.g)-vec3(.5,0.,.5))*w.y,sz=(vec3(z.rg,0.)-vec3(.5,.5,0.))*w.z;
 return vec4(sx+sy+sz,x.b*w.x+y.b*w.y+z.b*w.z);
}
GraniteSurface graniteSurface(vec3 p,vec3 up,float footprint){
 vec3 w=pow(abs(up),vec3(6.));w/=max(.0001,w.x+w.y+w.z);
 vec4 mineral=textureGrad(uGraniteMinerals,p.yz*.8,dFdx(p.yz)*.8,dFdy(p.yz)*.8)*w.x
  +textureGrad(uGraniteMinerals,p.xz*.8,dFdx(p.xz)*.8,dFdy(p.xz)*.8)*w.y
  +textureGrad(uGraniteMinerals,p.xy*.8,dFdx(p.xy)*.8,dFdy(p.xy)*.8)*w.z;
 // Mountain scale first. Outside the map stays neutral rather than clamping
 // its edge texels into an endless streak.
 vec2 mapUv=(vec2(p.x,-p.z)-uMountainGrid.xy)/max(1.,uMountainGrid.z);
 vec4 macro=textureGrad(uMountainMap,mapUv,dFdx(mapUv),dFdy(mapUv));
 float inMap=step(0.,mapUv.x)*step(0.,mapUv.y)*step(mapUv.x,1.)*step(mapUv.y,1.);
 float gully=macro.r*inMap,exposure=mix(.5,macro.g,inMap);
 float pluton=graniteNoise(p*.0029),body=graniteNoise(p*.013),weather=graniteNoise(p*.16),slab=graniteNoise(p*.048);
 float cliff=smoothstep(.2,.52,1.-abs(up.y));
 // Regional joints: hundreds of metres apart and metres wide, so they stay
 // legible from the air where the fine joint sets below have dissolved.
 // They stay planar: warp a joint by more than a small fraction of its spacing
 // and it becomes a contour line of the noise. Hairline up close, broad afar.
 float warp=body*.1+pluton*.16,seam=mix(.0035,.02,smoothstep(.8,7.,footprint));
 float regional=graniteJoint(dot(p,vec3(.0058,.0011,.0024))+warp,seam)*smoothstep(.45,.62,graniteNoise(p*.0071+3.));
 float regional2=graniteJoint(dot(p,vec3(-.0021,.0016,.0062))+warp*.8,seam*.8)*smoothstep(.48,.66,graniteNoise(p*.0063+11.));
 float fractures=max(regional,regional2*.85)*(.25+.75*cliff)*smoothstep(.8,4.,footprint)*.5;  // the ground holds real clefts now; these only hint at them from far off
 // Intersecting, gently warped joint planes and curved exfoliation sheets.
 // All lengths are metres; pixel derivatives filter lines before they alias.
 float crossJoint=graniteJoint(dot(p,vec3(.017,.004,.006))+slab*.53,.0018);
 float upright=graniteJoint(dot(p,vec3(-.006,.003,.014))+body*.85,.0014);
 float sheet=graniteJoint(p.y*.022+slab*1.6+body*2.1,.0024);
 crossJoint*=smoothstep(.40,.64,weather);
 upright*=smoothstep(.46,.68,slab);
 sheet*=smoothstep(.25,.6,body);
 float resolved=1.-smoothstep(.65,3.5,footprint);
 float joints=max(crossJoint*.82,upright*.68)*resolved;
 float sheets=sheet*resolved;
 // Sierra granite is grey-to-pale overall; darkness belongs to wet tracks and the
 // lichen veneer of little-sunned north faces. Occlusion lives in g.ambient, so
 // hollows are only slightly darker here or the shadow counts twice.
 vec3 pale=vec3(.49,.475,.44),warm=vec3(.42,.365,.30),dark=vec3(.19,.17,.15);
 vec3 stone=mix(pale,warm,smoothstep(.36,.68,pluton)*.72);
 float bench=graniteNoise(vec3(p.x*.0026,p.y*.031+pluton*1.8,p.z*.0026));
 float northFace=smoothstep(.1,.7,-up.z)*cliff*smoothstep(.35,.7,body);
 float darkness=cliff*.1+northFace*.2+(1.-smoothstep(.2,.56,exposure))*.14+gully*.3+(bench-.5)*.06;
 stone=mix(stone,dark,clamp(darkness,0.,.55));
 stone*=1.+smoothstep(.56,.86,exposure)*.28;
 stone*=.93+slab*.14+(weather-.5)*.11;
 // Mips integrate the salt/pepper grain into the same average at flight scale.
 stone*=mix(vec3(1.),mineral.rgb/vec3(.405,.400,.369),.57);
 stone*=1.-joints*.26-sheets*.15-fractures*.3;
 // Seep stripes follow the baked drainage, the only pattern that truly runs down
 // the fall line; height-stretched noise breaks into spots on anything but a
 // vertical wall. Near-black is allowed here (lichen and cyanobacteria on wet tracks).
 float seep=graniteNoise(vec3(p.x*.018,p.y*.0025,p.z*.018)+5.);
 float stain=smoothstep(.05,.5,gully)*smoothstep(.3,.6,1.-abs(up.y))*smoothstep(.25,.6,seep);
 stone*=1.-stain*.44;
 // Rock-scale creases fill the 1-30 m gap between the map's 8 m texels and the
 // mineral grain. They resolve only up close, and the mips average them away first.
 vec3 nearRelief=vec3(0.);
 float nearFade=1.-smoothstep(1.,7.,footprint);
 if(nearFade>.001){
  // Scales with no common multiple, and patchy strength, so neither tile repeats visibly.
  // Slab tops stay quiet; broken rock gathers on steeper, weathered ground.
  float patchy=smoothstep(.34,.72,slab+weather*.25+cliff*.2)*.75+.12,tightFade=1.-smoothstep(.25,1.6,footprint);
  vec4 broad=graniteCreases(p,w,1./61.),tight=graniteCreases(p.zxy+vec3(11.,3.,7.),w.zxy,1./13.7);
  nearRelief=(broad.xyz*.45*nearFade+tight.xyz.yzx*.24*tightFade)*patchy;
  stone*=1.-smoothstep(.3,.04,broad.w)*.16*nearFade*patchy;
 }
 GraniteSurface g;g.color=stone;
 g.relief=(slab-.5)*.72+(weather-.5)*.085-joints*.018-sheets*.014+(mineral.a-.5)*.009;
 g.farRelief=-fractures*1.2;
 vec2 macroSlope=(macro.ba-vec2(128./255.))*2.*${MOUNTAIN_SLOPE_RANGE.toFixed(2)}*inMap;
 g.detail=vec3(-macroSlope.x,0.,macroSlope.y)-nearRelief;
 g.ambient=mix(.62,1.,smoothstep(.16,.62,exposure))*(1.-gully*.24)*(1.-fractures*.3);
 g.roughness=clamp(.87+weather*.11-mineral.a*.07,.78,.98);g.joints=max(joints,sheets);return g;
}
`;

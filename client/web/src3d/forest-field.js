/** Cached browser light/soil footprint of the core's existing tree crowns.
 * This is presentation data: no new tree, clearing or placement decision.
 */
import * as T from '../vendor/three.module.min.js';
import {decodeGroundCover} from './heights.js';
export const forestField={map:{value:null},grid:{value:new T.Vector4(-2048,-2048,4096,1024)},ready:{value:0},cover:{value:null},litter:{value:null},coverGrid:{value:new T.Vector4()}};
export const FOREST_FIELD_GLSL=`
uniform sampler2D uForestField,uForestCover,uForestLitter;uniform vec4 uForestGrid,uForestCoverGrid;uniform float uForestReady;
vec4 forestAt(vec3 p){
 if(uForestReady<.5)return vec4(0.);
 vec2 uv=(vec2(p.x,-p.z)-uForestGrid.xy)/uForestGrid.z;
 float inside=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
 return texture2D(uForestField,clamp(uv,0.,1.))*inside;
}
float forestCoverAt(vec3 p){
 if(uForestReady<.5)return 0.;
 vec2 uv=(vec2(p.x,-p.z)-uForestCoverGrid.xy)/(uForestCoverGrid.z*uForestCoverGrid.w);
 return texture2D(uForestCover,clamp(uv,0.,1.)).r*step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
}
vec3 forestLitter(vec2 world){
 vec2 uv=world/1.5,dx=dFdx(uv),dy=dFdy(uv);
 vec2 skew=mat2(1.,0.,-.57735027,1.15470054)*(world*.18),cell=floor(skew),f=fract(skew);
 vec2 a,b,c;vec3 weight;
 if(f.x+f.y<1.){a=cell;b=cell+vec2(1.,0.);c=cell+vec2(0.,1.);weight=vec3(1.-f.x-f.y,f.x,f.y);}
 else{a=cell+1.;b=cell+vec2(0.,1.);c=cell+vec2(1.,0.);weight=vec3(f.x+f.y-1.,1.-f.x,1.-f.y);}
 vec2 oa=fract(sin(vec2(dot(a,vec2(127.1,311.7)),dot(a,vec2(269.5,183.3))))*43758.5453);
 vec2 ob=fract(sin(vec2(dot(b,vec2(127.1,311.7)),dot(b,vec2(269.5,183.3))))*43758.5453);
 vec2 oc=fract(sin(vec2(dot(c,vec2(127.1,311.7)),dot(c,vec2(269.5,183.3))))*43758.5453);
 // Explicit gradients keep random tile offsets out of mip selection.
 return textureGrad(uForestLitter,uv+oa,dx,dy).rgb*weight.x+textureGrad(uForestLitter,uv+ob,dx,dy).rgb*weight.y+textureGrad(uForestLitter,uv+oc,dx,dy).rgb*weight.z;
}
float forestCanopyLight(vec3 p){
 vec4 f=forestAt(p);float top=f.g*1500.,floorHeight=f.a*1500.;
 return 1.-f.r*.68*(1.-smoothstep(floorHeight+max(4.,(top-floorHeight)*.45),top,p.y));
}
`;
export function forestUniforms(){return {uForestField:forestField.map,uForestGrid:forestField.grid,uForestReady:forestField.ready,uForestCover:forestField.cover,uForestLitter:forestField.litter,uForestCoverGrid:forestField.coverGrid};}

export function buildForestField(placement,assets,habitat,{stamp=null,resolution=1024,span=4096}={}){
 const cover=stamp?decodeGroundCover(stamp):null;
 const coverTexture=cover?new T.DataTexture(Uint8Array.from(cover.covered,v=>v*255),cover.resolution,cover.resolution,T.RedFormat):new T.DataTexture(new Uint8Array([0]),1,1,T.RedFormat);
 coverTexture.minFilter=coverTexture.magFilter=T.LinearFilter;coverTexture.needsUpdate=true;forestField.cover.value=coverTexture;
 if(cover)forestField.coverGrid.value.set(cover.offsetX,cover.offsetY,cover.quad,cover.resolution);
 const data=new Uint8Array(resolution*resolution*4),pitch=span/resolution,offset=-span/2,bounds=new Map();let trees=0;
 for(const tree of placement.instances){
  if(!tree.tags?.includes(habitat.placement_tag))continue;
  if(!bounds.has(tree.asset)){
   const box=new T.Box3();for(const p of assets[tree.asset]?.primitives??[])if(/foliage/.test(p.materialName))box.union(p.geometry.boundingBox.clone().applyMatrix4(p.local));
   bounds.set(tree.asset,box);
  }
  const box=bounds.get(tree.asset);if(box.isEmpty())continue;
  const [x,y,z]=tree.position_m,[sx,sy,sz]=tree.scale??[1,1,1];
  const radius=Math.max(box.max.x-box.min.x,box.max.z-box.min.z)*.5*Math.max(sx,sy),top=z+box.max.y*sz;
  const minX=Math.max(0,Math.floor((x-radius-offset)/pitch)),maxX=Math.min(resolution-1,Math.ceil((x+radius-offset)/pitch));
  const minY=Math.max(0,Math.floor((y-radius-offset)/pitch)),maxY=Math.min(resolution-1,Math.ceil((y+radius-offset)/pitch));trees++;
  for(let row=minY;row<=maxY;row++)for(let col=minX;col<=maxX;col++){
   const d=Math.hypot(offset+(col+.5)*pitch-x,offset+(row+.5)*pitch-y)/Math.max(1,radius);
   if(d>=1)continue;const id=(row*resolution+col)*4,cover=1-T.MathUtils.smoothstep(d,.55,1);
   data[id]=Math.round(255*(1-(1-data[id]/255)*(1-cover*.82)));
   data[id+1]=Math.max(data[id+1],Math.round(Math.min(1,top/1500)*255));
   data[id+2]=Math.max(data[id+2],Math.round(Math.exp(-d*d*12)*255));
   data[id+3]=Math.max(data[id+3],Math.round(Math.min(1,z/1500)*255));
  }
 }
 const texture=new T.DataTexture(data,resolution,resolution);texture.minFilter=texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
 forestField.map.value=texture;forestField.grid.value.set(offset,offset,span,resolution);forestField.ready.value=1;
 function sample(x,y){
  const cx=(x-offset)/pitch-.5,cy=(y-offset)/pitch-.5;if(cx<0||cy<0||cx>=resolution-1||cy>=resolution-1)return 0;
  const ix=Math.floor(cx),iy=Math.floor(cy),fx=cx-ix,fy=cy-iy,at=(a,b)=>data[(b*resolution+a)*4]/255;
  return T.MathUtils.lerp(T.MathUtils.lerp(at(ix,iy),at(ix+1,iy),fx),T.MathUtils.lerp(at(ix,iy+1),at(ix+1,iy+1),fx),fy);
 }
 const sampleCover=(x,y)=>{
  if(!cover)return sample(x,y);
  const col=Math.floor((x-cover.offsetX)/cover.quad+.5),row=Math.floor((y-cover.offsetY)/cover.quad+.5);
  return col>=0&&row>=0&&col<cover.resolution&&row<cover.resolution?cover.covered[row*cover.resolution+col]:0;
 };
 return {texture,sample,sampleCover,stats:{trees,textureBytes:data.byteLength},dispose(){texture.dispose();coverTexture.dispose();forestField.ready.value=0;}};
}

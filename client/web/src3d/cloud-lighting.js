/** Low-frequency sunlight through each shared cell, cached in a portable RGBA8 atlas.
 * View density/edges stay full detail; only the five sun samples are amortized.
 */
import * as T from '../vendor/three.module.min.js';
import {CLOUD_DENSITY_GLSL} from './cloud-field.js';
import {cloudCellBounds} from './cloud-shadow-field.js';
export const LIGHT_VOXELS=32,LIGHT_TILE=34,LIGHT_COLUMNS=8;
export function cloudLightUv(q,layer,origin,atlas){
 const x=Math.max(0,Math.min(31,q[0]*32-.5)),z=Math.max(0,Math.min(31,q[2]*32-.5));
 return [(origin[0]+(layer%8)*34+x+1.5)/atlas[0],(origin[1]+Math.floor(layer/8)*34+z+1.5)/atlas[1]];
}
export const CLOUD_LIGHT_GLSL=`
uniform sampler2D uCloudLight;uniform vec2 uCloudLightOrigin,uCloudLightSize;
vec2 cloudLightUv(vec3 p,float layer){
 vec2 tile=vec2(mod(layer,8.),floor(layer/8.))*34.;
 return (uCloudLightOrigin+tile+clamp(p.xz*32.-.5,vec2(0.),vec2(31.))+1.5)/uCloudLightSize;
}
vec2 cachedCloudLight(vec3 world){
 vec3 p=clamp((world-uCentre)/uExtent+.5,0.,1.);
 float layer=clamp(p.y*32.-.5,0.,31.),lo=floor(layer),hi=min(31.,lo+1.);
 return mix(texture(uCloudLight,cloudLightUv(p,lo)).rg,texture(uCloudLight,cloudLightUv(p,hi)).rg,fract(layer));
}
`;
export function createCloudLighting(renderer,atmosphere,noise,style){
 const blockW=LIGHT_TILE*8,blockH=LIGHT_TILE*4,columns=4;
 const width=blockW*columns,height=blockH*Math.ceil(atmosphere.cloud_cells.length/columns);
 const target=new T.WebGLRenderTarget(width,height,{depthBuffer:false});target.texture.minFilter=target.texture.magFilter=T.LinearFilter;
 const scene=new T.Scene(),camera=new T.Camera(),geometry=new T.PlaneGeometry(2,2),size=new T.Vector2(width,height),origins=[];
 for(const [index,cell]of atmosphere.cloud_cells.entries()){
  const bounds=cloudCellBounds(cell,atmosphere),origin=new T.Vector2(index%columns*blockW,Math.floor(index/columns)*blockH);origins.push(origin);
  const material=new T.ShaderMaterial({glslVersion:T.GLSL3,depthTest:false,depthWrite:false,
   uniforms:{uOrigin:{value:origin},uCentre:{value:new T.Vector3(...bounds.centre)},uExtent:{value:new T.Vector3(...bounds.extent)},uSun:style.sun,uWind:style.cloudWind,uTime:style.time,uSeed:{value:cell.seed},uNoise:{value:noise}},
   vertexShader:'void main(){gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:`precision highp sampler3D;out vec4 fragColor;uniform vec2 uOrigin,uWind;uniform vec3 uCentre,uExtent,uSun;uniform float uTime,uSeed;uniform sampler3D uNoise;
    ${CLOUD_DENSITY_GLSL}
    void main(){
     vec2 pixel=gl_FragCoord.xy-uOrigin,tile=floor(pixel/34.);
     vec2 xz=clamp((mod(pixel,34.)-1.)/32.,0.,1.);float layer=tile.x+tile.y*8.;
     vec3 p=uCentre+(vec3(xz.x,(layer+.5)/32.,xz.y)-.5)*uExtent;
     float depth=cloudSunDepth(p);fragColor=vec4(exp(-depth*.028),exp(-depth*.006),0.,1.);
    }`});
  const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;scene.add(mesh);
 }
 let last=-Infinity;const sun=new T.Vector3(),wind=new T.Vector2(),color=new T.Color(),stats={updates:0,bytes:width*height*4};
 function update(force=false){
  if(!force&&style.time.value>=last&&style.time.value-last<.5&&sun.distanceToSquared(style.sun.value)<1e-8&&wind.distanceToSquared(style.cloudWind.value)<1e-8)return;
  last=style.time.value;sun.copy(style.sun.value);wind.copy(style.cloudWind.value);
  const saved=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();renderer.getClearColor(color);
  renderer.setRenderTarget(target);renderer.setClearColor(0xffffff,1);renderer.clear();renderer.setScissorTest(true);
  for(const [i,mesh]of scene.children.entries()){
   const origin=origins[i];renderer.setScissor(origin.x,origin.y,blockW,blockH);scene.children.forEach(other=>other.visible=other===mesh);renderer.render(scene,camera);
  }
  scene.children.forEach(m=>m.visible=true);renderer.setScissorTest(false);renderer.setClearColor(color,alpha);renderer.setRenderTarget(saved);stats.updates++;
 }
 return {target,size,origins,scene,stats,update,dispose(){target.dispose();geometry.dispose();scene.children.forEach(m=>m.material.dispose());}};
}

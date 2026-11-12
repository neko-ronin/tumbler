/** Tree receivers reuse the scene sun map already drawn for terrain/village.
 * No second scenery pass. Bind after sun creation; sync after the renderer's
 * shadow pass in material.onBeforeRender, including the first warm-up frame.
 */
import * as T from '../vendor/three.module.min.js';
import {SUN_PCF_GLSL} from './sun-pcf.js';
// Local detail hands off abruptly to a static coarse world map. Both maps
// measure sun visibility at full strength.
export const SCENERY_SHADOW_SPAN=640;
export const SCENERY_SHADOW_RESOLUTION=2560;
export const SHADOW_COVERAGE_SPAN=520;
{
  const chunk=T.ShaderChunk.shadowmap_pars_fragment,start=chunk.indexOf('float getShadow('),mark='return mix( 1.0, shadow, shadowIntensity );',end=chunk.indexOf(mark,start);
  if(start<0||end<0)throw new Error('three.js shadow chunk changed; update the shadow edge fade');
  T.ShaderChunk.shadowmap_pars_fragment=chunk.slice(0,end)+`
#ifdef TUMBLER_TREE_SHADOW
 if(sceneryShadowCoverage(shadowCoord.xy)<.5&&uTreeFarReady>.5){
  vec4 farCoord=uTreeFarFromNear*vec4(shadowCoord.xyz,1.);
  shadow=distantTreeSunLight(farCoord.xyz/farCoord.w);
 }

#endif
 `+chunk.slice(end);
}
export const treeShadow={map:{value:null},matrix:{value:new T.Matrix4()},texel:{value:new T.Vector2(1/2048,1/2048)},bias:{value:0},normalBias:{value:0},ready:{value:0},focus:{value:new T.Vector4()},coverageScale:{value:1}};
const distantShadow={map:{value:null},matrix:{value:new T.Matrix4()},fromNear:{value:new T.Matrix4()},ready:{value:0}};
let light=null;
export function bindTreeSunShadow(sun){light=sun;treeShadow.focus.value.w=0;updateTreeSunShadow();}
export function setTreeShadowFocus(point){treeShadow.focus.value.set(point.x,point.y,point.z,1);}

export function updateTreeSunShadow(){
 const shadow=light?.shadow;
 if(!shadow?.map){treeShadow.ready.value=0;return;}
 treeShadow.map.value=shadow.map.depthTexture;treeShadow.matrix.value=shadow.matrix;
 treeShadow.texel.value.set(1/shadow.map.width,1/shadow.map.height);
 treeShadow.bias.value=shadow.bias;treeShadow.normalBias.value=shadow.normalBias;treeShadow.ready.value=1;
 treeShadow.coverageScale.value=(shadow.camera.right-shadow.camera.left)/SHADOW_COVERAGE_SPAN;
 distantShadow.fromNear.value.copy(shadow.matrix).invert().premultiply(distantShadow.matrix.value);
}
export function treeShadowUniforms(){return {uTreeFarMap:distantShadow.map,uTreeFarFromNear:distantShadow.fromNear,uTreeFarMatrix:distantShadow.matrix,uTreeFarReady:distantShadow.ready,uTreeShadowFocus:treeShadow.focus,uTreeShadowCoverageScale:treeShadow.coverageScale,uTreeSunMap:treeShadow.map,uTreeSunMatrix:treeShadow.matrix,uTreeSunTexel:treeShadow.texel,uTreeSunBias:treeShadow.bias,uTreeSunNormalBias:treeShadow.normalBias,uTreeSunReady:treeShadow.ready};}
export const TREE_SHADOW_GLSL=`
${SUN_PCF_GLSL}
#define TUMBLER_TREE_SHADOW
uniform vec4 uTreeShadowFocus;uniform float uTreeShadowCoverageScale;
uniform highp sampler2DShadow uTreeFarMap;uniform mat4 uTreeFarFromNear,uTreeFarMatrix;uniform float uTreeFarReady;
float distantTreeSunLight(vec3 uv){
 if(min(uv.x,uv.y)<=0.||max(uv.x,uv.y)>=1.||uv.z<=0.||uv.z>=1.)return 1.;
 return texture(uTreeFarMap,vec3(uv.xy,uv.z-.000002));
}
uniform highp sampler2DShadow uTreeSunMap;uniform mat4 uTreeSunMatrix;uniform vec2 uTreeSunTexel;uniform float uTreeSunBias,uTreeSunNormalBias,uTreeSunReady;
float sceneryShadowCoverage(vec2 uv){
 if(uTreeShadowFocus.w>.5){
  vec4 focus=uTreeSunMatrix*vec4(uTreeShadowFocus.xyz,1.);
  uv=(uv-focus.xy/focus.w)*uTreeShadowCoverageScale+.5;
 }
 vec2 rim=min(uv,1.-uv);
 return step(0.,min(rim.x,rim.y));
}
float scenerySunLight(vec3 world,vec3 N){
 if(uTreeSunReady<.5)return 1.;
 vec4 q=uTreeSunMatrix*vec4(world+N*uTreeSunNormalBias,1.);vec3 uv=q.xyz/q.w;
 if(sceneryShadowCoverage(uv.xy)<.5&&uTreeFarReady>.5){
  vec4 farCoord=uTreeFarMatrix*vec4(world+N*uTreeSunNormalBias,1.);
  return distantTreeSunLight(farCoord.xyz/farCoord.w);
 }
 if(min(uv.x,uv.y)<=.001||max(uv.x,uv.y)>=.999||uv.z<=0.||uv.z>=1.)return 1.;
 return filteredSunDepth(uTreeSunMap,uv,uTreeSunTexel,uTreeSunBias);
}
`;

/** Static world coverage supplies full-strength coarse edges beyond local detail. */
export function createDistantTreeShadows(renderer,group,bounds){
 const scene=new T.Scene(),sun=new T.DirectionalLight(0xffffff,0);
 sun.castShadow=true;sun.shadow.mapSize.set(4096,4096);sun.shadow.autoUpdate=false;
 sun.shadow.normalBias=.7;sun.shadow.bias=-.000002;
 scene.add(group,sun,sun.target);
 const camera=new T.PerspectiveCamera(50,1,.1,1);
 camera.position.set(1e7,0,0);camera.lookAt(1e7+1,0,0);
 const sink=new T.WebGLRenderTarget(1,1),centre=bounds.getCenter(new T.Vector3()),direction=new T.Vector3();
 const stats={resolution:4096,updates:0,texelM:0,textureBytes:4096*4096*8};
 let valid=false;
 function update(sunDirection,force=false){
  if(valid&&!force&&direction.distanceToSquared(sunDirection)<1e-10)return;
  direction.copy(sunDirection);
  const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize();
  const up=new T.Vector3().crossVectors(direction,right).normalize(),corner=new T.Vector3();
  let extent=0;
  for(let i=0;i<8;i++){
   corner.set(i&1?bounds.max.x:bounds.min.x,i&2?bounds.max.y:bounds.min.y,i&4?bounds.max.z:bounds.min.z).sub(centre);
   extent=Math.max(extent,Math.abs(corner.dot(right)),Math.abs(corner.dot(up)));
  }
  extent=Math.ceil((extent+32)/32)*32;
  Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:1,far:60000});
  sun.shadow.camera.updateProjectionMatrix();
  sun.target.position.copy(centre);sun.position.copy(centre).addScaledVector(direction,30000);
  sun.target.updateMatrixWorld(true);sun.updateMatrixWorld(true);
  const pending=renderer.shadowMap.needsUpdate,target=renderer.getRenderTarget();
  try{
   sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;
   renderer.setRenderTarget(sink);renderer.render(scene,camera);
   distantShadow.map.value=sun.shadow.map.depthTexture;
   distantShadow.matrix.value.copy(sun.shadow.matrix);distantShadow.ready.value=1;
   stats.texelM=extent*2/4096;stats.updates++;valid=true;
   updateTreeSunShadow();
  }finally{renderer.setRenderTarget(target);renderer.shadowMap.needsUpdate=pending;}
 }
 return {stats,update,dispose(){distantShadow.ready.value=0;sun.shadow.dispose();sink.dispose();}};
}

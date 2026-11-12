/** A small per-frame sun map for moving actors, independent of scenery caches. */
import * as T from '../vendor/three.module.min.js';
import {SUN_PCF_GLSL} from './sun-pcf.js';
export const ACTOR_SHADOW_GLSL=`
${SUN_PCF_GLSL}
uniform highp sampler2DShadow uActorShadow;uniform mat4 uActorShadowMatrix;uniform vec2 uActorShadowTexel;uniform float uActorShadowReady;
float actorSunLight(vec3 world){
 if(uActorShadowReady<.5)return 1.;
 vec4 q=uActorShadowMatrix*vec4(world,1.);vec3 uv=q.xyz/q.w;
 if(min(uv.x,uv.y)<=.002||max(uv.x,uv.y)>=.998||uv.z<=0.||uv.z>=1.)return 1.;
 return filteredSunDepth(uActorShadow,uv,uActorShadowTexel,-.000006);
}
`;
export function snappedShadowAnchor(point,direction,span=64,resolution=1024){
 const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize();
 if(right.lengthSq()<.5)right.set(1,0,0);
 const up=new T.Vector3().crossVectors(direction,right).normalize(),texel=span/resolution;
 return right.multiplyScalar(Math.round(point.dot(right)/texel)*texel)
  .add(up.multiplyScalar(Math.round(point.dot(up)/texel)*texel))
  .addScaledVector(direction,point.dot(direction));
}
// Fixed actor coverage includes the 11.6 m wing and its pilot through bank/roll.
// Keep the scale stable rather than refitting it to each deforming pose.
export const ACTOR_SHADOW_SPAN=24;
const WIDE_ACTOR_SHADOW_SPAN=64;
export function createActorShadows(renderer,roots,uniforms){
 const sun=new T.DirectionalLight(0xffffff,0);sun.name='actor_shadow_only';sun.castShadow=true;
 sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-ACTOR_SHADOW_SPAN/2,right:ACTOR_SHADOW_SPAN/2,top:ACTOR_SHADOW_SPAN/2,bottom:-ACTOR_SHADOW_SPAN/2,near:1,far:10000});sun.shadow.camera.updateProjectionMatrix();
 sun.shadow.autoUpdate=false;sun.shadow.bias=0;sun.shadow.normalBias=0;
 // Render a tiny ordinary scene so Three owns clipping/render-state setup.
 // Proxies share the live geometry and copy each animated node's world matrix.
 const actorScene=new T.Scene();actorScene.add(sun,sun.target);
 const maskCamera=new T.PerspectiveCamera(50,1,.1,1);maskCamera.position.set(1e7,0,0);maskCamera.lookAt(1e7+1,0,0);
 const sink=new T.WebGLRenderTarget(1,1),material=new T.MeshBasicMaterial({side:T.DoubleSide,colorWrite:false,depthWrite:false});
 const casters=[];
 for(const root of roots)root.traverse(node=>{
  if(!node.isMesh)return;
  const materials=Array.isArray(node.material)?node.material:[node.material];
  const eligible=!/\.fur\d+$/.test(node.name)&&materials.some(m=>!m.transparent)&&!materials.some(m=>m.userData?.mergedFrom?.includes('propeller'));
  node.castShadow=false;
  if(eligible){const proxy=new T.Mesh(node.geometry,material);proxy.name=node.name;proxy.castShadow=true;proxy.matrixAutoUpdate=false;actorScene.add(proxy);casters.push({source:node,proxy});}
 });
 const stats={frame:0,updatedAt:0,casters:casters.length,spanM:ACTOR_SHADOW_SPAN,worldTexelM:ACTOR_SHADOW_SPAN/1024};
 const right=new T.Vector3(),up=new T.Vector3(),corner=new T.Vector3();
 function retainCoverage(point,direction){
  right.crossVectors(new T.Vector3(0,1,0),direction).normalize();if(right.lengthSq()<.5)right.set(1,0,0);
  up.crossVectors(direction,right).normalize();let extent=0;
  for(const {source,proxy}of casters){
   if(!proxy.visible)continue;if(!source.geometry.boundingBox)source.geometry.computeBoundingBox();
   const box=source.geometry.boundingBox;
   for(let i=0;i<8;i++){
    corner.set(i&1?box.max.x:box.min.x,i&2?box.max.y:box.min.y,i&4?box.max.z:box.min.z).applyMatrix4(source.matrixWorld).sub(point);
    extent=Math.max(extent,Math.abs(corner.dot(right)),Math.abs(corner.dot(up)));
   }
  }
  // Retain the former coverage when walking away from a parked wing or ride.
  // Fixed scales and a margin prevent a deforming wing from pumping the map.
  const limit=ACTOR_SHADOW_SPAN/2-(stats.spanM===ACTOR_SHADOW_SPAN?.5:1.5);
  const span=extent>limit?WIDE_ACTOR_SHADOW_SPAN:ACTOR_SHADOW_SPAN;
  if(span!==stats.spanM){
   Object.assign(sun.shadow.camera,{left:-span/2,right:span/2,top:span/2,bottom:-span/2});sun.shadow.camera.updateProjectionMatrix();
   stats.spanM=span;stats.worldTexelM=span/1024;
  }
 }
 function update(point,direction){
  if(!roots.some(r=>r.visible)||direction.y<=0){uniforms.actorShadowReady.value=0;return;}
  // The map follows the moving caster continuously. Snapping its origin to a
  // world grid makes fixed cloth/hat details crawl through shadow texels.
  const anchor=point;sun.target.position.copy(anchor);sun.position.copy(anchor).addScaledVector(direction,900);
  sun.target.updateMatrixWorld(true);sun.updateMatrixWorld(true);
  // Only these moving roots supply casters. Updating the entire valley here
  // duplicated the beauty pass's traversal of every terrain and forest node.
  for(const root of roots)if(root.visible)root.updateWorldMatrix(true,true);
  for(const {source,proxy}of casters){
   let visible=true;for(let node=source;node;node=node.parent)if(!node.visible){visible=false;break;}
   proxy.visible=visible;proxy.matrix.copy(source.matrixWorld);
  }
  retainCoverage(point,direction);
  const pending=renderer.shadowMap.needsUpdate,target=renderer.getRenderTarget();
  try{
   sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(sink);renderer.render(actorScene,maskCamera);
   uniforms.actorShadow.value=sun.shadow.map.depthTexture;uniforms.actorShadowMatrix.value.copy(sun.shadow.matrix);
   uniforms.actorShadowTexel.value.set(1/1024,1/1024);uniforms.actorShadowReady.value=1;
   stats.frame++;stats.updatedAt=performance.now();
  }finally{renderer.setRenderTarget(target);renderer.shadowMap.needsUpdate=pending;}
 }
 return {sun,stats,update,dispose(){sun.shadow.dispose();sink.dispose();material.dispose();uniforms.actorShadowReady.value=0;}};
}

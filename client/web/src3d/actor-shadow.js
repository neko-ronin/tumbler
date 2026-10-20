/** A small per-frame sun map for moving actors, independent of scenery caches. */
import * as T from '../vendor/three.module.min.js';
export const ACTOR_SHADOW_GLSL=`
uniform sampler2D uActorShadow;uniform mat4 uActorShadowMatrix;uniform vec2 uActorShadowTexel;uniform float uActorShadowReady;
float actorSunLight(vec3 world){
 if(uActorShadowReady<.5)return 1.;
 vec4 q=uActorShadowMatrix*vec4(world,1.);vec3 uv=q.xyz/q.w;
 if(min(uv.x,uv.y)<=.002||max(uv.x,uv.y)>=.998||uv.z<=0.||uv.z>=1.)return 1.;
 // RGBADepthPacking, the same packing as Three's ordinary sun shadow map.
 vec4 unpack=vec4(.99609375/16777216.,.99609375/65536.,.99609375/256.,.99609375);
 float visible=0.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  float depth=dot(texture2D(uActorShadow,uv.xy+vec2(float(x),float(y))*uActorShadowTexel*1.25),unpack);
  visible+=step(uv.z-.000006,depth);
 }
 return visible/9.;
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
export function createActorShadows(renderer,scene,roots,uniforms){
 const sun=new T.DirectionalLight(0xffffff,0);sun.name='actor_shadow_only';sun.castShadow=true;
 sun.shadow.mapSize.set(1024,1024);Object.assign(sun.shadow.camera,{left:-32,right:32,top:32,bottom:-32,near:1,far:10000});sun.shadow.camera.updateProjectionMatrix();
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
 const stats={frame:0,updatedAt:0,casters:casters.length,worldTexelM:64/1024};
 function update(point,direction){
  if(!roots.some(r=>r.visible)||direction.y<=0){uniforms.actorShadowReady.value=0;return;}
  const anchor=snappedShadowAnchor(point,direction);sun.target.position.copy(anchor);sun.position.copy(anchor).addScaledVector(direction,900);
  sun.target.updateMatrixWorld(true);sun.updateMatrixWorld(true);scene.updateMatrixWorld(true);
  for(const {source,proxy}of casters){
   let visible=true;for(let node=source;node;node=node.parent)if(!node.visible){visible=false;break;}
   proxy.visible=visible;proxy.matrix.copy(source.matrixWorld);
  }
  const pending=renderer.shadowMap.needsUpdate,target=renderer.getRenderTarget();
  try{
   sun.shadow.needsUpdate=true;renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(sink);renderer.render(actorScene,maskCamera);
   uniforms.actorShadow.value=sun.shadow.map.texture;uniforms.actorShadowMatrix.value.copy(sun.shadow.matrix);
   uniforms.actorShadowTexel.value.set(1/1024,1/1024);uniforms.actorShadowReady.value=1;
   stats.frame++;stats.updatedAt=performance.now();
  }finally{renderer.setRenderTarget(target);renderer.shadowMap.needsUpdate=pending;}
 }
 return {sun,stats,update,dispose(){sun.shadow.dispose();sink.dispose();material.dispose();uniforms.actorShadowReady.value=0;}};
}

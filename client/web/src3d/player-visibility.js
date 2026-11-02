/** A beauty-pass opening through scenery; never changes collisions or shadows.
 * Uses reconstructed fragment position, so instancing, custom tree billboards
 * and shader displacement retain their existing vertex paths. The climbing
 * leaf opening remains independent in tree-surface.js. */
import * as T from '../vendor/three.module.min.js';
import {visibilityFeather,VISIBILITY_FEATHER_GLSL} from './visibility-feather.js';
export function createPlayerVisibility(camera,renderer,roots,wholeObjects=[]){
 const uniforms={uVisibilityFeather:visibilityFeather,uPlayerSight:{value:new T.Vector4()},uSightInverse:{value:new T.Matrix4()},uSightViewport:{value:new T.Vector2(1,1)},uSightEnabled:{value:0},uSightTreePlay:{value:0}};
 const seen=new WeakSet(),objects=[];let active=false;
 const ray=new T.Ray(),end=new T.Vector3(),delta=new T.Vector3(),matrix=new T.Matrix4(),box=new T.Box3(),point=new T.Vector3();
 for(const root of wholeObjects)root?.traverse(mesh=>{
  if(!mesh.isMesh)return;
  const count=mesh.isInstancedMesh?mesh.instanceMatrix.count:1;
  if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();
  const hidden=new T.InstancedBufferAttribute(new Float32Array(count),1);
  // Mesh geometry may be shared by render batches; visibility belongs to this draw.
  mesh.geometry=mesh.geometry.clone();mesh.geometry.setAttribute('sightHidden',hidden);
  objects.push({mesh,hidden});
 });
 function attach(root){root?.traverse(mesh=>{
  if(!mesh.isMesh)return;
  for(const material of [mesh.material].flat()){
   if(seen.has(material)||material.isShaderMaterial)continue;seen.add(material);
   const compile=material.onBeforeCompile,key=material.customProgramCacheKey.bind(material),oldKey=key();
   material.onBeforeCompile=function(shader,...args){
    compile.call(this,shader,...args);Object.assign(shader.uniforms,uniforms);
    shader.vertexShader='attribute float sightHidden;varying float vSightHidden;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('void main() {','void main() {\n vSightHidden=sightHidden;');
    const treeLeaves=shader.fragmentShader.includes('varying float vTreeLeaf');
    shader.fragmentShader=VISIBILITY_FEATHER_GLSL+'varying float vSightHidden;\n'+shader.fragmentShader;
    shader.fragmentShader='uniform vec4 uPlayerSight;uniform mat4 uSightInverse;uniform vec2 uSightViewport;uniform float uSightEnabled,uSightTreePlay;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
     if(uSightEnabled>.5${treeLeaves?'&&!(uSightTreePlay>.5&&vTreeLeaf>.5)':''}){
      if(vSightHidden>.5)discard;
      vec4 sightWorld=uSightInverse*vec4(gl_FragCoord.xy/uSightViewport*2.-1.,gl_FragCoord.z*2.-1.,1.);
      vec3 place=sightWorld.xyz/sightWorld.w,ray=uPlayerSight.xyz-cameraPosition;
      float len=length(ray),alongSight=dot(place-cameraPosition,ray/max(len,.001));
      float gap=length(place-cameraPosition-ray/max(len,.001)*alongSight);
      // Stop before the player; scenery behind him stays present. The eye
      // sphere also removes near-plane intersections outside the central ray.
      float opening=visibilityOpening(distance(place,cameraPosition),.55,.25);
      if(alongSight>0.){
       float aperture=visibilityOpening(gap,uPlayerSight.w,uPlayerSight.w*.8);
       aperture*=1.-smoothstep(max(0.,len-.2),max(.001,len),alongSight);
       opening=max(opening,aperture);
      }
      visibilityDiscard(opening);
     }
    `);
   };
   material.defaultAttributeValues={...material.defaultAttributeValues,sightHidden:[0]};
   material.customProgramCacheKey=()=>oldKey+'-player-sight-v2';material.needsUpdate=true;
  }
  const before=mesh.onBeforeRender;
  mesh.onBeforeRender=function(r,s,c,...args){before.call(this,r,s,c,...args);uniforms.uSightEnabled.value=+(active&&c===camera);};
 });}
 roots.forEach(attach);
 return {update(position,enabled,scale=1,treePlay=false){
  uniforms.uSightTreePlay.value=+treePlay;
  active=enabled;uniforms.uPlayerSight.value.set(position.x,position.y,position.z,.85*scale);
  camera.updateMatrixWorld();
  end.copy(position);delta.subVectors(end,camera.position);const distance=delta.length();ray.set(camera.position,delta.normalize());
  for(const {mesh,hidden} of objects){
   mesh.updateWorldMatrix(true,false);
   for(let i=0;i<hidden.count;i++){
    if(mesh.isInstancedMesh){mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);}else matrix.copy(mesh.matrixWorld);
    box.copy(mesh.geometry.boundingBox).applyMatrix4(matrix).expandByScalar(.25);
    const hit=ray.intersectBox(box,point),blocked=active&&(box.containsPoint(camera.position)||(hit&&point.distanceTo(camera.position)<distance-.2));
    hidden.setX(i,+!!blocked);
   }
   hidden.needsUpdate=true;
  }
  uniforms.uSightInverse.value.multiplyMatrices(camera.matrixWorld,camera.projectionMatrixInverse);
  renderer.getDrawingBufferSize(uniforms.uSightViewport.value);
 },attach};
}

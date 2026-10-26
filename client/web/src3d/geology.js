/** Draw the core's world-space granite, batched into 512 m source tiles.
 * These deliberately economical convex meshes retain their source triangles
 * at all distances. Terrain keeps its independent error-bounded LOD ladder.
 */
import {Group,Mesh} from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
export function buildGeology(data,assets){
 const group=new Group();group.name='mountain_granite';let triangles=0;
 for(const path of data.meshes){
  const merged=mergePrimitives(assets[path].primitives,'opaque');
  merged.material.defines={...merged.material.defines,MOUNTAIN_GRANITE:1};
  const mesh=new Mesh(merged.geometry,merged.material);mesh.name=`geology_${path}`;
  mesh.receiveShadow=true;group.add(mesh);triangles+=merged.triangles;
 }
 return {group,stats:{...data.counts,triangles,batches:group.children.length},dispose(){
  for(const mesh of group.children){mesh.geometry.dispose();mesh.material.dispose();}group.clear();
 }};
}

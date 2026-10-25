/** Three spatial mesh LODs of the core's existing river rocks and gravel.
 * Distant stones keep volume; transforms and moss stay source-derived.
 */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {clusteredTreeGeometry,treeLodWeights,intervalMaterial} from './forest.js';
import {instanceMatrix} from './world.js';
export const isRock=record=>/\/(river_rock|gravel)\.glb$/.test(record.asset);
export function buildRockLod(records,assets){
 const group=new T.Group();group.name='granite_rocks';const byAsset=new Map(),batches=[],resources=new Set();
 const stats={rocks:records.length,lodCounts:[0,0,0],triangles:0,sourceTriangles:0,levels:{}};
 for(const r of records){if(!byAsset.has(r.asset))byAsset.set(r.asset,[]);byAsset.get(r.asset).push(r);}
 for(const [path,instances]of byAsset){
  const asset=assets[path],source=mergePrimitives(asset.primitives,'opaque');
  const medium=clusteredTreeGeometry(source.geometry,Math.max(80,source.triangles*.4),{minCell:.018});
  const coarse=clusteredTreeGeometry(source.geometry,Math.max(40,source.triangles*.13),{minCell:.045});
  const shapes=[source.geometry,medium.triangles?medium.geometry:source.geometry,coarse.triangles?coarse.geometry:source.geometry];
  resources.add(source.material);resources.add(medium.geometry);resources.add(coarse.geometry);shapes.forEach(g=>resources.add(g));
  intervalMaterial(source.material);const costs=shapes.map(g=>(g.index?.count??g.attributes.position.count)/3);stats.levels[path]=costs;stats.sourceTriangles+=source.triangles*instances.length;
  const tiles=new Map();for(const r of instances){const [x,y]=r.position_m,key=`${Math.floor(x/128)},${Math.floor(y/128)}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(r);}
  for(const [key,items]of tiles){
   const matrices=items.map(r=>instanceMatrix(r.position_m,r.yaw_deg,r.scale,asset.primitives[0].local));
   const bounds=matrices.map(m=>source.geometry.boundingBox.clone().applyMatrix4(m));
   const meshes=shapes.map((shape,lod)=>{
    const g=shape.clone();g.setAttribute('forestInterval',new T.InstancedBufferAttribute(new Float32Array(items.length*2),2));resources.add(g);
    const mesh=new T.InstancedMesh(g,source.material,items.length);mesh.count=0;mesh.name=`rock_lod${lod}_${path}_${key}`;mesh.receiveShadow=true;
    mesh.boundingBox=new T.Box3();bounds.forEach(b=>mesh.boundingBox.union(b));mesh.boundingSphere=mesh.boundingBox.getBoundingSphere(new T.Sphere());group.add(mesh);return mesh;
   });batches.push({meshes,matrices,bounds,costs});
  }
 }
 const last=new T.Vector3(Infinity,Infinity,Infinity);
 function update(camera){
  if(camera.position.distanceToSquared(last)<.25)return;last.copy(camera.position);stats.lodCounts.fill(0);stats.triangles=0;
  for(const {meshes,matrices,bounds,costs}of batches){
   const counts=[0,0,0];
   for(let i=0;i<matrices.length;i++){
    const size=bounds[i].getSize(new T.Vector3()).length(),scale=Math.max(.5,size);
    const weights=treeLodWeights(bounds[i].distanceToPoint(camera.position),{near:24*scale,nearEnd:36*scale,mid:65*scale,midFade:25*scale});let low=0;
    for(let lod=0;lod<3;lod++){const high=low+weights[lod];if(weights[lod]>.0001){const mesh=meshes[lod],index=counts[lod]++;mesh.setMatrixAt(index,matrices[i]);mesh.geometry.attributes.forestInterval.setXY(index,low,high);}low=high;}
   }
   for(let lod=0;lod<3;lod++){const mesh=meshes[lod];mesh.count=counts[lod];mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.forestInterval.needsUpdate=true;stats.lodCounts[lod]+=counts[lod];stats.triangles+=counts[lod]*costs[lod];}
  }
 }
 return {group,stats,update,dispose(){for(const b of batches)for(const m of b.meshes)m.dispose();for(const r of resources)r.dispose();group.clear();}};
}

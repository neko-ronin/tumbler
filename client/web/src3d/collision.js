/** Collision shapes for the placed world, read from the actual shared geometry:
 * trees as a round trunk and a soft crown, everything else as its own triangles
 * (shared/activities/colliders.js). Reading, not changing, any asset.
 */
import * as T from '../vendor/three.module.min.js';
import {instanceMatrix} from './world.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {radialProfile,trunkShape,crownShape,meshAsset,meshShape} from '../../../shared/activities/colliders.js';

// Scene axes (y up, z south) to the core's (x east, y north, z up).
const SCENE_TO_CORE=new T.Matrix4().set(1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1);
const foliage=p=>/foliage/.test(p.materialName);

const IDENTITY=new T.Matrix4();

/** Asset-local vertex positions, each primitive's own node transform applied. */
function positions(primitives){
  const out=[],v=new T.Vector3();
  for(const p of primitives){
    const a=p.geometry.attributes.position,plain=p.local.equals(IDENTITY);
    for(let i=0;i<a.count;i++){if(plain)out.push(a.getX(i),a.getY(i),a.getZ(i));else{v.fromBufferAttribute(a,i).applyMatrix4(p.local);out.push(v.x,v.y,v.z);}}
  }
  return out;
}

/** Asset-local triangles, 9 numbers each. */
function triangles(primitives){
  const out=[],v=new T.Vector3();
  for(const p of primitives){
    const a=p.geometry.attributes.position,index=p.geometry.index,n=index?index.count:a.count,plain=p.local.equals(IDENTITY);
    for(let k=0;k<n;k++){const i=index?index.getX(k):k;if(plain)out.push(a.getX(i),a.getY(i),a.getZ(i));else{v.fromBufferAttribute(a,i).applyMatrix4(p.local);out.push(v.x,v.y,v.z);}}
  }
  return out;
}

/** What one asset contributes, measured once and shared by its instances. */
function readAsset(key,asset){
  const prims=asset.primitives;
  if(key.startsWith('redwood/')){
    // The trunk is the widest bark per 2 m band below the crown (the climb taper);
    // the crown is the 90th-percentile foliage reach per 1 m, so stray sprays do not inflate it.
    const leaves=positions(prims.filter(foliage));let base=Infinity;
    for(let i=1;i<leaves.length;i+=3)base=Math.min(base,leaves[i]);
    return {trunk:radialProfile(positions(prims.filter(p=>!foliage(p))),{band_m:2,to_h:base}),top_h:base,crown:radialProfile(leaves,{band_m:1,percentile:.9})};
  }
  const tree=key.startsWith('arboreal/village_tree'),solid=tree?prims.filter(p=>!foliage(p)):prims;
  return {crown:tree?radialProfile(positions(prims.filter(foliage)),{band_m:1,percentile:.9}):null,
    mesh:meshAsset(triangles(solid)),boxes:solid.map(p=>({box:p.geometry.boundingBox,matrix:p.local}))};
}

export function buildWorldCollision(placement,assets){
  const read=new Map(),shapes=[];
  placement.instances.forEach((i,index)=>{
    if(['river','lake','hardstanding'].includes(i.kind))return;
    if(!read.has(i.asset))read.set(i.asset,readAsset(i.asset,assets[i.asset]));
    const entry=read.get(i.asset),id=part=>`${i.id??index}:${part}`,[x,y,z]=i.position_m,scale=i.scale??[1,1,1],s=Math.max(...scale);
    if(entry.trunk){
      shapes.push(trunkShape({id:id('trunk'),x,y,base_z:z,scale:s,profile:entry.trunk,top_h:entry.top_h}),
        crownShape({id:id('crown'),x,y,base_z:z,scale:s,profile:entry.crown}));
      return;
    }
    if(entry.crown?.length)shapes.push(crownShape({id:id('crown'),x,y,base_z:z,scale:s,profile:entry.crown}));
    const kind=i.kind==='blimp'?'generator':'structure';
    if(scale.every(v=>v===scale[0])){
      shapes.push(meshShape({id:id('mesh'),asset:entry.mesh,kind,matrix:SCENE_TO_CORE.clone().multiply(instanceMatrix(i.position_m,i.yaw_deg,i.scale)).elements}));
      return;
    }
    // A stretched instance would turn a sphere into an ellipsoid: keep a box per part.
    entry.boxes.forEach(({box,matrix},k)=>{
      const b=box.clone().applyMatrix4(instanceMatrix(i.position_m,i.yaw_deg,i.scale,matrix));
      shapes.push({id:id(k),min:[b.min.x,-b.max.z,b.min.y],max:[b.max.x,-b.min.z,b.max.y],kind});
    });
  });
  return createCollisionIndex(shapes);
}

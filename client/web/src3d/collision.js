/** Collision shapes for the placed world, read from the actual shared geometry:
 * trees as a round trunk and a soft crown, everything else as its own triangles
 * (shared/activities/colliders.js). Reading, not changing, any asset.
 */
import * as T from '../vendor/three.module.min.js';
import {createBranchIndex} from '../../../shared/activities/branches.js';
import {fitForestCrown} from '../../../shared/geometry/tree-design/forest-sprays.js';
import {CROWN_SPREAD} from './redwood-rendering.js';
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
    const leaves=positions(prims.filter(foliage));let base=Infinity,top= -Infinity;
    for(let i=1;i<leaves.length;i+=3){base=Math.min(base,leaves[i]);top=Math.max(top,leaves[i]);}
    return {trunk:radialProfile(positions(prims.filter(p=>!foliage(p))),{band_m:2,to_h:base}),top_h:base,climb_top_h:top,
      crown:radialProfile(leaves,{band_m:1,percentile:.9})};
  }
  const tree=key.startsWith('arboreal/village_tree'),solid=tree?prims.filter(p=>!foliage(p)):prims;
  return {crown:tree?radialProfile(positions(prims.filter(foliage)),{band_m:1,percentile:.9}):null,
    mesh:meshAsset(triangles(solid)),boxes:solid.map(p=>({box:p.geometry.boundingBox,matrix:p.local}))};
}

export function buildWorldCollision(placement,assets,treePlan=null,branchData=null){
  const read=new Map(),shapes=[],branchTrees=[],graphs=new Map();
  const graphFor=(asset)=>{
    if(graphs.has(asset))return graphs.get(asset);
    const source=branchData?.profiles?.[treePlan?.targets?.[asset]];if(!source)return null;
    const leaves=positions(assets[asset].primitives.filter(foliage)),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<leaves.length;i+=3)for(let a=0;a<3;a++){min[a]=Math.min(min[a],leaves[i+a]);max[a]=Math.max(max[a],leaves[i+a]);}
    for(const a of [0,2]){min[a]*=CROWN_SPREAD;max[a]*=CROWN_SPREAD;}
    const flat=Float32Array.from(source.branches.flatMap(b=>b.path.flatMap(p=>p.slice(0,3)))),normals=new Float32Array(flat.length);for(let i=1;i<normals.length;i+=3)normals[i]=1;
    const fitted=fitForestCrown(flat,normals,{min,max},[0,0],source.fitBounds).positions,sy=(max[1]-min[1])/(source.fitBounds.max[1]-source.fitBounds.min[1]);let offset=0;
    const graph=source.branches.map(b=>({...b,path:b.path.map(p=>{const q=[...fitted.slice(offset,offset+3),p[3]*sy];offset+=3;return q;})}));const points=graph.flatMap(b=>b.path);graph.stemProfile=source.stemProfile;graph.envelope={reach:Math.max(...points.map(p=>Math.hypot(p[0],p[2])+p[3])),low:Math.min(...points.map(p=>p[1]-p[3])),high:Math.max(...points.map(p=>p[1]+p[3]))};graphs.set(asset,graph);return graph;
  };
  placement.instances.forEach((i,index)=>{
    if(['river','lake','hardstanding'].includes(i.kind))return;
    if(!read.has(i.asset))read.set(i.asset,readAsset(i.asset,assets[i.asset]));
    const entry=read.get(i.asset),id=part=>`${i.id??index}:${part}`,[x,y,z]=i.position_m,scale=i.scale??[1,1,1],s=Math.max(...scale);
    if(entry.trunk){
      const graph=graphFor(i.asset);
      const trunk=trunkShape({id:id('trunk'),x,y,base_z:z,scale:s,profile:entry.trunk,top_h:entry.top_h,climb_top_h:entry.climb_top_h,asset:i.asset,climb_profile:graph?.stemProfile});
      if(graph){const reach=graph.envelope.reach*s;branchTrees.push({id:id('tree'),graph,trunkBox:trunk,matrix:SCENE_TO_CORE.clone().multiply(instanceMatrix(i.position_m,i.yaw_deg,i.scale)).elements,min:[x-reach,y-reach,z+graph.envelope.low*s],max:[x+reach,y+reach,z+graph.envelope.high*s]});}
      shapes.push(trunk,
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
  return Object.assign(createCollisionIndex(shapes),{branchesNear:createBranchIndex(branchTrees)});
}

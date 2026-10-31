/** Adopted studio plan with fixed core silhouettes and bounded visible work.
 * Indexed sources are shared per species/stage/tile. Old core meshes remain
 * stable shadow casters; dense leaf meshes never enter the sun depth pass. */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {instanceMatrix} from './world.js';
import {style} from './style.js';
import {treeLightingKey} from './tree-surface.js';
import {treeMaterial} from './tree-material.js';
import {bakeBoughCards} from './tree-cards.js';
import {bakeCards} from './tree-impostors.js';
import {fitCrown} from '../../../shared/geometry/tree-design/fit-crown.js';
import {fitForestCrown} from '../../../shared/geometry/tree-design/forest-sprays.js';
import {TREE_BUDGETS,projectedTreePixels,allocateTreeLods,treeTransitionDraws,treeBudgetsForQuality} from './tree-budget.js';

const triangles=g=>(g.index?.count??g.attributes.position.count)/3;
const lightKey=()=>style.sun.value.toArray().map(v=>v.toFixed(4)).join(',')+','+treeLightingKey();
const crownPrimitive=p=>/foliage|branch_bark/.test(p.materialName);
export const retainedVillagePrimitive=p=>!crownPrimitive(p);
function boundsOf(primitives){const box=new T.Box3();for(const p of primitives)box.union(p.geometry.boundingBox.clone().applyMatrix4(p.local));return box;}

// Seen from above the stand left the ground showing between crowns. The core's
// crown reach (collision reads it, as a soft 90th-percentile hull) stays as
// authored; only the drawn feral foliage spreads sideways about the bole.
// The village crown holds dwellings inside its envelope, so it keeps its own.
export const CROWN_SPREAD=1.28;
const spreadBounds=box=>{const min=box.min.toArray(),max=box.max.toArray();for(const a of [0,2]){min[a]*=CROWN_SPREAD;max[a]*=CROWN_SPREAD;}return {min,max};};
export function fittedTreeGeometry(source,crown,stage,village=false,taper=.78,retainedBoleIndexCount=Infinity) {
  const box=boundsOf(source.primitives.filter(p=>/foliage/.test(p.materialName)));
  // Crown primitives share one vertex buffer as authored, but each owns its own once
  // meshopt-packed. Fit every distinct buffer once, end to end (the fit is per vertex
  // against the bounds of all of them), and index each primitive into its own.
  const crownGeometries=[...new Map(crown.primitives.map(p=>[p.geometry.attributes.position.array,p.geometry])).values()];
  const crownBase=new Map();let crownCount=0;
  for(const g of crownGeometries){crownBase.set(g.attributes.position.array,crownCount);crownCount+=g.attributes.position.count;}
  const joined=name=>{const out=new Float32Array(crownCount*3);for(const g of crownGeometries)out.set(g.attributes[name].array,crownBase.get(g.attributes.position.array)*3);return out;};
  const fit=stage.recipe.architecture==='feral'?fitForestCrown:fitCrown;
  const fitted=fit(joined('position'),joined('normal'),...(stage.recipe.architecture==='feral'?[village?{min:box.min.toArray(),max:box.max.toArray()}:spreadBounds(box),[0,0],crown.extras?.fitBounds]:[stage.recipe,{min:box.min.toArray(),max:box.max.toArray()},taper]));
  const solids=village?(stage.includeBole?source.primitives.filter(p=>p.materialName==='redwood_bark'):[]):source.primitives.filter(p=>!/foliage/.test(p.materialName));
  const solidVertices=solids.reduce((n,p)=>n+p.geometry.attributes.position.count,0),count=solidVertices+crownCount;
  const position=new Float32Array(count*3),normal=new Float32Array(count*3),color=new Float32Array(count*3),uv=new Float32Array(count*2),leaf=new Uint8Array(count),ao=new Uint8Array(count).fill(255),indices=[];
  const vector=new T.Vector3(),normalMatrix=new T.Matrix3();let offset=0;
  for(const primitive of solids){
    const g=primitive.geometry,p=g.attributes.position,n=g.attributes.normal,tint=g.attributes.color;
    normalMatrix.getNormalMatrix(primitive.local);
    const factor=primitive.baseColorFactor;
    for(let i=0;i<p.count;i++){
      vector.fromBufferAttribute(p,i).applyMatrix4(primitive.local).toArray(position,(offset+i)*3);
      vector.fromBufferAttribute(n,i).applyNormalMatrix(normalMatrix).toArray(normal,(offset+i)*3);
      if(g.attributes.uv){uv[(offset+i)*2]=g.attributes.uv.getX(i);uv[(offset+i)*2+1]=g.attributes.uv.getY(i);}
      for(let a=0;a<3;a++)color[(offset+i)*3+a]=factor[a]*(tint?tint.getComponent(i,a):1);
    }
    for(let i=0;i<Math.min(g.index?.count??p.count,retainedBoleIndexCount);i++)indices.push(offset+(g.index?g.index.getX(i):i));offset+=p.count;
  }
  position.set(fitted.positions,offset*3);normal.set(fitted.normals,offset*3);
  for(const g of crownGeometries){const at=offset+crownBase.get(g.attributes.position.array),{uv:uvs,color:tint}=g.attributes;
    for(let i=0;i<g.attributes.position.count;i++){uv[(at+i)*2]=uvs.getX(i);uv[(at+i)*2+1]=uvs.getY(i);ao[at+i]=Math.round(tint.getW(i)*255);}
  }
  for(const p of crown.primitives){const g=p.geometry,tint=g.attributes.color,at=offset+crownBase.get(g.attributes.position.array),foliage=/foliage/.test(p.materialName),tone=p.materialName.match(/foliage_(dark|mid|new)/)?.[1];
    // The core's original material values are the palette authority for each
    // species, including the separately authored occupied village trees.
    const palette=source.primitives.find(s=>tone?s.materialName.endsWith('foliage_'+tone):/^(redwood|conifer)_bark$/.test(s.materialName))?.baseColorFactor;
    if(!palette)throw new Error('Missing original redwood palette: '+p.materialName);
    for(let i=0;i<g.index.count;i++){const id=g.index.getX(i);indices.push(at+id);if(foliage)leaf[at+id]=p.materialName.includes('spray')?2:1;
      for(let a=0;a<3;a++)color[(at+id)*3+a]=palette[a]*tint.getComponent(id,a);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(position,3));g.setAttribute('normal',new T.BufferAttribute(normal,3));
  g.setAttribute('color',new T.BufferAttribute(color,3));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setAttribute('leafKind',new T.BufferAttribute(leaf,1));g.setAttribute('canopyAO',new T.BufferAttribute(ao,1,true));g.setIndex(indices);
  g.userData.treePalette=['dark','mid','new'].map(tone=>source.primitives.find(p=>p.materialName.endsWith('foliage_'+tone)).baseColorFactor.slice(0,3));
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
/** Discard decoded generator prototypes after fitting. Render geometry owns
 * independent buffers; shared atlas textures stay alive on its materials. */
export function releaseCrownSources(assets,plan){
  const paths=new Set([...plan.stages,...Object.values(plan.profiles??{}).flatMap(p=>p.stages)].map(s=>s.asset)),buffers=new Set();
  for(const path of paths){if(plan.targets[path])continue;const asset=assets[path];if(!asset)continue;
    for(const p of asset.primitives){for(const a of Object.values(p.geometry.attributes))buffers.add(a.array.buffer);if(p.geometry.index)buffers.add(p.geometry.index.array.buffer);p.geometry.dispose();}
    delete assets[path];
  }
  return [...buffers].reduce((sum,b)=>sum+b.byteLength,0);
}
function batchGeometry(base,count){
  const g=new T.BufferGeometry();g.setIndex(base.index);for(const [name,a]of Object.entries(base.attributes))g.setAttribute(name,a);
  g.boundingBox=base.boundingBox;g.boundingSphere=base.boundingSphere;
  g.setAttribute('forestInterval',new T.InstancedBufferAttribute(new Float32Array(count*2),2).setUsage(T.DynamicDrawUsage));return g;
}
export function buildAdoptedRedwoods(placement,assets,renderer,plan,options={}) {
  const group=new T.Group();group.name='studio_redwoods';
  const types=new Map(),batches=[],beautyMeshes=[],records=[],kits=[],bases=[],materials=[],shapeCache=new Map();
  const distantTileCells=options.distantTileCells??4;
  if(!Number.isInteger(distantTileCells)||distantTileCells<1)throw Error('Distant tree batches require a positive number of selection tiles');
  const stats={trees:0,near:0,mid:0,far:0,tiles:0,shadowProxies:0,shadowRevision:0,lodCounts:[0,0,0,0],
    trianglesByLod:[0,0,0,0],budgets:[...(options.budgets??TREE_BUDGETS)],costsByAsset:{},culled:0,selectionMs:0,presentation:(plan.design?.name??'studio r'+plan.source.studioRevision)+' / four bounded LODs / unchanged core envelopes'};
  for(const tree of placement.instances)if(plan.targets[tree.asset]){if(!types.has(tree.asset))types.set(tree.asset,[]);types.get(tree.asset).push(tree);stats.trees++;}
  for(const [path,entries]of types){
    const source=assets[path],village=plan.targets[path]==='village',profile=plan.profiles?.[village?'giant':plan.targets[path]],stages=profile?.stages??plan.stages,shapeKey=village?'village':path;
    let prepared=shapeCache.get(shapeKey);
    if(!prepared){
      prepared=stages.map(stage=>{
        const crown=assets[stage.asset],sprayMap=crown.primitives.find(p=>p.texture)?.texture??null;
        const g=fittedTreeGeometry(source,crown,stage,village,plan.silhouette.taper,plan.silhouette.retainedBoleIndexCount),material=treeMaterial(stage.recipe,{sprayMap,palette:g.userData.treePalette});
        if(stage.representation==='mesh'){bases.push(g);materials.push(material);return {geometry:g,material,triangles:triangles(g)};}
        const bake=()=>{const sourceMaterial=treeMaterial(stage.recipe,{sprayMap,palette:g.userData.treePalette,shadowShader:null});try{return stage.representation==='lattice'?bakeBoughCards(renderer,g,sourceMaterial,'lattice',stage.cards):bakeCards(renderer,g,sourceMaterial,'multiview',stage.cards);}finally{sourceMaterial.dispose();g.dispose();}};
        const kit=bake();kit.bake=bake;
        kit.dispose=()=>{kit.target.dispose();kit.geometry.dispose();kit.material.dispose();kit.material.studioMaskMaterial?.dispose();};
        g.dispose();material.dispose();kits.push(kit);bases.push(kit.geometry);materials.push(kit.material);
        return {...kit,triangles:triangles(kit.geometry)};
      });shapeCache.set(shapeKey,prepared);
    }
    stats.costsByAsset[path]=prepared.map(p=>p.triangles);
    const shadowParts=village?source.primitives.filter(crownPrimitive):source.primitives;
    const shadow=mergePrimitives(shadowParts,'opaque');bases.push(shadow.geometry);shadow.material.dispose();
    const shadowMaterial=new T.MeshBasicMaterial({side:T.DoubleSide,colorWrite:false,depthWrite:false});materials.push(shadowMaterial);
    const sourceBox=boundsOf(source.primitives),visualBox=sourceBox.clone(),tiles=new Map();
    for(const p of prepared)visualBox.union(p.geometry.boundingBox);
    for(const tree of entries){const [x,y]=tree.position_m,key=`${Math.floor(x/128)},${Math.floor(y/128)}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(tree);}
    const distant=new Map(),distantKey=tile=>tile.split(',').map(v=>Math.floor(Number(v)/distantTileCells)).join(',');
    for(const [tile,items]of tiles){const key=distantKey(tile);if(!distant.has(key))distant.set(key,{capacity:0,bounds:new T.Sphere(),meshes:[]});distant.get(key).capacity+=items.length;}
    const make=(base,material,name,count,bounds)=>{const mesh=new T.InstancedMesh(batchGeometry(base,count),material,count);mesh.count=0;mesh.visible=false;mesh.name=`studio_${name}_${path}`;mesh.boundingSphere=bounds.clone();mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);group.add(mesh);return mesh;};
    for(const [key,pool]of distant)for(const lod of [2,3]){
      const p=prepared[lod],mesh=make(p.geometry,p.material,`lod${lod}_distant_${key}`,pool.capacity,pool.bounds);pool.meshes[lod]=mesh;beautyMeshes.push(mesh);
    }
    for(const [tile,entries]of tiles){
      const batch={items:[],meshes:[],proxy:null};const sphere=new T.Sphere();
      for(const tree of entries){
        const matrix=instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale,null,tree.tags?.includes('world_space'));
        const box=sourceBox.clone().applyMatrix4(matrix),visibleBox=visualBox.clone().applyMatrix4(matrix),bound=visibleBox.getBoundingSphere(new T.Sphere());sphere.union(bound);
        const item={id:records.length,matrix,box,bound,visibleBox,height:box.max.y-box.min.y,costs:prepared.map(p=>p.triangles),previous:-1,batch};
        batch.items.push(item);records.push(item);
      }
      sphere.radius*=1.15;
      const pool=distant.get(distantKey(tile));pool.bounds.union(sphere);batch.bounds=sphere.clone();
      batch.meshes=prepared.map((p,lod)=>{if(lod>=2)return pool.meshes[lod];const mesh=make(p.geometry,p.material,`lod${lod}_${tile}`,entries.length,sphere);beautyMeshes.push(mesh);return mesh;});
      batch.proxy=make(shadow.geometry,shadowMaterial,`core_shadow_${tile}`,entries.length,sphere);batch.proxy.castShadow=true;
      batch.proxy.onBeforeRender=()=>batch.proxy.geometry.setDrawRange(0,0);
      batch.proxy.onAfterRender=batch.proxy.onBeforeShadow=()=>batch.proxy.geometry.setDrawRange(0,Infinity);
      batches.push(batch);
    }
    for(const pool of distant.values())for(const lod of [2,3])pool.meshes[lod].boundingSphere.copy(pool.bounds);
  }
  stats.tiles=batches.length;stats.drawBatches=beautyMeshes.length;let lastKey='',lastShadowKey='',bakedLight=lightKey(),fading=false;
  const frustum=new T.Frustum(),matrix=new T.Matrix4(),lastPosition=new T.Vector3(Infinity,Infinity,Infinity),lastDirection=new T.Vector3(),direction=new T.Vector3();
  function update(camera,anchor=camera.position){
    const shadowKey=[anchor.x,anchor.y,anchor.z].map(v=>Math.round(v/4)).join(',');
    if(shadowKey!==lastShadowKey){
      let changed=false;stats.shadowProxies=0;
      for(const b of batches){let count=0;for(const item of b.items){const box=item.box,dx=Math.max(box.min.x-anchor.x,0,anchor.x-box.max.x),dz=Math.max(box.min.z-anchor.z,0,anchor.z-box.max.z);
        const casts=dx*dx+dz*dz<380*380;changed||=casts!==item.casts;item.casts=casts;if(casts)b.proxy.setMatrixAt(count++,item.matrix);}
        b.proxy.count=count;b.proxy.visible=count>0;b.proxy.instanceMatrix.needsUpdate=true;stats.shadowProxies+=count;}
      if(changed)stats.shadowRevision++;lastShadowKey=shadowKey;
    }
    camera.getWorldDirection(direction);const size=renderer.getSize(new T.Vector2()),key=[camera.fov,camera.aspect,size.y].join(',');
    if(!fading&&key===lastKey&&lastPosition.distanceToSquared(camera.position)<.25&&direction.dot(lastDirection)>.9999)return;
    const start=performance.now();lastKey=key;lastPosition.copy(camera.position);lastDirection.copy(direction);
    camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    const visible=[];
    for(const b of batches){if(!frustum.intersectsSphere(b.bounds))continue;
      for(const item of b.items)if(frustum.intersectsBox(item.visibleBox)){
        item.clearance=item.box.distanceToPoint(camera.position);
        item.pixels=projectedTreePixels(item.height,camera.position.distanceTo(item.bound.center),camera.fov,size.y);item.priority=item.pixels+800/(1+item.clearance);visible.push(item);
      }}
    const allocation=allocateTreeLods(visible,stats.budgets),transitions=treeTransitionDraws(allocation,stats.budgets,performance.now());
    stats.trianglesByLod=transitions.used;stats.lodCounts=[0,0,0,0];stats.transitioning=transitions.transitioning;fading=stats.transitioning>0;
    for(const {lod}of allocation.result)stats.lodCounts[lod]++;
    const counts=new Map(beautyMeshes.map(mesh=>[mesh,0]));
    for(const {tree:item,lod,lo,hi}of transitions.draws){
      const mesh=item.batch.meshes[lod],index=counts.get(mesh);counts.set(mesh,index+1);
      mesh.setMatrixAt(index,item.matrix);mesh.geometry.attributes.forestInterval.setXY(index,lo,hi);
    }
    for(const mesh of beautyMeshes){mesh.count=counts.get(mesh);mesh.visible=mesh.count>0;mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.forestInterval.needsUpdate=true;}
    stats.near=stats.lodCounts[0];stats.mid=stats.lodCounts[1]+stats.lodCounts[2];stats.far=stats.lodCounts[3];stats.culled=records.length-visible.length;stats.selectionMs=performance.now()-start;
  }
  return {group,stats,update,setQuality(quality){stats.budgets=options.budgets??treeBudgetsForQuality(quality);stats.quality=quality;lastKey='';},invalidateShadows(){stats.shadowRevision++;lastKey='';lastShadowKey='';},
    rebuildImpostors(direction){
      const key=lightKey();if(direction&&key===bakedLight)return;
      for(const kit of kits){const next=kit.bake();kit.target.dispose();kit.target=next.target;kit.material.map=next.target.texture;kit.material.needsUpdate=true;next.geometry.dispose();next.material.dispose();next.material.studioMaskMaterial?.dispose();}
      bakedLight=key;stats.shadowRevision++;lastKey='';},
    dispose(){for(const mesh of [...beautyMeshes,...batches.map(b=>b.proxy)])mesh.geometry.dispose();for(const g of bases)g.dispose();for(const m of materials)m.dispose();for(const kit of kits)kit.dispose();group.clear();}};
}

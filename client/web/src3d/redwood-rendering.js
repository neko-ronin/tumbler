/** Adopted studio plan with fixed core silhouettes and bounded visible work.
 * Indexed sources are shared per species/stage/tile. The fitted spatial
 * representation casts stable shadows independent of beauty allocation. */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {instanceMatrix} from './world.js';
import {style} from './style.js';
import {treeLightingKey} from './tree-surface.js';
import {treeMaterial} from './tree-material.js';
import {bakeBoughCards} from './tree-cards.js';
import {bakeCards} from './tree-impostors.js';
import {bakeTreeSlices} from './tree-slices.js';
import {paletteOverride} from '../../../shared/geometry/tree-design/forest-palette.js';
import {fitCrown} from '../../../shared/geometry/tree-design/fit-crown.js';
import {fitForestCrown} from '../../../shared/geometry/tree-design/forest-sprays.js';
import {TREE_BUDGETS,projectedTreePixels,allocateTreeLods,treeTransitionDraws,treeBudgetsForQuality,treeTransitionBudgets} from './tree-budget.js';

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
const TALLEST_TREE_M=70;
const spreadBounds=box=>{const min=box.min.toArray(),max=box.max.toArray();for(const a of [0,2]){min[a]*=CROWN_SPREAD;max[a]*=CROWN_SPREAD;}return {min,max};};
/** Browser capture policy. The shared plan still owns source geometry/recipes;
 * GPU representation, texture resolution and budgets belong to this client. */
export function browserTreeStages(stages,kind){
  const fir=kind==='fir';
  // Fill out the simplified sprays from the side. From above the existing
  // mesh already has enough cover, but the horizontal atlas slabs need gaps.
  const mid=kind==='pine'?stages[1]:{...stages[1],recipe:{...stages[1].recipe,spraySideCutoff:fir?.28:.29}};
  const spatial={...stages[2],representation:'slices',cards:{
    layers:12,resolution:fir?256:128,alphaCutoff:fir?.1:.22,
    sideAlphaCutoff:(kind==='giant'||kind==='redwood')?.16:undefined,
    sideAlphaRange:fir?[.025,.24]:undefined,
    topAlphaCutoff:fir?.32:kind==='pine'?.36:.4,woodTriangles:700,
  }};
  return [stages[0],mid,spatial,{...spatial,lod:3}];
}
export function fittedTreeGeometry(source,crown,stage,village=false,taper=.78,retainedBoleIndexCount=Infinity,override=undefined) {
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
    const palette=(tone&&override?.[tone])||source.primitives.find(s=>tone?s.materialName.endsWith('foliage_'+tone):/^(redwood|conifer)_bark$/.test(s.materialName))?.baseColorFactor;
    if(!palette)throw new Error('Missing original redwood palette: '+p.materialName);
    for(let i=0;i<g.index.count;i++){const id=g.index.getX(i);indices.push(at+id);if(foliage)leaf[at+id]=p.materialName.includes('spray')?2:1;
      for(let a=0;a<3;a++)color[(at+id)*3+a]=palette[a]*tint.getComponent(id,a);}}
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(position,3));g.setAttribute('normal',new T.BufferAttribute(normal,3));
  g.setAttribute('color',new T.BufferAttribute(color,3));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setAttribute('leafKind',new T.BufferAttribute(leaf,1));g.setAttribute('canopyAO',new T.BufferAttribute(ao,1,true));g.setIndex(indices);
  g.userData.treePalette=['dark','mid','new'].map(tone=>override?.[tone]??source.primitives.find(p=>p.materialName.endsWith('foliage_'+tone)).baseColorFactor.slice(0,3));
  g.computeBoundingBox();g.computeBoundingSphere();return g;
}
/** Fit three cross sections and a tip to the rooted wood already in LOD 2.
 * The lowest section includes the flare and keeps the original support height. */
function farBole(position,faces){
 const bounds=new T.Box3(),point=new T.Vector3();
 for(const id of faces)bounds.expandByPoint(point.fromBufferAttribute(position,id));
 const {min,max}=bounds,positions=[],indices=[],sides=8;
 for(const fraction of [0,.07,.52]){
  const y=T.MathUtils.lerp(min.y,max.y,fraction),section=new T.Box2();
  for(let i=0;i<faces.length;i+=3){
   for(let edge=0;edge<3;edge++){
    const a=faces[i+edge],b=faces[i+(edge+1)%3],ay=position.getY(a),by=position.getY(b);
    if(y<Math.min(ay,by)||y>Math.max(ay,by))continue;
    const t=ay===by?0:(y-ay)/(by-ay);
    section.expandByPoint(new T.Vector2(T.MathUtils.lerp(position.getX(a),position.getX(b),t),T.MathUtils.lerp(position.getZ(a),position.getZ(b),t)));
   }
  }
  const centre=section.getCenter(new T.Vector2()),radius=section.getSize(new T.Vector2()).multiplyScalar(.5);
  for(let i=0;i<sides;i++){
   const a=i*2*Math.PI/sides;
   positions.push(centre.x+radius.x*Math.cos(a),y,centre.y+radius.y*Math.sin(a));
  }
 }
 const tip=faces.find(id=>position.getY(id)===max.y);
 point.fromBufferAttribute(position,tip).toArray(positions,positions.length);
 for(let i=0;i<sides;i++){
  const next=(i+1)%sides;
  for(const ring of [0,sides]){
   const a=ring+i,b=ring+next;
   indices.push(a,a+sides,b,b,a+sides,b+sides);
  }
  indices.push(2*sides+i,3*sides,2*sides+next);
 }
 for(let i=1;i<sides-1;i++)indices.push(0,i,i+1);
 const bole=new T.BufferGeometry();
 bole.setAttribute('position',new T.Float32BufferAttribute(positions,3));bole.setIndex(indices);bole.computeVertexNormals();
 return bole;
}

/** The far draw keeps every indexed slice face in its original order. Its wood
 * is a continuous low-poly bole, with the full fitted wood kept for shadows. */
export function farStageGeometry(geometry,{bole=true}={}){
 const {position,sliceTile,color}=geometry.attributes,index=geometry.index,cards=[],wood=[];
 const vertex=i=>index?index.getX(i):i;
 for(let i=0;i<(index?.count??position.count);i+=3){
  const a=vertex(i),b=vertex(i+1),c=vertex(i+2);
  (sliceTile.getX(a)>=0?cards:wood).push(a,b,c);
 }
 const vertices=[...new Set(cards)],remap=new Map(vertices.map((id,i)=>[id,i]));
 const stem=bole&&wood.length?farBole(position,wood):null;
 const far=new T.BufferGeometry();
 for(const [name,attribute]of Object.entries(geometry.attributes)){
  const values=[];
  for(const id of vertices)for(let i=0;i<attribute.itemSize;i++)values.push(attribute.getComponent(id,i));
  if(stem){
   const stemAttribute=stem.getAttribute(name);
   for(let id=0;id<stem.attributes.position.count;id++)for(let i=0;i<attribute.itemSize;i++){
    values.push(stemAttribute?stemAttribute.getComponent(id,i):name==='color'?color.getComponent(wood[0],i):name==='uv'?0:-1);
   }
  }
  far.setAttribute(name,new T.Float32BufferAttribute(values,attribute.itemSize));
 }
 far.setIndex([...cards.map(id=>remap.get(id)),...(stem?Array.from(stem.index.array,id=>id+vertices.length):[])]);
 far.computeBoundingBox();far.computeBoundingSphere();stem?.dispose();
 return far;
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
  const distantShadowGroup=new T.Group(),distantShadowBounds=new T.Box3();
  const types=new Map(),batches=[],pools=[],beautyMeshes=[],records=[],kits=[],bases=[],materials=[],shapeCache=new Map(),shadowCrowns=new Map();
  const distantTileCells=options.distantTileCells??12,detachEmpty=options.detachEmpty??false;
  const setCount=(mesh,count)=>{
    mesh.count=count;mesh.visible=count>0;
    if(detachEmpty&&mesh.visible&&!mesh.parent)group.add(mesh);
    if(detachEmpty&&!mesh.visible&&mesh.parent)group.remove(mesh);
  };
  if(!Number.isInteger(distantTileCells)||distantTileCells<1)throw Error('Distant tree batches require a positive number of selection tiles');
  const stats={trees:0,near:0,mid:0,far:0,tiles:0,shadowProxies:0,shadowRevision:0,lodCounts:[0,0,0,0],
    trianglesByLod:[0,0,0,0],budgets:[...(options.budgets??TREE_BUDGETS)],costsByAsset:{},capturesByAsset:{},textureBytes:0,culled:0,selectionMs:0,presentation:(plan.design?.name??'studio r'+plan.source.studioRevision)+' / spatial canopy at every distance / bounded priority detail'};
  for(const tree of placement.instances)if(plan.targets[tree.asset]){if(!types.has(tree.asset))types.set(tree.asset,[]);types.get(tree.asset).push(tree);stats.trees++;}
  for(const [path,entries]of types){
    const source=assets[path],village=plan.targets[path]==='village',profile=plan.profiles?.[village?'giant':plan.targets[path]],stages=(options.presentationStages??browserTreeStages)(profile?.stages??plan.stages,plan.targets[path]),shapeKey=village?'village':path;
    let prepared=shapeCache.get(shapeKey);
    if(!prepared){
      const stageCache=new Map();
      prepared=stages.map(stage=>{
        const key=JSON.stringify([stage.asset,stage.representation,stage.recipe,stage.cards]);
        if(stageCache.has(key))return stageCache.get(key);
        const crown=assets[stage.asset],sprayMap=crown.primitives.find(p=>p.texture)?.texture??null;
        const g=fittedTreeGeometry(source,crown,stage,village,plan.silhouette.taper,plan.silhouette.retainedBoleIndexCount,paletteOverride(plan.targets[path])),material=treeMaterial(stage.recipe,{sprayMap,palette:g.userData.treePalette});
        if(stage.representation==='mesh'){bases.push(g);materials.push(material);const entry={geometry:g,material,triangles:triangles(g)};stageCache.set(key,entry);return entry;}
        const bake=()=>{const sourceMaterial=treeMaterial(stage.recipe,{sprayMap,palette:g.userData.treePalette,shadowShader:null,capture:true});try{return stage.representation==='slices'?bakeTreeSlices(renderer,g,sourceMaterial,stage.cards):stage.representation==='lattice'?bakeBoughCards(renderer,g,sourceMaterial,'lattice',stage.cards):bakeCards(renderer,g,sourceMaterial,'multiview',stage.cards);}finally{sourceMaterial.dispose();g.dispose();}};
        const kit=bake();kit.bake=bake;
        kit.dispose=()=>{kit.target.dispose();kit.geometry.dispose();kit.material.dispose();kit.material.studioMaskMaterial?.dispose();};
        g.dispose();material.dispose();kits.push(kit);bases.push(kit.geometry);materials.push(kit.material);
        const entry={...kit,triangles:triangles(kit.geometry)};stageCache.set(key,entry);return entry;
      });
      // Keep the same canopy at the 24 px handoff. The occupied village
      // already draws its bole separately at every distance.
      if(prepared[3]===prepared[2]&&prepared[2].geometry.hasAttribute('sliceTile')){
        const slim=farStageGeometry(prepared[2].geometry,{bole:!village});
        bases.push(slim);prepared[3]={...prepared[2],geometry:slim,triangles:triangles(slim)};
      }
      shapeCache.set(shapeKey,prepared);
    }
    stats.costsByAsset[path]=prepared.map(p=>p.triangles);
    stats.capturesByAsset[path]=prepared.map(p=>p.detail??null);
    const spatial=prepared.find(p=>p.createShadowMaterial);
    // Keep the former caster available for isolated historical beauty controls.
    const shadow=spatial??mergePrimitives(village?source.primitives.filter(crownPrimitive):source.primitives,'opaque');
    const depth=spatial?.createShadowMaterial();
    if(spatial)shadowCrowns.set(path,spatial.crownBounds);
    else {bases.push(shadow.geometry);shadow.material.dispose();}
    if(depth)materials.push(depth);
    const shadowMaterial=new T.MeshBasicMaterial({side:T.DoubleSide,colorWrite:false,depthWrite:false});materials.push(shadowMaterial);
    const sourceBox=boundsOf(source.primitives),visualBox=sourceBox.clone(),tiles=new Map();
    for(const p of prepared)visualBox.union(p.geometry.boundingBox);
    for(const tree of entries){const [x,y]=tree.position_m,key=`${Math.floor(x/128)},${Math.floor(y/128)}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(tree);}
    const distant=new Map(),distantKey=tile=>tile.split(',').map(v=>Math.floor(Number(v)/distantTileCells)).join(',');
    for(const [tile,items]of tiles){const key=distantKey(tile);if(!distant.has(key)){const pool={capacity:0,bounds:new T.Sphere(),meshes:[],batches:[],frozen:false};distant.set(key,pool);pools.push(pool);}distant.get(key).capacity+=items.length;}
    const make=(base,material,name,count,bounds)=>{const mesh=new T.InstancedMesh(batchGeometry(base,count),material,count);mesh.count=0;mesh.visible=false;mesh.matrixAutoUpdate=false;mesh.matrixWorldAutoUpdate=false;mesh.name=`studio_${name}_${path}`;mesh.boundingSphere=bounds.clone();mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);if(!detachEmpty)group.add(mesh);return mesh;};
    for(const [key,pool]of distant)for(const lod of [2,3]){
      const p=prepared[lod],mesh=make(p.geometry,p.material,`lod${lod}_distant_${key}`,pool.capacity,pool.bounds);mesh.userData.pool=pool;pool.meshes[lod]=mesh;beautyMeshes.push(mesh);
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
      batch.pool=pool;pool.batches.push(batch);
      batch.meshes=prepared.map((p,lod)=>{if(lod>=2)return pool.meshes[lod];const mesh=make(p.geometry,p.material,`lod${lod}_${tile}`,entries.length,sphere);mesh.userData.pool=pool;beautyMeshes.push(mesh);return mesh;});
      batch.proxy=make(shadow.geometry,shadowMaterial,`canopy_shadow_${tile}`,entries.length,sphere);batch.proxy.castShadow=true;
      if(depth)batch.proxy.customDepthMaterial=depth;
      batch.proxy.onBeforeRender=()=>batch.proxy.geometry.setDrawRange(0,0);
      batch.proxy.onAfterRender=batch.proxy.onBeforeShadow=()=>batch.proxy.geometry.setDrawRange(0,Infinity);
      const distantProxy=new T.InstancedMesh(batchGeometry(shadow.geometry,entries.length),shadowMaterial,entries.length);
      distantProxy.name='distant_'+batch.proxy.name;distantProxy.castShadow=true;
      distantProxy.customDepthMaterial=depth;distantProxy.boundingSphere=sphere.clone();
      for(const [index,item] of batch.items.entries()){
        distantProxy.setMatrixAt(index,item.matrix);distantShadowBounds.union(item.visibleBox);
      }
      distantShadowGroup.add(distantProxy);
      batches.push(batch);
    }
    for(const pool of distant.values())for(const lod of [2,3])pool.meshes[lod].boundingSphere.copy(pool.bounds);
  }
  stats.tiles=batches.length;stats.drawBatches=beautyMeshes.length;stats.textureBytes=kits.reduce((sum,kit)=>sum+(kit.textureBytes??0),0);let requestedBudgets=[...stats.budgets];let lastKey='',bakedLight=lightKey(),fading=false,lastLive=new Set();
  const frustum=new T.Frustum(),matrix=new T.Matrix4(),lastPosition=new T.Vector3(Infinity,Infinity,Infinity),lastAnchor=lastPosition.clone(),lastDirection=new T.Vector3(),direction=new T.Vector3();
  function updateShadowCasters(lightFrustum){
    // Reject whole tiles before visiting trees in the grown valley. The
    // visual bounds enclose the fitted slices, even in a frozen beauty pool.
    let proxies=0,triangles=0;
    for(const batch of batches){
      const proxy=batch.proxy;
      if(!lightFrustum.intersectsSphere(proxy.boundingSphere)){
        if(proxy.count)setCount(proxy,0);
        continue;
      }
      let count=0;
      for(const item of batch.items)if(lightFrustum.intersectsBox(item.visibleBox))proxy.setMatrixAt(count++,item.matrix);
      setCount(proxy,count);
      if(count)proxy.instanceMatrix.needsUpdate=true;
      proxies+=count;
      triangles+=count*(proxy.geometry.index?.count??proxy.geometry.attributes.position.count)/3;
    }
    stats.shadowProxies=proxies;stats.shadowTriangles=triangles;
  }
  function update(camera,anchor=camera.position){
    camera.getWorldDirection(direction);const size=renderer.getSize(new T.Vector2()),key=[camera.fov,camera.aspect,size.y].join(',');
    if(!fading&&key===lastKey&&lastPosition.distanceToSquared(camera.position)<.25&&lastAnchor.distanceToSquared(anchor)<.25&&direction.dot(lastDirection)>.9999)return;
    const start=performance.now();lastKey=key;lastPosition.copy(camera.position);lastAnchor.copy(anchor);lastDirection.copy(direction);
    camera.updateMatrixWorld();frustum.setFromProjectionMatrix(matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    // A pool wholly too far for any tree to reach the farthest stage's 24 pixels stops being
    // chosen per tree: it holds that stage until the camera comes back. What it draws is what
    // the selection would have picked, without visiting tens of thousands of trees a frame.
    const freezeM=TALLEST_TREE_M*size.y/(2*Math.tan(camera.fov*Math.PI/360)*20);let frozenTrees=0,frozenTriangles=0;
    for(const pool of pools){
      const clear=Math.min(camera.position.distanceTo(pool.bounds.center),anchor.distanceTo(pool.bounds.center))-pool.bounds.radius,freeze=clear>(pool.frozen?freezeM:freezeM+80);
      if(freeze&&!pool.frozen){
        let n=0;const far=pool.meshes[3];pool.frozen=true;setCount(pool.meshes[2],0);
        for(const b of pool.batches){for(const lod of [0,1])setCount(b.meshes[lod],0);
          for(const item of b.items){item.previous=-1;item.from=-1;far.setMatrixAt(n,item.matrix);far.geometry.attributes.forestInterval.setXY(n++,0,1);}}
        setCount(far,n);far.instanceMatrix.needsUpdate=true;far.geometry.attributes.forestInterval.needsUpdate=true;
      }else if(!freeze&&pool.frozen){
        pool.frozen=false;
        // A pool can re-enter outside the frustum. Clear the retained far
        // draw even when no member is selected on this frame.
        setCount(pool.meshes[3],0);
      }
      if(pool.frozen){frozenTrees+=pool.meshes[3].count;frozenTriangles+=pool.meshes[3].count*(pool.batches[0]?.items[0]?.costs[3]??0);}
    }
    const visible=[],selected=new Set();
    for(const b of batches){if(b.pool.frozen||!frustum.intersectsSphere(b.bounds))continue;
      for(const item of b.items)if(frustum.intersectsBox(item.visibleBox)){
        item.clearance=Math.min(item.box.distanceToPoint(camera.position),item.box.distanceToPoint(anchor));
        item.pixels=projectedTreePixels(item.height,camera.position.distanceTo(item.bound.center),camera.fov,size.y);item.priority=item.pixels+800/(1+item.clearance);visible.push(item);selected.add(item);
      }}
    for(const b of batches)if(!b.pool.frozen)for(const item of b.items)if(!selected.has(item)){item.previous=-1;item.from=-1;}
    const now=performance.now();stats.selectionTime=now;
    stats.budgets=treeTransitionBudgets(visible,requestedBudgets,now);
    const allocation=allocateTreeLods(visible,requestedBudgets),transitions=treeTransitionDraws(allocation,stats.budgets,now);
    stats.trianglesByLod=transitions.used;stats.trianglesByLod[3]+=frozenTriangles;stats.lodCounts=[0,0,0,frozenTrees];stats.frozenTrees=frozenTrees;stats.transitioning=transitions.transitioning;fading=stats.transitioning>0||transitions.pending;
    for(const {lod}of allocation.result)stats.lodCounts[lod]++;
    // Only meshes with a draw can need a new upload. Retire the previously
    // active ones that no longer have work; frozen pools remain independent.
    const counts=new Map();
    for(const {tree:item,lod,lo,hi}of transitions.draws){
      const mesh=item.batch.meshes[lod],index=counts.get(mesh)??0;counts.set(mesh,index+1);
      mesh.setMatrixAt(index,item.matrix);mesh.geometry.attributes.forestInterval.setXY(index,lo,hi);
    }
    for(const mesh of lastLive)if(!counts.has(mesh)&&!mesh.userData.pool.frozen)setCount(mesh,0);
    for(const [mesh,count] of counts){
      setCount(mesh,count);mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.forestInterval.needsUpdate=true;
    }
    lastLive=new Set(counts.keys());
    stats.near=stats.lodCounts[0];stats.mid=stats.lodCounts[1]+stats.lodCounts[2];stats.far=stats.lodCounts[3];stats.culled=records.length-visible.length-frozenTrees;stats.selectionMs=performance.now()-start;
  }
  const rebake=kit=>{
    const next=kit.bake();kit.target.dispose();kit.target=next.target;
    kit.material.map=next.target.texture;kit.material.needsUpdate=true;
    if(kit.shadowCapture)kit.shadowCapture.map.value=next.target.texture;
    next.geometry.dispose();next.material.dispose();next.material.studioMaskMaterial?.dispose();
  };
  return {group,stats,distantShadowGroup,distantShadowBounds,update,updateShadowCasters,shadowCrowns,setQuality(quality){requestedBudgets=options.budgets??treeBudgetsForQuality(quality);stats.quality=quality;lastKey='';},invalidateShadows(){stats.shadowRevision++;lastKey='';},
    rebuildImpostors(direction){
      const key=lightKey();if(direction&&key===bakedLight)return;
      for(const kit of kits)rebake(kit);
      bakedLight=key;stats.shadowRevision++;lastKey='';},
    dispose(){for(const mesh of distantShadowGroup.children)mesh.geometry.dispose();distantShadowGroup.clear();for(const mesh of [...beautyMeshes,...batches.map(b=>b.proxy)])mesh.geometry.dispose();for(const g of bases)g.dispose();for(const m of materials)m.dispose();for(const kit of kits)kit.dispose();group.clear();}};
}

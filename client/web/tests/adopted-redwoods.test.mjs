import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as T from '../vendor/three.module.min.js';
import {parseGLB,makeMaterialFor} from '../src3d/glb.js';
import {buildRedwoodSprays,rasterSprayAtlas} from '../../../shared/geometry/tree-design/redwood-sprays.js';
import {fittedTreeGeometry,buildAdoptedRedwoods,retainedVillagePrimitive,releaseCrownSources} from '../src3d/redwood-rendering.js';
import {TREE_BUDGETS,preferredTreeLod,allocateTreeLods,treeTransitionDraws,treeBudgetsForQuality} from '../src3d/tree-budget.js';
import {setTreeLighting} from '../src3d/tree-surface.js';
import {style} from '../src3d/style.js';
import {buildPlacements} from '../src3d/placements.js';
const root=new URL('../../../',import.meta.url),plan=JSON.parse(readFileSync(new URL('shared/geometry/tree-design/adopted-redwoods.json',root)));
const read=path=>parseGLB(readFileSync(new URL('shared/geometry/'+path,root)));
const crowns=Object.fromEntries(plan.stages.map(s=>[s.asset,read(s.asset)]));
const bounds=primitives=>{const box=new T.Box3();for(const p of primitives)box.union(p.geometry.boundingBox.clone().applyMatrix4(p.local));return box;};

test('adoption binds the approved studio revision without changing any original silhouette source',()=>{
  assert.equal(plan.source.studioRevision,2349);
  assert.deepEqual(plan.stages.map(s=>s.representation),['mesh','mesh','lattice','multiview']);
  for(const [path,hash]of Object.entries(plan.silhouette.sourceSHA256)){
    assert.equal(createHash('sha256').update(readFileSync(new URL('shared/geometry/'+path,root))).digest('hex'),hash,path);
  }
  assert.equal(plan.targets['redwood/mountain_pine.glb'],'pine');assert.equal(plan.targets['redwood/silver_fir.glb'],'fir');
});
test('leaf cards retain normalized packed UVs and portable glTF alpha masks',()=>{
  for(const crown of Object.values(crowns)){
    assert.equal(crown.images.length,1);
    for(const p of crown.primitives){
      assert.ok(p.geometry.index.count>0,'no empty glTF accessors or primitives');
      const uv=p.geometry.attributes.uv;assert.ok(uv.normalized);assert.ok(uv.array instanceof Uint16Array);
      for(let i=0;i<uv.count;i++)assert.ok(uv.getX(i)>=0&&uv.getX(i)<=1&&uv.getY(i)>=0&&uv.getY(i)<=1,'packed UVs must decode into the atlas, not clamp to its transparent border');
      if(p.materialName.includes('spray')){
        assert.equal(p.alphaMode,'MASK');assert.equal(p.imageIndex,0);const m=makeMaterialFor(p);
        assert.equal(m.alphaTest,.3);assert.equal(m.transparent,false);assert.equal(m.depthWrite,true);assert.equal(m.alphaToCoverage,true);m.dispose();
      }
    }
  }
  assert.equal(plan.stages[1].asset,plan.stages[2].asset);assert.equal(plan.stages[1].asset,plan.stages[3].asset,'far captures reuse the same bough source');
});
test('every adopted wood and leaf vertex uses the original species palette without studio color overrides',()=>{
  for(const [path,type]of Object.entries(plan.targets)){
    const source=read(path),palette=source.primitives.filter(p=>/^(redwood|conifer)_bark$/.test(p.materialName)||/foliage/.test(p.materialName)).map(p=>p.baseColorFactor);
    for(const stage of plan.stages.slice(0,2)){
      const g=fittedTreeGeometry(source,crowns[stage.asset],stage,type==='village',plan.silhouette.taper,plan.silhouette.retainedBoleIndexCount),c=g.attributes.color;
      for(const id of new Set(g.index.array))assert.ok(palette.some(p=>[0,1,2].every(a=>Math.abs(c.getComponent(id,a)-p[a])<1e-7)),path+' source palette must remain exact');
      g.dispose();
    }
  }
});
test('the near hybrid and middle cards share one scaffold and physically porous needle contours',()=>{
  const a=buildRedwoodSprays(plan.geometryRecipe,0),b=buildRedwoodSprays(plan.geometryRecipe,1);
  assert.equal(a.structure.primaryBranches,b.structure.primaryBranches);assert.equal(a.structure.sprays,b.structure.sprays);
  assert.ok(a.leafKind.includes(1)&&a.leafKind.includes(2),'near leaves mix explicit blades and curved sprays');
  assert.ok(!b.leafKind.includes(1)&&b.leafKind.includes(2),'middle carriers keep the complete needle silhouette in alpha');
  assert.ok(b.structure.triangles<a.structure.triangles/6);
  const atlas=rasterSprayAtlas();let transparent=0,opaque=0;
  for(let i=3;i<atlas.pixels.length;i+=4){transparent+=atlas.pixels[i]===0;opaque+=atlas.pixels[i]>200;}
  assert.ok(transparent>atlas.width*atlas.height*.4&&opaque>atlas.width*atlas.height*.1,'actual needle gaps remain open instead of filling a bough hull');
});
test('all adopted species keep their original crown footprint, bare bole and height at every spatial LOD',()=>{
  for(const [path,type]of Object.entries(plan.targets)){
    const source=read(path),crown=bounds(source.primitives.filter(p=>/foliage/.test(p.materialName))),whole=bounds(source.primitives);
    const original=source.primitives.map(p=>p.geometry.attributes.position.array.slice());
    for(const lod of [0,1]){
      const stage=plan.stages[lod],g=fittedTreeGeometry(source,crowns[stage.asset],stage,type==='village',plan.silhouette.taper,plan.silhouette.retainedBoleIndexCount);
      const p=g.attributes.position,k=g.attributes.leafKind,seen=new T.Box3();
      for(let i=0;i<p.count;i++)if(k.getX(i)>.5)seen.expandByPoint(new T.Vector3(p.getX(i),p.getY(i),p.getZ(i)));
      // Leaves can be slightly inside a retained solid branch extremum; no
      // silhouette dimension or dwelling clearance is allowed to expand.
      for(let a=0;a<3;a++){
        assert.ok(seen.min.getComponent(a)>=crown.min.getComponent(a)-1e-4,path+' crown minimum');
        assert.ok(seen.max.getComponent(a)<=crown.max.getComponent(a)+1e-4,path+' crown maximum');
        assert.ok(seen.getSize(new T.Vector3()).getComponent(a)>crown.getSize(new T.Vector3()).getComponent(a)*.78,path+' crown size');
      }
      assert.ok(g.index,'retain indexed needle topology instead of expanding every triangle');
      assert.ok(g.boundingBox.max.y<=whole.max.y+.001,path+' tree height');g.dispose();
    }
    source.primitives.forEach((p,i)=>assert.deepEqual(p.geometry.attributes.position.array,original[i],path+' original geometry stays byte-identical'));
    if(type==='village'){
      const retained=source.primitives.filter(retainedVillagePrimitive);
      assert.ok(retained.some(p=>/bark/.test(p.materialName)),'occupied bole remains');
      assert.ok(retained.some(p=>!/bark/.test(p.materialName)),'dwellings, stairs and collars remain');
      assert.ok(retained.every(p=>!/foliage|branch_bark/.test(p.materialName)));
    }
  }
});
test('dense flights preserve every visible tree while bounding actual geometry, including both sides of transitions',()=>{
  const trees=Array.from({length:900},(_,id)=>({id,priority:1000-id,pixels:2000-id*1.8,clearance:id*.3,
    previous:-1,costs:[771000,106000,6500,2]}));
  for(const [now,factor]of [[0,1],[50,.6],[140,.3],[500,1.4],[700,.8],[1000,0]]){
    for(const tree of trees)tree.pixels=(2000-tree.id*1.8)*factor;
    const allocation=allocateTreeLods(trees),result=treeTransitionDraws(allocation,TREE_BUDGETS,now);
    assert.equal(allocation.result.length,trees.length,'no distance/population deletion');
    const actual=[0,0,0,0],coverage=new Map();
    for(const draw of result.draws){actual[draw.lod]+=draw.tree.costs[draw.lod];coverage.set(draw.tree.id,(coverage.get(draw.tree.id)??0)+draw.hi-draw.lo);}
    assert.deepEqual(result.used,actual,'reported costs count every submitted triangle, even fading geometry');
    for(let lod=0;lod<3;lod++)assert.ok(actual[lod]<=TREE_BUDGETS[lod],`LOD ${lod} cannot overspend`);
    for(const weight of coverage.values())assert.ok(Math.abs(weight-1)<1e-10,'complementary coverage one');
    assert.equal(coverage.size,trees.length);
  }
  assert.equal(preferredTreeLod(155,1),1,'hysteresis keeps a middle mesh at the edge');
});

test('village crown adoption leaves every occupied part, glass pane and placement transform in the ordinary renderer',()=>{
  const placement=JSON.parse(readFileSync(new URL('shared/world/out/placement.json',root))),instances=placement.instances.filter(i=>plan.targets[i.asset]==='village');
  const assets=Object.fromEntries([...new Set(instances.map(i=>i.asset))].map(path=>[path,read(path)]));
  const before=buildPlacements({instances},assets),after=buildPlacements({instances},assets,{crownAssets:new Set(Object.keys(plan.targets))});
  assert.equal(after.stats.instances,before.stats.instances);assert.equal(after.stats.parts,before.stats.parts);
  for(const mesh of after.group.children){
    const original=before.group.children.find(m=>m.name===mesh.name);assert.ok(original);assert.equal(mesh.count,original.count);
    assert.deepEqual(mesh.instanceMatrix.array,original.instanceMatrix.array,'occupied transforms remain byte-identical');
    if(mesh.name.endsWith(':glass'))assert.deepEqual(mesh.geometry.attributes.position.array,original.geometry.attributes.position.array,'all dwelling windows stay intact');
  }
  assert.ok(after.stats.sourceTriangles<before.stats.sourceTriangles,'generic placements do not draw a second crown');
});

test('adaptive tree quality reduces submitted geometry while retaining a full-detail priority tree and complete coverage',()=>{
  const trees=Array.from({length:180},(_,id)=>({id,priority:10000-id,pixels:1000-id*2,clearance:id,previous:-1,costs:[770848,105636,6472,2]}));
  let previous=Infinity;
  for(const quality of [1,.9,.8,.7,.65]){
    const budgets=treeBudgetsForQuality(quality),allocation=allocateTreeLods(trees,budgets);
    assert.equal(allocation.result[0].lod,0,'the priority tree keeps its approved full-detail mesh');
    const count=allocation.used.reduce((a,b)=>a+b);assert.ok(count<=previous);previous=count;
    assert.ok(allocation.used.every((cost,lod)=>lod===3||cost<=budgets[lod]));
    assert.equal(allocation.result.length,trees.length,'adaptive quality never removes an individual');
  }
});

const renderer={capabilities:{maxTextureSize:8192},autoClear:true,getRenderTarget:()=>null,getClearColor:c=>c.set(0),getClearAlpha:()=>1,
  getViewport:v=>v.set(0,0,1200,800),getScissor:v=>v.set(0,0,1200,800),getScissorTest:()=>false,getSize:v=>v.set(1200,800),
  setRenderTarget(){},setClearColor(){},setScissor(){},setViewport(){},setScissorTest(){},clear(){},render(){}};
test('the real four-stage path uses stable original shadow topology and updates after camera rotation',()=>{
  const path='redwood/giant_redwood.glb',assets={[path]:read(path),...crowns};
  const records=Array.from({length:25},(_,id)=>({id:String(id),asset:path,position_m:[(id%5)*18-36,Math.floor(id/5)*18,0],yaw_deg:id*23,scale:[1,1,1]}));
  const forest=buildAdoptedRedwoods({instances:records},assets,renderer,plan),camera=new T.PerspectiveCamera(62,1.5,.1,5000);
  camera.position.set(0,80,80);camera.lookAt(0,65,-40);camera.updateMatrixWorld();forest.update(camera,new T.Vector3(0,0,0));
  const costs=forest.stats.costsByAsset[path];assert.ok(costs[0]>costs[1]*4&&costs[1]>costs[2]*4&&costs[3]===2);
  const proxy=forest.group.children.find(m=>m.name.includes('core_shadow'));
  assert.ok(proxy.castShadow);assert.ok(proxy.geometry.attributes.position.count/3<costs[0]/10,'dense leaf mesh never enters depth pass');
  const revision=forest.stats.shadowRevision,first=forest.stats.lodCounts.reduce((a,b)=>a+b,0);assert.ok(first>0);
  camera.lookAt(0,80,400);camera.updateMatrixWorld();forest.update(camera,new T.Vector3(0,0,0));
  assert.ok(forest.stats.culled>0,'rotation culls trees without requiring translation');
  assert.equal(forest.stats.shadowRevision,revision,'beauty culling does not remove ground-shadow casters');
  assert.ok(forest.group.children.filter(m=>m.name.includes('lod')).every(m=>!m.castShadow));forest.dispose();
});


test('prototype release preserves fitted geometry, future rebakes and all original world assets',()=>{
  const path='redwood/giant_redwood.glb',original=read(path),assets={...crowns,[path]:original};
  const forest=buildAdoptedRedwoods({instances:[{id:'hero',asset:path,kind:'forest_tree',position_m:[0,0,0],yaw_deg:0,scale:[1,1,1]}]},assets,renderer,plan);
  const bytes=releaseCrownSources(assets,plan);assert(bytes>25000000);assert.equal(assets[path],original);assert(plan.stages.every(s=>!assets[s.asset]));
  assert(forest.group.children.some(m=>m.name.includes('lod0')&&m.geometry.index.count>1000000));
  const previous=style.sun.value.clone();style.sun.value.set(1,.5,0).normalize();forest.rebuildImpostors(style.sun.value);style.sun.value.copy(previous);forest.dispose();
});


test('changing only light color rebakes cached cards, while unchanged lighting reuses them',()=>{
  let draws=0;const counted={...renderer,render(){draws++;}},path='redwood/giant_redwood.glb';
  const forest=buildAdoptedRedwoods({instances:[{id:'hero',asset:path,kind:'forest_tree',position_m:[0,0,0],yaw_deg:0,scale:[1,1,1]}]}, {[path]:read(path),...crowns},counted,plan);
  const before=draws;setTreeLighting({sun:'#ffc18d',fill:'#9baccd',intensity:1.6,ambient:1.55});forest.rebuildImpostors(style.sun.value);assert(draws>before,'a color change at the same sun angle cannot retain stale captures');
  const after=draws;forest.rebuildImpostors(style.sun.value);assert.equal(draws,after);setTreeLighting();forest.dispose();
});

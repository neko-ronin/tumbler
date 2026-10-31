import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync,existsSync}from'node:fs';import{createHash}from'node:crypto';
import{parseGLB}from'../src3d/glb.js';
const url=p=>new URL('../../../'+p,import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const record=JSON.parse(readFileSync(url('shared/geometry/packed.json'))),manifest=JSON.parse(readFileSync(url('client/web/data/viewer.json')));

// tools/pack_meshopt.py writes each packed GLB and records it; check_packed.mjs compared it with its source then.
test('every packed GLB matches its record and reads through glb.js',()=>{
  for(const [source,entry] of Object.entries(record.assets)){
    const bytes=readFileSync(url('shared/geometry/'+entry.packed));
    assert.equal(sha(bytes),entry.sha256,`${entry.packed}: rerun tools/pack_meshopt.py ${source}`);
    assert.ok(parseGLB(bytes).primitives.length>0,`${entry.packed} has no geometry`);
  }
});

test('the client fetches the packed copy of every packed GLB it loads',()=>{
  const fetched=new Set(manifest.fetched.map(e=>e.path));
  for(const [source,entry] of Object.entries(record.assets)){
    assert.ok(!fetched.has('shared/geometry/'+source),`${source} is fetched unpacked: rerun make_viewer_data.py`);
    if(fetched.has('shared/geometry/'+entry.packed))assert.equal(manifest.packed['shared/geometry/'+source],'shared/geometry/'+entry.packed);
  }
});

// The sources stay in the private repository; where they are present, a changed one needs repacking.
test('no packed GLB is older than its source',()=>{
  for(const [source,entry] of Object.entries(record.assets)){
    const path=url('shared/geometry/'+source);
    if(existsSync(path))assert.equal(sha(readFileSync(path)),entry.source_sha256,`${source} changed: rerun tools/pack_meshopt.py ${source}`);
  }
});

// Packing gives each crown primitive its own vertex buffer where the source shares one;
// fittedTreeGeometry must build the same tree from either (it once lost the foliage).
test('packed tree crowns fit into the same trees as their sources',async()=>{
  const{fittedTreeGeometry}=await import('../src3d/redwood-rendering.js');
  const plan=JSON.parse(readFileSync(url('shared/geometry/tree-design/adopted-redwoods.json'))),load=p=>parseGLB(readFileSync(url('shared/geometry/'+p)));
  const summary=g=>{const leaf=g.attributes.leafKind,kinds=[0,0,0];for(let i=0;i<g.index.count;i++)kinds[leaf.getX(g.index.getX(i))]++;g.computeBoundingBox();return{kinds,size:g.boundingBox.getSize(g.boundingBox.min.clone()).toArray()};};
  for(const stage of plan.stages){
    const entry=record.assets[stage.asset];if(!entry||!existsSync(url('shared/geometry/'+stage.asset)))continue;
    const source=load(Object.keys(plan.targets)[0]),fitted=crown=>summary(fittedTreeGeometry(source,crown,stage,false,plan.silhouette.taper));
    const a=fitted(load(stage.asset)),b=fitted(load(entry.packed));
    assert.deepEqual(b.kinds,a.kinds,`${stage.asset}: foliage triangles changed`);
    for(let i=0;i<3;i++)assert.ok(Math.abs(a.size[i]-b.size[i])<.01,`${stage.asset}: fitted size changed`);
  }
});

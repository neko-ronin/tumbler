import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Vector3, Matrix4, Texture } from '../vendor/three.module.min.js';
import { buildTerrainGeometry, buildWater, buildRiverReaches } from '../src3d/terrain.js';
import { HeightGrid } from '../src3d/heights.js';
import { parseGLB, applyImageBytes, mergePrimitives } from '../src3d/glb.js';
const repo = new URL('../../../', import.meta.url);
const read = p => readFileSync(new URL(p, repo));

test('all terrain faces face their supplied normals, including one-sided rim gradients', () => {
  const grid = new HeightGrid({ values: new Float32Array([0,1,2, 2,3,4, 4,5,6]), resolution: 3, quad_size_m: 1, offset_xy_m: [0,0], row_0: 'min_y' });
  const { geometry } = buildTerrainGeometry(grid);
  const p=geometry.attributes.position, normals=geometry.attributes.normal;
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),n=new Vector3();
  for(let i=0;i<geometry.index.count;i+=3){
    const indices=[0,1,2].map(j=>geometry.index.getX(i+j));
    a.fromBufferAttribute(p,indices[0]);b.fromBufferAttribute(p,indices[1]);c.fromBufferAttribute(p,indices[2]);
    n.crossVectors(b.sub(a),c.sub(a)).normalize();
    assert.ok(n.y>0,'terrain is visible from above');
    for(const index of indices) assert.ok(n.dot(new Vector3().fromBufferAttribute(normals,index))>.9999,'rim and interior normals agree with faces');
  }
});

test('world-space water draws the union of named parts exactly once', () => {
  const placement=JSON.parse(read('shared/world/out/placement.json'));
  const water=placement.instances.filter(i=>i.kind==='river'||i.kind==='lake');
  const asset=parseGLB(read('shared/geometry/water/water.glb'));
  const group=buildWater(water,{'water/water.glb':asset});
  assert.deepEqual(group.children.map(m=>m.name).sort(),['lake','river']);
  for(const mesh of group.children) assert.ok(mesh.matrix.equals(new Matrix4()),'water gets no duplicate height translation');
  assert.equal(buildWater([...water,...water],{'water/water.glb':asset}).children.length,2,'duplicate records cannot duplicate world-space water');
});

test('embedded images resolve by image index, and their texture survives instancing', async () => {
  const asset=parseGLB(read('shared/geometry/blimp/blimp.glb'));
  const texture=new Texture();
  await applyImageBytes(asset,async()=>texture);
  const textured=asset.primitives.filter(p=>p.imageIndex!==null);
  assert.ok(textured.length>0);
  for(const primitive of textured){
    assert.equal(primitive.texture,texture,'image index is not the GLB bufferView index');
    const merged=mergePrimitives([primitive],primitive.alphaMode==='BLEND'?'glass':'opaque');
    assert.equal(merged.material.map,texture,'batched material keeps the embedded texture');
    assert.equal(merged.material.color.r,primitive.baseColorFactor[0]);
  }
});


test('dome glass keeps authored transparency after batching', () => {
  const asset=parseGLB(read('shared/geometry/dome/dome.glb'));
  const glass=mergePrimitives(asset.primitives,'glass');
  assert.ok(glass);
  const colors=glass.geometry.attributes.color;
  assert.equal(colors.itemSize,4);
  assert.ok(Array.from({length:colors.count},(_,i)=>colors.getW(i)).every(a=>a>0 && a<1),'glass must transmit light rather than becoming an opaque shell');
});

test('the river beyond the block lies on far-field ground the core lowered for it', () => {
  const worldmap = JSON.parse(read('shared/world/worldmap.json'));
  const manifest = JSON.parse(read('client/web/data/viewer.json'));
  const far = new HeightGrid({ values: new Float32Array(new Uint8Array(read('client/web/data/farfield.f32')).buffer), ...manifest.height_grids.far_field, kind: 'far field' });
  const reaches = buildRiverReaches(worldmap, far);
  const river = worldmap.water.bodies.find(b => b.kind === 'river');
  assert.equal(reaches.children.length, 2, 'one ribbon upstream, one downstream');
  for (const ribbon of reaches.children) {
    const p = ribbon.geometry.attributes.position;
    // Each row is a left/right pair; its midpoint is the reach centreline.
    const start = [(p.getX(0) + p.getX(1)) / 2, p.getY(0), -(p.getZ(0) + p.getZ(1)) / 2];
    assert.ok(river.polyline.some(([x, y]) => Math.hypot(x - start[0], y - start[2]) < 1e-3), 'a reach starts where the block river ends');
    assert.equal(start[1], river.surface_z_m);
    for (let row = 0; row < p.count; row += 2) {
      const x = (p.getX(row) + p.getX(row + 1)) / 2, y = -(p.getZ(row) + p.getZ(row + 1)) / 2;
      if (Math.max(Math.abs(x), Math.abs(y)) < far.maxX / 2 + 112) continue;
      assert.ok(far.sample(x, y) < p.getY(row) - 1, `${ribbon.name} at ${x.toFixed(0)}, ${y.toFixed(0)} floats over its ground`);
    }
  }
});

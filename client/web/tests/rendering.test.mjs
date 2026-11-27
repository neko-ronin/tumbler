import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Vector3, Matrix4, Texture } from '../vendor/three.module.min.js';
import { buildTerrainGeometry, buildWater, buildWaterBodies, joinedRiver } from '../src3d/terrain.js';
import { HeightGrid } from '../src3d/heights.js';
import { parseGLB, applyImageBytes, mergePrimitives } from '../src3d/glb.js';
import { buildTethers } from '../src3d/details.js';
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

test('the river is one ribbon from source to mouth, and beyond the block it lies on far-field ground the core lowered for it', () => {
  const worldmap = JSON.parse(read('shared/world/worldmap.json'));
  const manifest = JSON.parse(read('client/web/data/viewer.json'));
  const far = new HeightGrid({ values: new Float32Array(new Uint8Array(read('client/web/data/farfield.f32')).buffer), ...manifest.height_grids.far_field, kind: 'far field' });
  const meshes = buildWaterBodies(worldmap);
  assert.deepEqual(meshes.map(m => m.name).sort(), ['lake', 'river'], 'no separate reach pieces to meet at the block edge');
  const {line} = joinedRiver(worldmap), block = worldmap.water.bodies.find(b => b.kind === 'river').polyline_xyz_m;
  const reaches = worldmap.mountains.enclosure.river_reaches;
  assert.equal(line.length, block.length + reaches.reduce((n, r) => n + r.polyline_xyz_m.length - 1, 0), 'each joint point appears once');
  const p = meshes.find(m => m.name === 'river').geometry.attributes.position;
  // Each row is a left/right pair; its midpoint is the centreline.
  const first = [(p.getX(0) + p.getX(1)) / 2, -(p.getZ(0) + p.getZ(1)) / 2], last = p.count - 2;
  assert.ok(Math.hypot(first[0] - line[0][0], first[1] - line[0][1]) < 1e-3 && Math.abs(p.getY(0) - line[0][2]) < 1e-3, 'it starts at the upstream reach\'s source');
  assert.ok(Math.hypot((p.getX(last) + p.getX(last + 1)) / 2 - line.at(-1)[0], -(p.getZ(last) + p.getZ(last + 1)) / 2 - line.at(-1)[1]) < 1e-3, 'and ends at the downstream reach\'s mouth');
  for (let row = 0; row < p.count; row += 2) {
    const x = (p.getX(row) + p.getX(row + 1)) / 2, y = -(p.getZ(row) + p.getZ(row + 1)) / 2;
    if (Math.max(Math.abs(x), Math.abs(y)) < far.maxX / 2 + 112) continue;
    assert.ok(far.sample(x, y) < p.getY(row) - 1, `river at ${x.toFixed(0)}, ${y.toFixed(0)} floats over its ground`);
  }
});

test('the river ends at its bank and does not spill over low ground behind it', () => {
  const worldmap = JSON.parse(read('shared/world/worldmap.json'));
  const manifest = JSON.parse(read('client/web/data/viewer.json'));
  const far = new HeightGrid({ values: new Float32Array(new Uint8Array(read('client/web/data/farfield.f32')).buffer), ...manifest.height_grids.far_field, kind: 'far field' });
  const river = buildWaterBodies(worldmap, far).find(m => m.name === 'river');
  const p = river.geometry.attributes.position, across = river.geometry.attributes.channel;
  let checked = 0;
  for (let row = 0; row < p.count; row += 2) {
    // The two sides may end at different distances; each vertex's channel.y is its own (signed) distance out.
    const f = Math.abs(across.getY(row)) / (Math.abs(across.getY(row)) + Math.abs(across.getY(row + 1)));
    const cx = p.getX(row) + (p.getX(row + 1) - p.getX(row)) * f, cy = -(p.getZ(row) + (p.getZ(row + 1) - p.getZ(row)) * f), z = p.getY(row);
    if (Math.abs(cx) < 2100 && Math.abs(cy) < 2100) continue; // the block's own ground is not this grid
    for (const v of [row, row + 1]) {
      const ex = p.getX(v), ey = -p.getZ(v), length = Math.hypot(ex - cx, ey - cy);
      // From the first ground over the surface outward, at most 6 m more water (the tuck under the bank).
      for (let d = 2; d < length; d += 2) if (far.sample(cx + (ex - cx) * d / length, cy + (ey - cy) * d / length) >= z) {
        assert.ok(length <= d + 6 + .05, `river at ${cx.toFixed(0)}, ${cy.toFixed(0)} runs ${(length - d).toFixed(0)} m past its bank`); checked++; break;
      }
    }
  }
  assert.ok(checked > 100, 'banks found along the reaches');
});

test('the terrain\'s water level reaches past the block: a reach\'s banks read that reach\'s own surface', async () => {
  const { style } = await import('../src3d/style.js');
  const { DataUtils } = await import('../vendor/three.module.min.js');
  const worldmap = JSON.parse(read('shared/world/worldmap.json'));
  const manifest = JSON.parse(read('client/web/data/viewer.json'));
  const far = new HeightGrid({ values: new Float32Array(new Uint8Array(read('client/web/data/farfield.f32')).buffer), ...manifest.height_grids.far_field, kind: 'far field' });
  const started = performance.now();
  buildWaterBodies(worldmap, far);
  const built = performance.now() - started;
  const { image: { data, width } } = style.waterLevel.value, [x0, y0, span] = style.waterLevelGrid.value.toArray();
  const at = (x, y) => { const k = (Math.floor((y - y0) / span * width) * width + Math.floor((x - x0) / span * width)) * 2; return [DataUtils.fromHalfFloat(data[k]), DataUtils.fromHalfFloat(data[k + 1])]; };
  const reaches = Object.fromEntries(worldmap.mountains.enclosure.river_reaches.map(r => [r.id, r.polyline_xyz_m]));
  for (const [id, k] of [['upstream', 20], ['upstream', 120], ['downstream', 40]]) {
    const [x, y, z] = reaches[id][k], [level, edge] = at(x, y);
    assert.ok(Math.abs(level - z) < .5 && edge < 30, `${id} point ${k} at ${x.toFixed(0)}, ${y.toFixed(0)}: level ${level} for water at ${z}, ${edge} m from it`);
  }
  assert.ok(built < 3000, `water built in ${built.toFixed(0)} ms`);
});

test('each tether runs from its mast top, up and against the wind, to the underside of the drawn head', () => {
  const placement=JSON.parse(read('shared/world/out/placement.json')),worldmap=JSON.parse(read('shared/world/worldmap.json'));
  const blimp=parseGLB(read('shared/geometry/blimp/blimp.glb'));
  const position=buildTethers(placement,{'blimp/blimp.glb':blimp}).geometry.attributes.position;
  const hulls=placement.instances.filter(i=>i.kind==='blimp'&&i.tags.includes('flying'));
  assert.ok(hulls.length>2);assert.equal(position.count,2*hulls.length);
  const declared=Object.fromEntries(worldmap.blimps.map(b=>[b.id,b])),house=worldmap.activities.house_blimps;
  // The wind blows toward the opposite of its bearing; in the scene north is -z.
  const from=worldmap.wind.direction_deg*Math.PI/180,upwind=new Vector3(Math.sin(from),0,-Math.cos(from));
  hulls.forEach((hull,i)=>{
    const top=new Vector3().fromBufferAttribute(position,2*i),end=new Vector3().fromBufferAttribute(position,2*i+1);
    const config=declared[hull.tags[0]]??house,s=hull.scale[0],[x,y,z]=hull.position_m,centre=new Vector3(x,z,-y);
    assert.ok(Math.abs(top.distanceTo(end)-config.tether_m)<1e-3,`${hull.tags[0]}: tether ${top.distanceTo(end)} m, declared ${config.tether_m}`);
    const lead=end.clone().sub(top);
    assert.ok(Math.abs(lead.y-config.tether_m*Math.sin(config.tether_elevation_deg*Math.PI/180))<1e-3,'the tether rises at its declared elevation');
    assert.ok(lead.setY(0).normalize().dot(upwind)<-.9999,'the hull is pushed downwind: the line leads up and away from the wind');
    // The drawn end hangs under the hull and ahead of its centre, into the wind: the head's underside.
    const offset=end.clone().sub(centre);
    assert.ok(offset.y<-20*s,`${hull.tags[0]}: the tether meets the hull ${offset.y.toFixed(2)} m from its axis, not underneath`);
    assert.ok(offset.clone().setY(0).dot(upwind)>13*s,`${hull.tags[0]}: the tether meets the hull ${offset.clone().setY(0).dot(upwind).toFixed(2)} m upwind of its centre, not at its head`);
  });
});

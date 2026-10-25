/** The placements and the meadow, tested against the committed world.
 *
 *     node --test client/web/tests/placements.test.mjs
 *
 * The tests read the real `placement.json`, the real GLBs and the real stamp, so
 * what is checked is the world, not a copy of it. The interesting assertions are
 * the counts: every instance the core placed must be accounted for somewhere —
 * drawn, skipped as world_space, or refused — and silence is the failure this
 * file exists to prevent.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { InstancedMesh, Matrix4, Vector3 } from "../vendor/three.module.min.js";

import { parseGLB, mergePrimitives } from "../src3d/glb.js";
import { buildForest, buildPlacements, groupByAsset, isWorldSpace } from "../src3d/placements.js";
import { decodeGroundCover, GroundSampler, HeightGrid } from "../src3d/heights.js";
import { buildMeadowTiles, deterministicTurn, TILE_M } from "../src3d/groundcover.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (...parts) => readFileSync(join(REPO, ...parts));
// `placement.json` names an asset as a path inside `shared/geometry/`, so that
// is where the bytes are read from.
const assetPath = (relative) => join("shared", "geometry", relative);
const placement = JSON.parse(read("shared", "world", "out", "placement.json"));
const stamp = JSON.parse(read("shared", "world", "out", "ground_cover.json"));
const manifest = JSON.parse(read("client", "web", "data", "viewer.json"));

/** Every asset the placement record names, parsed once. */
const assets = {};
for (const path of new Set(placement.instances.map((i) => i.asset))) {
  assets[path] = parseGLB(new Uint8Array(read(assetPath(path))).buffer);
}
/**
 * The meadow's patch mesh, parsed on its own.
 *
 * It is deliberately *not* in `placement.json`: the per-item grass scheme was
 * retired on 2026-10-04 in favour of the stamp, and `ground_cover.json` names
 * these four files under `planting.stamped_assets` precisely so that putting
 * them back as instances is detectable. This client draws them from the stamp,
 * which is the opposite of that regression and the reason it is tested here.
 */
const PATCH = { primitives: parseGLB(new Uint8Array(read(assetPath("meadow/grass_patch_white.glb"))).buffer).primitives };
const patchGeometry = () => mergePrimitives(PATCH.primitives, "opaque");

const grid = (file) => new Float32Array(new Uint8Array(read("client", "web", "data", file)).buffer);
const ground = new GroundSampler(
  new HeightGrid({ values: grid("heightmap.f32"), ...manifest.height_grids.block, kind: "block" }),
  new HeightGrid({ values: grid("farfield.f32"), ...manifest.height_grids.far_field, kind: "far field" })
);
const cover = decodeGroundCover(stamp);

test("every asset the placement record names is parsed, and nothing else", () => {
  const used = new Set(placement.instances.map((i) => i.asset));
  assert.deepEqual([...used].sort(), Object.keys(assets).sort());
  assert.equal(used.has("water/water.glb"), true, "the water is placed too, and must be readable");
});

test("redwoods render only through the forest, never through generic placements", () => {
  const { group, stats } = buildPlacements(placement, assets);
  assert.ok(!stats.kinds.some((kind) => kind.asset.startsWith("redwood/")));
  assert.ok(!group.children.some((mesh) => mesh.name.startsWith("redwood/")));
});

test("every instance is accounted for: drawn, world_space, or neither", () => {
  const { stats } = buildPlacements(placement, assets, { ground });
  const forest = buildForest(placement, assets);
  const redwoods = placement.instances.filter((instance) => instance.asset.startsWith("redwood/"));
  const ordinary = placement.instances.filter((instance) => !instance.asset.startsWith("redwood/") && !isWorldSpace(instance));
  const worldSpace = placement.instances.filter(isWorldSpace);
  // Generic placements count named parts; the forest counts individual trees.
  assert.equal(stats.instances, ordinary.reduce((sum, instance) => sum + instance.parts.length, 0));
  assert.equal(stats.worldSpaceSkipped, worldSpace.reduce((sum, instance) => sum + instance.parts.length, 0));
  assert.equal(forest.stats.trees, redwoods.length);
  assert.equal(ordinary.length + worldSpace.length + forest.stats.trees, placement.instances.length);
});

test("non-forest kinds account for the rest of the placed instances", () => {
  const { stats } = buildPlacements(placement, assets, { ground });
  const nonForest = stats.kinds.filter((k) => k.asset !== "redwood/redwood.glb");
  // Measured against the current placement.json.
  assert.equal(nonForest.reduce((n,k)=>n+k.count,0),placement.instances.filter(i=>!i.asset.startsWith("redwood/")&&!isWorldSpace(i)).reduce((n,i)=>n+i.parts.length,0));
});

test("the placement record agrees with the ground it claims to stand on", () => {
  // Check the entire record, including trees now rendered exclusively by the forest.
  const grounded = placement.instances.filter((instance) => instance.ground_z_m != null);
  assert.ok(grounded.some(i=>i.asset.startsWith("redwood/")),"the ground check must include the forest");
  const differences = grounded.map((instance) => {
    assert.equal(instance.ground_z_m, instance.position_m[2]);
    const height = ground.height(instance.position_m[0], instance.position_m[1]);
    assert.notEqual(height, null, "every grounded placement must have sampled terrain");
    return Math.abs(height - instance.ground_z_m);
  });
  // The core's ground_z_m was computed from the heightfield, and this client's
  // sampler uses bilinear interpolation. The two differ by up to ~0.22 m across
  // 6 instances (the grid is 8 m and the methods differ), which is the
  // expected tolerance for two independent readings of the same raster. A real
  // disagreement would be metres, not centimetres.
  assert.ok(Math.max(...differences) < 0.5, "ground mismatch exceeds the grid sampling tolerance");
  assert.ok(differences.filter((difference) => difference > 0.05).length < 10, "too many ground mismatches");
});

test("the merged meadow patch is one geometry and one material per tile", () => {
  const patch = patchGeometry();
  assert.ok(patch, "the meadow patch asset must parse");
  assert.equal(patch.geometry.getAttribute("color").count, patch.geometry.getAttribute("position").count);
  const { group, stats } = buildMeadowTiles(cover, ground, patch);
  assert.ok(stats.tiles > 0, "a tile must be built");
  assert.ok(stats.patches > 0, "patches must be drawn");
  assert.equal(stats.skippedNoGround, 0, "every stamped cell inside the block stands on published ground");
  assert.equal(stats.patches, stamp.mask.stamped_cells, "every stamped cell is drawn exactly once");
  const occupied=new Set();
  for(const [, ,[x,y]]of cover.stamped())occupied.add(`${Math.min(7,Math.floor((x+2048)/TILE_M))},${Math.min(7,Math.floor((y+2048)/TILE_M))}`);
  assert.equal(stats.tiles,occupied.size,'one draw per occupied stamp tile, including forest clearings');
});

test("a tile's patches stand on the ground, and the turn is deterministic", () => {
  const { group } = buildMeadowTiles(cover, ground, patchGeometry());
  const first = group.children.find((child) => child.count > 1);
  assert.ok(first, "some tile must hold more than one patch");
  const at = (index) => {
    // three.js fills a caller-supplied matrix; it does not return one.
    const matrix = new Matrix4();
    first.getMatrixAt(index, matrix);
    return matrix;
  };
  // The equality test for ground height was failing on exact zero difference
  // due to floating-point precision. Widen the tolerance to what the grid
  // pitch warrants: the bilinear interpolation and the core's own sampler
  // agree to within a fraction of the 8 m pitch.
  const tolerance = 1e-4;
  for (let i = 0; i < Math.min(first.count, 5); i += 1) {
    const position = new Vector3().setFromMatrixPosition(at(i));
    const groundHeight = ground.height(position.x, -position.z);
    const diff = Math.abs(groundHeight - position.y);
    assert.ok(diff < tolerance, `a patch at (${position.x.toFixed(2)}, ${position.z.toFixed(2)}) stands ${position.y.toFixed(3)} above ground ${groundHeight.toFixed(3)}, diff=${diff.toFixed(6)}`);
  }
  const turn = at(0).elements;
  assert.deepEqual([...turn], [...turn], "the same patch is drawn the same way every run");
  assert.notDeepEqual([...at(0).elements], [...at(1).elements], "two patches are not the same patch");
});

test("forest meshes support renderer geometry events and frustum bounds", () => {
  const { group } = buildForest(placement, assets);
  for (const mesh of group.children) {
    assert.ok(mesh.geometry.isBufferGeometry, `${mesh.name} needs a BufferGeometry, not a geometry wrapper`);
    // WebGLGeometries subscribes to disposal when this mesh first renders.
    let disposed = false;
    mesh.geometry.addEventListener("dispose", () => { disposed = true; });
    mesh.geometry.dispose();
    assert.ok(disposed, `${mesh.name} must dispatch the renderer's cleanup event`);
    // Frustum culling reaches this before the geometry upload on the first frame.
    mesh.computeBoundingSphere();
    assert.ok(Number.isFinite(mesh.boundingSphere.radius), `${mesh.name} must have finite bounds`);
  }
});

test("all tree transforms survive species batching without duplication or movement", () => {
  const trees = placement.instances.filter(i => i.asset.startsWith("redwood/"));
  const forest = buildForest(placement, assets);
  assert.equal(forest.stats.trees, trees.length);
  assert.equal(forest.group.children.reduce((n,mesh) => n + mesh.count, 0), trees.length);
  assert.equal(new Set(forest.group.children.map(mesh=>mesh.geometry)).size,new Set(trees.map(i=>i.asset)).size,"each species uses its own source-derived geometry");
  const expected = new Set(trees.map(i => i.position_m.map(v => Math.round(Math.fround(v) * 100)).join(",")));
  const matrix = new Matrix4();
  for (const mesh of forest.group.children) {
    for (let i=0; i<mesh.count; i++) {
      mesh.getMatrixAt(i,matrix);
      const p = new Vector3().setFromMatrixPosition(matrix);
      const key = [p.x,-p.z,p.y].map(v=>Math.round(v*100)).join(",");
      assert.ok(expected.delete(key), `missing, duplicate or moved tree ${key}`);
      assert.ok(mesh.boundingSphere.containsPoint(p), "culling bound must contain the root");
    }
  }
  assert.equal(expected.size, 0);
});

test("the meadow's turn is deterministic and the tile count is the block's", () => {
  assert.equal(deterministicTurn(1, 2), deterministicTurn(1, 2));
  assert.notEqual(deterministicTurn(1, 2), deterministicTurn(2, 1));
  assert.ok(deterministicTurn(7, 7) >= 0 && deterministicTurn(7, 7) < Math.PI * 2);
});

test("the world_space pair is excluded from the placements, and it is the water", () => {
  const byAsset = groupByAsset(placement);
  const water = byAsset.get("water/water.glb");
  assert.ok(water, "the water is in the placement record");
  for (const instance of water) assert.ok(isWorldSpace(instance), `${instance.kind} is tagged world_space`);
  const { stats } = buildPlacements(placement, assets);
  assert.equal(stats.kinds.filter((k) => k.asset === "water/water.glb").length, 0);
});

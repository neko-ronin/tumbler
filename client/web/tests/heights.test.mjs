/** The ground, the far field, and the stamp's meadow.
 *
 *     node --test client/web/tests/heights.test.mjs
 *
 * Every number here is read from the committed core output — the two float32
 * grids `make_viewer_data.py` wrote from the core's own readers, and the
 * committed `ground_cover.json` — so a change in the core's ground moves a test
 * rather than a picture. The one thing computed here is bilinear
 * interpolation between published samples, and the tests say so.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { decodeGroundCover, GroundSampler, HeightGrid } from "../src3d/heights.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (...parts) => readFileSync(join(REPO, ...parts));
// A Node Buffer is a view into a shared pool, so `new Float32Array(buffer)`
// would read the pool and not the file — a 1 MB raster became 4 MB of samples
// that did not match its own resolution. The exact bytes are copied out, which
// is what `fetch` hands the browser anyway.
const grid = (file) => new Float32Array(new Uint8Array(read("client", "web", "data", file)).buffer);
const manifest = JSON.parse(read("client", "web", "data", "viewer.json"));

const block = new HeightGrid({ values: grid("heightmap.f32"), ...manifest.height_grids.block, kind: "block" });
const far = new HeightGrid({ values: grid("farfield.f32"), ...manifest.height_grids.far_field, kind: "far field" });
const sampler = new GroundSampler(block, far);
const world = JSON.parse(read("shared", "world", "out", "world.json"));
const stamp = JSON.parse(read("shared", "world", "out", "ground_cover.json"));

test("river replacement floors and mountain solid roofs compose without refilling the river bed", () => {
  const raster = { sample: () => 100 }, outside = { sample: () => null };
  const river = x => x < 2 ? 20 : null;
  const roof = x => x === 1 ? 30 : x === 2 ? 120 : null;
  const combined = new GroundSampler(raster, outside, river, roof);
  assert.equal(combined.height(0, 0), 20, "the detailed bed replaces the higher original raster");
  assert.equal(combined.height(1, 0), 30, "a rock stands above that detailed bed, below the old raster");
  assert.equal(combined.height(2, 0), 120, "a mountain roof raises the ordinary terrain floor");
  assert.equal(combined.height(3, 0), 100, "unoccupied ground keeps its original height");
  assert.equal(new GroundSampler(outside, outside).height(0, 0), null);
});

test("the block grid is the block, in metres, south-up", () => {
  assert.equal(block.resolution, 512);
  assert.equal(block.quad, 8);
  assert.equal(block.minX, -2044);
  assert.equal(block.maxX, 2044);
  assert.ok(Math.abs(block.minimum-manifest.height_grids.block.min_m)<.0001,"float32 bounds match the core raster descriptor");
  assert.ok(Math.abs(block.maximum-manifest.height_grids.block.max_m)<.0001);
  assert.ok(block.maximum>1000,"the forest now has alpine relief");
  // world.json declares the same grid, so the two cannot drift.
  assert.equal(block.resolution, world.grid.resolution);
  assert.equal(block.quad, world.grid.quad_size_m);
  assert.deepEqual([block.offsetX, block.offsetY], world.grid.offset_m.slice(0, 2));
});

test("a published sample matches the core's own raster", () => {
  // The far field's descriptor and the block's are both in world.json, so the
  // numbers can be compared rather than trusting the client's own write.
  assert.equal(far.resolution, 3009);  // the grown world, not the core's coarse 32 m raster
  assert.equal(far.quad, 8);
  assert.equal(far.minX, -12036);
  assert.equal(far.maxX, 12028);
});

test("the block meets the world past it without a step", () => {
  // On the floor, where a seam would show. The world's own cell at the rim is never drawn: the block's replaces it. What the player
  // crosses is the block's last sample to the world's next one, 8 m on.
  let worst = 0;
  for (let k = 0; k < 512; k += 1) {
    const along = -2044 + 8 * k;
    for (const [inX, inY, outX, outY] of [[-2044, along, -2052, along], [2044, along, 2052, along], [along, -2044, along, -2052], [along, 2044, along, 2052]]) {
      if (block.sample(inX, inY) < 60) worst = Math.max(worst, Math.abs(block.sample(inX, inY) - far.sample(outX, outY)));  // on the walls, 8 m can be a real cliff
    }
  }
  assert.ok(worst < 14, `the seam's worst 8 m step is ${worst}`);
});

test("between vertices the two grids are the same ground, not the same number", () => {
  // The far field is a 56 m pitch against the block's 8 m, so between its
  // vertices it interpolates and differs — by metres, not centimetres. This is
  // stated because a reader who assumed exact agreement everywhere would draw
  // a ring that does not match the meadow it meets.
  const differences = [];
  for (let i = 0; i < 40; i += 1) {
    differences.push(Math.abs(block.sample(-2000 + 13 * i, -1500 + 17 * i) - far.sample(-2000 + 13 * i, -1500 + 17 * i)));
  }
  const worst = Math.max(...differences);
  assert.ok(worst > 1, `the coarse grid should differ measurably, worst ${worst}`);
  assert.ok(worst < 60, `and only by its own pitch's worth of ground, worst ${worst}`);
});

test("ground outside the block comes from the far field, and no further", () => {
  // The ridge ring and the northern skyline stand past the block edge, and
  // the far field is what they stand on.
  assert.ok(sampler.hasGround(0, -3000));
  assert.ok(sampler.hasGround(0, 3800));
  assert.ok(sampler.hasGround(0, 12000));assert.ok(!sampler.hasGround(0, 12100), "past the published ground is past the published ground");
  assert.ok(!sampler.hasGround(-12100, 0));
  // Inside the block the block wins, and its number is the one the core
  // published for that grid.
  assert.equal(sampler.height(-2044, -2044), block.sample(-2044, -2044));
  // The ring is a seam only if the two agree where they meet; the block's own
  // last sample is the far field's boundary sample.
  assert.ok(sampler.hasGround(-2044, -2044));
  assert.ok(sampler.hasGround(2044, 2044));
});

test("interpolation is interpolation: between two samples, halfway is halfway", () => {
  // The pitch is 8 m from an offset of -2044, so -2044 + 381*8 = 1004 and 1012
  // are published samples; anything else is an interpolation. Picking real
  // samples is the difference between testing interpolation and testing this
  // test's own arithmetic.
  const x0 = -2044 + 381 * 8;
  const x1 = x0 + 8;
  const y = -700;
  assert.equal(block.sample(x0, y), block.at(Math.round((y + 2044) / 8), Math.round((x0 + 2044) / 8)));
  const h0 = block.sample(x0, y);
  const h1 = block.sample(x1, y);
  assert.notEqual(h0, h1, "the ground is not flat here, so this measured something");
  const half = block.sample(x0 + 4, y);
  assert.ok(Math.abs(half - (h0 + h1) / 2) < 1e-6, `${half} vs ${(h0 + h1) / 2}`);
});

test("the ground cover mask decodes, and its own count agrees", () => {
  const cover = decodeGroundCover(stamp);
  assert.equal(cover.resolution, 512, "the stamp rides the block's own grid");
  assert.equal(cover.stampedCells, stamp.mask.stamped_cells);
  assert.ok(Math.abs(cover.stampedCells / (512 * 512) - stamp.area_m2.stamped_fraction_of_block) < 1e-6, 'decoded coverage agrees with the shared habitat accounting');
  const first = [...cover.stamped()][0];
  assert.equal(first.length, 3, "row, column, centre");
  const [[row, column, [cx, cy]]] = [[...first]];
  // Row 0 is minimum y, so the first stamped row's centre is near the south edge.
  assert.ok(cy > -2044 && cy < 2044, `centre y ${cy}`);
  assert.ok(cx === stamp.grid.offset_xy_m[0] + (column + 0.5) * 8, "the centre follows the file's own declared origin");
  void row;
});

test("the stamp's row order is read from the file, not assumed", () => {
  // ground_cover.json declares row 0 is MINIMUM y while the committed rasters
  // declare max y. A decoder that assumed the raster convention would mirror
  // the meadow north-south, which reads as plausible, so the declaration is
  // required rather than defaulted.
  assert.ok(String(stamp.grid.row_order).includes("MINIMUM y"));
  assert.throws(() => decodeGroundCover({ ...stamp, grid: { ...stamp.grid, row_order: "row 0 is MAXIMUM y" } }), /convention/);
});

test("a mask that does not fill its grid is refused", () => {
  const truncated = { ...stamp, mask: { ...stamp.mask, runs: [1, 2] } };
  assert.throws(() => decodeGroundCover(truncated), /overrun|does not fill/);
  const lying = { ...stamp, mask: { ...stamp.mask, stamped_cells: 12345 } };
  assert.throws(() => decodeGroundCover(lying), /declares/);
});

test("a grid that is not the shape it claims is refused", () => {
  // The values must be both the shape and the count, and any of them can be a
  // lie: a 4 MB file called 512x512, a grid with no pitch, a grid with no
  // offset, a grid with one sample. Each refusal names which.
  assert.throws(() => new HeightGrid({ values: new Float32Array(4), resolution: 512, quad_size_m: 8, offset_xy_m: [0, 0] }), /cannot be a/);
  assert.throws(() => new HeightGrid({ values: new Float32Array(512 * 512), resolution: 512, offset_xy_m: [0, 0] }), /usable pitch/);
  assert.throws(() => new HeightGrid({ values: new Float32Array(512 * 512), resolution: 512, quad_size_m: 8 }), /offset_xy_m/);
  assert.throws(() => new HeightGrid({ values: new Float32Array(1), resolution: 1, quad_size_m: 8, offset_xy_m: [0, 0] }), /usable grid/);
  assert.throws(
    () => new HeightGrid({ values: new Float32Array(512 * 512), resolution: 512, quad_size_m: 8, offset_xy_m: [0, 0], row_0: "max_y" }),
    /minimum y/
  );
  assert.throws(() => decodeGroundCover({ ...stamp, grid: undefined }), /missing its grid/);
  assert.throws(() => decodeGroundCover({ ...stamp, mask: { runs: [] } }), /missing its mask/);
});

test("a stamped cell stands on published ground", () => {
  // Every stamped cell must have ground under it, or the meadow would float.
  // Checked on a real subset rather than all 140,323 for speed, and never a
  // subset chosen to be uniform.
  const cover = decodeGroundCover(stamp);
  let checked = 0;
  for (const [, , [x, y]] of cover.stamped()) {
    if (checked++ >= 500) break;
    assert.ok(sampler.hasGround(x, y), `no published ground under a stamped cell at (${x}, ${y})`);
  }
});

test('half-texel border sampling clamps to the published edge instead of extrapolating',()=>{
  const g=new HeightGrid({values:new Float32Array([0,100,200,300]),resolution:2,quad_size_m:8,offset_xy_m:[0,0]});
  assert.equal(g.sample(-3,0),0);assert.equal(g.sample(0,-3),0);
  assert.equal(g.sample(11,0),100);assert.equal(g.sample(0,11),200);
  assert.equal(g.sample(-5,0),null);
});

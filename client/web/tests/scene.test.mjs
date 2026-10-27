/** Tests for the viewer's pure modules, run against the committed core data.
 *
 *     node --test client/web/tests/
 *
 * These are not fixtures. `scene.test.mjs` reads the repository's real
 * `worldmap.json`, `placement.json` and `world.json`, so a test goes red when
 * the world changes under the viewer rather than when a copy of the world goes
 * stale in a fixture directory. Where the core publishes the same fact twice —
 * `worldmap.turbines.count` and the turbine entries in `placement.json` — the
 * test asserts the two agree, because that is a check the viewer can make and a
 * fixture cannot.
 *
 * What is NOT tested here, and cannot be: `draw.js` and `stamp.js` need a
 * canvas, and `main.js` needs a browser and a server. Those are exercised by
 * opening the page; the parts that could be wrong in a way a human would not
 * see — the transforms, the grouping, the orientation decision — are here.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { detectAlbedoFlip, extentOf, hexToRgb, project, unproject } from "../src/geometry.js";
import { buildScene, groupPlacements, sceneSummary } from "../src/scene.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");

const read = (...parts) => readFileSync(join(REPO, ...parts), "utf8");
const worldmap = JSON.parse(read("shared", "world", "worldmap.json"));
const placement = JSON.parse(read("shared", "world", "out", "placement.json"));
const world = JSON.parse(read("shared", "world", "out", "world.json"));
const manifest = JSON.parse(read("client", "web", "data", "viewer.json"));

const scene = buildScene({ worldmap, placement, world });

test("north is up: a point further north draws nearer the top", () => {
  const extent = extentOf(manifest);
  const size = 1000;
  const south = project([0, extent.minY], extent, size);
  const north = project([0, extent.maxY], extent, size);
  assert.ok(north.y < south.y, `north ${north.y} should be above south ${south.y}`);
});

test("project and unproject round-trip", () => {
  const extent = extentOf(manifest);
  const size = 2048;
  for (const point of [
    [extent.minX, extent.minY],
    [0, 0],
    [extent.maxX, extent.maxY],
    [-1234.5, 678.25],
  ]) {
    const pixel = project(point, extent, size);
    const back = unproject(pixel, extent, size);
    assert.ok(Math.abs(back[0] - point[0]) < 1e-6, `x round-trip: ${back[0]} vs ${point[0]}`);
    assert.ok(Math.abs(back[1] - point[1]) < 1e-6, `y round-trip: ${back[1]} vs ${point[1]}`);
  }
});

test("the extent the viewer draws is the block the core generated", () => {
  const extent = extentOf(manifest);
  const block = worldmap.block;
  assert.equal(extent.width, block.extent_m);
  assert.deepEqual([extent.minX, extent.minY], block.min_xy_m);
  // 4096 m of block over 512 vertices at 8 m is 511 quads; an off-by-one here
  // would stretch the partition by 8 m and nothing else would notice.
  assert.equal(manifest.extent.height_resolution, block.landscape.resolution);
  assert.equal(manifest.extent.quad_size_m, block.landscape.quad_size_m);
});

test("every instance in placement.json reaches the scene, grouped by kind", () => {
  const summary = sceneSummary(scene);
  assert.equal(summary.instances, placement.instances.length);
  assert.equal(summary.instances, Object.values(placement.counts).reduce((a, b) => a + b, 0));
  for (const [kind, count] of Object.entries(placement.counts)) {
    const group = scene.placements.find((g) => g.kind === kind);
    assert.ok(group, `no group for kind ${kind}`);
    assert.equal(group.marks.length, count, `${kind}: ${group.marks.length} marks against ${count} declared`);
  }
});

test("the two places the core states the same thing agree", () => {
  // worldmap.turbines.count and the turbine entries in placement.json are
  // written by different steps of the pipeline. If they disagree the viewer
  // would draw a legend that contradicts the map it drew.
  assert.equal(scene.turbines.length, worldmap.turbines.count);
  assert.equal(sceneSummary(scene).turbines, worldmap.turbines.count);
});

test("water bodies are the declared ones, not derived ones", () => {
  assert.equal(scene.water.length, worldmap.water.bodies.length);
  const river = scene.water.find((b) => b.id === "river");
  assert.ok(river, "no river");
  assert.equal(river.polyline.length, worldmap.water.bodies.find((b) => b.id === "river").polyline.length);
  const lake = scene.water.find((b) => b.id === "lake");
  assert.deepEqual(lake.centre_xy_m, worldmap.water.bodies.find((b) => b.id === "lake").centre_xy_m);
});

test("the camera path is the map's nine keyframes, in order", () => {
  assert.equal(scene.camera.points.length, worldmap.camera.keyframes.length);
  worldmap.camera.keyframes.forEach((keyframe, index) => {
    assert.deepEqual(scene.camera.points[index], keyframe.location_m);
  });
});

test("the partition edges drawn are the core's, and they are edges", () => {
  assert.equal(scene.edges.length, (world.fields_status.partition_edges??[]).length);
  assert.equal(scene.edges.length, 0, "the retired partition must draw no crop boundaries");
  for (const edge of scene.edges.slice(0, 50)) {
    for (const key of ["x0", "y0", "x1", "y1"]) {
      assert.equal(typeof edge[key], "number", `edge is missing ${key}: ${JSON.stringify(edge)}`);
    }
  }
});

test("groupPlacements drops a mark with no position rather than drawing NaN", () => {
  const grouped = groupPlacements({
    instances: [
      { kind: "house", position_m: [1, 2, 3] },
      { kind: "house", position_m: null },
      { kind: "house" },
    ],
  });
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].marks.length, 1);
});

test("the orientation decision reads the core's cell data, not a constant", () => {
  const cells = [
    { seed_x_m: 0, seed_y_m: 0, crop: { hex: "#112233" } },
    { seed_x_m: 100, seed_y_m: -50, crop: { hex: "#AABBCC" } },
  ];
  // The sampler must answer for BOTH orientations, because the decision reads
  // them as a pair: right-under-one, wrong-under-the-other.
  const wanted = (flip) => (x, y, isFlipped) =>
    isFlipped === flip ? [...hexToRgb(x === 0 ? "#112233" : "#AABBCC"), 255] : [9, 9, 9, 255];
  const straight = detectAlbedoFlip(wanted(false), cells);
  assert.equal(straight.flipped, false);
  assert.equal(straight.agree, 2);

  const flipped = detectAlbedoFlip(wanted(true), cells);
  assert.equal(flipped.flipped, true);
  assert.equal(flipped.disagree, 2);

  // No agreement either way is reported as such, and the default is unflipped
  // rather than a coin toss.
  const neither = detectAlbedoFlip(() => [0, 0, 0, 255], cells);
  assert.equal(neither.flipped, false);
  assert.equal(neither.agree, 0);
  assert.equal(neither.disagree, 0);
});

test("the manifest's digests are the bytes on disk right now", () => {
  // The stamp is only worth anything if it matches. This is the Node-side twin
  // of the check `main.js` makes in the browser, so a page built from a stale
  // manifest is caught here rather than by a human noticing a wrong map.
  for (const source of manifest.sources) {
    const actual = createHash("sha256")
      .update(readFileSync(join(REPO, source.path)))
      .digest("hex");
    assert.ok(
      actual.startsWith(source.sha256_12),
      `${source.path} is ${actual.slice(0, 12)} on disk, the manifest says ${source.sha256_12}`,
    );
  }
});

test("the manifest states the exported geography and shared activity boundary", () => {
  assert.match(manifest.notice, /exported core geography/i);
  assert.match(manifest.notice, /engine-neutral shared flight, ski and bike rules/i);
  assert.match(manifest.heightmap_note, /16-bit/);
  assert.ok(manifest.commit && manifest.commit !== "unknown", "the manifest carries no commit");
  assert.ok(manifest.generator.includes("make_viewer_data.py"));
});

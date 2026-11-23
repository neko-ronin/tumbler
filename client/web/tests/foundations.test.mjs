/** Every raised home stands on a plinth that meets its floor and reaches the ground.
 *
 *     node --test client/web/tests/foundations.test.mjs
 *
 * Read from the real `placement.json` and the real GLBs: the lowest of the five
 * footprint ground samples the core used is floor minus `foundation_m`, so the
 * plinth's bottom must reach below it and its top must sit just under the floor.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Box3, Matrix4 } from "../vendor/three.module.min.js";

import { parseGLB } from "../src3d/glb.js";
import { buildFoundations, buildPlacements, footprintOf, PLINTH_BURY_M, PLINTH_TOP_M } from "../src3d/placements.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (...parts) => readFileSync(join(REPO, ...parts));
const placement = JSON.parse(read("shared", "world", "out", "placement.json"));
const raised = placement.instances.filter((i) => i.foundation_m);
const assets = {};
for (const path of new Set(raised.map((i) => i.asset))) assets[path] = parseGLB(new Uint8Array(read("shared", "geometry", path)).buffer);

test("every raised home gets one plinth, all in one draw call", () => {
  assert.ok(raised.length > 0, "the placement record raises some homes");
  assert.ok(raised.every((i) => ["homestead", "dome"].includes(i.kind)));
  const mesh = buildFoundations(placement, assets);
  assert.equal(mesh.isInstancedMesh, true);
  assert.equal(mesh.count, raised.length);
});

test("each plinth's top meets the floor and its bottom reaches below the lowest ground sample", () => {
  const mesh = buildFoundations(placement, assets);
  const matrix = new Matrix4();
  raised.forEach((instance, k) => {
    mesh.getMatrixAt(k, matrix);
    const plinth = new Box3().setFromBufferAttribute(mesh.geometry.attributes.position).applyMatrix4(matrix);
    const floor = instance.position_m[2], lowest = floor - instance.foundation_m;
    // foundation_m is rounded to the centimetre in derive.py, hence 5 mm.
    assert.ok(lowest <= instance.ground_z_m + 0.005, `${instance.asset}: the centre sample is one of the five`);
    assert.ok(Math.abs(plinth.max.y - (floor - PLINTH_TOP_M)) < 1e-4, `${instance.asset} top ${plinth.max.y} vs floor ${floor}`);
    assert.ok(plinth.min.y < lowest, `${instance.asset} bottom ${plinth.min.y} must reach below ${lowest}`);
    assert.ok(Math.abs(plinth.min.y - (floor - instance.foundation_m - PLINTH_BURY_M)) < 1e-4);
    // The plan is the model's own footprint: its x/z extent, whatever the yaw.
    const box = footprintOf(assets[instance.asset]);
    const area = (b) => (b.max.x - b.min.x) * (b.max.z - b.min.z);
    assert.ok(area(plinth) >= area(box) - 1e-3, `${instance.asset} plinth covers the house`);
    assert.ok(Math.abs(plinth.getCenter(box.min.clone()).x - instance.position_m[0]) < 15, "plinth stays at its house");
  });
});

test("the world build adds the plinths as exactly one draw", () => {
  const ground = { height: () => null };
  const homes = { instances: raised };
  const bare = buildPlacements(homes, assets), world = buildPlacements(homes, assets, { ground });
  assert.equal(world.stats.drawCalls, bare.stats.drawCalls + 1);
  assert.equal(world.stats.foundations, raised.length);
  assert.ok(!bare.group.getObjectByName("foundations"));
});

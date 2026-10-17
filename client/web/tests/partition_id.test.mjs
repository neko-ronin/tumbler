/** The agreed partition identity: two implementations, and what it must cost.
 *
 *     node --test client/web/tests/
 *
 * `tools/make_viewer_data.py` writes this format's bytes in Python;
 * `src/partition_id.js` writes them in JavaScript, both from the specification
 * in that file's header. This checks that they agree, and — the part that
 * matters more — that the format is sensitive to *meaning* and blind to
 * *spelling*.
 *
 * The asymmetry is the whole point:
 *
 *   re-spelling a number  -> the id must NOT move   (the core's text digest does)
 *   moving a number by 1 ULP -> the id MUST move
 *
 * A format that got that backwards would be worse than the float disagreement
 * it replaces, because it could not be argued with.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { partitionId, partitionIdBytes } from "../src/partition_id.js";
import { partitionVerdict } from "../src/stamp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const worldText = readFileSync(join(REPO, "shared", "world", "out", "world.json"), "utf8");
const world = JSON.parse(worldText);
const specimen=JSON.parse(readFileSync(join(HERE,"fixtures/partition.json"),"utf8"));
const fields=specimen.fields;
const liveManifest=JSON.parse(readFileSync(join(REPO, "client", "web", "data", "viewer.json"), "utf8")).partition;
const manifest=specimen.partition;
test('current empty world partition has the independently encoded core identity',async()=>{
  assert.equal(await partitionId(world.fields_status),liveManifest.id_agreed);
});

test("the two implementations agree, on the real partition", async () => {
  assert.equal(manifest.id_agreed.length, 16);
  const mine = await partitionId(fields);
  assert.equal(
    mine,
    manifest.id_agreed,
    `python wrote ${manifest.id_agreed}, javascript wrote ${mine}. The format has no ` +
      "rendering step, so a difference is a bug in one of the two encoders, not a " +
      "disagreement about how to write a number.",
  );
});

test("BLIND TO SPELLING: re-writing -400.0 as -400 does not move the id", async () => {
  // The property the core's text digest lacks, and the reason this format
  // exists. Measured on the core: the same partition spelled as ints digests to
  // 430e5e9b5c02a350 instead of fcbf5f3e81efb77d.
  // The numbers sit inside arrays, so what precedes them is `[` or a comma and
  // not a quote. Anchored on the trailing `,`/`}`/`]` so `12.05` is not caught.
  const pattern = /(-?\d+)\.0(?=[,}\]])/g;
  assert.ok(
    [...worldText.matchAll(pattern)].length > 0,
    "world.json spells no integral float with a .0; the check would be vacuous",
  );
  const respelled = worldText.replace(pattern, "$1");
  assert.notEqual(respelled, worldText, "the text was not actually re-spelled");

  const other = JSON.parse(JSON.stringify(fields).replace(pattern,"$1"));
  assert.equal(other.cells.length, fields.cells.length);
  assert.equal(
    await partitionId(other),
    await partitionId(fields),
    "the identity moved when the numbers were only re-spelled",
  );
});

test("SENSITIVE: one ULP of one seed moves the id", async () => {
  // Sensitivity is the property a rounding or quantising scheme gives up, so it
  // is checked rather than assumed. The next double up from -1711.8597 is about
  // 2e-13 m: far below anything a designer can see, and the id still moves.
  const nudged = structuredClone(fields);
  nudged.cells[0].seed_x_m = nudged.cells[0].seed_x_m * (1 + Number.EPSILON);
  assert.notEqual(nudged.cells[0].seed_x_m, fields.cells[0].seed_x_m);
  assert.notEqual(await partitionId(nudged), await partitionId(fields));
});

test("SENSITIVE: a moved boundary moves the id", async () => {
  const moved = structuredClone(fields);
  moved.partition_edges[0].x0 += 0.001;
  assert.notEqual(await partitionId(moved), await partitionId(fields));
});

test("SENSITIVE: reordering the cells moves the id", async () => {
  // Order is part of the identity: the same parcels exported in a different
  // order are a different artefact, and a digest that ignored order would let a
  // reordered file pass as unchanged.
  const reordered = structuredClone(fields);
  reordered.cells.reverse();
  assert.notEqual(await partitionId(reordered), await partitionId(fields));
});

test("SENSITIVE: a changed adjacency moves the id", async () => {
  const rewired = structuredClone(fields);
  rewired.cells[0].neighbours = [...rewired.cells[0].neighbours].reverse();
  if (rewired.cells[0].neighbours.length < 2) return; // nothing to reorder: sensitivity unproven
  assert.notEqual(await partitionId(rewired), await partitionId(fields));
});

test("the encoding is the layout its header documents, to the byte", async () => {
  // magic(8) + cell count(4)
  // + per cell: 8+8 doubles, 1 name length, the name, 4 neighbour count, 4 each
  // + edge count(4)
  // + per edge: 4+4 for the two i32 ids, and 8 each for the four doubles = 40
  const nameOf = (cell) => new TextEncoder().encode(cell.crop.name).length;
  const expected =
    8 +
    4 +
    fields.cells.reduce(
      (total, cell) => total + 16 + 1 + nameOf(cell) + 4 + 4 * cell.neighbours.length,
      0,
    ) +
    4 +
    fields.partition_edges.length * 40;
  assert.equal(
    partitionIdBytes(fields).length,
    expected,
    `the encoder's buffer is not the documented layout; first crop name is ${nameOf(fields.cells[0])} bytes`,
  );
  assert.equal(new TextDecoder().decode(partitionIdBytes(fields).slice(0, 8)), "TPIDv1\0\0");
});

test("the stamp says REPRODUCED when the two agree", async () => {
  const report = {
    partitionCore: manifest.id_agreed,
    partitionBrowser: await partitionId(fields),
    partitionAgrees: true,
  };
  const verdict = partitionVerdict(report);
  assert.equal(verdict.wrong, false);
  assert.match(verdict.text, /REPRODUCED in-browser/);
  assert.ok(verdict.text.includes(manifest.id_agreed), "the stamp must carry both ids");
});

test("FAILURE: the stamp says DRIFT, and names both ids, when they disagree", () => {
  // The branch the whole arrangement exists for. If this ever passed, a drifted
  // second implementation would render a confident picture.
  const report = {
    partitionCore: "fcbf5f3e81efb77d",
    partitionBrowser: "0000000000000000",
    partitionAgrees: false,
  };
  const verdict = partitionVerdict(report);
  assert.equal(verdict.wrong, true);
  assert.match(verdict.text, /PARTITION DRIFT/);
  assert.ok(verdict.text.includes("fcbf5f3e81efb77d"));
  assert.ok(verdict.text.includes("0000000000000000"));
});

test("FAILURE: a cross-check that did not run is not a pass", () => {
  // The failure mode of a check that only fires on load: it never fires, and a
  // blank stamp reads like nothing to worry about. So "not computed" is wrong.
  const verdict = partitionVerdict({ partitionCore: manifest.id_agreed });
  assert.equal(verdict.wrong, true);
  assert.match(verdict.text, /NOT COMPUTED/);
});

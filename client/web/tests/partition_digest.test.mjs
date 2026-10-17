/** The two implementations of `digest_partition` must agree, and this proves it can fail.
 *
 *     node --test client/web/tests/
 *
 * `shared/terrain/field_layout.digest_partition` is fifteen lines of Python.
 * `client/web/src/digest.js` is the browser's copy. This is the only thing
 * standing between them, and it is the artefact this repository should care
 * about most today: **if two implementations of one core operation exist,
 * nothing in the Python suite will notice when they drift**, because the Python
 * side has no idea the JavaScript exists.
 *
 * So this file does three things, in order of how much they matter:
 *
 *  1. runs both and compares them, against real committed data;
 *  2. proves the comparison can fail, four different ways, so a green run here
 *     means something;
 *  3. records that the *interesting* failure is not the algorithm.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { digestPartition, partitionPayload } from "../src/digest.js";
import { asFloat, asInt, pythonJson, pythonRepr } from "../src/pyjson.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const world = JSON.parse(readFileSync(join(REPO, "shared", "world", "out", "world.json"), "utf8"));
const liveManifest = JSON.parse(readFileSync(join(REPO, "client", "web", "data", "viewer.json"), "utf8"));
const specimen=JSON.parse(readFileSync(join(HERE,'fixtures/partition.json'),'utf8'));
const manifest={partition:specimen.partition};
const fields=specimen.fields;
test('current retired partition agrees with the core without invented fields',async()=>{
  assert.equal(world.fields_status.cells.length,0);
  assert.equal((world.fields_status.partition_edges??[]).length,0);
  assert.equal(await digestPartition(world.fields_status),liveManifest.partition.digest_core);
});

async function sha16(text) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

test("the browser's implementation agrees with the core's, on the nonempty core-generated wire specimen", async () => {
  assert.equal(manifest.partition.cells, fields.cells.length);
  assert.equal(manifest.partition.edges, fields.partition_edges.length);

  const mine = await digestPartition(fields);
  assert.equal(
    mine,
    manifest.partition.digest_core,
    `python said ${manifest.partition.digest_core}, javascript said ${mine}. ` +
      "One of them has drifted; the encoder in client/web/src/pyjson.js is the first suspect.",
  );
});

test("FAILURE 1: plain JSON.stringify does NOT reproduce it", async () => {
  // This is the finding. The algorithm is trivial and the bytes are not:
  // Python writes `-400.0` where JavaScript writes `-400`, so the payload is
  // 214 bytes shorter and the digests have nothing to do with each other.
  const naive = JSON.stringify({
    cells: fields.cells.map((c) => [c.seed_x_m, c.seed_y_m, c.crop.name, [...c.neighbours]]),
    edges: fields.partition_edges.map((e) => [e.a, e.b, e.x0, e.y0, e.x1, e.y1]),
  });
  const honest = pythonJson(partitionPayload(fields));

  assert.notEqual(naive, honest);
  assert.ok(
    Buffer.byteLength(honest) - Buffer.byteLength(naive) > 200,
    "expected the .0 suffixes to account for the size difference",
  );
  assert.notEqual(await sha16(naive), manifest.partition.digest_core);
  assert.equal(await sha16(honest), manifest.partition.digest_core);
});

test("FAILURE 2: dropping the int/float tags does NOT reproduce it", async () => {
  // JSON erases the difference between 0 and 0.0, so a duplicated operation has
  // to be told which fields are which. Nothing in the data files says.
  const untagged = JSON.stringify(partitionPayload(fields), (_key, value) =>
    value && value.__py !== undefined ? value.value : value,
  );
  assert.notEqual(await sha16(untagged), manifest.partition.digest_core);
  assert.match(untagged, /\[\[-?[0-9]+,/); // the coordinates lost their ".0"
});

test("FAILURE 3: a moved boundary changes the digest", async () => {
  // The core claims "any moved boundary changes it". Checked rather than taken,
  // because a digest that cannot notice a moved boundary would make the whole
  // comparison meaningless.
  const moved = structuredClone(fields);
  moved.partition_edges[0].x0 += 1.0;
  assert.notEqual(await digestPartition(moved), manifest.partition.digest_core);
});

test("FAILURE 4: the encoder refuses numbers it cannot prove it renders like Python", () => {
  // Python switches to exponent notation at 1e16; JavaScript at 1e21. Rather
  // than diverge quietly in that band, the serialiser stops.
  assert.throws(() => pythonRepr(1e16), /Python and JavaScript choose different/);
  assert.throws(() => pythonRepr(1e-7), /Python and JavaScript choose different/);
  assert.throws(() => pythonRepr(Number.NaN), /cannot render/);
  assert.equal(pythonRepr(-400), "-400.0");
  assert.equal(pythonRepr(-1617.9322061), "-1617.9322061");
  assert.equal(pythonJson(asInt(17)), "17");
  assert.equal(pythonJson(asFloat(-400)), "-400.0");
});

test("the comparison would notice a drift in the core, not only in the browser", async () => {
  // The manifest's value is the core's, produced by running the core's code.
  // If the core changed, `make_viewer_data.py` would have to be re-run for this
  // file to notice — so the check has a stated half-life, and it is the half
  // that says "someone changed the core and did not regenerate". Stating that
  // is better than pretending the check is continuous.
  assert.match(manifest.partition.digest_source, /shared\.terrain\.field_layout\.digest_partition/);
  assert.equal(manifest.partition.digest_core.length, 16);
});

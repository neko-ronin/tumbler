/**
 * `shared/terrain/field_layout.digest_partition`, again, in JavaScript.
 *
 * This is the experiment, and it is meant to be visible rather than tidy. The
 * core's version is fifteen lines of Python. This is the browser's copy, and the
 * interesting number is not the line count — it is that **most of what follows
 * is not the algorithm.**
 *
 *   the algorithm, faithfully      : build the payload, hash the bytes
 *   python's float rendering       : src/pyjson.js, because `-400.0` is not `-400`
 *   python's int/float distinction : asInt/asFloat, because JSON erases it
 *
 * The core does not publish its digest anywhere in `world.json`, so the
 * comparison is made against a value `tools/make_viewer_data.py` computes by
 * calling the real `digest_partition` on a `FieldAlbedo` rebuilt from the
 * committed `fields_status`. That is the only honest way to compare two
 * implementations: run both and compare, rather than trust either.
 *
 * If the core's `digest_partition` changes, this goes stale and **nothing in the
 * Python suite will notice**, because the Python side has no idea this file
 * exists. That is the whole risk, and it is why the browser recomputes the
 * digest on every load and stamps the verdict rather than trusting the recorded
 * one.
 */

import { asFloat, asInt, pythonJson } from "./pyjson.js";

/** The exact payload `digest_partition` hashes. */
export function partitionPayload(fieldsStatus) {
  const cells = fieldsStatus?.cells ?? [];
  const edges = fieldsStatus?.partition_edges ?? [];
  return {
    cells: cells.map((cell) => [
      asFloat(cell.seed_x_m),
      asFloat(cell.seed_y_m),
      cell.crop.name,
      cell.neighbours.map(asInt),
    ]),
    edges: edges.map((edge) => [
      asInt(edge.a),
      asInt(edge.b),
      asFloat(edge.x0),
      asFloat(edge.y0),
      asFloat(edge.x1),
      asFloat(edge.y1),
    ]),
  };
}

/** Sixteen hex characters, as the core returns them. */
export async function digestPartition(fieldsStatus) {
  const bytes = new TextEncoder().encode(pythonJson(partitionPayload(fieldsStatus)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

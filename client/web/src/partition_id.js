/**
 * A partition's identity, as bytes rather than as text.
 *
 * ## What this fixes, and why it is not a tolerance
 *
 * `shared/terrain/field_layout.digest_partition` hashes
 * `json.dumps(payload, sort_keys=True, separators=(",", ":"))`. That makes the
 * digest a function of *how the numbers were written down*, not of the
 * partition. Measured on this repository's committed partition, 2026-10-02:
 *
 *   coordinates spelled as floats (as world.json spells them) : fcbf5f3e81efb77d
 *   the same geometry, the same partition, spelled as ints     : 430e5e9b5c02a350
 *
 * A tool that rewrote `-400.0` as `-400` would change the digest with nothing
 * about the world changing. That is not a float-formatting annoyance between
 * two languages; it is the identity function answering the wrong question, and
 * it would bite any consumer, in any language, including the core's own.
 *
 * The obvious answers all cost sensitivity, and are rejected here:
 *
 * | answer | what it costs |
 * |---|---|
 * | round the values at the boundary | a tolerance, and an unverified claim that differences below it do not matter — the same mistake `session-lessons` §4 records being withdrawn |
 * | quantise to integers | the same tolerance with a unit attached |
 * | hash something coarser than exact doubles — a per-cell ordinal, crop plus neighbours | **blind to meaning**: two partitions with the same adjacency and moved seeds would collide |
 *
 * A **digest that is robust to formatting and blind to meaning is worse than
 * the float disagreement**, because it cannot be argued with.
 *
 * So: the double's identity *is* its eight bytes. This writes IEEE-754
 * big-endian, at fixed widths, with an explicit field order and an explicit
 * int/float tag per field. There is no rendering step left to disagree about —
 * no shortest-round-trip rule, no locale, no `repr`, no JSON number grammar —
 * so two implementations written from this specification agree by
 * construction.
 *
 * ## What it costs in sensitivity: nothing
 *
 * Bit-exact. Two partitions collide only if every double is bit-identical and
 * every integer equal. A one-ULP move of a seed changes the identity; a
 * re-spelling of the same value does not. That is strictly better than the text
 * digest in the direction that matters, which is catching a changed partition.
 *
 * ## What this is not
 *
 * It is a second implementation of a **wire format**, not of a core algorithm.
 * The algorithm stays in `shared/` exactly once. And the format is a proposal
 * for `digest_partition` to adopt — one function, `struct.pack` instead of
 * `json.dumps` — which is a change to `shared/` and therefore not this lane's
 * to make. See `client/web/README.md`.
 */

const MAGIC = "TPIDv1\0\0";
const TEXT_ENCODER = new TextEncoder();

/** Byte length of the encoding, so the buffer is sized once. */
function byteLength(fieldsStatus) {
  const cells = fieldsStatus?.cells ?? [];
  const edges = fieldsStatus?.partition_edges ?? [];
  let total = 8 + 4;
  for (const cell of cells) {
    total += 8 + 8 + 1 + TEXT_ENCODER.encode(cell.crop.name).length + 4 + 4 * cell.neighbours.length;
  }
  total += 4;
  for (const edge of edges) total += 4 + 4 + 8 * 4;
  return total;
}

/** The encoding itself. Every write is explicit and big-endian. */
export function partitionIdBytes(fieldsStatus) {
  const cells = fieldsStatus?.cells ?? [];
  const edges = fieldsStatus?.partition_edges ?? [];
  const buffer = new ArrayBuffer(byteLength(fieldsStatus));
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let at = 0;

  for (let i = 0; i < MAGIC.length; i += 1) bytes[at++] = MAGIC.charCodeAt(i);

  view.setUint32(at, cells.length, false); at += 4;
  for (const cell of cells) {
    view.setFloat64(at, cell.seed_x_m, false); at += 8;
    view.setFloat64(at, cell.seed_y_m, false); at += 8;
    const name = TEXT_ENCODER.encode(cell.crop.name);
    view.setUint8(at, name.length); at += 1;
    bytes.set(name, at); at += name.length;
    view.setUint32(at, cell.neighbours.length, false); at += 4;
    for (const neighbour of cell.neighbours) {
      view.setInt32(at, neighbour, false); at += 4;
    }
  }

  view.setUint32(at, edges.length, false); at += 4;
  for (const edge of edges) {
    view.setInt32(at, edge.a, false); at += 4;
    view.setInt32(at, edge.b, false); at += 4;
    view.setFloat64(at, edge.x0, false); at += 8;
    view.setFloat64(at, edge.y0, false); at += 8;
    view.setFloat64(at, edge.x1, false); at += 8;
    view.setFloat64(at, edge.y1, false); at += 8;
  }
  return bytes;
}

/** The partition's identity: sixteen hex characters of sha256 over those bytes. */
export async function partitionId(fieldsStatus) {
  const hash = await crypto.subtle.digest("SHA-256", partitionIdBytes(fieldsStatus));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

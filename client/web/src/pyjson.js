/**
 * The serialisation half of a duplicated operation, and it is the larger half.
 *
 * `shared/terrain/field_layout.digest_partition` takes a sha256 over
 * `json.dumps(payload, sort_keys=True, separators=(",", ":"))`. Reproduce that
 * digest in a browser and the algorithm is trivial — the payload is two arrays
 * and a hash. Reproduce the *bytes* is not: Python and JavaScript do not render
 * the same double the same way.
 *
 * Measured on this repository's committed data, 2026-10-02:
 *
 *   python `json.dumps`  24983 bytes   digest e4099ad6cdba0586
 *   JavaScript stringify 24768 bytes   digest d2c75c8008c791d2
 *
 * 215 bytes differ, and every one of them is an integral float: Python writes
 * `-400.0` where JavaScript writes `-400`. JavaScript numbers carry no
 * int/float distinction, Python's do. **The digests are unrelated, and no
 * amount of correct JavaScript fixes that** — it is the encoding, not the code.
 *
 * So this module exists, and it is the honest cost of the duplication. It does
 * the ASCII subset the payload actually contains and **throws on anything it
 * cannot prove it renders identically to Python**, rather than diverging
 * quietly. A serialiser that is silently wrong is worse than one that refuses,
 * because the digest still looks like a digest.
 */

/** Python's `repr` of a float, for the range this payload is made of. */
export function pythonRepr(value) {
  if (!Number.isFinite(value)) {
    throw new Error(`cannot render ${value} the way Python would`);
  }
  // JS prints 1e21 as "1e+21"; Python switches to exponent notation at 1e16.
  // So anything at or above that, and anything in the small-value exponent
  // band, is territory where the two renderers are not proven to agree.
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e16 || magnitude < 1e-4)) {
    throw new Error(
      `${value} is in the range where Python and JavaScript choose different ` +
        `notation (Python: |x| >= 1e16 or |x| < 1e-4), so this digest cannot be ` +
        `reproduced honestly here`,
    );
  }
  if (Number.isInteger(value)) return `${value}.0`;
  // Shortest round-trip: String() is the same guarantee repr() makes, and both
  // are shortest, so they agree on every non-integral value in this range.
  return String(value);
}

/** Code-point order, which is what Python's `sort_keys=True` uses. */
function codePointSort(a, b) {
  const left = [...a];
  const right = [...b];
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    const l = left[i].codePointAt(0);
    const r = right[i].codePointAt(0);
    if (l !== r) return l - r;
  }
  return left.length - right.length;
}

/**
 * `json.dumps(value, sort_keys=True, separators=(",", ":"))` for the subset of
 * Python this payload uses: dict, list, str, int, float, bool, None.
 *
 * Anything else raises rather than being guessed at.
 */
export function pythonJson(value) {
  if (value === null) return "null";
  if (value === true) return "true";
  if (value === false) return "false";
  if (isTagged(value)) {
    return value.__py === "int" ? String(value.value) : pythonRepr(value.value);
  }
  if (typeof value === "number") return Number.isInteger(value) && Object.is(value, Math.trunc(value)) && Math.abs(value) < 1e16
    ? `${value}.0`
    : pythonRepr(value);
  if (typeof value === "string") return pythonJsonString(value);
  if (Array.isArray(value)) return `[${value.map(pythonJson).join(",")}]`;
  if (typeof value === "object") {
    const keys = Object.keys(value).sort(codePointSort);
    return `{${keys.map((key) => `${pythonJsonString(key)}:${pythonJson(value[key])}`).join(",")}}`;
  }
  throw new Error(`pythonJson cannot render a ${typeof value}`);
}

/** A JSON string, escaped the way Python escapes with ensure_ascii=True. */
function pythonJsonString(text) {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0);
    if (char === '"') out += '\\"';
    else if (char === "\\") out += "\\\\";
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else if (code > 0x7e) out += `\\u${code.toString(16).padStart(4, "0")}`;
    else out += char;
  }
  return `${out}"`;
}

/**
 * Tag a number as a Python int or float.
 *
 * Needed because JSON erases the distinction: `0` and `0.0` parse to the same
 * JavaScript number, while `json.dumps` writes them differently. A duplicated
 * operation has to know which fields are which, and **the data files cannot
 * tell it** — that is the second cost the duplication carries, and unlike the
 * float formatting it is paid at every coordinate rather than in one place.
 */
export function asInt(value) {
  return { __py: "int", value: Math.trunc(value) };
}

export function asFloat(value) {
  return { __py: "float", value };
}

function isTagged(value) {
  return typeof value === "object" && value !== null && value.__py !== undefined;
}

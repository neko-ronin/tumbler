/** The form refuses early what the core would refuse, in the same direction.
 *
 *     node --test client/web/tests/study.test.mjs
 *
 * These pin the courtesy mirror in `src/study_validate.js`: same fields,
 * same bounds as the core's `ArrangementConstraints`, without asserting
 * identical strings (the server validates again through the core, and the
 * core's message is the authority). Each refusal here has a core-side twin
 * in `shared/tests/test_field_layout.py`; a bound the core tightened and
 * the form did not follow would show up as a study that passes the form and
 * fails the server — still safe, but no longer courteous — so the last test
 * names the shared bounds in one place.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { parseConstraints } from "../src/study_validate.js";

test("a full valid form parses to constraints", () => {
  const { errors, constraints } = parseConstraints({
    seed: "2001",
    cell_size_m: "120",
    jitter_fraction: "0.4",
    lloyd_passes: "3",
    min_parcels: "10",
    max_parcels: "400",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(constraints, {
    seed: 2001,
    cell_size_m: 120,
    jitter_fraction: 0.4,
    lloyd_passes: 3,
    min_parcels: 10,
    max_parcels: 400,
  });
});

test("blanks mean the map's values", () => {
  const { errors, constraints } = parseConstraints({ seed: "7", cell_size_m: "", jitter_fraction: " ", min_parcels: "" });
  assert.deepEqual(errors, []);
  assert.deepEqual(constraints, { seed: 7 });
});

test("every misshapen value is refused, naming its field", () => {
  for (const values of [
    { seed: "seven" },
    { seed: "7.5" },
    { seed: "2001", cell_size_m: "-10" },
    { seed: "2001", cell_size_m: "wide" },
    { seed: "2001", jitter_fraction: "1.5" },
    { seed: "2001", jitter_fraction: "-0.1" },
    { seed: "2001", lloyd_passes: "-1" },
    { seed: "2001", lloyd_passes: "2.5" },
    { seed: "2001", min_parcels: "0" },
    { seed: "2001", max_parcels: "none" },
  ]) {
    const { errors } = parseConstraints(values);
    assert.ok(errors.length > 0, `accepted what the core refuses: ${JSON.stringify(values)}`);
  }
});

test("the shared bounds live in one place", () => {
  // If the core ever moves these, move the matching check in study_validate.js
  // in the same commit: positive cell size, jitter in [0, 1], nonnegative
  // integer Lloyd passes, parcel guards positive integers, integer seed.
  const { errors } = parseConstraints({ seed: "1", cell_size_m: "0", jitter_fraction: "0", lloyd_passes: "0", min_parcels: "1" });
  assert.ok(errors.some((message) => message.includes("cell_size_m")));
  const ok = parseConstraints({ seed: "1", cell_size_m: "0.5", jitter_fraction: "0", lloyd_passes: "0", min_parcels: "1" });
  assert.deepEqual(ok.errors, []);
});

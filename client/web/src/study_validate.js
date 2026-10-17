/** Client-side reading of a field-study form: parse, refuse early, pass on.
 *
 * This mirrors the core's `ArrangementConstraints` refusals
 * (`shared/terrain/field_layout.py`) so a mistyped value fails here, in the
 * form, rather than costing a server round trip — but the mirror is a
 * courtesy, not a gate. The server validates again through the core, and a
 * form that disagreed with the core would be the second-authority defect, so
 * `study.test.mjs` pins every refusal against the core's wording direction
 * (same bounds, same fields) without asserting identical strings.
 */

export function parseConstraints(values) {
  const errors = [];
  const constraints = {};

  const seed = Number(values.seed);
  if (!Number.isInteger(seed)) {
    errors.push("seed must be an integer");
  } else {
    constraints.seed = seed;
  }

  const optional = (name, text, check) => {
    if (text === undefined || text === null || String(text).trim() === "") return;
    const value = Number(text);
    const bad = !Number.isFinite(value) || (check && !check(value));
    if (bad) {
      errors.push(`${name} refused: ${JSON.stringify(text)}`);
      return;
    }
    constraints[name] = value;
  };

  optional("cell_size_m", values.cell_size_m, (v) => v > 0);
  optional("jitter_fraction", values.jitter_fraction, (v) => v >= 0 && v <= 1);
  optional("lloyd_passes", values.lloyd_passes, (v) => Number.isInteger(v) && v >= 0);

  if (values.min_parcels !== undefined && String(values.min_parcels).trim() !== "") {
    const minParcels = Number(values.min_parcels);
    if (!Number.isInteger(minParcels) || minParcels < 1) {
      errors.push(`min_parcels refused: ${JSON.stringify(values.min_parcels)}`);
    } else {
      constraints.min_parcels = minParcels;
    }
  }

  if (values.max_parcels !== undefined && String(values.max_parcels).trim() !== "") {
    const maxParcels = Number(values.max_parcels);
    if (!Number.isInteger(maxParcels) || maxParcels < 1) {
      errors.push(`max_parcels refused: ${JSON.stringify(values.max_parcels)}`);
    } else {
      constraints.max_parcels = maxParcels;
    }
  }

  return { errors, constraints };
}

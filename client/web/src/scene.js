/** Turns the core's committed records into drawable primitives.
 *
 * Pure: no DOM, no fetch, no canvas. This is the part `node --test` can reach,
 * and it is deliberately the part that decides *what* is drawn, so the drawing
 * code has no opinions of its own.
 *
 * ## Nothing here re-derives the world
 *
 * Every number below is read out of a committed artefact and passed through:
 * the 1,422 instance positions come from `placement.json`, the river centreline
 * and the lake's size from `worldmap.json`, the camera keyframes from
 * `worldmap.json`. This file counts and groups. It does not partition fields,
 * does not place anything, does not carve water and does not sample terrain --
 * those are the core's answers and they arrive already computed.
 *
 * The one judgement in here is grouping by `kind` so the legend can say what
 * was drawn, which is bookkeeping rather than geography.
 */

/** One mark per placed instance, grouped by kind. */
export function groupPlacements(placement) {
  const instances = Array.isArray(placement.instances) ? placement.instances : [];
  const byKind = new Map();
  for (const instance of instances) {
    const kind = String(instance.kind ?? "unknown");
    const position = instance.position_m;
    if (!Array.isArray(position) || position.length < 2) continue;
    if (!byKind.has(kind)) byKind.set(kind, { kind, marks: [], withAsset: 0 });
    const entry = byKind.get(kind);
    entry.marks.push([position[0], position[1], Number(instance.yaw_deg ?? 0)]);
    if (instance.asset) entry.withAsset += 1;
  }
  return [...byKind.values()].sort((a, b) => b.marks.length - a.marks.length);
}

/** The nine keyframes, as a polyline, plus the declared speed and duration. */
export function cameraPath(worldmap) {
  const camera = worldmap.camera ?? {};
  const keyframes = Array.isArray(camera.keyframes) ? camera.keyframes : [];
  return {
    // The full `location_m`, z included: it is the map's data, and `project`
    // reads x and y only. Dropping z here would lose it for no reason.
    points: keyframes.map((k) => k.location_m.map(Number)),
    keyframes,
    speed_mps: camera.speed_mps,
    duration_s: camera.duration_s,
    field_of_view_deg: camera.field_of_view_deg,
  };
}

/**
 * The declared water bodies.
 *
 * The *shape* is drawn from `water_mask.png`, which is the core's carve. These
 * are the declared descriptors, drawn as annotations on top — a centreline is
 * not a re-carve and is labelled as such.
 */
export function waterBodies(worldmap) {
  const bodies = worldmap.water?.bodies ?? [];
  return bodies.map((body) => ({
    id: body.id,
    kind: body.kind,
    surface_z_m: body.surface_z_m,
    polyline: Array.isArray(body.polyline) ? body.polyline.map((p) => [Number(p[0]), Number(p[1])]) : [],
    centre_xy_m: Array.isArray(body.centre_xy_m) ? body.centre_xy_m.map(Number) : null,
    size_m: body.size_m ?? null,
    width_start_m: body.width_start_m ?? null,
    width_end_m: body.width_end_m ?? null,
  }));
}

/** City towers, as declared: [x, y, height_m] each. */
export function cityTowers(worldmap) {
  const towers = worldmap.city?.towers ?? [];
  return towers.map((t) => [Number(t[0]), Number(t[1]), Number(t[2])]);
}

/** Turbine placements, as declared. */
export function turbinePlacements(worldmap) {
  const turbines = worldmap.turbines ?? {};
  return (turbines.placement ?? []).map((p) => [Number(p[0]), Number(p[1])]);
}

/** The counts the stamp prints, so the picture states what it drew. */
export function sceneSummary(scene) {
  return {
    instances: scene.placements.reduce((total, group) => total + group.marks.length, 0),
    kinds: scene.placements.length,
    cameraKeyframes: scene.camera.points.length,
    waterBodies: scene.water.length,
    cityTowers: scene.towers.length,
    turbines: scene.turbines.length,
  };
}

/** Assemble the whole scene from the three fetched records. */
export function buildScene({ worldmap, placement, world }) {
  const cells = world?.fields_status?.cells ?? [];
  const edges = world?.fields_status?.partition_edges ?? [];
  return {
    placements: groupPlacements(placement),
    camera: cameraPath(worldmap),
    water: waterBodies(worldmap),
    towers: cityTowers(worldmap),
    turbines: turbinePlacements(worldmap),
    cells,
    edges,
    palette: worldmap.fields?.palette ?? [],
    cropGreen: worldmap.fields?.crop_green_hex ?? worldmap.fields?.crop_green ?? "#6E8F4A",
    hedgerowHex: worldmap.fields?.hedgerow_hex ?? "#2E3D24",
    declaredCounts: worldmap.camera?.counts ?? null,
  };
}

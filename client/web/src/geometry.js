/** World-metre <-> canvas transforms, and nothing else.
 *
 * Pure: no DOM, no fetch. Everything here is testable by running node, which is
 * how `client/web/tests/scene.test.mjs` uses it.
 *
 * The block is square and north-up on screen. `+y` is north in
 * `worldmap.json`'s frame, and screen `y` grows downward, so the V flip lives
 * here and nowhere else.
 */

/** A world extent in metres, min corner first. */
export function extentOf(manifest) {
  const [minX, minY] = manifest.extent.min_xy_m;
  const [maxX, maxY] = manifest.extent.max_xy_m;
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

/** World metres -> fractional canvas pixels. */
export function project(point, extent, size) {
  return {
    x: ((point[0] - extent.minX) / extent.width) * size,
    // +y is north; canvas y is down. This is the one flip, and it is here so
    // that no other file has to remember it.
    y: (1 - (point[1] - extent.minY) / extent.height) * size,
  };
}

/** The inverse, for hit-testing and for placing labels back in world terms. */
export function unproject(pixel, extent, size) {
  return [
    extent.minX + (pixel.x / size) * extent.width,
    extent.minY + (1 - pixel.y / size) * extent.height,
  ];
}

/**
 * The V flip an image needs, decided from data rather than assumed.
 *
 * `fields_albedo.png` is stored south-up — the core writes row 0 as minimum y
 * and PNG row 0 is the top — and `shared/geometry/structures/REPORT.md` records
 * that this has already caught several clients: "a client that samples it the
 * obvious way gets the partition mirrored north-south." `world.json` does not
 * declare a row order for it, and neither does `fields_albedo.png`, so the only
 * honest source is a check.
 *
 * So: sample the image at the seed position of each cell in
 * `world.json:fields_status.cells` and see which orientation puts the cell's own
 * declared crop hex under it. That is the core's own data used as the oracle.
 *
 * @param sampleAt  (worldX, worldY, flipped) -> [r, g, b, a] or null
 * @param cells     world.json's fields_status.cells
 * @returns {flipped: boolean, agree: number, disagree: number}
 */
export function detectAlbedoFlip(sampleAt, cells) {
  let agree = 0;
  let disagree = 0;
  for (const cell of cells) {
    const hex = cell.crop?.hex;
    const x = cell.seed_x_m;
    const y = cell.seed_y_m;
    if (typeof hex !== "string" || typeof x !== "number" || typeof y !== "number") continue;
    const wanted = hexToRgb(hex);
    const straight = sampleAt(x, y, false);
    const flipped = sampleAt(x, y, true);
    if (!straight || !flipped) continue;
    if (near(straight, wanted)) agree += 1;
    else if (near(flipped, wanted)) disagree += 1;
  }
  return { flipped: disagree > agree, agree, disagree };
}

/** "#RRGGBB" -> [r, g, b]. */
export function hexToRgb(hex) {
  const text = hex.replace("#", "");
  return [
    parseInt(text.slice(0, 2), 16),
    parseInt(text.slice(2, 4), 16),
    parseInt(text.slice(4, 6), 16),
  ];
}

/** "#RRGGBB" -> "rgba(r,g,b,a)". */
export function hexToCss(hex, alpha = 1) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Same swatch within a tolerance, because the raster is quantised. */
function near(pixel, rgb, tolerance = 10) {
  return (
    Math.abs(pixel[0] - rgb[0]) <= tolerance &&
    Math.abs(pixel[1] - rgb[1]) <= tolerance &&
    Math.abs(pixel[2] - rgb[2]) <= tolerance
  );
}

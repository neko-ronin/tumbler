/** C7 for the browser: the grass wave as a weight in 0..1 over the ground the core stamped as grass.
 *
 * Source of truth for the signal is shared/geometry/grass_wave/README.md (C6/C7) and
 * docs/design/R0002-GRASS-WIND.md. The core publishes only two inputs, both read here and nothing
 * else: the wind *direction* (worldmap.json wind.direction_deg) and the grass stamp
 * (ground_cover.json mask). The speeds, spacings and sharpness are this client's appearance and
 * live here, not in the core (AGENTS.md, "The core owns the map, not the blades").
 *
 * What a 2D canvas can and cannot carry: this is the *travelling* half, a pale front sliding
 * downwind, drawn as a tint with alpha. The sheen half (light catching bending stalks, gloss that
 * depends on sun and view angle) needs a lighting model and a view vector; a top-down canvas has
 * neither, so the tint only stands in for it. The UE material is where the sheen is.
 *
 * The UE material (client/ue/scripts/build_terrain_material.py) carries the same constants and
 * the same warp/breakup, expressed as material nodes. They are duplicated on purpose: there is no
 * shared shader language between the two clients.
 */

export const WAVE = {
  combs: [
    { spacingM: 90, speedMps: 7.0, gain: 1.0, phase: 0.0 },
    { spacingM: 143, speedMps: 8.5, gain: 0.8, phase: 2.1 },
  ],
  sharpness: 3.5, // frac(phase) ** 3.5: soft-edged leading edge, long fading trail
  warp: 0.30, // phase wobble across the front (two harmonics), so fronts curve and do not run parallel
  breakup: { lo: -0.6, hi: 0.7, drift: 0.6 }, // segments of a front, feathered at the ends; they drift at 0.6 of its speed
  strength: 0.35, // alpha at a crest
  tint: [230, 224, 200], // #E6E0C8, pale straw
};

/** Unit vector the wind blows TOWARD, in world (east, north). direction_deg is where it comes FROM. */
export function windToward(directionDeg) {
  const r = ((directionDeg + 180) * Math.PI) / 180;
  return [Math.sin(r), Math.cos(r)];
}

const frac = (x) => x - Math.floor(x);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** One comb's front strength, 0..1, at world metres (x, y) and time t seconds. */
export function comb(c, along, across, t, p = WAVE) {
  const s = c.spacingM;
  const warp = p.warp * (Math.sin(across / (1.7 * s) + c.phase) + 0.6 * Math.sin(across / (0.63 * s) + 1.3 * c.phase + 1.0));
  const phase = along / s - (t * c.speedMps) / s + warp;
  const front = Math.pow(frac(phase), p.sharpness);
  // Broken into segments along its length. `along - drift * speed * t` makes the segmentation
  // travel with the front but slower, so the gaps move through the front rather than staying put.
  const seg = Math.sin(across / (1.1 * s) + 0.35 * Math.sin((along - p.breakup.drift * c.speedMps * t) / (3 * s)) + c.phase);
  return front * smoothstep(p.breakup.lo, p.breakup.hi, seg);
}

/** Wave weight at one point; `wind` is the unit toward-vector. The stronger front wins where they meet. */
export function waveAt(x, y, t, wind, p = WAVE) {
  const along = x * wind[0] + y * wind[1];
  const across = wind[1] * x - wind[0] * y; // same sign as the UE material's engine-frame dot product
  let w = 0;
  for (const c of p.combs) w = Math.max(w, c.gain * comb(c, along, across, t, p));
  return w;
}

/** The core's stamp as a Uint8Array (1 = grass), row 0 = minimum y. Fails loudly on a malformed file.
 *  Each cell is centred on its vertex (offset + index * quad), so the grid covers the map's +-2048 m exactly. */
export function decodeGroundCover(gc) {
  const { resolution } = gc.grid;
  const out = new Uint8Array(resolution * resolution);
  let i = 0;
  gc.mask.runs.forEach((run, k) => {
    if (k % 2 === 1) out.fill(1, i, i + run);
    i += run;
  });
  if (i !== out.length) throw new Error(`ground_cover mask runs sum to ${i}, expected ${out.length}`);
  return out;
}

/** Draw one frame of the wave into `image` (ImageData over the mask grid, row 0 at the TOP = max y). */
export function paintWave(image, grid, mask, t, wind, p = WAVE) {
  const n = grid.resolution;
  const [r, g, b] = p.tint;
  for (let row = 0; row < n; row++) {
    const y = grid.offset_xy_m[1] + row * grid.quad_size_m;
    const o = (n - 1 - row) * n * 4;
    for (let col = 0; col < n; col++) {
      const k = o + col * 4;
      const w = mask[row * n + col] ? waveAt(grid.offset_xy_m[0] + col * grid.quad_size_m, y, t, wind, p) : 0;
      image.data[k] = r;
      image.data[k + 1] = g;
      image.data[k + 2] = b;
      image.data[k + 3] = Math.round(255 * p.strength * w);
    }
  }
}

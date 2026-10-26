/** The two published height grids, and standing things on the ground.
 *
 * The terrain exists in the browser as two rasters of float32 — the block's own
 * 512x512 and the far field's 146x146 — written by
 * `client/web/tools/make_viewer_data.py` from the core's own readers, because a
 * browser cannot read a 16-bit grayscale PNG's sample values back. Both are
 * south-up, both are in the world's own metres, and this module knows nothing
 * about either file: it takes arrays and the numbers that describe them.
 *
 * ## What this module does and does not compute
 *
 * It samples and it interpolates. It does not generate ground, does not decide
 * where anything stands, and does not know the ground is grass. The one thing
 * it adds of its own is the bilinear interpolation between published samples,
 * which is the client's own interpolation of the core's own numbers and is
 * labelled as interpolation in what it returns.
 */

/**
 * A height grid, constructed from the manifest's own `height_grids` entry.
 *
 * The constructor takes exactly the keys `viewer.json` publishes — `values`
 * plus the eight descriptors around it — so a caller reads no translation layer
 * between the committed file and the object that samples it. Row 0 is the
 * southern edge, which is `Heightfield`'s own order and the manifest's.
 */
export class HeightGrid {
  constructor({ values, resolution, quad_size_m, offset_xy_m, row_0 = "min_y", min_m, max_m, kind = "grid" }) {
    if (!(values instanceof Float32Array)) throw new Error(`${kind}: expected a Float32Array of samples`);
    const pitch = Number(quad_size_m);
    if (!Number.isInteger(resolution) || resolution < 2) {
      throw new Error(`${kind}: resolution ${resolution} is not a usable grid`);
    }
    if (!(pitch > 0)) throw new Error(`${kind}: quad_size_m ${quad_size_m} is not a usable pitch`);
    if (values.length !== resolution * resolution) {
      throw new Error(`${kind}: ${values.length} samples cannot be a ${resolution}x${resolution} grid`);
    }
    if (row_0 !== "min_y") {
      throw new Error(`${kind}: row_0 "${row_0}" is not the convention this reader was written for; it reads row 0 as minimum y`);
    }
    if (!Array.isArray(offset_xy_m) || offset_xy_m.length !== 2) {
      throw new Error(`${kind}: offset_xy_m must be a pair of numbers`);
    }
    this.values = values;
    this.resolution = resolution;
    this.quad = pitch;
    this.offsetX = Number(offset_xy_m[0]);
    this.offsetY = Number(offset_xy_m[1]);
    this.minimum = Number(min_m);
    this.maximum = Number(max_m);
    this.kind = kind;
    // The extent of the samples themselves, in world metres, and the extent of
    // the ground between them. They differ by half a pitch, and a caller that
    // conflates them puts a vertex at the wrong end of the world.
    this.minX = this.offsetX;
    this.minY = this.offsetY;
    this.maxX = this.offsetX + (resolution - 1) * pitch;
    this.maxY = this.offsetY + (resolution - 1) * pitch;
  }

  /** The published sample at a grid index, or null outside the grid. */
  at(row, column) {
    if (row < 0 || column < 0 || row >= this.resolution || column >= this.resolution) return null;
    return this.values[row * this.resolution + column];
  }

  /** The sample under a world coordinate, by interpolation between four.
   *
   * Outside the grid this returns null rather than the edge value: a tree
   * placed beyond the published ground must not be quietly held at its highest
   * sample, which is how a forest ends up standing on the rim of the world.
   */
  sample(x, y) {
    if (x < this.minX - this.quad / 2 || x > this.maxX + this.quad / 2 || y < this.minY - this.quad / 2 || y > this.maxY + this.quad / 2) {
      return null;
    }
    const fx = Math.max(0,Math.min(this.resolution-1,(x - this.offsetX) / this.quad));
    const fy = Math.max(0,Math.min(this.resolution-1,(y - this.offsetY) / this.quad));
    const x0 = Math.max(0, Math.min(this.resolution - 1, Math.floor(fx)));
    const y0 = Math.max(0, Math.min(this.resolution - 1, Math.floor(fy)));
    const x1 = Math.min(this.resolution - 1, x0 + 1);
    const y1 = Math.min(this.resolution - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const h00 = this.at(y0, x0);
    const h10 = this.at(y0, x1);
    const h01 = this.at(y1, x0);
    const h11 = this.at(y1, x1);
    const south = h00 + (h10 - h00) * tx;
    const north = h01 + (h11 - h01) * tx;
    return south + (north - south) * ty;
  }
}

function extentOf(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

/**
 * Two grids that agree where they meet, read as one.
 *
 * The far field is vertex-for-vertex with the block at its edge and carries the
 * block's own heights inside it, so inside the block the block wins and outside
 * it the far field does. There is no blending and no seam: at the boundary both
 * hold the same number, and that is the core's own guaranteed property rather
 * than something this module arranges.
 */
export class GroundSampler {
  // surface is a complete local replacement (river bed); geology adds roofs.
  constructor(block, farField, surface = null, geology = null) {
    this.block = block;
    this.farField = farField;
    this.surface = surface;
    this.geology = geology;
  }

  /** Metres at a world coordinate, or null where no published ground reaches. */
  height(x, y) {
    const detailed = this.surface?.(x, y);
    // A published detailed bed replaces the raster, including below it.
    // Solid roofs then stand on that floor instead of refilling the old bed.
    const base = detailed ?? this.block.sample(x, y) ?? this.farField.sample(x, y);
    if (base === null) return null;
    const rock = this.geology?.(x, y);
    return rock == null ? base : Math.max(base, rock);
  }

  /** Is this ground published at all? */
  hasGround(x, y) {
    return this.height(x, y) !== null;
  }
}

/**
 * The mask of stamped ground cover, decoded from the core's run-lengths.
 *
 * `ground_cover.json` publishes the stamp as run-lengths over the land-use grid
 * in row-major order, alternating uncovered then covered, so `runs[0]` is a run
 * of zeros and the covered runs are the odd-numbered ones. It also declares
 * `row 0 is MINIMUM y`, which is the opposite of the committed rasters — the
 * file says so itself, and this decoder does not assume the other convention.
 *
 * What it returns is which cells are stamped and where each cell's centre is.
 * It has no opinion on grass, blades, colour or density: those are the client's
 * by the 2026-10-04 ruling, and this file stops exactly where the core does.
 */
export function decodeGroundCover(stamp) {
  const grid = stamp?.grid;
  const resolution = Number(grid?.resolution);
  const quad = Number(grid?.quad_size_m);
  if (!Number.isInteger(resolution) || resolution < 2 || !(quad > 0) || !Array.isArray(grid?.offset_xy_m)) {
    throw new Error("ground_cover.json is missing its grid: resolution, quad_size_m and offset_xy_m are all required");
  }
  if (!Array.isArray(stamp?.mask?.runs) || !Number.isFinite(Number(stamp.mask.stamped_cells))) {
    throw new Error("ground_cover.json is missing its mask or the count it publishes");
  }
  const rowOrder = String(grid.row_order ?? "");
  if (!rowOrder.includes("MINIMUM y")) {
    throw new Error(`ground_cover.json declares row_0 "${grid.row_order}", which is not the convention this reader was written for`);
  }
  const [offsetX, offsetY] = grid.offset_xy_m;
  const total = resolution * resolution;
  const covered = new Uint8Array(total);
  let index = 0;
  let runIndex = 0;
  let painted = 0;
  for (const run of stamp.mask.runs) {
    const length = Number(run);
    if (!Number.isInteger(length) || length < 0) throw new Error(`run ${runIndex} is not a non-negative integer: ${run}`);
    if (index + length > total) throw new Error(`the runs overrun the grid: ${index}+${length} > ${total}`);
    if (runIndex % 2 === 1) {
      painted += length;
      covered.fill(1, index, index + length);
    }
    index += length;
    runIndex += 1;
  }
  if (index !== total) throw new Error(`the runs hold ${index} cells of a ${resolution}x${resolution} grid's ${total}: a mask that does not fill its grid is lying about coverage`);
  // The stamp publishes its own count. Two numbers that must agree, or the
  // client is drawing a different meadow from the one the core measured.
  const declared = Number(stamp.mask.stamped_cells);
  if (Number.isFinite(declared) && declared !== painted) {
    throw new Error(`the runs paint ${painted} cells and the stamp declares ${declared}`);
  }
  return {
    covered,
    resolution,
    quad,
    offsetX,
    offsetY,
    stampedCells: painted,
    /** The world coordinate of a cell's centre. */
    centre: (row, column) => [offsetX + (column + 0.5) * quad, offsetY + (row + 0.5) * quad],
    /** Every stamped cell's centre, row-major from the south-west corner. */
    stamped: function* stamped() {
      for (let row = 0; row < resolution; row += 1) {
        for (let column = 0; column < resolution; column += 1) {
          if (covered[row * resolution + column]) yield [row, column, this.centre(row, column)];
        }
      }
    },
  };
}

/** One presentation mask from two core-owned habitat grids. The primary grid
 * wins throughout its domain, including its bare cells (paths, water, homes).
 * The coarser continuation is sampled, never extended past its published mask.
 */
export function mergeGroundCover(primary,outer){
  if(!outer)return primary;
  const quad=primary.quad,offsetX=Math.min(primary.offsetX,outer.offsetX),offsetY=Math.min(primary.offsetY,outer.offsetY);
  if(Math.abs((primary.offsetX-offsetX)/quad-Math.round((primary.offsetX-offsetX)/quad))>1e-6||Math.abs((primary.offsetY-offsetY)/quad-Math.round((primary.offsetY-offsetY)/quad))>1e-6)throw Error('habitat grids must share the primary lattice');
  const highX=Math.max(primary.offsetX+primary.resolution*primary.quad,outer.offsetX+outer.resolution*outer.quad),highY=Math.max(primary.offsetY+primary.resolution*primary.quad,outer.offsetY+outer.resolution*outer.quad);
  const resolution=Math.ceil(Math.max(highX-offsetX,highY-offsetY)/quad),covered=new Uint8Array(resolution*resolution);
  const at=(cover,x,y)=>{const col=Math.floor((x-cover.offsetX)/cover.quad),row=Math.floor((y-cover.offsetY)/cover.quad);return col>=0&&row>=0&&col<cover.resolution&&row<cover.resolution?cover.covered[row*cover.resolution+col]:0;};
  for(let row=0;row<resolution;row++)for(let col=0;col<resolution;col++){
    const x=offsetX+(col+.5)*quad,y=offsetY+(row+.5)*quad;
    const inside=x>=primary.offsetX&&y>=primary.offsetY&&x<primary.offsetX+primary.resolution*primary.quad&&y<primary.offsetY+primary.resolution*primary.quad;
    covered[row*resolution+col]=at(inside?primary:outer,x,y);
  }
  return {covered,resolution,quad,offsetX,offsetY,stampedCells:covered.reduce((sum,n)=>sum+n,0)};
}

/** The existing ground sampler represented on one aligned lattice. Outer
 * values are bilinear readings of farfield.f32, not new terrain relief. One
 * mesh topology shares all edge vertices and normals across the old join.
 */
export function landscapeHeightGrid(block,far){
  const quad=block.quad,steps=(far.maxX-far.minX)/quad;
  if(Math.abs(steps-Math.round(steps))>1e-6)throw Error('outer terrain must align to the block lattice');
  const resolution=Math.round(steps)+1,values=new Float32Array(resolution*resolution);
  for(let row=0;row<resolution;row++)for(let col=0;col<resolution;col++){
    const x=far.minX+col*quad,y=far.minY+row*quad;values[row*resolution+col]=block.sample(x,y)??far.sample(x,y);
  }
  return new HeightGrid({values,resolution,quad_size_m:quad,offset_xy_m:[far.minX,far.minY],min_m:Math.min(block.minimum,far.minimum),max_m:Math.max(block.maximum,far.maximum),kind:'block samples and interpolated outer terrain'});
}

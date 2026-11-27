/** The ground itself: the block's terrain, the far-field ring, and the water.
 *
 * ## Why the client builds the ground from the published rasters
 *
 * The core ships an authored `shared/geometry/terrain/terrain.glb`, 14.6 MB of
 * the same 512x512 mesh with a neutral grey placeholder material — the file's
 * own material note says *"neutral placeholder so a viewer shows the mesh. The
 * appearance is the 3D artist's, not the generator's."*
 *
 * So the geometry is the core's either way, and the client's judgement is only
 * what colour to put on it. Building here from `heightmap.f32` ships a third as
 * many bytes (1 MB against 14.6), lets the meadow's colouring and the far-field
 * ring share one code path, and keeps a placeholder out of the picture. The
 * vertices are the published heights sampled exactly where the core published
 * them: nothing is generated, resampled or carved.
 *
 * ## The far-field ring
 *
 * The ground past the block is published at a 56 m pitch and is vertex-for-
 * vertex identical to the block at every shared vertex (see
 * `tests/heights.test.mjs`, which measures it on the committed files). So the
 * ring is the same grid with the cells wholly inside the block left out — no
 * blending, no seam, nothing to look wrong.
 */

import { style, toonMaterial, waterMaterial, surfaceSpeeds } from "./style.js";

import { BufferGeometry, Color, DataTexture, DataUtils, Float32BufferAttribute, HalfFloatType, LinearFilter, Mesh, Group, RGFormat, ShapeUtils, Vector2 } from "../vendor/three.module.min.js";

/** Deterministic jitter in [0, 1): variety in the ground without noise. */
function hash(x, y) {
  const value = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

// The vegetated ground's palette. The core publishes heights, and what colour
// the meadow reads is the client's under the 2026-10-04 ruling. A single flat
// green was tried on this ground once and read as painted plywood, so it is a
// height decision here; rock, snow and the wet bank are blended per pixel by
// the terrain shader in style.js, where they can break up within a sample.
const MEADOW = new Color("#82a94e");
const MEADOW_DRY = new Color("#b0b862");
const HEATHER = new Color("#819b71");
const PINEFLOOR = new Color("#718568");
const RIVEREDGE = new Color("#6c9450");

/** The vegetated ground's colour at one sample; rock and snow come from the shader. */
export function vertexColor(colors, vertex, here, worldX, worldY, scratch) {
  const jitter = hash(worldX, worldY) - 0.5;
  if (here < 22) scratch.copy(RIVEREDGE);
  else if (here > 280) scratch.copy(PINEFLOOR);
  else if (here > 115) scratch.copy(HEATHER);
  else scratch.copy(MEADOW).lerp(MEADOW_DRY, Math.min(1, Math.max(0, (here - 20) / 60 + jitter * 0.2)));
  colors[vertex] = scratch.r * (1 + jitter * 0.06);
  colors[vertex + 1] = scratch.g * (1 + jitter * 0.06);
  colors[vertex + 2] = scratch.b * (1 + jitter * 0.06);
}

export function terrainRegionBlend(region,x,y){
  if(!region)return 0;
  const u=(x-region.centre[0])/region.radii[0],v=(y-region.centre[1])/region.radii[1];
  const radius=Math.hypot(u+.08*Math.sin(v*2.4),v),t=Math.max(0,Math.min(1,(1-radius)/region.edgeBlend));
  let blend=t*t*t*(t*(t*6-15)+10);
  if(Number.isFinite(region.southM)){const s=Math.max(0,Math.min(1,(y-region.southM)/112));blend*=s*s*s*(s*(s*6-15)+10);}
  return blend;
}

/**
 * A triangle mesh over a height grid's own samples, in the client's colours.
 *
 * One vertex per published sample and two triangles per cell, so the geometry
 * carries exactly the resolution the core published — 262,144 vertices for the
 * block, 21,316 for the far field — and the client has not decided the meadow
 * is finer or coarser than its own record.
 */
export function buildTerrainGeometry(grid, { skipCell = null, normalRegion = null } = {}) {
  const { resolution, quad, offsetX, offsetY, values } = grid;
  const count = resolution * resolution;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const heightAt = (row, column) => {
    if (row < 0 || column < 0 || row >= resolution || column >= resolution) return null;
    return values[row * resolution + column];
  };
  const scratch = new Color();

  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      const index = row * resolution + column;
      const vertex = index * 3;
      const worldX = offsetX + column * quad;
      const worldY = offsetY + row * quad;
      // x east, height up, z south — the world frame's own mapping, applied to
      // every vertex so the scene has one convention and not several.
      positions[vertex] = worldX;
      positions[vertex + 1] = values[index];
      positions[vertex + 2] = -worldY;

      const here = values[index];
      // Central differences inside the grid, one-sided at the rim, so the edge
      // is shaded from the one neighbour it has rather than flattened.
      const east = heightAt(row, column + 1);
      const west = heightAt(row, column - 1);
      const north = heightAt(row + 1, column);
      const south = heightAt(row - 1, column);
      let dzdx = east !== null && west !== null ? (east - west) / (2 * quad) : (east !== null ? east - here : here - west) / quad;
      let dzdy = north !== null && south !== null ? (north - south) / (2 * quad) : (north !== null ? north - here : here - south) / quad;
      if (normalRegion) {
        const blend=terrainRegionBlend(normalRegion,worldX,worldY);
        if (blend>0) {
          // Browser shading integrates one native far-field cell rather than
          // exposing each bilinear cell's slope as a square rock/grass island.
          // Positions, topology and the shared physical floor are unchanged.
          const r=normalRegion.radiusM;
          const a=grid.sample(worldX+r,worldY),b=grid.sample(worldX-r,worldY),c=grid.sample(worldX,worldY+r),d=grid.sample(worldX,worldY-r);
          if(a!==null&&b!==null&&c!==null&&d!==null){dzdx+=((a-b)/(2*r)-dzdx)*blend;dzdy+=((c-d)/(2*r)-dzdy)*blend;}
        }
      }
      // The normal of y = f(x, z): (−f_x, 1, f_z). The world's north y becomes
      // scene −z, so the north gradient enters with the opposite sign here.
      const length = Math.hypot(dzdx, dzdy, 1);
      normals[vertex] = -dzdx / length;
      normals[vertex + 1] = 1 / length;
      normals[vertex + 2] = dzdy / length;

      vertexColor(colors, vertex, here, worldX, worldY, scratch);
    }
  }

  const indices = [];
  for (let row = 0; row + 1 < resolution; row += 1) {
    for (let column = 0; column + 1 < resolution; column += 1) {
      if (skipCell && skipCell(row, column)) continue;
      const a = row * resolution + column;
      const b = row * resolution + column + 1;
      const c = (row + 1) * resolution + column;
      const d = (row + 1) * resolution + column + 1;
      // World north maps to scene -z: (a,d,c) and (a,b,d) face upward.
      indices.push(a, d, c, a, b, d);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, vertices: count, triangles: indices.length / 3 };
}

/** The block's ground, as one mesh. */
export function buildBlockTerrain(grid) {
  const { geometry, vertices, triangles } = buildTerrainGeometry(grid);
  const mesh = new Mesh(geometry, toonMaterial({ name: "block_terrain", vertexColors: true }, { terrain: true }));
  mesh.name = "terrain";
  mesh.receiveShadow = true;
  mesh.userData = { samples: vertices, triangles, source: "heightmap.f32" };
  return mesh;
}

/**
 * The ground beyond the block, as a ring that meets the block exactly.
 *
 * A cell is dropped when all four corners are inside the block, so the ring
 * begins at the block's last sample and no ground is drawn twice — and the
 * dropped cells' shared vertices carry the block's own height, so there is no
 * step at the seam to blend or hide.
 */
export function buildFarFieldRing(grid, blockExtent) {
  const { quad, offsetX, offsetY } = grid;
  const inside = (row, column) => {
    const x = offsetX + column * quad;
    const y = offsetY + row * quad;
    return Math.abs(x) <= blockExtent + 1e-6 && Math.abs(y) <= blockExtent + 1e-6;
  };
  const skipCell = (row, column) =>
    inside(row, column) && inside(row, column + 1) && inside(row + 1, column) && inside(row + 1, column + 1);
  const { geometry, triangles } = buildTerrainGeometry(grid, { skipCell });
  const mesh = new Mesh(geometry, toonMaterial({ name: "far_field", vertexColors: true }, { terrain: true, horizonM:grid.maxX }));
  mesh.name = "far_field";
  mesh.userData = { triangles, source: "farfield.f32", covers: "past the block edge, where the ridge ring stands" };
  return mesh;
}

/**
 * The high country past the far field. Display only: nothing samples it, and it
 * stays out of `GroundSampler`, so flight and walking still end at the far field.
 *
 * Painted per vertex rather than through the terrain shader, whose maps stop at the
 * far field: forest low and gentle, pale rock, snow on what is high and not steep.
 * Corners past `extent_m` are dropped so the mesh ends on a circle, not a square.
 */
export function buildHorizonRange({ grid, heights_m: heights }, map) {
  const { resolution: n, quad_size_m: quad, offset_xy_m: [low], inner_edge_m: inner, extent_m: extent } = grid;
  const positions = new Float32Array(n * n * 3), normals = new Float32Array(n * n * 3), uvs = new Float32Array(n * n * 2);
  const h = (r, c) => heights[Math.max(0, Math.min(n - 1, r)) * n + Math.max(0, Math.min(n - 1, c))];
  for (let r = 0; r < n; r += 1) for (let c = 0; c < n; c += 1) {
    const at = r * n + c, x = low + c * quad, y = low + r * quad;
    positions.set([x, heights[at], -y], at * 3);
    const dzdx = (h(r, c + 1) - h(r, c - 1)) / (2 * quad), dzdy = (h(r + 1, c) - h(r - 1, c)) / (2 * quad), length = Math.hypot(dzdx, dzdy, 1);
    normals.set([-dzdx / length, 1 / length, dzdy / length], at * 3);
    uvs.set([(c + .5) / n, (r + .5) / n], at * 2);
  }
  const indices = [], outer = extent * extent;
  const place = (r, c) => [low + c * quad, low + r * quad];
  for (let r = 0; r + 1 < n; r += 1) for (let c = 0; c + 1 < n; c += 1) {
    const corners = [place(r, c), place(r, c + 1), place(r + 1, c), place(r + 1, c + 1)];
    if (corners.every(([x, y]) => Math.max(Math.abs(x), Math.abs(y)) < inner - 200)) continue;
    if (corners.some(([x, y]) => x * x + y * y > outer)) continue;
    const a = r * n + c, b = a + 1, d = a + n, e = d + 1;
    indices.push(a, e, d, a, b, e);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, toonMaterial({ name: "horizon_range", map, fog: false }, { horizonM: extent }));
  mesh.name = "horizon_range";
  mesh.userData = { triangles: indices.length / 3, source: "horizon_range.json" };
  return mesh;
}

/**
 * The river and the lake, as the core authored them.
 *
 * Both bodies' surface heights and areas are published in `world.json`, and the
 * core also ships the ribbon itself as a mesh in `shared/geometry/water/`,
 * tagged `world_space` — its vertices already stand at the world's own 20 m, so
 * no transform is applied and multiplying by the instance's `position_m` would
 * float the river twice as high. Colour is the committed `water_surface` base
 * colour; the translucency is the client's own gloss, exactly as in Unreal.
 */
export function buildWater(waterInstances, parsedAssets, grid = null, worldmap=null, options = {}) {
  const group = new Group();
  group.name = "water";
  const drawn = new Set();
  // The adopted map carries its own shapes; the GLB still holds the old ones.
  if (worldmap?.water?.bodies?.some(b => b.polyline_xyz_m || b.outline_xy_m)) {
    for (const mesh of buildWaterBodies(worldmap, grid, options)) { group.add(mesh); drawn.add(mesh.name); }
    waterInstances = [];
  }
  for (const instance of waterInstances) {
    const asset = parsedAssets[instance.asset];
    if (!asset) throw new Error(`no GLB parsed for ${instance.asset}`);
    for (const primitive of asset.primitives) {
      // Both world-space instances list both parts. Their union is drawn once.
      if (!(instance.parts ?? []).some(part => part.mesh === primitive.part)) continue;
      const key = `${instance.asset}#${primitive.part}:${primitive.name}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      const material = grid ? waterMaterial(grid, primitive.part === "river",worldmap?.water.bodies.find(b=>b.kind==='river')?.polyline) :
        toonMaterial({ color: "#55aa9f" });
      const mesh = new Mesh(primitive.geometry, material);
      mesh.name = primitive.part;
      mesh.applyMatrix4(primitive.local);
      group.add(mesh);
    }
  }
  group.userData = { parts: drawn.size };
  return group;
}

/** Whether (x, y) lies inside a closed [[x, y], ...] outline (even-odd). */
function insideOutline(outline, x, y) {
  let inside = false;
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, ay] = outline[i], [bx, by] = outline[j];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

/** Flip any triangle whose face points down, so FrontSide shows it from above. */
function faceUp(positions, indices) {
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
    const ux = positions[b] - positions[a], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vz = positions[c + 2] - positions[a + 2];
    if (uz * vx - ux * vz < 0) [indices[t + 1], indices[t + 2]] = [indices[t + 2], indices[t + 1]];
  }
}

function waterMesh(name, positions, indices, material) {
  faceUp(positions, indices);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  return mesh;
}

/** On a bend, which side (-1 or 1, as the row's offsets) is the inside, and how far an offset may go there
 * before the row crosses its neighbours: 90% of the local turning radius, never under the declared half width
 * plus 4 m. A wide row on a tight bend folded the water over itself, three layers deep, and their flow
 * patterns crossed in a bright star (2026-11-22). */
function bendInside(line, i, t, declared) {
  const a = line[Math.max(0, i - 1)], b = line[i], c = line[i + 1], d = line[Math.min(line.length - 1, i + 2)];
  const [p, q, r] = t < .5 ? [a, b, c] : [b, c, d];
  const ux = q[0] - p[0], uy = q[1] - p[1], vx = r[0] - q[0], vy = r[1] - q[1];
  const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
  if (!lu || !lv) return { side: 0, limit: Infinity }; // an end point has no neighbour beyond it, and no bend
  const cross = (ux * vy - uy * vx) / (lu * lv), turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (lu * lv))));
  if (turn < 1e-3) return { side: 0, limit: Infinity };
  const radius = Math.min(lu, lv) / (2 * Math.sin(turn / 2));
  // The offsets' normal (-dy, dx) points left of the flow, so a left turn (cross > 0) has its inside at side 1.
  return { side: cross > 0 ? 1 : -1, limit: Math.max(declared + 4, .9 * radius) };
}

// The river is drawn this much wider than declared on each bank (the wet channel runs 5 to 10 m past the map's
// half width), so its edge tucks under the terrain and the depth fade, not a drawn line, ends it.
const RIVER_BANK_OVERLAP_M = 24;

/** The whole river as one line, upstream reach (reversed) + block + downstream reach, with its half widths.
 * The reaches start at the block river's end points; the shared points appear once. */
export function joinedRiver(worldmap) {
  const block = worldmap.water?.bodies?.find(b => b.kind === "river" && b.polyline_xyz_m);
  if (!block) return null;
  const line = block.polyline_xyz_m, widths = block.half_widths_m ?? line.map(() => 30);
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
  const reaches = worldmap.mountains?.enclosure?.river_reaches ?? [];
  const widthsOf = r => r.half_widths_m ?? r.polyline_xyz_m.map(() => r.half_width_m);
  const up = reaches.find(r => near(r.polyline_xyz_m[0], line[0])), down = reaches.find(r => near(r.polyline_xyz_m[0], line.at(-1)));
  return {
    line: [...(up ? up.polyline_xyz_m.slice(1).reverse() : []), ...line, ...(down ? down.polyline_xyz_m.slice(1) : [])],
    widths: [...(up ? widthsOf(up).slice(1).reverse() : []), ...widths, ...(down ? widthsOf(down).slice(1) : [])],
  };
}

/**
 * The lake and the river, built from the adopted map's own shapes. The lake is its `outline_xy_m` triangulated
 * at `surface_z_m`, each vertex pushed 20 m outward so the edge is buried under the bank. The river is a ribbon
 * every 20 m along the joined line, its surface at each point's own level.
 *
 * `bedGrid`: the ground the river's depth is measured against (main.js passes the landscape grid the terrain
 * draws, block and far field on one 8 m lattice); `riverSurface`: the detailed granite bed where it lies. */
export function buildWaterBodies(worldmap, grid = null, { bedGrid = grid, riverSurface = null } = {}) {
  const bodies = worldmap.water.bodies, meshes = [];
  const river = bodies.find(b => b.kind === "river" && b.polyline_xyz_m);
  const lake = bodies.find(b => b.kind === "lake" && b.outline_xy_m), joined = river ? joinedRiver(worldmap) : null;
  if (grid) waterLevelField(bedGrid, lake, joined?.line, joined?.widths);
  if (lake) {
    const ring = lake.outline_xy_m, n = ring.length;
    let area = 0;
    for (let i = 0; i < n; i += 1) area += ring[i][0] * ring[(i + 1) % n][1] - ring[(i + 1) % n][0] * ring[i][1];
    const out = area > 0 ? 1 : -1; // counter-clockwise: the right-hand normal points out
    const grown = ring.map(([x, y], i) => {
      const [px, py] = ring[(i + n - 1) % n], [qx, qy] = ring[(i + 1) % n];
      const length = Math.hypot(qx - px, qy - py) || 1;
      return [x + (qy - py) / length * 20 * out, y - (qx - px) / length * 20 * out];
    });
    const positions = grown.flatMap(([x, y]) => [x, lake.surface_z_m, -y]);
    const indices = ShapeUtils.triangulateShape(grown.map(([x, y]) => new Vector2(x, y)), []).flat();
    meshes.push(waterMesh("lake", positions, indices, grid ? waterMaterial(grid, false, river?.polyline_xyz_m ?? river?.polyline, { halfWidths: river?.half_widths_m }) : toonMaterial({ color: "#55aa9f" })));
  }
  if (river) {
    // One ribbon from source to mouth with one material: the block's edges at x = ±2048 are not the river's,
    // and two pieces met there as a hard line of different water (2026-11-26 seam marks).
    const { line, widths: halves } = joined, speeds = surfaceSpeeds(line, halves);
    // Seconds the current takes to reach each point: patterns drawn in this time ride at the local speed.
    const seconds = [0];
    for (let i = 1; i < line.length; i += 1) seconds.push(seconds[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]) * 2 / (speeds[i - 1] + speeds[i]));
    const positions = [], wet = [], indices = [], current = [], channel = [];
    // Where the river runs on a raised bank (west of the block the plain lies 2 to 7 m under it), a ribbon
    // drawn its full width laid water over the low ground behind the bank, edged by its own straight rows.
    // Each side ends 6 m past the first ground standing over the surface, tucked under that bank.
    const ground = grid ? (x, y) => riverSurface?.height(x, y) ?? bedGrid.sample(x, y) : null;
    const toBank = (x, y, z, nx, ny, side, most) => {
      if (!ground) return most;
      for (let d = 2; d < most; d += 2) if (ground(x + nx * d * side, y + ny * d * side) >= z) return Math.min(most, d + 6);
      return most;
    };
    for (let i = 0; i + 1 < line.length; i += 1) {
      const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 20));
      for (let k = i ? 1 : 0; k <= steps; k += 1) {
        const t = k / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        const declared = halves[i] + (halves[i + 1] - halves[i]) * t, half = declared + RIVER_BANK_OVERLAP_M;
        const [px, py] = line[Math.max(0, t === 0 ? i - 1 : i)], [qx, qy] = line[Math.min(line.length - 1, t === 1 ? i + 2 : i + 1)];
        const length = Math.hypot(qx - px, qy - py);
        const nx = -(qy - py) / length, ny = (qx - px) / length;
        const speed = speeds[i] + (speeds[i + 1] - speeds[i]) * t, along = seconds[i] + (seconds[i + 1] - seconds[i]) * t;
        const inner = bendInside(line, i, t, declared);
        for (const side of [-1, 1]) {
          const reach = toBank(x, y, z, nx, ny, side, side === inner.side ? Math.min(half, inner.limit) : half);
          positions.push(x + nx * reach * side, z, -(y + ny * reach * side));
          // Flow in scene x, z (north is -z); the channel's across is metres left of the line.
          current.push((qx - px) / length, -(qy - py) / length, speed);
          channel.push(along, reach * side);
        }
        wet.push(lake ? insideOutline(lake.outline_xy_m, x, y) : false);
      }
    }
    // Ribbon quads whose two centre points both lie in the lake are left out: the lake's surface is there.
    for (let row = 0; row + 1 < wet.length; row += 1) {
      if (wet[row] && wet[row + 1]) continue;
      const a = row * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const material = grid ? waterMaterial(bedGrid, true, null, { vertexCurrent: true, riverSurface }) : toonMaterial({ color: "#55aa9f" });
    const mesh = waterMesh("river", positions, indices, material);
    mesh.geometry.setAttribute("current", new Float32BufferAttribute(current, 3));
    mesh.geometry.setAttribute("channel", new Float32BufferAttribute(channel, 2));
    meshes.push(mesh);
  }
  return meshes;
}

/** Distance from (x, y) to segment a-b; `along.t` receives how far along it the closest point lies. */
const along = { t: 0 };
function toSegment(x, y, a, b) {
  const ax = a[0], ay = a[1], vx = b[0] - ax, vy = b[1] - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
  const dx = x - ax - vx * t, dy = y - ay - vy * t;
  along.t = t;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * The nearest water's surface level (r) and the distance to its edge (g) over the whole landscape at about 23 m,
 * for the terrain shader's banks: the bed under the water, the damp band above it. Read through `style.waterLevel`.
 * It covered only the block at 32 m; past the block the shader clamped to the edge texels, so the reaches' banks
 * took one level per 32 m row and their shoreline stepped like stairs (2026-11-27).
 * Only texels within `NEAR_M` of some water are measured; the shader ignores water further than 90 m.
 */
function waterLevelField(grid, lake, line, halves) {
  const size = 1024, span = grid.quad * (grid.resolution - 1), cell = span / size, NEAR_M = 120;
  const level = new Float32Array(size * size).fill(20), distance = new Float32Array(size * size).fill(6e4);
  const each = (x0, y0, x1, y1, visit) => {
    const c0 = Math.max(0, Math.floor((x0 - grid.offsetX) / cell)), c1 = Math.min(size - 1, Math.ceil((x1 - grid.offsetX) / cell));
    const r0 = Math.max(0, Math.floor((y0 - grid.offsetY) / cell)), r1 = Math.min(size - 1, Math.ceil((y1 - grid.offsetY) / cell));
    for (let row = r0; row <= r1; row += 1) for (let col = c0; col <= c1; col += 1) visit(row * size + col, grid.offsetX + (col + .5) * cell, grid.offsetY + (row + .5) * cell);
  };
  if (lake) {
    const ring = lake.outline_xy_m, xs = ring.map(p => p[0]), ys = ring.map(p => p[1]);
    each(Math.min(...xs) - NEAR_M, Math.min(...ys) - NEAR_M, Math.max(...xs) + NEAR_M, Math.max(...ys) + NEAR_M, (k, x, y) => {
      let d = Infinity;
      for (let i = 0; i < ring.length; i += 1) d = Math.min(d, toSegment(x, y, ring[i], ring[(i + 1) % ring.length]));
      if (insideOutline(ring, x, y)) d = 0;
      if (d < distance[k]) { distance[k] = d; level[k] = lake.surface_z_m; }
    });
  }
  for (let i = 1; line && i < line.length; i += 1) {
    const a = line[i - 1], b = line[i], reach = Math.max(halves[i - 1], halves[i]) + NEAR_M;
    each(Math.min(a[0], b[0]) - reach, Math.min(a[1], b[1]) - reach, Math.max(a[0], b[0]) + reach, Math.max(a[1], b[1]) + reach, (k, x, y) => {
      const d = toSegment(x, y, a, b), t = along.t, edge = Math.max(0, d - (halves[i - 1] + (halves[i] - halves[i - 1]) * t));
      if (edge < distance[k]) { distance[k] = edge; level[k] = a[2] + (b[2] - a[2]) * t; }
    });
  }
  const data = new Uint16Array(size * size * 2);
  for (let k = 0; k < size * size; k += 1) { data[k * 2] = DataUtils.toHalfFloat(level[k]); data[k * 2 + 1] = DataUtils.toHalfFloat(Math.min(distance[k], 6e4)); }
  // Half floats filter bilinearly on every WebGL2 device; 32-bit floats need an extension.
  const texture = new DataTexture(data, size, size, RGFormat, HalfFloatType);
  texture.minFilter = texture.magFilter = LinearFilter; texture.needsUpdate = true;
  style.waterLevel.value = texture;
  style.waterLevelGrid.value.set(grid.offsetX, grid.offsetY, span, 1);
}


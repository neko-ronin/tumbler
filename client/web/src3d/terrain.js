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

import { toonMaterial, waterMaterial } from "./style.js";

import { BufferGeometry, Color, Float32BufferAttribute, Mesh, Group } from "../vendor/three.module.min.js";

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

/**
 * A triangle mesh over a height grid's own samples, in the client's colours.
 *
 * One vertex per published sample and two triangles per cell, so the geometry
 * carries exactly the resolution the core published — 262,144 vertices for the
 * block, 21,316 for the far field — and the client has not decided the meadow
 * is finer or coarser than its own record.
 */
export function buildTerrainGeometry(grid, { skipCell = null } = {}) {
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
      const dzdx = east !== null && west !== null ? (east - west) / (2 * quad) : (east !== null ? east - here : here - west) / quad;
      const dzdy = north !== null && south !== null ? (north - south) / (2 * quad) : (north !== null ? north - here : here - south) / quad;
      // The normal of y = f(x, z): (−f_x, 1, f_z). The world's north y becomes
      // scene −z, so the north gradient enters with the opposite sign here.
      const length = Math.hypot(dzdx, dzdy, 1);
      normals[vertex] = -dzdx / length;
      normals[vertex + 1] = 1 / length;
      normals[vertex + 2] = dzdy / length;

      const jitter = hash(worldX, worldY) - 0.5;
      if (here < 22) scratch.copy(RIVEREDGE);
      else if (here > 280) scratch.copy(PINEFLOOR);
      else if (here > 115) scratch.copy(HEATHER);
      else scratch.copy(MEADOW).lerp(MEADOW_DRY, Math.min(1, Math.max(0, (here - 20) / 60 + jitter * 0.2)));
      colors[vertex] = scratch.r * (1 + jitter * 0.06);
      colors[vertex + 1] = scratch.g * (1 + jitter * 0.06);
      colors[vertex + 2] = scratch.b * (1 + jitter * 0.06);
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
  mesh.userData = { triangles, source: "farfield.f32", covers: "past the block edge, where the city stands" };
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
export function buildWater(waterInstances, parsedAssets, grid = null, worldmap=null) {
  const group = new Group();
  group.name = "water";
  const drawn = new Set();
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

/**
 * The river beyond the block, as the map's reaches describe it.
 *
 * `mountains.enclosure.river_reaches` gives each reach as [x, y, surface z]
 * from the point where the block's own river ends; the core shapes the far
 * field's valley along the same lines, so this ribbon lies on ground that was
 * lowered for it. The surface climbs or falls between points exactly as the
 * map says, linearly, every 20 m; nothing here is invented.
 */
export function buildRiverReaches(worldmap, farGrid) {
  const group = new Group();
  group.name = "river_reaches";
  for (const reach of worldmap.mountains?.enclosure?.river_reaches ?? []) {
    const line = reach.polyline_xyz_m, half = reach.half_width_m;
    const positions = [], across = [], indices = [];
    for (let i = 0; i + 1 < line.length; i += 1) {
      const [ax, ay, az] = line[i], [bx, by, bz] = line[i + 1];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 20));
      for (let k = i ? 1 : 0; k <= steps; k += 1) {
        const t = k / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
        // Offsets follow the mean of the two neighbouring segments' normals.
        const [px, py] = line[Math.max(0, t === 0 ? i - 1 : i)], [qx, qy] = line[Math.min(line.length - 1, t === 1 ? i + 2 : i + 1)];
        const length = Math.hypot(qx - px, qy - py), nx = -(qy - py) / length, ny = (qx - px) / length;
        for (const side of [-1, 1]) {
          positions.push(x + nx * half * side, z, -(y + ny * half * side));
          across.push(side);
        }
      }
    }
    for (let row = 0; row + 1 < positions.length / 6; row += 1) {
      const a = row * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, c, b, b, c, d);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("across", new Float32BufferAttribute(across, 1));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const mesh = new Mesh(geometry, waterMaterial(farGrid, true, line, { ribbon: true }));
    mesh.name = `river_reach_${reach.id}`;
    group.add(mesh);
  }
  return group;
}

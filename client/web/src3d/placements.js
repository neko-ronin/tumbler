/** The placement record, turned into instances that draw.
 *
 * 17,283 instances across 13 kinds, and one kind is 17,208 redwoods of 766,000
 * source triangles each — 13.2 **billion** triangles. Drawn the obvious way,
 * one `Group` per instance, that is 68,832 draw calls and nothing renders. So
 * this module groups by named part, merges each part's primitives into one
 * geometry with `mergePrimitives`, and drives each group with a single
 * `InstancedMesh`.
 *
 * The core's transforms and named parts are retained. The forest is spatially
 * batched by forest.js with one source-envelope stylization at every distance.
 * Visibility is ordinary conservative frustum culling, with no radius cutoff.
 *
 * ## The two instances that are not placed
 *
 * The river and the lake are tagged `world_space` and their meshes already
 * stand in the world. They are excluded here and drawn by `terrain.js`, because
 * applying their own `position_m` would float them at twice the surface height.
 */

import { Group, InstancedMesh } from "../vendor/three.module.min.js";
import { mergePrimitives } from "./glb.js";
import { instanceMatrix } from "./world.js";

/** The instances of `placement.json`, grouped by the asset they name. */
export function groupByAsset(placement) {
  const byAsset = new Map();
  for (const instance of placement.instances ?? []) {
    if (!instance.asset) continue;
    if (!byAsset.has(instance.asset)) byAsset.set(instance.asset, []);
    byAsset.get(instance.asset).push(instance);
  }
  return byAsset;
}

/** An instance the core says already stands in the world, transformed by nothing. */
export const isWorldSpace = (instance) => (instance.tags ?? []).includes("world_space");

/** The named parts an asset carries, each with its own cumulative matrix. */
export function partsOf(asset) {
  const byPart = new Map();
  for (const primitive of asset.primitives) {
    const name = primitive.part ?? "part";
    if (!byPart.has(name)) byPart.set(name, []);
    byPart.get(name).push(primitive);
  }
  for (const [name, primitives] of byPart) {
    // Every primitive of a part shares the part's node, so it shares the node's
    // matrix. Checked rather than assumed: two matrices under one part name
    // would billow the geometry and look like weather.
    const first = primitives[0].local;
    for (const primitive of primitives.slice(1)) {
      for (let i = 0; i < 16; i += 1) {
        if (Math.abs(primitive.local.elements[i] - first.elements[i]) > 1e-6) {
          throw new Error(`${name}: two primitives under one named part carry different local matrices`);
        }
      }
    }
  }
  return byPart;
}

/** The matrices that place every instance of one part. */
export function instanceMatrices(instances, local) {
  return instances.map((instance) => instanceMatrix(instance.position_m, instance.yaw_deg, instance.scale, local, isWorldSpace(instance)));
}

/**
 * Every placement, as one instanced mesh per (asset, part, alpha kind).
 *
 * `options.ground` is a `GroundSampler`. It is used only to **check** the
 * core's placement against the core's own terrain, never to move anything: if
 * the published ground height disagrees with the published raster, that is a
 * finding a second client is exactly for, and it is counted rather than
 * smoothed away.
 */
export function buildPlacements(placement, assets, options = {}) {
  const group = new Group();
  group.name = "placements";
  const stats = {
    kinds: [],
    instances: 0,
    drawCalls: 0,
    sourceTriangles: 0,
    parts: 0,
    worldSpaceSkipped: 0,
    groundChecked: 0,
    groundMismatched: 0,
    groundMismatch_worst_m: 0,
    groundZDisagrees: 0,
  };
  for (const [assetPath, instances] of [...groupByAsset(placement).entries()].sort()) {
    // Forest instances have their own spatial batches. Drawing them here too
    // would duplicate every tree with full needle geometry.
    if (assetPath.startsWith("redwood/")) continue;
    const asset = assets[assetPath];
    if (!asset) throw new Error(`placement.json names ${assetPath} and no GLB was loaded for it`);
    for (const [partName, primitives] of partsOf(asset)) {
      const askedFor = instances.filter((instance) => (instance.parts ?? []).some((part) => part.mesh === partName));
      const placed = askedFor.filter((instance) => !isWorldSpace(instance));
      stats.worldSpaceSkipped += askedFor.length - placed.length;
      if (!placed.length) continue;
      const local = primitives[0].local;
      for (const materialKind of ["opaque", "glass"]) {
        const merged = mergePrimitives(primitives, materialKind);
        if (!merged) continue;
        const mesh = new InstancedMesh(merged.geometry, merged.material, placed.length);
        mesh.name = `${assetPath}#${partName}:${materialKind}`;
        for (let i = 0; i < placed.length; i += 1) {
          mesh.setMatrixAt(i, instanceMatrix(placed[i].position_m, placed[i].yaw_deg, placed[i].scale, local));
        }
        mesh.instanceMatrix.needsUpdate = true;
        mesh.castShadow = materialKind === "opaque";
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
        stats.drawCalls += 1;
        stats.sourceTriangles += merged.triangles * placed.length;
      }
      stats.parts += 1;
      stats.instances += placed.length;
      stats.kinds.push({ kind: askedFor[0].kind, asset: assetPath, part: partName, count: placed.length });
      if (options.ground) {
        for (const instance of placed) {
          if (instance.ground_z_m === null || instance.ground_z_m === undefined) continue;
          stats.groundChecked += 1;
          if (Math.abs(instance.ground_z_m - instance.position_m[2]) > 1e-6) stats.groundZDisagrees += 1;
          const ground = options.ground.height(instance.position_m[0], instance.position_m[1]);
          if (ground === null) continue;
          const difference = Math.abs(ground - instance.ground_z_m);
          if (difference > 0.05) {
            stats.groundMismatched += 1;
            stats.groundMismatch_worst_m = Math.max(stats.groundMismatch_worst_m, difference);
          }
        }
      }
    }
  }
  group.userData = stats;
  return { group, stats };
}

export { buildStylizedForest as buildForest } from "./forest.js";

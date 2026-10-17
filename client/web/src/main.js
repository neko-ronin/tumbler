/** Wire the fetch, the checks and the canvas together.
 *
 * The order is the point: fetch, **verify what arrived**, decide the
 * orientation from the core's own data, then draw. A viewer that draws before it
 * has checked is a viewer that can confidently show the wrong world.
 */

import { detectAlbedoFlip, extentOf } from "./geometry.js";
import { buildScene, sceneSummary } from "./scene.js";
import { drawFurniture, drawScene } from "./draw.js";
import { drawLegend, drawStamp } from "./stamp.js";
import { digestPartition } from "./digest.js";
import { partitionId } from "./partition_id.js";
import { decodeGroundCover, paintWave, windToward } from "./wave.js";

const SIZE = 2048;

async function fetchJson(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(path) {
  const response = await fetch(path, { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return createImageBitmap(await response.blob());
}

/**
 * sha256 of what arrived, compared with what the generator recorded.
 *
 * `crypto.subtle` needs a secure context, which localhost is. If it is missing
 * the answer is "could not check", never "matches" -- the same rule
 * `preview_frame.py` follows with its MISSING- marker.
 */
async function digestOf(path) {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const response = await fetch(path, { cache: "no-store" });
    const buffer = await response.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Read one RGBA pixel out of an image, in image pixel coordinates. */
function samplerFor(image, extent, flipped) {
  const scratch = document.createElement("canvas");
  scratch.width = image.width;
  scratch.height = image.height;
  const scratchCtx = scratch.getContext("2d", { willReadFrequently: true });
  scratchCtx.drawImage(image, 0, 0);
  const pixels = scratchCtx.getImageData(0, 0, image.width, image.height).data;
  return (worldX, worldY) => {
    const u = (worldX - extent.minX) / extent.width;
    const v = (worldY - extent.minY) / extent.height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const x = Math.min(image.width - 1, Math.max(0, Math.floor(u * image.width)));
    // The image stores row 0 at minimum y; canvas row 0 is the top.
    const y = flipped
      ? Math.min(image.height - 1, Math.floor(v * image.height))
      : image.height - 1 - Math.min(image.height - 1, Math.floor(v * image.height));
    const index = (y * image.width + x) * 4;
    return [pixels[index], pixels[index + 1], pixels[index + 2], pixels[index + 3]];
  };
}

/** The grass wave: C7's travelling front over the cells the core stamped as grass. `?wave=0` turns it off. */
async function startWave(canvas, windDirectionDeg) {
  if (new URLSearchParams(location.search).get("wave") === "0") return canvas.remove();
  const cover = await fetchJson("../../../shared/world/out/ground_cover.json");
  const mask = decodeGroundCover(cover);
  const image = new ImageData(cover.grid.resolution, cover.grid.resolution);
  const wind = windToward(windDirectionDeg);
  canvas.width = canvas.height = cover.grid.resolution;
  const ctx = canvas.getContext("2d");
  const frame = (ms) => {
    paintWave(image, cover.grid, mask, ms / 1000, wind);
    ctx.putImageData(image, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function main() {
  const status = document.getElementById("status");
  const canvas = document.getElementById("map");
  const report = { digestMismatch: [] };
  try {
    status.textContent = "reading the core's committed outputs...";

    const manifest = await fetchJson("data/viewer.json");
    report.commit = manifest.commit;
    report.generator = manifest.generator;
    report.sources = manifest.sources;
    report.heights = manifest.heights;
    report.extent = { ...manifest.extent, width: manifest.extent.max_xy_m[0] - manifest.extent.min_xy_m[0] };

    const [worldmap, placement, world, hillshade, albedo, water] = await Promise.all([
      fetchJson("../../../shared/world/worldmap.json"),
      fetchJson("../../../shared/world/out/placement.json"),
      fetchJson("../../../shared/world/out/world.json"),
      fetchImage("data/hillshade.png"),
      fetchImage("../../../shared/world/out/fields_albedo.png"),
      fetchImage("../../../shared/world/out/water_mask.png"),
    ]);

    // What the stamp says about provenance is checked here, in the browser,
    // against the bytes that actually arrived.
    for (const source of manifest.sources) {
      const actual = await digestOf("../../../" + source.path);
      if (actual === null) {
        report.digestUnchecked = (report.digestUnchecked ?? []).concat(source.path);
      } else if (!actual.startsWith(source.sha256_12)) {
        report.digestMismatch.push(source.path);
      }
    }

    const scene = buildScene({ worldmap, placement, world });
    report.summary = sceneSummary(scene);

    // **The one place this client observes the core rather than its output.**
    // Two comparisons, because they cover different failures:
    //
    //   id_agreed    the agreed binary identity. Spelling-independent, so it is
    //                the one a form should compare and the one that says
    //                "this partition is the same partition".
    //   digest_core  the core's own text digest, reproduced here. Fragile by
    //                construction, and kept precisely because it moves the
    //                moment `digest_partition` is edited — which is the
    //                alarm for "the core changed and the browser's copy has
    //                not".
    //
    // A refusal is a failure, not a pass: `pythonRepr` stops rather than
    // rendering a number it cannot prove it renders like Python.
    const id = await partitionId(world.fields_status);
    report.partitionCore = manifest.partition.id_agreed;
    report.partitionBrowser = id;
    report.partitionAgrees = id === manifest.partition.id_agreed;
    try {
      const reproduced = await digestPartition(world.fields_status);
      report.coreDigestMatches = reproduced === manifest.partition.digest_core;
    } catch (error) {
      report.coreDigestMatches = false;
      report.coreDigestNote = error.message;
    }

    const extent = extentOf(manifest);
    const flip = detectAlbedoFlip(samplerFor(albedo, extent, false), scene.cells);
    report.albedoFlipped = flip.flipped;
    report.flipEvidence = `${flip.agree} cells agree as stored, ${flip.disagree} agree flipped`;
    if (flip.agree === 0 && flip.disagree === 0) {
      report.flipEvidence += " - NEITHER ORIENTATION MATCHES, treat the partition as unverified";
    }

    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext("2d");
    // How big the canvas *looks*, not how big it is. `index.html` lays it out at
    // `min(96vw, 96vh)`, so a 2048px canvas is usually shown at well under half
    // size, and anything sized from `SIZE` is sized for a viewer nobody has.
    // The stamp and the legend are drawn in display terms and converted back.
    const shown = canvas.clientWidth || canvas.width;
    const displayScale = Math.min(1, shown / canvas.width);
    report.displayWidth = Math.round(shown);
    drawScene(ctx, scene, { hillshade, albedo, water }, { size: SIZE, extent, albedoFlipped: flip.flipped });
    drawFurniture(ctx, extent, SIZE, displayScale);
    drawLegend(ctx, scene, SIZE, displayScale);
    drawStamp(ctx, report, SIZE, displayScale);

    startWave(document.getElementById("wave"), worldmap.wind.direction_deg);

    status.textContent = report.digestMismatch.length
      ? `drawn, but ${report.digestMismatch.length} file(s) no longer match the digests in this page`
      : `drawn from ${report.summary.instances} committed instances`;
    document.title = "tumbler - world map (web viewer)";
  } catch (error) {
    status.textContent = `FAIL: ${error.message}. Serve the repository root, not client/web — see client/web/README.md.`;
    throw error;
  }
}

main();

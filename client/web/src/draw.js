/** The only file that touches a canvas. Every number it draws comes from a file.
 *
 * Layers, bottom to top:
 *   1. the map's crop green, because `fields_albedo.png` is alpha-0 off the
 *      farmland and the docs say the green fills in there
 *   2. relief, from `client/web/data/hillshade.png` — see the note on that file
 *   3. the field partition, the core's own `fields_albedo.png`, V-flipped as
 *      detected from the core's own cell data
 *   4. water, the core's carved `water_mask.png`
 *   5. the declared water descriptors, as annotations
 *   6. the core's partition edges, drawn from `world.json` — a hedge line the
 *      core found, not one found here
 *   7. the camera path and the 1,422 placements
 *
 * Nothing here computes world geometry. If a number is not in a fetched file it
 * does not appear.
 */

import { project } from "./geometry.js";

const INK = "#20261f";
const PAPER = "#f4f1e6";

/** A kind colour that is distinguishable and says it is not the world's colour. */
const KIND_COLOURS = {
  house: "#c2410c",
  greenhouse: "#65a30d",
  water_tower: "#0369a1",
  turbine: "#e2e8f0",
  blob: "#a78bfa",
  orchard_tree: "#15803d",
  hedgerow_tree: "#166534",
  mooring_mast: "#0f766e",
  hardstanding: "#78716c",
  river: "#0891b2",
  lake: "#0891b2",
  blimp: "#f59e0b",
};

export function colourForKind(kind) {
  return KIND_COLOURS[kind] ?? "#64748b";
}

export function drawScene(ctx, scene, images, options = {}) {
  const size = options.size ?? 2048;
  const extent = options.extent;

  ctx.save();
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, size, size);

  // 1. crop green under everything, as the albedo is transparent off the farmland
  ctx.fillStyle = scene.cropGreen;
  ctx.fillRect(0, 0, size, size);

  // 2. relief, multiplied so the green reads as ground
  if (images.hillshade) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = 0.85;
    ctx.drawImage(images.hillshade, 0, 0, size, size);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  // 3. the field partition, oriented by what the core's cell data says
  if (images.albedo) {
    ctx.save();
    ctx.translate(0, size);
    ctx.scale(1, options.albedoFlipped ? -1 : 1);
    ctx.drawImage(images.albedo, 0, 0, size, size);
    ctx.restore();
  }

  // 4. the core's carve
  if (images.water) {
    ctx.globalAlpha = 0.75;
    ctx.drawImage(images.water, 0, 0, size, size);
    ctx.globalAlpha = 1;
  }

  drawWaterAnnotations(ctx, scene, extent, size);
  drawPartitionEdges(ctx, scene, extent, size);
  drawCameraPath(ctx, scene, extent, size);
  drawPlacements(ctx, scene, extent, size);
  ctx.restore();
}

function strokeWorld(ctx, points, extent, size, style, width, dash = []) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash(dash);
  ctx.beginPath();
  points.forEach((point, index) => {
    const p = project(point, extent, size);
    if (index === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawWaterAnnotations(ctx, scene, extent, size) {
  for (const body of scene.water) {
    if (body.polyline.length > 1) {
      strokeWorld(ctx, body.polyline, extent, size, "#e0f2fe", size / 900, [size / 60, size / 60]);
    }
    if (body.centre_xy_m && body.size_m) {
      const centre = project(body.centre_xy_m, extent, size);
      ctx.save();
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = size / 900;
      ctx.beginPath();
      ctx.arc(centre.x, centre.y, (Number(body.size_m) / extent.width) * size, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }
}

function drawPartitionEdges(ctx, scene, extent, size) {
  // `partition_edges` is the core's own list of internal parcel boundaries. It
  // is drawn here and computed nowhere here.
  for (const edge of scene.edges) {
    strokeWorld(
      ctx,
      [
        [Number(edge.x0), Number(edge.y0)],
        [Number(edge.x1), Number(edge.y1)],
      ],
      extent,
      size,
      scene.hedgerowHex,
      size / 700,
    );
  }
}

function drawCameraPath(ctx, scene, extent, size) {
  strokeWorld(ctx, scene.camera.points, extent, size, "#b91c1c", size / 420);
  scene.camera.points.forEach((point, index) => {
    const p = project(point, extent, size);
    ctx.save();
    ctx.fillStyle = "#b91c1c";
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = size / 1400;
    ctx.beginPath();
    ctx.arc(p.x, p.y, size / 90, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PAPER;
    ctx.font = `${Math.round(size / 110)}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(String(index), p.x, p.y - size / 60);
    ctx.restore();
  });
}

function drawPlacements(ctx, scene, extent, size) {
  const radius = Math.max(1, size / 900);
  for (const group of scene.placements) {
    ctx.save();
    ctx.fillStyle = colourForKind(group.kind);
    for (const mark of group.marks) {
      const p = project(mark, extent, size);
      // Blimps and turbines are landmarks; the 1,369 vegetation instances are a
      // texture. Both are drawn, and the legend gives the counts, so the
      // picture does not have to flatter itself.
      const big = ["blimp", "turbine", "water_tower", "greenhouse", "mooring_mast", "hardstanding"].includes(group.kind);
      ctx.beginPath();
      ctx.arc(p.x, p.y, big ? radius * 3 : radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** North arrow and a scale bar, so the picture is readable as a map. */
export function drawFurniture(ctx, extent, size, displayScale = 1) {
  // Same reasoning as the stamp: the canvas is laid out smaller than it is, so
  // a font derived from `size` alone shrinks below reading on a laptop. These
  // two are the map's own furniture and were legible at 2048; the floor keeps
  // them legible when the window is smaller still.
  const scale = displayScale > 0 ? displayScale : 1;
  const fit = (divisor) => Math.round(Math.max(size / divisor, 11 / scale));
  ctx.save();
  ctx.fillStyle = INK;
  ctx.font = `${fit(58)}px monospace`;
  ctx.textAlign = "left";

  const metres = 1000;
  const barPx = (metres / extent.width) * size;
  const x = size * 0.03;
  const y = size * 0.93;
  ctx.fillRect(x, y, barPx, size / 320);
  ctx.fillRect(x, y - size / 200, size / 700, size / 200 + size / 320);
  ctx.fillRect(x + barPx - size / 700, y - size / 200, size / 700, size / 200 + size / 320);
  ctx.fillText(`${metres} m`, x + barPx + size / 60, y + size / 120);

  ctx.font = `${fit(44)}px monospace`;
  ctx.textAlign = "center";
  ctx.fillText("N", size * 0.965, size * 0.055);
  ctx.beginPath();
  ctx.moveTo(size * 0.965, size * 0.065);
  ctx.lineTo(size * 0.955, size * 0.105);
  ctx.lineTo(size * 0.975, size * 0.105);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

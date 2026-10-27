/** The corner stamp and the legend.
 *
 * The stamp exists because of a rule this project has paid for: **a map drawn
 * from stale data and a map drawn from current data look identical.**
 * `client/ue/scripts/preview_frame.py` burns its inputs' digests into its
 * frames for the same reason, and a frame with no signal is stamped as such.
 * So this draws:
 *
 *   - what this picture is NOT (not an engine frame, not a render, not the core
 *     running in a browser)
 *   - the commit the data was generated at
 *   - the sha256 of every file it fetched, re-checked in the browser
 *   - the counts it actually drew
 *   - the orientation it detected, because getting that wrong mirrors the world
 */

import { colourForKind } from "./draw.js";

/**
 * The stamp's verdict on the two implementations, as data rather than as a
 * string buried in a canvas call.
 *
 * Extracted so it can be tested without a canvas, which matters more than it
 * looks: a check that only fires when somebody opens the page is a check that
 * does not run. This is the branch, and it is the thing that goes red.
 */
export function partitionVerdict(report) {
  if (report.partitionAgrees === undefined) {
    return { text: "partition digest NOT COMPUTED - the cross-check did not run", wrong: true };
  }
  if (report.partitionAgrees) {
    return {
      text: `partition REPRODUCED in-browser: core ${report.partitionCore} = browser ${report.partitionBrowser}`,
      wrong: false,
    };
  }
  return {
    text: `PARTITION DRIFT: core ${report.partitionCore} vs browser ${report.partitionBrowser}`,
    wrong: true,
  };
}

/** Smallest type this client will draw, in CSS pixels on the reader's screen. */
export const MIN_STAMP_CSS_PX = 12;

/**
 * The stamp's geometry, in canvas units, derived from how big the canvas
 * actually *looks*.
 *
 * ## Why this function exists
 *
 * The stamp was invisible, and the reason was not contrast, not layering and
 * not a cross-check that silently skipped. It was this: `index.html` lays the
 * 2048px canvas out at `min(96vw, 96vh)`, so the canvas is **downscaled** to
 * the viewport, and the font was computed from the 2048. The stamp drew
 * correctly at 17 canvas pixels — which is 7.2 CSS pixels on a 1440x900
 * screen, and about a fifth of a character of readable height.
 *
 * The furniture text was `size / 58` and the stamp `size / 118`, so the scale
 * bar was legible and the stamp was not. That is exactly the failure this
 * client exists to prevent: something that draws, and draws correctly, and is
 * invisible on the machine a person is actually using.
 *
 * So the font is now chosen in **display** terms and converted back into canvas
 * units, and it is then shrunk if the box would not fit. Both directions are
 * tested in `tests/stamp_layout.test.mjs` across viewports from 600px to
 * 3000px, because a stamp that only appears at one resolution is a stamp that
 * will disappear again.
 */
export function stampLayout(lines, size, displayScale, minCss = MIN_STAMP_CSS_PX) {
  const scale = displayScale > 0 ? displayScale : 1;
  // A corner panel, not a banner across the map: 62% of the width, so the
  // picture is still the picture. It wraps to fit rather than shrinking, because
  // shrinking below the legibility floor is the bug being fixed.
  const target = size * 0.62;
  // size/118 is what looks right at 1:1; the floor is what is still readable
  // after the browser has shrunk the canvas. Ceil, not round: rounding down put
  // the type half a pixel under its own floor at 1280x800, which is the same
  // class of bug as the one being fixed.
  const floor = minCss / scale;
  const start = Math.max(size / 118, floor);

  for (let font = Math.ceil(start); font >= 6; font -= 1) {
    const maxChars = Math.max(20, Math.floor((target - font * 2) / (font * 0.6)));
    const wrapped = lines.flatMap((line) => wrap(line, maxChars));
    const lineHeight = Math.round(font * 1.35);
    const boxHeight = wrapped.length * lineHeight + font * 2;
    // Leave the map visible: the stamp is an annotation, not the picture.
    if (boxHeight <= size * 0.6 && wrapped.length <= 40) {
      return {
        font,
        lineHeight,
        pad: font,
        boxWidth: Math.min(target, Math.max(...wrapped.map((l) => l.length)) * font * 0.6 + font * 2),
        boxHeight,
        lines: wrapped,
        minCss,
      };
    }
  }
  // Nothing fit at the floor: draw the floor anyway, wrapped as tightly as it
  // goes. A small box is better than an unreadable one, and the content is the
  // whole point of the stamp.
  const font = Math.max(6, Math.floor(floor));
  const maxChars = Math.max(20, Math.floor((target - font * 2) / (font * 0.6)));
  const wrapped = lines.flatMap((line) => wrap(line, maxChars));
  const lineHeight = Math.round(font * 1.35);
  return {
    font,
    lineHeight,
    pad: font,
    boxWidth: target,
    boxHeight: wrapped.length * lineHeight + font * 2,
    lines: wrapped,
    minCss,
  };
}

/** Break one line at `width` characters, on spaces where there are any. */
function wrap(line, width) {
  if (line.length <= width) return [line];
  const out = [];
  let rest = line;
  while (rest.length > width) {
    let cut = rest.lastIndexOf(" ", width);
    if (cut <= 0) cut = width;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, "");
  }
  if (rest) out.push(rest);
  return out;
}

/** The legend's geometry, same reasoning and same floor. */
export function legendLayout(rowCount, size, displayScale, minCss = MIN_STAMP_CSS_PX) {
  const scale = displayScale > 0 ? displayScale : 1;
  let font = Math.ceil(Math.max(size / 128, minCss / scale));
  while (font > 6 && font * 15 + font * 1.6 > size * 0.4) font -= 1;
  return {
    font,
    lineHeight: Math.round(font * 1.5),
    pad: Math.round(font * 0.8),
    boxWidth: font * 15 + font * 1.6,
    boxHeight: rowCount * Math.round(font * 1.5) + font * 1.6,
    minCss,
  };
}

/** Where the stamp goes, in canvas units. Pure, so a test can check it stays on. */
export function stampOrigin(box, size) {
  return { x: size - box.boxWidth - box.font, y: size - box.boxHeight - box.font };
}

/** What the stamp says. Pure, so a test can measure the geometry it produces. */
export function stampLines(report) {
  return [
    "WEB VIEWER - CORE OUTPUT - NOT AN ENGINE RENDER",
    "a browser cannot run Python: this draws the core's committed files, not the core",
    report.displayWidth ? `shown at ${report.displayWidth} css px wide` : "",
    `data commit ${report.commit ?? "unknown"}`.trim(),
    ...report.sources.map((source) => `  ${source.sha256_12}  ${source.path.split("/").slice(-2).join("/")}`),
    `terrain ${report.heights.min_m.toFixed(1)}-${report.heights.max_m.toFixed(1)} m over ${report.extent.width} m`,
    `drew ${report.summary.instances} instances in ${report.summary.kinds} kinds, `
      + `${report.summary.cameraKeyframes} keyframes, `
      + `${report.summary.waterBodies} water bodies`,
    report.albedoFlipped
      ? `fields_albedo.png read SOUTH-UP and flipped (${report.flipEvidence})`
      : `fields_albedo.png read north-up as stored (${report.flipEvidence})`,
    partitionVerdict(report).text,
    report.coreDigestMatches === undefined
      ? "the core's text digest was not checked"
      : report.coreDigestMatches
        ? "core text digest reproduced as well - both identities agree"
        : "CORE TEXT DIGEST NOT REPRODUCED - digest_partition changed, or this copy is stale",
    report.digestMismatch.length
      ? `DIGEST MISMATCH: ${report.digestMismatch.join(", ")} - the data moved since this page was built`
      : "every fetched file matches the digest recorded when this page was built",
    `generated by ${report.generator}`,
  ];
}

/** The lines with the empty ones dropped: an absent field is not a blank line. */
export function stampText(report) {
  return stampLines(report).filter((line) => line !== "");
}

export function drawStamp(ctx, report, size, displayScale = 1) {
  const box = stampLayout(stampText(report), size, displayScale);
  const lines = box.lines;
  const { x, y } = stampOrigin(box, size);

  // Bottom-right, and proportionally: that is where a person looks for
  // provenance, and it is the one corner the legend (top right) and the scale
  // bar (bottom left) do not already occupy.

  ctx.save();
  ctx.fillStyle = "rgba(20, 24, 20, 0.86)";
  ctx.fillRect(x, y, box.boxWidth, box.boxHeight);
  // Red on a file digest mismatch, on the two identities disagreeing, or on the
  // core's text digest no longer reproducing. A drifted second implementation is
  // the worst of the three: one of them is wrong and nothing in Python can say which.
  const wrong =
    partitionVerdict(report).wrong || report.digestMismatch.length > 0 || report.coreDigestMatches === false;
  ctx.font = `${box.font}px monospace`;
  ctx.textBaseline = "top";
  ctx.fillStyle = wrong ? "#fca5a5" : "#e7e5e4";
  lines.forEach((line, index) => {
    ctx.fillText(line, x + box.pad, y + box.pad + index * box.lineHeight);
  });
  ctx.restore();
}

export function drawLegend(ctx, scene, size, displayScale = 1) {
  const rows = scene.placements.map((group) => [colourForKind(group.kind), group.kind, group.marks.length]);
  const box = legendLayout(rows.length, size, displayScale);
  const { font, lineHeight, pad } = box;
  const x = size - box.boxWidth - font;
  const y = font;

  ctx.save();
  ctx.fillStyle = "rgba(20, 24, 20, 0.86)";
  ctx.fillRect(x, y, box.boxWidth, box.boxHeight);
  ctx.font = `${font}px monospace`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  rows.forEach(([colour, kind, count], index) => {
    const rowY = y + pad + index * lineHeight + lineHeight / 2;
    ctx.fillStyle = colour;
    ctx.fillRect(x + pad, rowY - font * 0.28, font * 0.7, font * 0.56);
    ctx.fillStyle = "#e7e5e4";
    ctx.fillText(`${kind} ${count}`, x + pad + font * 1.4, rowY);
  });
  ctx.restore();
}

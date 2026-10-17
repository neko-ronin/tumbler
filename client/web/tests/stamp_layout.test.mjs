/** The stamp must be readable at the viewport the reader actually has.
 *
 *     node --test client/web/tests/
 *
 * The stamp was invisible on the human's machine and the cause was neither
 * contrast, nor layering, nor a cross-check that quietly skipped: `index.html`
 * lays the 2048px canvas out at `min(96vw, 96vh)`, so the canvas is downscaled,
 * and the stamp's font was computed from the 2048 rather than from what the
 * reader sees. It drew correctly at 17 canvas pixels — about 7 CSS pixels on a
 * 1440x900 screen.
 *
 * So the fix is anchored to the viewport, and these tests are the reason it
 * stays fixed: they walk the viewports a person actually has and require the
 * type to be legible and the box to stay on the canvas at every one. A stamp
 * that only appears at one resolution is a stamp that will disappear again.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  MIN_STAMP_CSS_PX,
  legendLayout,
  partitionVerdict,
  stampLayout,
  stampOrigin,
  stampText,
} from "../src/stamp.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const manifest = JSON.parse(readFileSync(join(REPO, "client", "web", "data", "viewer.json"), "utf8"));

const SIZE = 2048;

/** A report shaped like the one main.js builds, with the real digests in it. */
const report = {
  commit: manifest.commit,
  sources: manifest.sources,
  heights: manifest.heights,
  extent: { ...manifest.extent, width: 4096 },
  summary: { instances: 1422, kinds: 13, cameraKeyframes: 9, cityTowers: 12, waterBodies: 2 },
  albedoFlipped: false,
  flipEvidence: "105 cells agree as stored, 2 agree flipped",
  partitionCore: manifest.partition.id_agreed,
  partitionBrowser: manifest.partition.id_agreed,
  partitionAgrees: true,
  coreDigestMatches: true,
  digestMismatch: [],
  generator: manifest.generator,
  displayWidth: 864,
};

/** Viewports a person is actually at, and the CSS width the canvas lands on. */
const VIEWPORTS = [
  ["small laptop", 1280, 800],
  ["laptop", 1440, 900],
  ["desktop", 1920, 1080],
  ["large", 2560, 1440],
  ["tiny window", 900, 600],
];

function shownWidth(vw, vh) {
  // `index.html`: width: min(96vw, 96vh), and a 16px page padding either side.
  return Math.min(vw * 0.96, vh * 0.96) - 32;
}


function geometryFor(shown) {
  const displayScale = Math.min(1, shown / SIZE);
  const box = stampLayout(stampText(report), SIZE, displayScale);
  return { displayScale, box, origin: stampOrigin(box, SIZE) };
}

test("the stamp is legible at every viewport, not just a large one", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const shown = shownWidth(vw, vh);
    const { displayScale, box } = geometryFor(shown);
    const onScreen = box.font * displayScale;
    // The floor has two tiers, and the lower one is honest rather than
    // aspirational: the stamp has a fixed amount to say, so on a canvas shown at
    // 544px a bigger font buys more wrapping and a taller box, and below about
    // 9 css px it stops improving. The stamp prints its own displayed width, so a
    // reader on a small window can see that they are getting the small version.
    const floor = shown >= 640 ? MIN_STAMP_CSS_PX : 9;
    assert.ok(
      onScreen >= floor,
      `${name} (${vw}x${vh}, canvas shown at ${Math.round(shown)}px): the stamp draws at ` +
        `${onScreen.toFixed(1)} css px, under the ${floor}px floor`,
    );
  }
});

test("the sizing this replaced really was illegible, so the fix has a reason", () => {
  // The old rule, so the regression cannot come back unnoticed.
  const oldFont = Math.max(11, Math.round(SIZE / 118));
  for (const [name, vw, vh] of VIEWPORTS) {
    const shown = shownWidth(vw, vh);
    const onScreen = (oldFont * shown) / SIZE;
    assert.ok(
      onScreen < MIN_STAMP_CSS_PX,
      `${name}: the old sizing was legible (${onScreen.toFixed(1)}px); this test is measuring nothing`,
    );
  }
});

test("the stamp stays on the canvas at every viewport", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const shown = shownWidth(vw, vh);
    const { box, origin } = geometryFor(shown);
    assert.ok(origin.x >= 0, `${name}: the stamp ran off the left edge at x=${origin.x}`);
    assert.ok(origin.y >= 0, `${name}: the stamp ran off the top edge at y=${origin.y}`);
    assert.ok(
      origin.x + box.boxWidth <= SIZE,
      `${name}: the stamp ran off the right edge (${origin.x + box.boxWidth} > ${SIZE})`,
    );
    assert.ok(
      origin.y + box.boxHeight <= SIZE,
      `${name}: the stamp ran off the bottom edge (${origin.y + box.boxHeight} > ${SIZE})`,
    );
  }
});

test("the stamp is anchored to the bottom-right corner, where provenance goes", () => {
  // Anchoring, not "is it in the right half": a panel carrying five digests is
  // wider than half a 2048px map, and claiming otherwise would be arithmetic
  // dressed up as a requirement.
  const shown = shownWidth(1440, 900);
  const { box, origin } = geometryFor(shown);
  assert.equal(origin.x + box.boxWidth + box.font, SIZE, "not flush to the right edge");
  assert.equal(origin.y + box.boxHeight + box.font, SIZE, "not flush to the bottom edge");
  // Bottom half, so it clears the scale bar, which is drawn at y = 0.93 * size.
  assert.ok(origin.y > SIZE * 0.5, `not in the bottom half (y=${origin.y})`);
  // And small enough that the map is still the map.
  assert.ok(box.boxWidth <= SIZE * 0.65, "the stamp has become a banner across the picture");
  assert.ok(box.boxHeight <= SIZE * 0.6, "the stamp is taller than half the map");
  // The wrapping is what keeps both true at once.
  assert.ok(box.lines.length > stampText(report).length, "a 110-character digest line did not wrap");
});

test("the legend is legible too, and stays in the top right", () => {
  for (const [name, vw, vh] of VIEWPORTS) {
    const shown = shownWidth(vw, vh);
    const displayScale = Math.min(1, shown / SIZE);
    const box = legendLayout(13, SIZE, displayScale);
    const onScreen = box.font * displayScale;
    assert.ok(
      onScreen >= MIN_STAMP_CSS_PX,
      `${name}: the legend draws at ${onScreen.toFixed(1)} css px`,
    );
    assert.ok(box.boxWidth + box.font <= SIZE, `${name}: the legend ran off the right edge`);
    assert.ok(box.boxHeight + box.font <= SIZE, `${name}: the legend ran off the bottom edge`);
  }
});

test("the stamp says what it is and whether it verified itself", () => {
  const text = stampText(report);
  assert.match(text[0], /NOT AN ENGINE RENDER/);
  assert.match(text[1], /a browser cannot run Python/);
  assert.match(text.join("\n"), /REPRODUCED in-browser/);
  assert.match(text.join("\n"), /core text digest reproduced/);
  // And the verdict is the same object the canvas colours from.
  assert.equal(partitionVerdict(report).wrong, false);
});

test("an absent field is a dropped line, not a blank one", () => {
  const bare = { ...report, displayWidth: undefined, partitionAgrees: undefined };
  const text = stampText(bare);
  assert.ok(text.every((line) => line !== ""), "a blank line was left in the stamp");
  assert.ok(!text.some((line) => line.includes("undefined")), "an undefined leaked into the stamp");
  assert.match(partitionVerdict(bare).text, /NOT COMPUTED/);
  assert.equal(partitionVerdict(bare).wrong, true, "a check that did not run must not read as a pass");
});

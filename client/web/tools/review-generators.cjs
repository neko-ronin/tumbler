/** Matched stills of a generator's rotor over time, to judge that it turns.
 * NODE_PATH=<existing node_modules> node client/web/tools/review-generators.cjs <label>
 * TUMBLER_REVIEW_URL selects the server (default 8046); output/playwright/generators/<label>-<kind>-t<seconds>.png
 *
 * The rotors are animation, so a single still cannot judge them. This pins the
 * camera and the clock, then captures one ridge turbine and one flying hull at
 * named times and records the browser's own fleet statistics for each frame.
 */
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const label = process.argv[2] || "candidate";
const out = path.resolve("output/playwright/generators");
fs.mkdirSync(out, { recursive: true });
const chrome = process.env.CHROME_PATH;
const times = [0, 1.5, 3, 4.5, 6];

// Where the camera stands for each kind: offset from the hub in scene metres.
const FRAMES = {
  turbine: { rise: 90, offset: [210, 35, 190] },
  blimp: { rise: 0, offset: [150, 45, 130] },
};

(async () => {
  const browser = await chromium.launch({
    headless: false,
    ...(chrome ? { executablePath: chrome } : { channel: "chrome" }),
    args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  const report = { label, times, frames: {}, framed: {}, errors };
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.addInitScript(() => Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [] }));

  try {
    await page.goto((process.env.TUMBLER_REVIEW_URL || "http://127.0.0.1:8046") + "/client/web/scene.html");
    await page.waitForFunction(() => window.tumbler && document.body.classList.contains("ready"), null, { timeout: 240000 });

    await page.evaluate(() => {
      const t = tumbler;
      t.navigation.select("orbit");
      const adaptive = document.getElementById("adaptive");
      if (adaptive) adaptive.checked = false;
      t.navigation.update = () => {};
      t.controls.enabled = false;
      if (t.flightRig) t.flightRig.group.visible = false;
      if (t.character) t.character.object.visible = false;
      window.__genStats = () => ({ ...t.generators.stats });
    });

    for (const [kind, frame] of Object.entries(FRAMES)) {
      const placed = await page.evaluate(async ({ kind, frame }) => {
        const placement = await (await fetch("/shared/world/out/placement.json")).json();
        const instance = placement.instances.find((i) => i.kind === kind);
        if (!instance) return null;
        const [x, y, z] = instance.position_m;
        // World (x, y, z) becomes scene (x, z, -y). The hub stands `rise` above
        // the placed point; the camera sits a fixed offset from it.
        const hub = [x, z + frame.rise, -y];
        const t = tumbler;
        t.camera.position.set(hub[0] + frame.offset[0], hub[1] + frame.offset[1], hub[2] + frame.offset[2]);
        t.camera.lookAt(...hub);
        t.camera.fov = 55;
        t.camera.updateProjectionMatrix();
        t.camera.updateMatrixWorld();
        return { tags: instance.tags, hub };
      }, { kind, frame });
      report.framed[kind] = placed;
      if (!placed) continue;
      await page.waitForTimeout(2200);
      const start = Date.now();
      report.frames[kind] = {};
      for (const at of times) {
        const wait = at * 1000 - (Date.now() - start);
        if (wait > 0) await page.waitForTimeout(wait);
        await page.screenshot({ path: `${out}/${label}-${kind}-t${at}.png` });
        report.frames[kind][at] = await page.evaluate(() => window.__genStats());
      }
    }
  } catch (error) {
    report.fatal = String(error);
  } finally {
    fs.writeFileSync(`${out}/${label}-report.json`, JSON.stringify(report, null, 2));
    await browser.close().catch(() => {});
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
})();

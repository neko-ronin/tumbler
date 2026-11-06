// S0 tumble spike capture (throwaway, docs/design/S0-TUMBLE-SPIKE.md). Paste into the console of
// client/web/scene.html once it reads 'Ready', with client/web/tools/s0_upload.py serving a folder on
// 127.0.0.1:8148. Then e.g. await spike.run({mode:'s0', name:'snow-s0', x:-80, y:2280, heading:.62}).
// It pauses the page's own frame loop and steps the game at a fixed 1/60 s, because a background
// window gets ~2 fps; frame strips are taken after the scene's final pass (a hidden pane's
// screenshots are blank). Strips are not tracked: this regenerates them.
window.spike = (() => {
  const t = tumbler, nav = t.navigation, folk = t.folkLayer, cam = t.camera, floor = nav.sampleFloor;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const realRaf = window.requestAnimationFrame.bind(window); let held = [];
  const pause = () => { window.requestAnimationFrame = cb => { held.push(cb); return 0; }; };
  const resume = () => { window.requestAnimationFrame = realRaf; const h = held; held = []; for (const cb of h) realRaf(cb); };
  const pct = (a, q) => { const o = [...a].sort((x, y) => x - y); return o[Math.floor((o.length - 1) * q)]; };
  const DOWN = ['trip', 'tumble', 'slide', 'recover', 'roll'];
  function view(p, heading, side, dist) {
    const px = -Math.sin(heading) * side, py = Math.cos(heading) * side, x = p.x + px * dist, y = p.y + py * dist;
    cam.position.set(x, Math.max(p.z + 1.1, (floor(x, y) ?? p.z) + 1), -y); cam.lookAt(p.x, p.z + .35, -p.y); cam.updateMatrixWorld();
  }
  /** who: 'player' or a cat id. */
  async function run({ mode, name, who = 'player', x, y, heading, v = 5, seconds = 5, every = .2, side = 1, dist = 3.5, cols = 5, start = 'trip', w = 320, h = 200, dt = 1 / 60, settle = 1, strip = true }) {
    t.setTumbleMode(mode);
    if (nav.mode !== 'walk') t.toTumbleHill();
    await sleep(50); pause(); await sleep(50);
    const cat = who === 'player' ? null : t.folk.world.cats.find(c => c.id === who);
    const body = () => cat ? cat.body.state : nav.state;
    if (cat) { nav.placeOnFoot(x - Math.cos(heading) * 12, y - Math.sin(heading) * 12, heading); cat.body.state = { ...cat.body.state, x, y, z: floor(x, y), heading, speed: 0, vx: 0, vy: 0, balance: undefined, mode: 'walk' }; cat.plan = []; cat.controller = 'agent'; cat.step = { kind: 'go', to: [x + Math.cos(heading) * 150, y + Math.sin(heading) * 150], pace: 'walk' }; }
    else nav.placeOnFoot(x, y, heading);
    const onFoot = () => nav.state;
    const step = () => { nav.update(dt); folk.update(dt, onFoot()); };
    for (let i = 0; i < settle / dt; i++) step();
    const s = body(), vx = Math.cos(heading) * v, vy = Math.sin(heading) * v;
    Object.assign(s, { x, y, z: floor(x, y), vx, vy, speed: v, heading, balance: { phase: start, budget: start === 'roll' ? 1 : 0, t: 0, vx, vy, spin: 0, auto: start === 'roll', tuckHeld: false, load: 0 } });
    const n = Math.round(seconds / every), rows = Math.ceil(n / cols), canvas = document.createElement('canvas');
    canvas.width = w * cols; canvas.height = h * rows; const g = canvas.getContext('2d'); g.font = '14px sans-serif';
    const tr = t.character.spike.trace = [], ms = [], air = []; let k = 0;
    const st = cat ? null : t.character.spike.body.state;
    for (let i = 0; i * dt < seconds; i++) {
      const a = performance.now(); step(); ms.push(performance.now() - a);
      if (st) air.push(st.air);
      const p = body(); view(p, heading, side, dist);
      if (strip && i * dt >= k * every && k < n) {
        t.cloudPass.render({ speed: 0, strength: 0 });
        const c = t.renderer.domElement, sw = c.width * .7, sh = sw * h / w, X = (k % cols) * w, Y = Math.floor(k / cols) * h;
        g.drawImage(c, (c.width - sw) / 2, (c.height - sh) / 2, sw, sh, X, Y, w, h);
        g.fillStyle = '#000a'; g.fillRect(X, Y, 200, 20); g.fillStyle = '#fff';
        g.fillText(`${mode} ${(i * dt).toFixed(2)}s ${p.balance?.phase ?? 'steady'}`, X + 4, Y + 15); k++;
      }
      if (i % 30 === 0) await sleep(0);
    }
    t.character.spike.trace = null; resume();
    if (strip) { const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', .85)); await fetch(`http://127.0.0.1:8148/${name}.jpg`, { method: 'PUT', body: blob }); }
    const down = tr.filter(f => DOWN.includes(f.phase)), mx = q => Math.max(0, ...down.map(f => f.dip[q]));
    const dms = ms.filter((_, i) => DOWN.includes(tr[i]?.phase));
    return { name, mode, who, phases: [...new Set((cat ? [] : tr).map(f => f.phase))].join('>'),
      dipCm: [mx('head'), mx('paw'), mx('trunk'), mx('foot')].map(z => Math.round(z * 100)).join(' / '),
      dipped: +(down.filter(f => Math.max(f.dip.head, f.dip.paw, f.dip.trunk) > .02).length / Math.max(1, down.length)).toFixed(2),
      floats: +(down.filter(f => f.clear > .05).length / Math.max(1, down.length)).toFixed(2),
      air: air.length ? +(air.filter(Boolean).length / air.length).toFixed(2) : null,
      accP50P99: [pct(down.map(f => f.acc), .5), pct(down.map(f => f.acc), .99)].map(Math.round).join(' / '),
      stepMs: { mean: +(dms.reduce((a, b) => a + b, 0) / Math.max(1, dms.length)).toFixed(3), p95: +(pct(dms, .95) ?? 0).toFixed(2) },
      end: [+body().x.toFixed(1), +body().y.toFixed(1), +body().z.toFixed(1)] };
  }
  /** Find steep ground of a surface near (x, y): samples a grid, returns the steepest few. */
  function find(surface, x, y, r = 400, stepM = 8, minGrade = .4) {
    const out = [], sa = t.ride.surfaceAt, snow = t.ride.snowAt;
    for (let dx = -r; dx <= r; dx += stepM) for (let dy = -r; dy <= r; dy += stepM) {
      const X = x + dx, Y = y + dy, e = floor(X + 1, Y), wv = floor(X - 1, Y), nn = floor(X, Y + 1), so = floor(X, Y - 1);
      if (![e, wv, nn, so].every(Number.isFinite)) continue;
      const gx = (e - wv) / 2, gy = (nn - so) / 2, grade = Math.hypot(gx, gy);
      const surf = snow(X, Y) > .03 ? 'snow' : 'other';
      if (grade >= minGrade && (surface === 'snow') === (surf === 'snow')) out.push({ x: X, y: Y, grade: +grade.toFixed(2), downhill: Math.atan2(-gy, -gx) });
    }
    return out.sort((a, b) => b.grade - a.grade);
  }
  return { run, find, pause, resume };
})();

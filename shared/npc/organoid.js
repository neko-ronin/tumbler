/** The authored Organoid encounter. Coordinates use the shared east/north/up
 * convention. The caller supplies the same ground and solid checks as walking. */
const mix = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const unit = (x, y) => {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
};

export function createOrganoidEncounter(config, {height, hit}) {
  const tree = config.cover_tree_xy_m;
  const approach = config.approach_xy_m;
  const away = unit(tree[0] - approach[0], tree[1] - approach[1]);
  const right = [-away[1], away[0]];
  const offset = (a, b) => [tree[0] + away[0] * a + right[0] * b, tree[1] + away[1] * a + right[1] * b];
  const lift = (x, y) => {
    const z = height(x, y);
    return [x, y, Number.isFinite(z) ? z + config.hover_m : NaN];
  };
  const perch = offset(config.detour_m, .84);
  const home = lift(...perch);
  let position = home, phase = 'watch', target = null, path = null, travel = 0;
  let segment = 0, elapsed = 0, sleepTime = 0, side = 1;

  function startWake(player) {
    for (const angle of [.9, -.9, 1.32, -1.32, .5, -.5]) {
      const heading = player.heading + angle;
      const x = player.x + Math.cos(heading) * 2.8;
      const y = player.y + Math.sin(heading) * 2.8;
      const next = lift(x, y);
      if (!next.every(Number.isFinite) || Math.abs(next[2] - config.hover_m - player.z) > .8 ||
          hit([player.x, player.y, player.z + config.hover_m], next, config.radius_m + .08)) continue;
      position = next;
      target = {x: player.x, y: player.y, z: player.z, heading: player.heading};
      side = -Math.sign(angle);
      phase = 'talk';
      return 'wake';
    }
    return null;
  }

  function routeFor(player, flank, start) {
    const [dx, dy] = unit(tree[0] - player.x, tree[1] - player.y);
    const stop = [player.x + dx * config.stop_m - dy * .44 * flank,
      player.y + dy * config.stop_m + dx * .44 * flank];
    const path = [start.slice(0, 2), ...[.52, 1.10, 1.70, 2.30, 2.86].map(angle =>
      offset(config.detour_m * Math.cos(angle), config.detour_m * Math.sin(angle) * flank)), stop];
    // Check the actual terrain-following sweep, including the last segment.
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .36);
      let prev = lift(...a);
      for (let j = 1; j <= count; j++) {
        const next = lift(mix(a[0], b[0], j / count), mix(a[1], b[1], j / count));
        if (!next.every(Number.isFinite) || hit(prev, next, config.radius_m + .08)) return null;
        prev = next;
      }
    }
    return path;
  }

  function update(dt, player, canStart = true, asleep = false) {
    if (phase === 'watch') {
      elapsed += dt;
      const distance = player ? Math.hypot(player.x - tree[0], player.y - tree[1]) : Infinity;
      // A few centimetres of motion at the trunk's edge reads as watching,
      // without drawing a floating patrol across the open slope.
      if (distance < 50) {
        const peek = .36 + .36 * Math.sin(elapsed * .37);
        position = lift(...offset(config.detour_m, .84 + peek));
      } else position = home;
      sleepTime = canStart && player && asleep ? sleepTime + dt : 0;
      if (!canStart || !player) return null;
      if (asleep) return sleepTime >= config.wake.asleep_s ? startWake(player) : null;
      if (Math.hypot(player.x - approach[0], player.y - approach[1]) > config.trigger_radius_m) return null;
      path = routeFor(player, 1, position);
      side = path ? 1 : -1;
      path ??= routeFor(player, side, position);
      if (!path) return null;
      target = {x: player.x, y: player.y, z: player.z, heading: player.heading};
      phase = 'approach';
      return 'start';
    }
    if (phase !== 'approach') return null;
    let budget = dt * config.pace_mps;
    while (budget > 0 && segment < path.length - 1) {
      const a = path[segment], b = path[segment + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const step = Math.min(length - travel, budget);
      travel += step;
      budget -= step;
      const t = length > 1e-6 ? travel / length : 1;
      position = lift(mix(a[0], b[0], t), mix(a[1], b[1], t));
      if (t >= 1) { segment++; travel = 0; }
    }
    if (segment === path.length - 1) {
      phase = 'talk';
      return 'listen';
    }
    return null;
  }

  return {
    update,
    complete() {
      // Skipping stops the pursuit at its current physical location.
      phase = 'complete';
    },
    get phase() { return phase; },
    get position() { return position; },
    get target() { return target; },
    get side() { return side; },
  };
}

/** Find a clear walk away from the speaker for the last shot. */
export function organoidDeparture(player, organoid, {height, hit, waterAt}) {
  const away = Math.atan2(player.y - organoid[1], player.x - organoid[0]);
  const options = [0, .43, -.43, .86, -.86, 1.3, -1.3];
  let best = {heading: away, distance: 0};
  for (const angle of options) {
    const heading = away + angle, dx = Math.cos(heading), dy = Math.sin(heading);
    let previous = [player.x, player.y, player.z + .64];
    let distance = 0;
    for (let step = 1; step <= 16; step++) {
      const along = step * .25;
      const x = player.x + along * dx, y = player.y + along * dy;
      if (waterAt?.(x, y)) break;
      const ground = height(x, y);
      if (!Number.isFinite(ground)) break;
      const z = ground + .64;
      const next = [x, y, z];
      if (Math.abs(z - previous[2]) > .19 || hit(previous, next, .37)) break;
      distance = along;
      previous = next;
    }
    if (distance > best.distance) best = {heading, distance};
    if (distance >= 3.25) break;
  }
  return best;
}

export function sampleOrganoidExpression(cue, age, look) {
  const ease = (a, b) => smooth(Math.max(0, Math.min(1, (age - a) / (b - a))));
  look.notice = 0;
  look.withdraw = 0;
  look.front = -2;
  look.pulse = 0;
  if (cue === 'notice') {
    look.notice = ease(0, .38) * (1 - ease(1.35, 3.4));
  } else if (cue === 'reply') {
    const phase = age < 1.05 ? age : (age - 1.05) * 1.26;
    const pulseEase = (a, b) => smooth(Math.max(0, Math.min(1, (phase - a) / (b - a))));
    look.front = -1.1 + phase * 2.22;
    look.pulse = pulseEase(0, .2) * (1 - pulseEase(.65, 1)) * (age < 1.05 ? 1 : .66);
    look.notice = .22 * (1 - ease(1.42, 2.4));
  } else if (cue === 'recoil') {
    look.withdraw = ease(0, .26) * (1 - ease(1.05, 3.1));
  } else if (cue === 'acknowledge') {
    look.notice = .66 * ease(.16, .48) * (1 - ease(.72, 1.48));
  }
  return look;
}

/** The Organoid as a pestering guide: it warps in, calls "Hey! Listen!" and explains the thing
 * the player is standing near. It calls only to a player who has stood steadily on the ground
 * for `settle_s`, one tip at a time and each tip once, so a launch, a ride or a tumble is
 * never interrupted. `anchors[near]` lists the [x, y] points a tip's `near` names; `seen` holds
 * tip ids already given. Phases: idle → in (warping in, calling) → talk (box shown) → out.
 *
 * update(dt, grounded, onFoot): `grounded` is the player standing steadily ({x, y}) or null;
 * `onFoot` is false once the player is no longer walking at all (flying, riding, in a menu),
 * which sends a showing Organoid away at once. Returns 'call' when a tip starts, else null. */
export function createOrganoidTutor(tutor, anchors, seen = new Set()) {
  let phase = 'idle', tip = null, age = 0, steady = 0, gap = tutor.gap_s;
  const near = (t, p) => (anchors[t.near] ?? []).some(([x, y]) => Math.hypot(p.x - x, p.y - y) <= t.radius_m);
  const leave = () => { phase = 'out'; age = 0; };
  function update(dt, grounded, onFoot) {
    age += dt;
    steady = grounded ? steady + dt : 0;
    if (phase === 'idle') {
      gap += dt;
      if (steady < tutor.settle_s || gap < tutor.gap_s) return null;
      tip = tutor.tips.find(t => !seen.has(t.id) && near(t, grounded)) ?? null;
      if (!tip) return null;
      seen.add(tip.id);
      phase = 'in';
      age = 0;
      return 'call';
    }
    if (!onFoot && phase !== 'out') {
      if (phase === 'in') seen.delete(tip.id);  // cut off before the box showed: offer it again
      leave();
    }
    else if (phase === 'in' && age >= tutor.warp_in_s) { phase = 'talk'; age = 0; }
    else if (phase === 'talk' && age >= tutor.read_s + tip.text.length * tutor.read_per_char_s) leave();
    else if (phase === 'out' && age >= tutor.warp_out_s) { phase = 'idle'; tip = null; gap = 0; }
    return null;
  }
  return {
    update,
    dismiss() { if (phase === 'in' || phase === 'talk') leave(); },
    get phase() { return phase; },
    get tip() { return tip; },
    get age() { return age; },
    seen,
  };
}

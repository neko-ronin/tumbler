/** The Organoid as the player's pestering guide. When to speak is shared/npc/organoid.js's
 * createOrganoidTutor; this draws it: a streak in from above, a pop to size at Ronin's shoulder,
 * a bobbing follow while the tip box is up, and a zip back up and out. It borrows the stage's
 * one Organoid mesh through `organoid.guest`. Tips already given are remembered in this
 * browser only, so a returning player is not told twice. */
import {createOrganoidTutor} from '../../../shared/npc/organoid.js';
import {steadyOnFoot} from './organoid-encounter.js';

const SEEN_KEY = 'tumbler.organoid-tips';
const clamp01 = t => Math.min(1, Math.max(0, t));
const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
// Overshoots to ~1.1 before settling: the pop of something arriving from nowhere.
const backOut = t => { t = clamp01(t) - 1; return 1 + t * t * (2.7 * t + 1.7); };

function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set(); }
}
function saveSeen(seen) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen])); } catch {}
}

export function stageOrganoidTutor({config, organoid, soundscape, clip, panel, anchors, navigation, characterScale}) {
  const t = config.tutor;
  const rules = createOrganoidTutor(t, anchors, loadSeen());
  const call = panel.querySelector('[data-call]');
  const words = panel.querySelector('[data-tip]');
  const close = panel.querySelector('button');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const pose = {position: [0, 0, 0], scale: 0, notice: 0, pulse: 0, front: -2};
  const at = [0, 0, 0], from = [0, 0, 0], shoulder = [0, 0, 0];
  let clock = 0, shown = null, placed = false;
  call.textContent = t.call.text;
  close.addEventListener('click', () => rules.dismiss());

  // Over Ronin's right shoulder and a little ahead, where the chase camera sees it.
  function aim(player) {
    const s = characterScale(), h = player.heading ?? 0;
    const fx = Math.cos(h), fy = Math.sin(h);
    shoulder[0] = player.x + fx * .45 * s + fy * .85 * s;
    shoulder[1] = player.y + fy * .45 * s - fx * .85 * s;
    shoulder[2] = player.z + 1.35 * s + .12 * Math.sin(clock * 3.1);
  }

  function update(dt, onFoot) {
    clock += dt;
    const player = navigation.state;
    const walking = navigation.mode === 'walk' && !navigation.suspended && !organoid.active && !!player;
    const grounded = walking && onFoot && steadyOnFoot(navigation, onFoot) ? onFoot : null;
    const event = rules.update(dt, grounded, walking);
    if (event === 'call') {
      const {offset_s, length_s} = clip;
      soundscape.playDialogue(offset_s, length_s);
      placed = false;
    }
    const phase = rules.phase;
    if (phase === 'idle' || !player) {
      organoid.guest = null;
      if (shown) { panel.hidden = true; shown = null; }
      return;
    }
    aim(player);
    if (!placed) {
      // Start high and behind, so the streak in crosses the camera's view.
      const s = characterScale(), h = player.heading ?? 0;
      from[0] = shoulder[0] - Math.cos(h) * 4 * s; from[1] = shoulder[1] - Math.sin(h) * 4 * s; from[2] = shoulder[2] + 6 * s;
      at[0] = from[0]; at[1] = from[1]; at[2] = from[2];
      placed = true;
    }
    const age = rules.age, s = characterScale() * t.scale;
    if (phase === 'in') {
      const k = reduced.matches ? 1 : smooth(age / t.warp_in_s);
      // An arc: along the line, plus a sideways swing that dies away on arrival.
      const swing = Math.sin(k * Math.PI) * 1.4 * characterScale();
      const h = player.heading ?? 0;
      for (let i = 0; i < 3; i++) at[i] = from[i] + (shoulder[i] - from[i]) * k;
      at[0] += Math.sin(h) * swing; at[1] -= Math.cos(h) * swing;
      pose.scale = s * (reduced.matches ? 1 : backOut(age / t.warp_in_s));
      pose.notice = 1;
      pose.pulse = 1;
      pose.front = -1.1 + age * 4;
    } else if (phase === 'talk') {
      // Follow, lagging a little like something flying, not attached.
      const follow = 1 - Math.exp(-dt * 6);
      for (let i = 0; i < 3; i++) at[i] += (shoulder[i] - at[i]) * follow;
      pose.scale = s;
      pose.notice = .55 + .25 * Math.sin(clock * 5);
      pose.pulse = .3 * smooth(1 - age / .6);
      pose.front = -1.1 + (age % 1.6) * 2.2;
    } else {
      // Up and out, shrinking to nothing.
      const k = reduced.matches ? 1 : smooth(age / t.warp_out_s);
      at[2] += dt * 9 * characterScale() * k;
      pose.scale = s * (1 - k);
      pose.notice = 1 - k;
      pose.pulse = 0;
    }
    pose.position[0] = at[0]; pose.position[1] = at[1]; pose.position[2] = at[2];
    organoid.guest = pose;
    const showing = phase === 'talk' ? rules.tip : null;
    if (showing !== shown) {
      shown = showing;
      panel.hidden = !shown;
      if (shown) { words.textContent = shown.text; saveSeen(rules.seen); }
    }
  }

  return {
    update,
    dismiss: () => rules.dismiss(),
    /** Forget the tips already given, in this browser. */
    reset() { rules.seen.clear(); saveSeen(rules.seen); },
    get state() { return {phase: rules.phase, tip: rules.tip?.id ?? null, seen: [...rules.seen], pose: {...pose, position: [...pose.position]}}; },
    dispose() { organoid.guest = null; panel.hidden = true; },
  };
}

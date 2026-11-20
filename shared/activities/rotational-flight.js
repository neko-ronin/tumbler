/** Six degrees of freedom per body in core east/north/up coordinates.
 * Body axes are forward/left/up. Unit quaternions [x,y,z,w] map body to world.
 * See docs/reviews/para-rotational-dynamics-2026-11-15/README.md.
 */
const add = (a, b, scale = 1) => a.map((value, i) => value + scale * b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function rotateFlightVector(q, vector) {
  const twiceCross = cross(q, vector).map(value => 2 * value);
  return add(add(vector, twiceCross, q[3]), cross(q, twiceCross));
}

function angularVelocity(body, inertia) {
  const q = body.orientation;
  const inverse = [-q[0], -q[1], -q[2], q[3]];
  const localMomentum = rotateFlightVector(inverse, body.angularMomentum);
  return rotateFlightVector(q, localMomentum.map((value, i) => value / inertia[i]));
}

function rotateOrientation(q, omega, seconds) {
  const speed = Math.hypot(...omega);
  const angle = speed * seconds / 2;
  const incrementScale = speed === 0 ? seconds / 2 : Math.sin(angle) / speed;
  const axis = omega.map(value => value * incrementScale);
  const scalar = Math.cos(angle);
  const vector = add(add(cross(axis, q), q, scalar), axis, q[3]);
  const next = [...vector, scalar * q[3] - dot(axis, q.slice(0, 3))];
  const norm = Math.hypot(...next);
  return next.map(value => value / norm);
}

function bodyMotion(body, properties) {
  return { ...body, angularVelocity: angularVelocity(body, properties.inertiaKgM2) };
}

function anchor(body, local) {
  const offset = rotateFlightVector(body.orientation, local);
  return {
    position: add(body.position, offset),
    velocity: add(body.velocity, cross(body.angularVelocity, offset)),
    offset,
  };
}

// Line groups are inextensible and tension-only: a fixed length that can go
// slack but never stretch. Real speedwing lines stretch millimetres, so a
// taut group carries whatever tension keeps it at length, solved from every
// other load at that instant. The explicit step leaves a little drift; it is
// pulled back with a critically damped correction at this rate (rad/s). That
// correction is also the catch: a slack group snapping taut stops over ~50 ms.
const LINE_SETTLE_RAD_S = 40;
// A group already carrying load stays taut within this of its length, so the
// correction carrying it a hair short does not flicker it slack. A slack group
// catches only at its full length.
const LINE_TAUT_M = .005;

const inverseInertia = (body, inertia, vector) =>
  angularVelocity({ orientation: body.orientation, angularMomentum: vector }, inertia);

function suspension(pilot, wing, lines, tensions = []) {
  return lines.map((line, i) => {
    const p = anchor(pilot, line.pilotAnchor);
    const w = anchor(wing, line.wingAnchor);
    const separation = add(w.position, p.position, -1);
    const distance = Math.hypot(...separation);
    const direction = distance === 0 ? [0, 0, 0] : separation.map(value => value / distance);
    const relativeVelocity = add(w.velocity, p.velocity, -1);
    const tensionN = tensions[i] ?? 0;
    return {
      pilotOffset: p.offset, wingOffset: w.offset, direction, distance, relativeVelocity,
      speed: dot(relativeVelocity, direction),
      forceOnPilot: direction.map(value => value * tensionN),
      tensionN, extensionM: Math.max(0, distance - line.lengthM), slackM: Math.max(0, line.lengthM - distance),
    };
  });
}

/** Tension-only constraint forces for the taut groups. K maps tensions to the
 * change in each group's length acceleration, so K t = free - target, with
 * t >= 0 and a group left slack only if it would not separate. With two groups
 * the active set is found by trying both, then each alone.
 * ponytail: two line groups; a wider line fan needs a general LCP solve.
 */
function lineTensions(pilot, wing, rig, lines, pilotLoads, wingLoads) {
  if (lines.length > 2) throw new RangeError('Rotational flight solves at most two line groups');
  const freeAngular = (body, properties, torque) => inverseInertia(body, properties.inertiaKgM2,
    add(torque, cross(body.angularVelocity, body.angularMomentum), -1));
  const pointAcceleration = (force, properties, alpha, body, offset) => add(add(
    force.map(value => value / properties.massKg), cross(alpha, offset)),
    cross(body.angularVelocity, cross(body.angularVelocity, offset)));
  const pilotAlpha = freeAngular(pilot, rig.pilot, pilotLoads.torque);
  const wingAlpha = freeAngular(wing, rig.wing, wingLoads.torque);
  const rows = lines.map((line, i) => {
    const relative = add(pointAcceleration(wingLoads.force, rig.wing, wingAlpha, wing, line.wingOffset),
      pointAcceleration(pilotLoads.force, rig.pilot, pilotAlpha, pilot, line.pilotOffset), -1);
    const curvature = line.distance > 0 ? (dot(line.relativeVelocity, line.relativeVelocity) - line.speed ** 2) / line.distance : 0;
    const target = -2 * LINE_SETTLE_RAD_S * line.speed - LINE_SETTLE_RAD_S ** 2 * (line.distance - rig.lines[i].lengthM);
    return {
      taut: line.distance >= rig.lines[i].lengthM - (line.tensionN > 0 ? LINE_TAUT_M : 1e-9), excess: dot(relative, line.direction) + curvature - target,
      pilotArm: cross(line.pilotOffset, line.direction), wingArm: cross(line.wingOffset, line.direction),
    };
  });
  const inverseMass = 1 / rig.pilot.massKg + 1 / rig.wing.massKg;
  const k = (i, j) => dot(lines[i].direction, lines[j].direction) * inverseMass +
    dot(rows[i].pilotArm, inverseInertia(pilot, rig.pilot.inertiaKgM2, rows[j].pilotArm)) +
    dot(rows[i].wingArm, inverseInertia(wing, rig.wing.inertiaKgM2, rows[j].wingArm));
  const solve = active => {
    const t = lines.map(() => 0);
    if (active.length === 1) t[active[0]] = rows[active[0]].excess / k(active[0], active[0]);
    if (active.length === 2) {
      const [a, b] = active, det = k(a, a) * k(b, b) - k(a, b) * k(b, a);
      t[a] = (rows[a].excess * k(b, b) - k(a, b) * rows[b].excess) / det;
      t[b] = (k(a, a) * rows[b].excess - k(b, a) * rows[a].excess) / det;
    }
    const valid = active.every(i => t[i] >= 0) && rows.every((row, i) => active.includes(i) ||
      !row.taut || row.excess - t.reduce((sum, value, j) => sum + k(i, j) * value, 0) <= 1e-9);
    return valid ? t : null;
  };
  const taut = rows.flatMap((row, i) => row.taut ? [i] : []);
  const subsets = taut.length === 2 ? [taut, [taut[0]], [taut[1]]] : taut.length === 1 ? [taut] : [];
  for (const active of subsets) {
    const t = solve(active);
    if (t) return t;
  }
  return lines.map(() => 0);
}

const noLoads = () => [];

function evaluate(state, rig, gravity, loads, previousTensions) {
  const pilot = bodyMotion(state.pilot, rig.pilot);
  const wing = bodyMotion(state.wing, rig.wing);
  const geometry = suspension(pilot, wing, rig.lines, previousTensions);
  const pilotLoads = { force: [0, 0, -gravity * rig.pilot.massKg], torque: [0, 0, 0] };
  const wingLoads = { force: [0, 0, -gravity * rig.wing.massKg], torque: [0, 0, 0] };

  const workRates = { air: 0, wind: 0, engine: 0, control: 0 };
  for (const name of ['pilot', 'wing']) {
    const body = name === 'pilot' ? pilot : wing;
    const total = name === 'pilot' ? pilotLoads : wingLoads;
    for (const load of loads(name, body, geometry, state.timeS)) {
      const { force = [0, 0, 0], torque = [0, 0, 0], offset = [0, 0, 0], source, air } = load;
      const velocity = add(body.velocity, cross(body.angularVelocity, offset));
      total.force = add(total.force, force);
      total.torque = add(add(total.torque, torque), cross(offset, force));
      if (source !== 'air' && source !== 'engine' && source !== 'control')
        throw new RangeError(`Unknown rotational flight force source: ${source}`);
      const windPower = (source === 'air' || source === 'engine') && air ? dot(force, air) : 0;
      workRates[source] += dot(force, velocity) + dot(torque, body.angularVelocity) - windPower;
      workRates.wind += windPower;
    }
  }
  // The pilot hangs from two hang points and could rock about them freely.
  // Their hands on the brake lines and their posture resist body rotation
  // against the canopy; that internal moment acts on both bodies.
  const relativeSpin = add(pilot.angularVelocity, wing.angularVelocity, -1);
  const harness = relativeSpin.map(value => -(rig.harnessDampingNms ?? 0) * value);
  pilotLoads.torque = add(pilotLoads.torque, harness);
  wingLoads.torque = add(wingLoads.torque, harness, -1);
  const tensions = lineTensions(pilot, wing, rig, geometry, pilotLoads, wingLoads);
  geometry.forEach((line, i) => {
    const force = line.direction.map(value => value * tensions[i]);
    pilotLoads.force = add(pilotLoads.force, force);
    wingLoads.force = add(wingLoads.force, force, -1);
    pilotLoads.torque = add(pilotLoads.torque, cross(line.pilotOffset, force));
    wingLoads.torque = add(wingLoads.torque, cross(line.wingOffset, force), -1);
  });
  return { pilot: pilotLoads, wing: wingLoads, workRates, tensions,
    lineLossRate: geometry.reduce((sum, line, i) => sum + tensions[i] * line.speed, 0) - dot(harness, relativeSpin) };
}

function advanceBody(before, slope, load, properties, seconds) {
  return {
    position: add(before.position, slope.velocity, seconds),
    velocity: add(before.velocity, load.force, seconds / properties.massKg),
    orientation: rotateOrientation(before.orientation, angularVelocity(slope, properties.inertiaKgM2), seconds),
    angularMomentum: add(before.angularMomentum, load.torque, seconds),
  };
}

function advance(before, slope, loads, rig, dt) {
  return {
    timeS: before.timeS + dt,
    pilot: advanceBody(before.pilot, slope.pilot, loads.pilot, rig.pilot, dt),
    wing: advanceBody(before.wing, slope.wing, loads.wing, rig.wing, dt),
  };
}

function energy(state, rig, gravity) {
  let total = 0;
  for (const name of ['pilot', 'wing']) {
    const body = state[name];
    const properties = rig[name];
    total += properties.massKg * (gravity * body.position[2] + dot(body.velocity, body.velocity) / 2);
    total += dot(body.angularMomentum, body.angularVelocity) / 2;
  }
  return total;
}

export function rotationalFlightSnapshot(state, rig, gravity = 9.81) {
  const pilot = bodyMotion(state.pilot, rig.pilot);
  const wing = bodyMotion(state.wing, rig.wing);
  const lines = suspension(pilot, wing, rig.lines, state.lineTensionN);
  return { pilot, wing, lines, energyJ: energy({ pilot, wing }, rig, gravity) };
}

/** Line tension is reported from the last midpoint solve of the step.
 * The line lengths and offsets are fixed over a force step. A future
 * actuated line needs to account for work before changing either parameter.
 * The pure load callback returns world-space forces, torques and application
 * offsets from COM; air is the world velocity of the surrounding flow there.
 */
export function stepRotationalFlight(state, rig, seconds, { gravity = 9.81, loads = noLoads } = {}) {
  if (!(seconds > 0) || !Number.isFinite(seconds)) return state;
  if (!(rig.maxStepS > 0) || !Number.isFinite(rig.maxStepS))
    throw new RangeError('Rotational flight needs a finite positive maximum force step');
  const initial = state.ledger ?? {
    initialEnergyJ: rotationalFlightSnapshot(state, rig, gravity).energyJ,
    airWorkJ: 0, windWorkJ: 0, engineWorkJ: 0, controlWorkJ: 0, lineLossJ: 0,
  };
  const ledger = { ...initial };
  const count = Math.ceil(seconds / rig.maxStepS);
  const h = seconds / count;
  let next = { ...state, timeS: state.timeS ?? 0 };
  let tensions = state.lineTensionN;
  for (let step = 0; step < count; step++) {
    const atStart = evaluate(next, rig, gravity, loads, tensions);
    const midpoint = advance(next, next, atStart, rig, h / 2);
    const atMidpoint = evaluate(midpoint, rig, gravity, loads, atStart.tensions);
    tensions = atMidpoint.tensions;
    next = advance(next, midpoint, atMidpoint, rig, h);
    const { air, wind, engine, control } = atMidpoint.workRates;
    ledger.airWorkJ += air * h;
    ledger.windWorkJ += wind * h;
    ledger.engineWorkJ += engine * h;
    ledger.controlWorkJ += control * h;
    ledger.lineLossJ += atMidpoint.lineLossRate * h;
  }
  next.lineTensionN = tensions;
  const { energyJ } = rotationalFlightSnapshot(next, rig, gravity);
  ledger.energyJ = energyJ;
  ledger.numericalJ = energyJ - ledger.initialEnergyJ - ledger.airWorkJ - ledger.windWorkJ -
    ledger.engineWorkJ - ledger.controlWorkJ + ledger.lineLossJ - (ledger.contactWorkJ ?? 0);
  return { ...next, ledger };
}

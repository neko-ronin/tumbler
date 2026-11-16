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

function suspension(pilot, wing, lines) {
  return lines.map(line => {
    const p = anchor(pilot, line.pilotAnchor);
    const w = anchor(wing, line.wingAnchor);
    const separation = add(w.position, p.position, -1);
    const distance = Math.hypot(...separation);
    const extension = distance - line.restLengthM;
    const direction = distance === 0 ? [0, 0, 0] : separation.map(value => value / distance);
    const speed = dot(add(w.velocity, p.velocity, -1), direction);
    const spring = line.stiffnessNpm * Math.max(0, extension);
    const tensionN = extension < 0 ? 0 : Math.max(0, spring + line.dampingNsPm * speed);
    return {
      pilotOffset: p.offset, wingOffset: w.offset,
      forceOnPilot: direction.map(value => value * tensionN),
      tensionN, extensionM: Math.max(0, extension), slackM: Math.max(0, -extension),
      elasticJ: spring * Math.max(0, extension) / 2,
      dissipationW: (tensionN - spring) * speed,
    };
  });
}

const noLoads = () => [];

function evaluate(state, rig, gravity, loads) {
  const pilot = bodyMotion(state.pilot, rig.pilot);
  const wing = bodyMotion(state.wing, rig.wing);
  const lines = suspension(pilot, wing, rig.lines);
  const pilotLoads = { force: [0, 0, -gravity * rig.pilot.massKg], torque: [0, 0, 0] };
  const wingLoads = { force: [0, 0, -gravity * rig.wing.massKg], torque: [0, 0, 0] };
  for (const line of lines) {
    pilotLoads.force = add(pilotLoads.force, line.forceOnPilot);
    wingLoads.force = add(wingLoads.force, line.forceOnPilot, -1);
    pilotLoads.torque = add(pilotLoads.torque, cross(line.pilotOffset, line.forceOnPilot));
    wingLoads.torque = add(wingLoads.torque, cross(line.wingOffset, line.forceOnPilot), -1);
  }

  const workRates = { air: 0, wind: 0, engine: 0, control: 0 };
  for (const name of ['pilot', 'wing']) {
    const body = name === 'pilot' ? pilot : wing;
    const total = name === 'pilot' ? pilotLoads : wingLoads;
    for (const load of loads(name, body, lines, state.timeS)) {
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
  return { pilot: pilotLoads, wing: wingLoads, workRates,
    lineLossRate: lines.reduce((sum, line) => sum + line.dissipationW, 0) };
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

function energy(state, rig, lines, gravity) {
  let total = lines.reduce((sum, line) => sum + line.elasticJ, 0);
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
  const lines = suspension(pilot, wing, rig.lines);
  return { pilot, wing, lines, energyJ: energy({ pilot, wing }, rig, lines, gravity) };
}

/** The line rest lengths and offsets are fixed over a force step. A future
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
  for (let step = 0; step < count; step++) {
    const atStart = evaluate(next, rig, gravity, loads);
    const midpoint = advance(next, next, atStart, rig, h / 2);
    const atMidpoint = evaluate(midpoint, rig, gravity, loads);
    next = advance(next, midpoint, atMidpoint, rig, h);
    const { air, wind, engine, control } = atMidpoint.workRates;
    ledger.airWorkJ += air * h;
    ledger.windWorkJ += wind * h;
    ledger.engineWorkJ += engine * h;
    ledger.controlWorkJ += control * h;
    ledger.lineLossJ += atMidpoint.lineLossRate * h;
  }
  const { energyJ } = rotationalFlightSnapshot(next, rig, gravity);
  ledger.energyJ = energyJ;
  ledger.numericalJ = energyJ - ledger.initialEnergyJ - ledger.airWorkJ - ledger.windWorkJ -
    ledger.engineWorkJ - ledger.controlWorkJ + ledger.lineLossJ - (ledger.contactWorkJ ?? 0);
  return { ...next, ledger };
}

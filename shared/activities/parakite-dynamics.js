/** Parakite aerodynamics for the rotational solver. */
import { cellLiftFactor, cellPressureTarget, coupledPolar, mixParakiteHandles } from './coupled-flight.js';
import { rotateFlightVector, rotationalFlightSnapshot, stepRotationalFlight } from './rotational-flight.js';

const G = 9.81;
const DYNAMIC_PRESSURE = 1.225 / 2;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const add = (a, b, scale = 1) => a.map((value, i) => value + scale * b[i]);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const pitchOrientation = angle => [0, -Math.sin(angle / 2), 0, Math.cos(angle / 2)];
const stillAir = () => [0, 0, 0];

/** Trim-derived rig for controlled comparisons with the accepted still-air
 * launch. Fixed principal inertias are prototype game values in kg m².
 * Left/right groups are equivalent force application points inside the span.
 */
export function parakitePrototype(config, maxStepS = 1 / 480) {
  const turnRules = config.modes.parakite;
  const rules = config.coupled;
  const polar = coupledPolar(turnRules, rules);
  const trimVelocity = [turnRules.trim_mps, 0, -turnRules.sink_mps];
  const drag = DYNAMIC_PRESSURE * rules.pilot_drag_area_m2 * Math.hypot(...trimVelocity);
  const support = add([0, 0, rules.pilot_mass_kg * G], trimVelocity, drag);
  const supportN = Math.hypot(...support);
  const up = support.map(value => value / supportN);
  const wingPitch = Math.atan2(trimVelocity[2], trimVelocity[0]) + rules.trim_alpha_rad;
  const pilotPitch = -Math.atan2(up[0], up[2]);
  // Lateral reach of each riser group's line fan from the harness hang point.
  const sideGap = turnRules.line_fan_m ?? .42;
  const centreSeparation = turnRules.canopy_height_m - rules.harness_height_m;
  const pilotAnchorHeight = .32;
  const wingAnchorDrop = .18;
  const anchorSeparation = centreSeparation - pilotAnchorHeight - wingAnchorDrop;
  const lineReach = Math.hypot(anchorSeparation, sideGap);
  const lineTension = supportN * lineReach / (2 * anchorSeparation);
  const lines = [-1, 1].map(side => ({
    pilotAnchor: [0, side * .23, pilotAnchorHeight],
    wingAnchor: [Math.sin(pilotPitch - wingPitch) * wingAnchorDrop, side * (.23 + sideGap),
      -Math.cos(pilotPitch - wingPitch) * wingAnchorDrop],
    lengthM: lineReach,
  }));
  const fabric = [15, 2.2, 16];
  const rig = {
    pilot: { massKg: rules.pilot_mass_kg, inertiaKgM2: [11, 16, 8] },
    wing: { massKg: rules.wing_mass_kg, inertiaKgM2: canopyAirInertia(turnRules).map((value, i) => value + fabric[i]) },
    harnessDampingNms: turnRules.harness_damping_nms ?? 0,
    lines, maxStepS,
  };
  const initial = (position, { heading = 0, air = [0, 0, 0], velocity } = {}) => {
    const sin = Math.sin(heading / 2);
    const cos = Math.cos(heading / 2);
    const yaw = [0, 0, sin, cos];
    const orientation = pitch => {
      const [, y, , w] = pitchOrientation(pitch);
      return [-sin * y, cos * y, sin * w, cos * w];
    };
    const worldVelocity = velocity ?? add(rotateFlightVector(yaw, trimVelocity), air);
    return {
      pilot: { position: [...position], velocity: [...worldVelocity], orientation: orientation(pilotPitch), angularMomentum: [0, 0, 0] },
      wing: { position: add(position, rotateFlightVector(yaw, up), centreSeparation), velocity: [...worldVelocity],
        orientation: orientation(wingPitch), angularMomentum: [0, 0, 0] },
      lineTensionN: [lineTension, lineTension],
      pressure: [1, 1],
    };
  };
  return { rig, turnRules, rules, polar, initial };
}

/** A canopy turning in air also turns the air around and inside it. Roll,
 * pitch and yaw inertia of that air, for an arched wing, from Lissaman &
 * Brown (1993) as written up by Barrows (2002), plus the enclosed cell air
 * as a uniform slab. Body axes forward/left/up, so [roll, pitch, yaw].
 * ponytail: rotational terms only. The translational apparent mass is
 * largest along the lines, which the inextensible suspension already holds;
 * add it with Munk moments if surge or plunge dynamics need it.
 */
export function canopyAirInertia(mode, rho = 2 * DYNAMIC_PRESSURE) {
  const b = mode.span_m, c = mode.chord_m, aspect = b / c, share = aspect / (1 + aspect);
  const thickness = (mode.thickness_ratio ?? .15) * c;
  const arch = (mode.arc_m ?? 0) / b, thin = thickness / c;
  const roll = .055 * rho * share * c * c * b ** 3;
  const pitch = .0308 * rho * share * (1 + Math.PI / 6 * (1 + aspect) * aspect * arch * arch * thin * thin) * c ** 4 * b;
  const yaw = .0555 * rho * (1 + 8 * arch * arch) * thickness * thickness * b ** 3;
  const cellAir = rho * .68 * thickness * c * b;
  return [roll + cellAir * b * b / 12, pitch + cellAir * c * c / 12, yaw + cellAir * (b * b + c * c) / 12];
}

function wingSections(body, model, pressure, controls, tensions, airAt, time, separation = []) {
  const { turnRules, rules, polar } = model;
  const forward = rotateFlightVector(body.orientation, [1, 0, 0]);
  const up = rotateFlightVector(body.orientation, [0, 0, 1]);
  const span = rotateFlightVector(body.orientation, [0, 1, 0]);
  const handles = controls.handles ?? [.45, .45];
  const weightShift = controls.steer ?? 0;
  const commonTravel = Math.abs((handles[0] + handles[1]) * .5 - .45);
  const pitchAuthority = clamp((commonTravel - .06) / .28, 0, 1);
  const commonHandle = clamp((handles[0] + handles[1]) * .5, 0, 1);
  const commonBrake = Math.max(0, (commonHandle - .45) / .55);
  const commonRelease = Math.max(0, (.45 - commonHandle) / .45);
  return [-1, 1].map((side, i) => {
    const offset = span.map(value => value * side * turnRules.span_m * .24);
    const air = airAt(add(body.position, offset), time);
    const flow = add(add(body.velocity, cross(body.angularVelocity, offset)), air, -1);
    const sideSpeed = dot(flow, span);
    const planeFlow = add(flow, span, -sideSpeed);
    const speed = Math.hypot(...planeFlow);
    const along = dot(planeFlow, forward);
    const alpha = Math.atan2(-dot(planeFlow, up), along);
    const handle = clamp(handles[i], 0, 1);
    const brake = Math.max(0, (handle - .45) / .55);
    const release = Math.max(0, (.45 - handle) / .45);
    // Common handle travel sets the canopy's trimmed incidence. The section
    // pitch moments act on one rigid canopy, so a one-sided pull must not read
    // as half a symmetric pull: the difference works through that side's
    // camber and drag below. Direct roll and pitch pose actuators would bypass
    // the suspension and aerodynamic work.
    const speedRatio = 1 - commonBrake * turnRules.brake_fraction + commonRelease * turnRules.accelerator_fraction;
    // Extra incidence under lateral load keeps the held turn carving through
    // the air. The shared curve models coordinated handle/weight movement.
    const turnLift = 1 + 2.5 * Math.abs(weightShift) * span[2] ** 2;
    const targetCl = polar.cl * turnLift / (speedRatio * speedRatio);
    const targetAlpha = clamp(rules.trim_alpha_rad + (targetCl - polar.cl) / rules.lift_slope, -.12, .6);
    const fade = clamp((Math.abs(alpha) - rules.stall_alpha_rad) / .35, 0, 1);
    // Flow takes a few chord transits to separate or reattach (dynamic
    // stall), so a brief excursion past the static stall stays attached.
    // The section uses its lagged separation state when the caller has one.
    const staticStall = fade * fade * (3 - 2 * fade);
    const stall = separation[i] ?? staticStall;
    // Resolve ordinary weight shift as a small differential incidence at the
    // riser groups. It changes the sectional loads and their lever arms.
    const shiftIncidence = side * weightShift * (turnRules.weight_shift_rad ?? .016);
    // A handle drawn beyond the other deflects that side's trailing edge: a
    // little camber and much more drag. Drag-led yaw plus the arc's side force
    // rolls the rig toward the drawn side (skid steering, Slegers & Costello
    // 2003). The symmetric part stays in the calibrated polar and pitch target.
    const drawn = Math.max(0, brake - commonBrake);
    const attachedCl = clamp(polar.cl + (turnRules.handle_camber ?? 0) * drawn +
      rules.lift_slope * (alpha + shiftIncidence - rules.trim_alpha_rad), -rules.max_cl, rules.max_cl);
    const normalCl = 1.15 * Math.sin(alpha) * Math.abs(Math.sin(alpha)) * Math.cos(alpha);
    const lift = ((1 - stall) * attachedCl + stall * normalCl) * cellLiftFactor(pressure[i], rules);
    const excessSpeed = Math.max(0, speed / turnRules.trim_mps - 1.2);
    // Near trim, model additional canopy drag at high speed. This dissipates
    // excess energy on a steep turn exit while deep handle travel still
    // permits a deliberate energy-carrying dive or pull.
    const trimDrag = (1 - pitchAuthority) * .34 * excessSpeed ** 2;
    const drag = polar.cd0 + polar.induced * lift * lift + (turnRules.handle_drag ?? 0) * drawn + brake * brake * .025 + trimDrag + stall * (.32 + .72 * Math.sin(alpha) ** 2);
    const scale = DYNAMIC_PRESSURE * polar.area * speed / 2;
    const force = add(cross(planeFlow, span).map(value => value * lift * scale), planeFlow, -drag * scale);
    const withSideslip = add(force, span, -DYNAMIC_PRESSURE * polar.area / 2 *
      (turnRules.arc_side_force_slope ?? rules.side_force_slope ?? 0) * Math.hypot(...flow) * sideSpeed);
    const pitchRate = dot(body.angularVelocity, span);
    // Handle travel controls pitch throughout the flight envelope. Scale the
    // damping by inverse section speed for a reduced pitch rate.
    const pitchDamping = (.085 - .045 * pitchAuthority) * turnRules.trim_mps / Math.max(12, speed);
    // With the risers released, prop the folded section into the airflow.
    // This reduced aerodynamic moment stands in for reopening fabric and
    // riser geometry. Pressure still needs forward flow and line support.
    const folded = clamp((.65 - pressure[i]) / .55, 0, 1);
    const reopening = folded * release * clamp((alpha - rules.trim_alpha_rad) * .35, -.6, .6);
    // ponytail: the light canopy's pitch damping is stiff for the explicit
    // midpoint step at high speed with a folded side. Cap each section at
    // half the stable rate (|λh| ≤ 1 for both). Apparent-air pitch inertia
    // would be the physical upgrade.
    const pitchDampingNms = Math.min(scale * speed * turnRules.chord_m * (pitchDamping + folded * .09),
      model.rig.wing.inertiaKgM2[1] / (2 * model.rig.maxStepS));
    const pitchMoment = scale * speed * turnRules.chord_m *
      (clamp((alpha - targetAlpha) * (.24 + .38 * pitchAuthority), -.28, .28) * (1 - stall) * pressure[i] + reopening) -
        pitchDampingNms * pitchRate;
    const yawRate = dot(body.angularVelocity, up);
    const yawMoment = scale * speed * turnRules.chord_m * pressure[i] *
      (clamp(Math.atan2(sideSpeed, Math.max(0, along)), -.65, .65) * .18 - yawRate * .045);
    // Roll damping beyond the two-section lift model (the arc's tilted
    // sections). Lateral trim after a released turn comes from the pendulum,
    // with no world-referenced levelling torque.
    const rollRate = dot(body.angularVelocity, forward);
    const rollMoment = -scale * speed * turnRules.chord_m * pressure[i] * rollRate * .025;
    const load = tensions[i].tensionN / (model.rig.pilot.massKg * G / 2);
    return {
      alpha, stall, staticStall, speed, load,
      mouthPressure: cellPressureTarget(speed, turnRules.trim_mps, alpha, load, stall, rules) * Number(along > 0),
      aerodynamicLoad: { source: 'air', force: withSideslip, torque: add(add(span.map(value => value * pitchMoment), up, yawMoment), forward, rollMoment), offset, air },
    };
  });
}

const pressureStep = (previous, target, dt, rules) =>
  previous + (target - previous) * -Math.expm1(-dt / (target > previous ? rules.cell_fill_s ?? .45 : rules.cell_vent_s ?? .22));

/** Section forces sample instantaneous local three-dimensional flow, including
 * angular motion of the load points. Pressure lags flow and support by side.
 */
export function stepParakitePrototype(state, model, dt, { controls = {}, airAt = stillAir } = {}) {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;
  const { rig, rules } = model;
  const loads = (name, body, lines, time) => {
    if (name === 'wing')
      return wingSections(body, model, state.pressure, controls, lines, airAt, time, state.separation).map(section => section.aerodynamicLoad);
    const air = airAt(body.position, time);
    const flow = add(body.velocity, air, -1);
    const drag = DYNAMIC_PRESSURE * rules.pilot_drag_area_m2 * Math.hypot(...flow);
    return [{ source: 'air', force: flow.map(value => -value * drag), air }];
  };
  const next = stepRotationalFlight(state, rig, dt, { loads });
  const { wing, lines } = rotationalFlightSnapshot(next, rig);
  const sections = wingSections(wing, model, state.pressure, controls, lines, airAt, next.timeS, state.separation);
  const pressure = sections.map((section, i) => pressureStep(state.pressure[i], section.mouthPressure, dt, rules));
  // Goman & Khrabrov (1994): separation follows the static value with a lag
  // of a few chord transit times, c / V.
  const separation = sections.map((section, i) => {
    const seconds = (model.turnRules.separation_lag_chords ?? 0) * model.turnRules.chord_m / Math.max(5, section.speed);
    const previous = state.separation?.[i] ?? section.staticStall;
    return seconds > 0 ? previous + (section.staticStall - previous) * -Math.expm1(-dt / seconds) : section.staticStall;
  });
  return { ...next, sections, pressure, separation };
}

/** A pilot moves their hips across the harness over a few tenths of a second.
 * Keyboard steering arrives as a step, so the body follows it with this lag.
 */
export function pilotWeightShift(previous, steer, mode, dt) {
  const seconds = mode.weight_shift_s ?? 0;
  return seconds > 0 ? previous + (steer - previous) * -Math.expm1(-dt / seconds) : steer;
}

/** Same analogue input convention and handle response as stepFlight. */
export function stepParakitePrototypeInput(state, model, dt, input, airAt = stillAir) {
  if (!(dt > 0) || !Number.isFinite(dt)) return state;
  const steer = clamp(input.turn || 0, -1, 1);
  const handles = mixParakiteHandles(state.handles ?? [.45, .45], model.turnRules,
    clamp(input.brake || 0, -1, 1), steer, input.brakeLeft || 0, input.brakeRight || 0, dt);
  const weightShift = pilotWeightShift(state.weightShift ?? 0, steer, model.turnRules, dt);
  const next = stepParakitePrototype(state, model, dt, {
    controls: { handles: [handles[1], handles[0]], steer: weightShift }, airAt,
  });
  return { ...next, handles, weightShift };
}

const flightModels = new WeakMap();
function rotationalModel(config) {
  if (!flightModels.has(config)) flightModels.set(config, parakitePrototype(config));
  return flightModels.get(config);
}

export function rotationalBasis(body) {
  return {
    forward: rotateFlightVector(body.orientation, [1, 0, 0]),
    left: rotateFlightVector(body.orientation, [0, 1, 0]),
    up: rotateFlightVector(body.orientation, [0, 0, 1]),
  };
}

/** Advance the experimental wing with the ordinary input-mixed handle
 * positions. The pose fields mirror the existing flight-frame contract.
 */
export function advanceRotationalParakite(state, config, dt, steer, airAt) {
  const model = rotationalModel(config);
  const position = [state.x, state.y, state.z - config.landing_clearance_m + config.coupled.harness_height_m];
  const air = airAt(position, 0);
  const previous = state.rotation ?? model.initial(position, {
    heading: state.heading, air,
    velocity: [state.vx, state.vy, state.vz].every(Number.isFinite) ? [state.vx, state.vy, state.vz] : undefined,
  });
  state.weightShift = pilotWeightShift(state.weightShift ?? 0, steer, config.modes.parakite, dt);
  const controls = { handles: [state.handleRight, state.handleLeft], steer: state.weightShift };
  const rotation = stepParakitePrototype(previous, model, dt, { controls, airAt });
  const { wing, pilot, lines } = rotationalFlightSnapshot(rotation, model.rig);
  const basis = rotationalBasis(wing);
  const velocity = pilot.velocity;
  const relative = add(velocity, airAt(pilot.position, rotation.timeS), -1);
  const [x, y, z] = pilot.position;
  state.rotation = rotation;
  state.coupled = {
    pilotPosition: pilot.position, wingPosition: wing.position, pilotVelocity: velocity, wingVelocity: wing.velocity,
    lineSlackM: (lines[0].slackM + lines[1].slackM) / 2,
    energyJ: rotation.ledger.energyJ, initialEnergyJ: rotation.ledger.initialEnergyJ,
    massKg: model.rig.pilot.massKg + model.rig.wing.massKg,
  };
  state.distance += Math.hypot(x - state.x, y - state.y);
  state.x = x;
  state.y = y;
  state.z = z + config.landing_clearance_m - config.coupled.harness_height_m;
  [state.vx, state.vy, state.vz] = velocity;
  state.vario = state.vertical = state.vz;
  state.speed = Math.hypot(...relative);
  state.groundSpeed = Math.hypot(velocity[0], velocity[1]);
  if (state.groundSpeed > .5) state.heading = Math.atan2(velocity[1], velocity[0]);
  state.pitch = Math.atan2(basis.forward[2], Math.hypot(basis.forward[0], basis.forward[1]));
  state.pitchRate = -dot(wing.angularVelocity, basis.left);
  // Instrument bank uses span tilt. The renderer and collision use all
  // quaternion axes, including when pitch takes the canopy over the top.
  state.bank = Math.asin(clamp(basis.left[2], -1, 1));
  state.rollRate = dot(wing.angularVelocity, basis.forward);
  state.load = (rotation.sections[0].load + rotation.sections[1].load) / 2;
  state.stall = Math.max(...rotation.sections.map(section => section.stall));
  state.pressure = (rotation.pressure[0] + rotation.pressure[1]) / 2;
  state.tuckSide = rotation.pressure[1] - rotation.pressure[0];
  const [right, left] = rotation.pressure;
  const opening = rotation.sections.every((section, i) => section.mouthPressure > Math.max(.35, rotation.pressure[i]));
  const bilateral = Math.min(left, right) < .65 && Math.abs(left - right) < .2;
  state.figure = bilateral ? (opening ? 'Wing opening · centre the handles' :
    'Wing deflated · raise handles briefly, then centre') :
    left < .65 ? 'Left wing folded · steer right gently' : right < .65 ? 'Right wing folded · steer left gently' :
    state.load < .2 ? 'Lines slack · ease the pull' : state.stall > .2 ? 'Low energy · ease handles' :
    state.vario > 1 ? 'Flare · climbing' : Math.abs(state.bank) > .72 && state.vario < -4 ? 'Spiral · ease the turn' : 'Speed wing';
}

/** Project the rigid state after an external world contact. Account for
 * impulse and correction explicitly in the mechanical energy ledger.
 */
export function updateRotationalContact(state, config, shift, velocity, tipSide = 0) {
  const { rig } = rotationalModel(config);
  const before = state.rotation;
  const pilot = { ...before.pilot, position: add(before.pilot.position, shift), velocity };
  const wing = { ...before.wing, position: add(before.wing.position, shift) };
  const pressure = [...before.pressure];
  if (tipSide) {
    const side = tipSide < 0 ? 1 : 0;
    pressure[side] = Math.max(0, pressure[side] - (config.collapse.tip_brush_pressure ?? 0));
    const axis = rotationalBasis(wing).forward;
    wing.angularMomentum = add(wing.angularMomentum, axis, tipSide * rig.wing.inertiaKgM2[0] *
      (config.collapse.tip_brush_roll_rps ?? 0));
  }
  const rotation = { ...before, pilot, wing, pressure };
  const energyJ = rotationalFlightSnapshot(rotation, rig).energyJ;
  rotation.ledger = { ...before.ledger, energyJ,
    contactWorkJ: (before.ledger.contactWorkJ ?? 0) + energyJ - before.ledger.energyJ };
  state.rotation = rotation;
  state.pressure = (pressure[0] + pressure[1]) / 2;
  state.tuckSide = pressure[1] - pressure[0];
  state.coupled = { ...state.coupled, pilotPosition: pilot.position, wingPosition: wing.position,
    pilotVelocity: velocity, energyJ, contactWorkJ: rotation.ledger.contactWorkJ };
}

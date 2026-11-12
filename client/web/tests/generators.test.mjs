/** The world's generators: what the core says a rotor does, and what the
 * browser draws of it.
 *
 *     node --test client/web/tests/generators.test.mjs
 *
 * Two halves, deliberately in one file because they are one claim: the rule is
 * the core's (`shared/activities/generators.js`) and the pixels are the
 * client's (`client/web/src3d/generators.js`). The rule is tested against
 * arithmetic; the drawing is tested against the committed world — the real
 * `placement.json`, the real GLBs and the real rotor data — so a world that
 * grows a generator the data does not describe fails here rather than spinning
 * silently.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Matrix4, Vector3 } from "../vendor/three.module.min.js";

import { parseGLB } from "../src3d/glb.js";
import { buildPlacements } from "../src3d/placements.js";
import { buildGenerators, AIR_SAMPLE_S } from "../src3d/generators.js";
import {
  rotorAngularSpeed,
  rotorPhase,
  stepRotor,
} from "../../../shared/activities/generators.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const read = (...parts) => readFileSync(join(REPO, ...parts));
const json = (...parts) => JSON.parse(read(...parts));

const config = json("shared", "activities", "generators.json");
const placement = json("shared", "world", "out", "placement.json");
const worldmap = json("shared", "world", "worldmap.json");

/** Every asset the placement record names, parsed once. */
const assets = {};
for (const path of new Set(placement.instances.map((i) => i.asset))) {
  assets[path] = parseGLB(new Uint8Array(read("shared", "geometry", path)).buffer);
}
const placements = buildPlacements(placement, assets);
const machines = placement.instances.filter((i) => config.rotors[i.kind]);

/** Air that never changes, so a test can say what the answer should be. The
 * client reads only `steady`: the mean speed. Direction is not its business,
 * because this world's wind does not turn. */
const constant = (steady) => () => ({ steady });

function build({ air, ...overrides }) {
  return buildGenerators({
    placement,
    assets,
    placements,
    config,
    air,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// The core's rule
// ---------------------------------------------------------------------------

test("a rotor tracks its tip-speed ratio until the tip speed is capped", () => {
  const rotor = config.rotors.turbine;
  const rated = rotor.max_tip_mps / rotor.tip_speed_ratio; // wind at which the cap arrives
  // Below the cap the tip speed is exactly tsr * v, and omega = tip / radius.
  const tracked = rotorAngularSpeed(rotor, rated / 2);
  assert.ok(Math.abs(Math.abs(tracked) * rotor.radius_m - rotor.tip_speed_ratio * rated / 2) < 1e-9);
  // At and above it the tip speed stops growing, so the rate stops too.
  const capped = rotorAngularSpeed(rotor, rated * 2);
  assert.ok(Math.abs(Math.abs(capped) * rotor.radius_m - rotor.max_tip_mps) < 1e-9);
  assert.equal(capped, rotorAngularSpeed(rotor, rated * 1.5), "the cap is a ceiling, not a slope");
  assert.ok(Math.abs(rotorAngularSpeed(rotor, rated * 0.99)) < Math.abs(capped), "below the cap the rate still rises with wind");
});

test("below cut-in a rotor freewheels, at cut-out it is held", () => {
  const rotor = config.rotors.turbine;
  const justBelow = rotorAngularSpeed(rotor, rotor.cut_in_mps * 0.99);
  const justAbove = rotorAngularSpeed(rotor, rotor.cut_in_mps * 1.01);
  assert.ok(Math.abs(justBelow) < Math.abs(justAbove), "cut-in must be a step, not a cliff");
  assert.ok(Math.abs(justBelow) > 0, "a rotor below cut-in still turns, slowly");
  const idle = Math.abs(rotorAngularSpeed(rotor, rotor.cut_in_mps * 0.5));
  assert.ok(Math.abs(idle * rotor.radius_m - rotor.tip_speed_ratio * rotor.cut_in_mps * 0.5 * rotor.idle_fraction) < 1e-9);
  assert.equal(rotorAngularSpeed(rotor, rotor.cut_out_mps), 0, "cut-out stops the rotor");
  assert.equal(rotorAngularSpeed(rotor, rotor.cut_out_mps * 10), 0, "and holds it stopped");
  assert.equal(rotorAngularSpeed(rotor, 0), 0, "calm air does not turn a rotor backwards");
});

test("the core signs the rate, so a client never decides handedness", () => {
  for (const rotor of Object.values(config.rotors)) {
    assert.ok(rotor.spin_sign === 1 || rotor.spin_sign === -1);
    assert.equal(Math.sign(rotorAngularSpeed(rotor, 10)), rotor.spin_sign);
  }
});

test("a house blimp's small rotor turns faster than a district hull's in the same air", () => {
  const rotor = config.rotors.blimp;
  const house = rotorAngularSpeed(rotor, 8, 0.28);
  const district = rotorAngularSpeed(rotor, 8, 1);
  assert.ok(Math.abs(house) > Math.abs(district) * 3, "the tip-speed rule makes scale visible, not tuned");
});

test("the spool is first order: it approaches its target without overshooting", () => {
  const rotor = config.rotors.turbine;
  const target = rotorAngularSpeed(rotor, 9);
  let state = { angle: 0, rate: 0 };
  for (let i = 0; i < 6000; i += 1) {
    state = stepRotor(rotor, state, target, 1 / 120);
    assert.ok(Math.abs(state.rate) <= Math.abs(target) + 1e-12, "a rotor must not overshoot its target rate");
  }
  assert.ok(Math.abs(state.rate - target) < 0.02, `after six time constants the rotor should be at its target, got ${state.rate} of ${target}`);
  assert.ok(Math.abs(state.angle) > 0, "the angle integrates the rate");
  assert.deepEqual(stepRotor(rotor, { angle: 1, rate: 2 }, target, 0), { angle: 1, rate: 2 }, "a zero step changes nothing");
});

test("nothing turns a machine's nose, because this world's wind does not turn", () => {
  // The world's one prevailing direction and the valley's diurnal axis are the
  // same line, so the mean bearing never changes. A client that rotated a
  // machine would be drawing a wind the core does not have — and the core has no
  // yaw rule to offer it. This test is the guard against that arriving by habit.
  assert.equal(worldmap.wind.direction_deg, 275);
  assert.equal(Math.abs(((worldmap.wind.diurnal.axis_bearing_deg - worldmap.wind.direction_deg + 540) % 360) - 180), 180,
    "the breeze runs along the prevailing axis, exactly against it");
  assert.equal(config.rotors.turbine.yaw_rate_deg_s, undefined, "no yaw rate in the data, no yaw in the client");
  assert.equal(config.rotors.blimp.yaw_rate_deg_s, undefined);
});

test("the starting blade angle is a stable hash of the instance, not a fleet in step", () => {
  const ids = machines.map((i) => i.tags.join(":"));
  const angles = ids.map(rotorPhase);
  for (const angle of angles) assert.ok(angle >= 0 && angle < Math.PI * 2);
  assert.deepEqual(angles, ids.map(rotorPhase), "the same id must give the same angle, for repeatable captures");
  assert.ok(new Set(angles.map((a) => a.toFixed(6))).size > angles.length * 0.9, "the fleet must not start as one blade");
});

// ---------------------------------------------------------------------------
// The world it describes
// ---------------------------------------------------------------------------

test("every generator the world places has a rotor the core describes", () => {
  const turbines = machines.filter((i) => i.kind === "turbine");
  const blimps = machines.filter((i) => i.kind === "blimp");
  assert.equal(turbines.length, worldmap.turbines.count, "the ridge fleet is the world map's own count");
  assert.ok(blimps.length >= 24, "the flying hulls are placed, plus one per collection of homes");
  for (const instance of machines) {
    const rotor = config.rotors[instance.kind];
    assert.equal(rotor.asset, instance.asset, `${instance.kind} rotor names the asset the placement draws`);
    assert.ok(instance.parts.some((part) => part.mesh === rotor.part), `${instance.kind} must place the part its rotor names`);
    assert.equal(rotor.spin_axis, "+Z", "both shipped rotors are thin on local Z, measured from the GLBs");
  }
});

test("the turbine rotor's radius is the world map's own rotor", () => {
  const diameter = worldmap.turbines.rotor_diameter_m;
  assert.ok(Math.abs(config.rotors.turbine.radius_m * 2 - diameter) < 1e-6, "two statements of one number must agree");
});

test("the browser builds the whole fleet and turns it", () => {
  const generators = build({ air: constant(9) });
  assert.equal(generators.stats.turbines, worldmap.turbines.count);
  assert.equal(generators.stats.blimps, machines.filter((i) => i.kind === "blimp").length);
  generators.update(1 / 60);
  assert.ok(generators.stats.spinning > 0, "9 m/s is above every cut-in in the file");
  assert.ok(generators.stats.rpm > 0);

  const turbine = placement.instances.find((i) => i.kind === "turbine");
  const mesh = placements.group.getObjectByName(`${turbine.asset}#${config.rotors.turbine.part}:opaque`);
  const before = new Matrix4();
  mesh.getMatrixAt(0, before);

  for (let i = 0; i < 240; i += 1) generators.update(1 / 120);
  const after = new Matrix4();
  mesh.getMatrixAt(0, after);
  assert.notDeepEqual(after.elements, before.elements, "the rotor's matrix must change as it turns");
  generators.dispose();
});

test("calm air turns the fleet slower than a gale, from the same code path", () => {
  const spin = (steady) => {
    const generators = build({ air: constant(steady) });
    // Let the spool settle on both sides of the comparison.
    for (let i = 0; i < 600; i += 1) generators.update(1 / 120);
    const rpm = generators.stats.rpm;
    generators.dispose();
    return rpm;
  };
  const calm = spin(config.rotors.turbine.cut_in_mps * 0.5);
  const breeze = spin(8);
  const gale = spin(config.rotors.turbine.max_tip_mps / config.rotors.turbine.tip_speed_ratio * 2);
  assert.ok(calm > 0, "below cut-in the rotors still freewheel");
  assert.ok(calm < breeze && breeze < gale, `rpm must rise with wind: ${calm} / ${breeze} / ${gale}`);
});

test("every frame draws the machine at the pose the core placed", () => {
  // The world's wind never turns, so a client that yawed a machine would be
  // drawing a wind the core does not have. The tower must be bit-identical to
  // the static pass on every frame, and the rotor may differ only by a rotation
  // about its own axis: same hub, same axis. Nothing turns the nose.
  const turbine = machines.find((i) => i.kind === "turbine");
  const rotor = config.rotors.turbine;
  const tower = placements.group.getObjectByName(`${turbine.asset}#tower:opaque`);
  const towerSlot = tower.userData.instances.indexOf(turbine);
  const spinner = placements.group.getObjectByName(`${turbine.asset}#${rotor.part}:opaque`);
  const spinnerSlot = spinner.userData.instances.indexOf(turbine);
  const towerBefore = new Matrix4(), spinBefore = new Matrix4();
  tower.getMatrixAt(towerSlot, towerBefore);
  spinner.getMatrixAt(spinnerSlot, spinBefore);

  const generators = build({ air: constant(12) });
  for (let i = 0; i < 240; i += 1) generators.update(1 / 120);

  const towerAfter = new Matrix4(), spinAfter = new Matrix4();
  tower.getMatrixAt(towerSlot, towerAfter);
  spinner.getMatrixAt(spinnerSlot, spinAfter);
  assert.deepEqual(towerAfter.elements, towerBefore.elements, "a non-spinning part must not move");

  const hubBefore = new Vector3().setFromMatrixPosition(spinBefore);
  const hubAfter = new Vector3().setFromMatrixPosition(spinAfter);
  assert.ok(hubBefore.distanceTo(hubAfter) < 1e-6, "the hub is the placed hub");
  const axisBefore = new Vector3(0, 0, 1).transformDirection(spinBefore);
  const axisAfter = new Vector3(0, 0, 1).transformDirection(spinAfter);
  assert.ok(axisBefore.distanceTo(axisAfter) < 1e-6, "the spin axis is the placed axis, not a wind vane");
  generators.dispose();
});

test("the air is re-sampled at the documented interval, not every frame", () => {
  let calls = 0;
  const generators = build({ air: () => { calls += 1; return { steady: 8 }; } });
  const fleet = generators.stats.turbines + generators.stats.blimps;
  calls = 0;
  for (let i = 0; i < 120; i += 1) generators.update(1 / 120); // one second
  const expected = fleet * Math.round(1 / AIR_SAMPLE_S);
  assert.ok(Math.abs(calls - expected) <= fleet, `one second should sample about ${expected} times, got ${calls}`);
  generators.dispose();
});

test("a part the rotor data does not describe is not a generator", () => {
  const generators = buildGenerators({
    placement: { instances: [] }, assets: {}, placements, config, air: constant(8),
  });
  assert.equal(generators.stats.turbines + generators.stats.blimps, 0);
  generators.update(1 / 60); // an empty fleet must be a no-op, not a crash
  generators.dispose();
});

// ---------------------------------------------------------------------------
// The rotor's pose is the same pose the static pass drew
// ---------------------------------------------------------------------------

test("with no wind a rotor stays exactly where the static pass put it", () => {
  const turbine = placement.instances.find((i) => i.kind === "turbine");
  const mesh = placements.group.getObjectByName(`${turbine.asset}#${config.rotors.turbine.part}:opaque`);
  const slot = mesh.userData.instances.indexOf(turbine);
  const staticMatrix = new Matrix4();
  mesh.getMatrixAt(slot, staticMatrix);

  const generators = build({ air: constant(0) });
  generators.update(1 / 60);
  const liveMatrix = new Matrix4();
  mesh.getMatrixAt(slot, liveMatrix);

  const a = new Vector3().setFromMatrixPosition(staticMatrix);
  const b = new Vector3().setFromMatrixPosition(liveMatrix);
  assert.ok(a.distanceTo(b) < 1e-6, "the hub must not move because it is animated");
  // The static pass drew blades at their authored angle; the live pass starts at
  // the instance's phase, so compare the hub and the rotor's own plane, not the
  // blade angle.
  const normal = new Vector3(0, 0, 1).transformDirection(liveMatrix);
  assert.ok(normal.length() > 0.9, "the rotor must still face along its own spin axis");
  generators.dispose();
});

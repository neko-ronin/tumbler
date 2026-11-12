/** The world's wind generators, turned by the shared air field.
 *
 * Eleven ridge turbines and twenty-four flying blimps. The core says what a
 * rotor does with the air (`shared/activities/generators.js`) and where the air
 * comes from and how hard it blows (`shared/activities/flight.js`); this module
 * is the browser's drawing of that: it samples the same field the wing flies
 * in and spins the named rotor part by the shared step.
 *
 * ## Why the pose is recomputed, not nudged
 *
 * `placements.js` merges each asset part into one `InstancedMesh` and writes a
 * matrix per instance once. A rotor's angle is not static, so every frame this
 * module rebuilds the few matrices that move from the same `instanceMatrix()`
 * the static pass used. Nudging the existing matrix would have to guess how
 * world-axis scale composes with a yaw, and be silently wrong on a non-uniform
 * instance.
 *
 * ## What is and is not the client's choice
 *
 * The rate, the handedness and the spool are all core values. The client
 * chooses only presentation: how often the air is re-sampled, and that a
 * blade's initial angle is a hash of the instance rather than all blades
 * starting upright. Wind is never invented here, so a calm day visibly slows
 * the rotors, an alpine one drives them, and the valley's afternoon breeze
 * slows them again — all through the one shared field.
 *
 * Nothing here turns a machine's nose. This world's wind has one prevailing
 * direction and a diurnal term along the same axis, so the placed pose is the
 * pose; see the core module's header for why that is not an omission.
 */

import { Matrix4, Vector3 } from "../vendor/three.module.min.js";
import { instanceMatrix } from "./world.js";
import { partsOf } from "./placements.js";
import {
  rotorAngularSpeed,
  rotorPhase,
  stepRotor,
} from "../../../shared/activities/generators.js";

/** How often the air is re-sampled, in seconds.
 *
 * The shared field's gust cycle is seconds long and a rotor's own spool is
 * longer still, so 4 Hz is far finer than anything a viewer can see while
 * keeping 35 hub samples off the per-frame budget.
 */
export const AIR_SAMPLE_S = 0.25;

const AXES = {
  "+X": new Vector3(1, 0, 0),
  "+Y": new Vector3(0, 1, 0),
  "+Z": new Vector3(0, 0, 1),
};

const blank = () => ({
  update() {},
  dispose() {},
  stats: { turbines: 0, blimps: 0, rpm: 0, windMps: 0, spinning: 0 },
});

/**
 * @param placement  `placement.json` — poses, parts and scale.
 * @param assets     decoded GLBs, for each part's own local matrix.
 * @param placements the built group from `buildPlacements`, whose meshes carry
 *                   `userData.instances` in slot order.
 * @param config     `generators.json`.
 * @param air        `(x, y, z) => sample` in **world** metres, returning at
 *                   least `{steady}` from the shared air field.
 */
export function buildGenerators({ placement, assets, placements, config, air }) {
  const rotors = config?.rotors;
  if (!rotors || !air) return blank();

  const partMaps = new Map();
  const machines = [];
  const stats = { turbines: 0, blimps: 0, rpm: 0, windMps: 0, spinning: 0 };
  for (const instance of placement.instances ?? []) {
    const rotor = rotors[instance.kind];
    if (!rotor) continue;
    if (!partMaps.has(instance.asset)) partMaps.set(instance.asset, partsOf(assets[instance.asset]));
    const parts = partMaps.get(instance.asset);
    const drawn = [];
    for (const part of instance.parts ?? []) {
      const mesh = placements.group.getObjectByName(`${instance.asset}#${part.mesh}:opaque`);
      const slot = mesh?.userData?.instances?.indexOf(instance) ?? -1;
      const primitives = parts.get(part.mesh);
      if (!mesh || slot < 0 || !primitives) continue;
      drawn.push({ mesh, slot, local: primitives[0].local, spinning: part.mesh === rotor.part });
    }
    const spinner = drawn.find((part) => part.spinning);
    if (!spinner) continue; // a kind with no rotor part is not a generator the core describes
    const axis = AXES[rotor.spin_axis];
    if (!axis) throw new Error(`generators.json names spin axis ${rotor.spin_axis} for ${instance.kind}`);
    const id = instance.tags?.join(":") || String(instance.position_m.join(","));
    machines.push({
      instance,
      rotor,
      axis,
      drawn,
      spinner,
      scale: instance.scale?.[0] ?? 1,
      angle: rotorPhase(id),
      rate: null,
      target: 0,
      hub: new Vector3(),
      spin: new Matrix4(),
      pose: new Matrix4(),
    });
    if (instance.kind === "turbine") stats.turbines += 1;
    else if (instance.kind === "blimp") stats.blimps += 1;
  }
  if (!machines.length) return blank();

  const touched = new Set();
  let clock = AIR_SAMPLE_S; // sample on the first update

  function resample() {
    let wind = 0, rpm = 0, spinning = 0;
    for (const machine of machines) {
      machine.pose.copy(instanceMatrix(
        machine.instance.position_m, machine.instance.yaw_deg, machine.instance.scale, machine.spinner.local,
      ));
      machine.hub.setFromMatrixPosition(machine.pose);
      // Scene metres back to world metres: y up becomes z up, south becomes north.
      const sample = air(machine.hub.x, -machine.hub.z, machine.hub.y);
      const speed = sample?.steady ?? 0;
      machine.target = rotorAngularSpeed(machine.rotor, speed, machine.scale);
      if (machine.rate === null) machine.rate = machine.target; // the world opens already turning
      wind += speed;
      rpm += Math.abs(machine.target) * 60 / (Math.PI * 2);
      if (Math.abs(machine.target) > 1e-3) spinning += 1;
    }
    stats.windMps = wind / machines.length;
    stats.rpm = rpm / machines.length;
    stats.spinning = spinning;
  }

  function update(dt) {
    const step = Math.min(Math.max(Number(dt) || 0, 0), 0.1);
    if (!step) return;
    clock += step;
    if (clock >= AIR_SAMPLE_S) {
      clock = 0;
      resample();
    }
    for (const machine of machines) {
      const rotor = stepRotor(machine.rotor, { angle: machine.angle, rate: machine.rate }, machine.target, step);
      machine.angle = rotor.angle;
      machine.rate = rotor.rate;
      for (const part of machine.drawn) {
        const matrix = instanceMatrix(
          machine.instance.position_m, machine.instance.yaw_deg, machine.instance.scale, part.local,
        );
        if (part.spinning) matrix.multiply(machine.spin.makeRotationAxis(machine.axis, machine.angle));
        part.mesh.setMatrixAt(part.slot, matrix);
        touched.add(part.mesh);
      }
    }
    for (const mesh of touched) mesh.instanceMatrix.needsUpdate = true;
    touched.clear();
  }

  return {
    update,
    stats,
    dispose() { machines.length = 0; },
  };
}

/** What a wind generator's rotor does with the air the core gives it.
 *
 * The world has two generator kinds and both are machines with a rotor in the
 * air: eleven ridge turbines and twenty-four flying blimps, the latter ducted,
 * the former open. `generators.json` says what each rotor is; this module is
 * the one rule that turns a wind speed into a turn, so the two clients cannot
 * disagree about it and neither invents its own spin.
 *
 * ## Facing, and why nothing here turns
 *
 * `placement.json` poses every generator at the prevailing wind, and in this
 * world that pose is permanent: the one prevailing direction is a world fact
 * (`worldmap.json:wind`), and the valley's diurnal breeze runs along the same
 * axis as the prevailing flow — the river's own axis, exactly against it — so a
 * phase of the day changes how hard the air blows, never which way it comes
 * from. There is therefore no yaw rule here, and a client must not invent one:
 * a machine that turned would be drawing a wind the core does not have. If the
 * world ever gains a turning wind, the pose is placement data and the core
 * gains the rule with it.
 *
 * ## What is modelled, and what is not
 *
 * A rotor tracks its tip-speed ratio (`omega = tsr * v / r`) until the tip
 * speed reaches `max_tip_mps`, above which it is held at that cap. Below
 * `cut_in_mps` it freewheels at `idle_fraction` of the tracked rate, and at or
 * above `cut_out_mps` it is stopped and held. Wind is sampled from the shared
 * air field (`sampleAir` in `flight.js`), never invented here: the same wind
 * that lifts a paraglider turns the blades.
 *
 * This is a presentation model. There is no torque, generator load, pitch
 * control, grid, bearing wear or energy budget, and the game consumes none of
 * the power the hulls and turbines are said to make. `docs/design/AIR-AND-PARA.md`
 * is where that boundary is recorded.
 *
 * ## Scale
 *
 * `radius_m` is the asset at scale 1. A client resolves the instance's own
 * radius by multiplying by its placement scale, so a house blimp's 4.2 m rotor
 * turns 3.6 times as fast as a district hull's 15 m rotor in the same air. That
 * follows from the tip-speed rule rather than being tuned per instance.
 */

/** A rotor's angular speed, in radians per second about its own spin axis.
 *
 * `rotor` is one entry of `generators.json:rotors`; `scale` is the placement
 * scale of the instance carrying it. The returned rate is **signed** by
 * `rotor.spin_sign`, so a client only has to turn the mesh by the angle this
 * module hands back and never decides handedness itself.
 */
export function rotorAngularSpeed(rotor, windSpeedMps, scale = 1) {
  const radius = Math.max(1e-6, rotor.radius_m * (scale || 1));
  const speed = Math.max(0, Number(windSpeedMps) || 0);
  const sign = rotor.spin_sign < 0 ? -1 : 1;
  let rate;
  if (speed >= rotor.cut_out_mps) rate = 0;
  else if (speed < rotor.cut_in_mps) rate = (rotor.tip_speed_ratio * speed / radius) * rotor.idle_fraction;
  else rate = Math.min(rotor.tip_speed_ratio * speed, rotor.max_tip_mps) / radius;
  return rate === 0 ? 0 : sign * rate;
}

/** One step of a rotor's spin, as the first-order spool a real rotor has.
 *
 * `state` is `{angle, rate}` in radians and radians per second. The rotor
 * approaches its target rate with time constant `spool_s` and integrates its
 * own angle; the angle is deliberately unbounded so a client can keep the
 * fractional turn without wrapping arithmetic of its own.
 */
export function stepRotor(rotor, state, targetRate, dt) {
  const step = Math.max(0, Number(dt) || 0);
  const tau = Math.max(0.05, rotor.spool_s);
  const rate = state.rate + (targetRate - state.rate) * (1 - Math.exp(-step / tau));
  return { angle: state.angle + rate * step, rate };
}

/** A stable, non-zero initial blade angle for one instance.
 *
 * Every rotor in the world would otherwise start with the same blade straight
 * up, which reads as a diagram rather than a fleet. This is a hash of the
 * instance's own identity — not a world fact, not persisted, and not a seeded
 * RNG that could drift when the world grows: the same id always gives the same
 * angle, so a capture can be repeated.
 */
export function rotorPhase(id) {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967296) * Math.PI * 2;
}

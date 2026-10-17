/** Grounded walking in world metres (x east, y north, z up), independent of a client. */
export function stepWalk(state, input, dt, config, height, hitTest) {
  const magnitude = Math.hypot(input.x, input.y);
  if (!magnitude || dt <= 0) return { ...state, speed: 0 };
  const speed = input.run ? config.run_mps : config.walk_mps;
  const distance = speed * Math.min(dt, .05) * Math.min(1, magnitude);
  const x = state.x + input.x / magnitude * distance;
  const y = state.y + input.y / magnitude * distance;
  const z = height(x, y);
  if (z === null || Math.abs(z - state.z) > Math.max(config.max_step_m, distance * config.max_grade)
      || hitTest?.([state.x, state.y, state.z + .9], [x, y, z + .9], config.radius_m)) {
    return { ...state, speed: 0 };
  }
  return { x, y, z, heading: Math.atan2(input.y, input.x), speed: distance / Math.min(dt, .05) };
}

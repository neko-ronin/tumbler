/** Web art direction for clear-air scattering; no weather or cloud placement.
 * Shared by the sky background and the aerial perspective on cloud volumes.
 * This is a small analytic approximation, not a spectral atmosphere solver.
 */
export const ATMOSPHERE_SKY_GLSL = `
vec3 clearSky(vec3 ray, vec3 sun, float warmth, float altitude) {
  float height=max(0.,ray.y),day=smoothstep(.05,.72,sun.y);
  float high=1.-exp(-max(0.,altitude)/6500.);
  vec3 zenith=mix(vec3(.075,.13,.28),vec3(.055,.24,.51),day);
  zenith*=1.-high*.30;
  vec3 horizon=mix(vec3(.52,.43,.42),vec3(.48,.67,.74),day);
  float haze=exp(-height*4.5);
  vec3 col=mix(zenith,horizon,haze);
  float forward=max(0.,dot(ray,sun));
  col+=mix(vec3(.20,.20,.14),vec3(.48,.20,.055),warmth)
    *pow(forward,8.)*(.35+.65*haze);
  // A warm sunward horizon and a cooler opposite one share one solar bearing.
  float bearing=dot(normalize(ray.xz+vec2(.00001)),normalize(sun.xz));
  col+=vec3(.16,.045,.015)*warmth*max(0.,bearing)*haze;
  return col;
}
`;

/** Browser grass surface interpretation. No plant instances or world facts.
 * The same sampled, traveling core air field bends blades and lights the sward.
 * Explicit bilinear reads also work without OES_texture_float_linear.
 */
export const MEADOW_AIR_GLSL = `
uniform sampler2D uMeadowAirFrom;uniform sampler2D uMeadowAirTo;
uniform vec4 uMeadowAirGrid;uniform float uMeadowAirMix;
vec4 meadowBilinear(sampler2D field,vec2 p){
  vec2 cell=clamp((p-uMeadowAirGrid.xy)/uMeadowAirGrid.z*uMeadowAirGrid.w-.5,vec2(0.),vec2(uMeadowAirGrid.w-1.));
  vec2 base=floor(cell),f=fract(cell),uv=(base+.5)/uMeadowAirGrid.w;
  float texel=1./uMeadowAirGrid.w;
  return mix(mix(texture2D(field,uv),texture2D(field,uv+vec2(texel,0.)),f.x),
    mix(texture2D(field,uv+vec2(0.,texel)),texture2D(field,uv+vec2(texel)),f.x),f.y);
}
vec4 meadowAir(vec2 p){return mix(meadowBilinear(uMeadowAirFrom,p),meadowBilinear(uMeadowAirTo,p),uMeadowAirMix);}
`;

/** Quadratic cantilever displacement and its inverse-transpose normal.
 * Every vertex at its own plant base has exactly zero displacement. Wind is
 * already expressed in the patch's tangent frame, including its scale.
 */
export const MEADOW_BEND_GLSL = `
vec3 meadowBendCoefficient(vec3 wind,float flex){
  return vec3(wind.x*.065,-length(wind.xz)*.018,wind.z*.065)*flex;
}
vec3 meadowBentPosition(vec3 p,vec3 base,vec3 coefficient){
  float h=max(0.,p.y-base.y);return p+coefficient*h*h;
}
vec3 meadowBentNormal(vec3 n,vec3 p,vec3 base,vec3 coefficient){
  vec3 slope=2.*max(0.,p.y-base.y)*coefficient;
  return normalize(vec3(n.x,(n.y-dot(n.xz,slope.xz))/max(.3,1.+slope.y),n.z));
}
`;

// The distant bed carries only an averaged canopy tone. Fine structure is real
// displaced grass above it; the former Gabor carriers engraved hashes into soil.
export const MEADOW_SURFACE_GLSL = `
vec3 meadowSurface(vec2 p,vec3 up,float footprint,vec4 air){
  float speed=length(air.xy),lean=speed/(speed+3.);
  return vec3(1.+(vnoise(p*.035)-.5)*.04,0.,lean);
}
`;

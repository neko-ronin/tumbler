/** Shared optical falloff for scenery and the separate climbing leaf opening.
 * Stable screen-door coverage keeps the existing opaque depth/shadow paths.
 * Zero is a diagnostic hard-edge control; one is the normal soft opening. */
export const visibilityFeather={value:1};
export const VISIBILITY_FEATHER_GLSL=`
#ifndef TUMBLER_VISIBILITY_FEATHER
#define TUMBLER_VISIBILITY_FEATHER
uniform float uVisibilityFeather;
float visibilityOpening(float distanceM,float clearRadius,float featherM){
 float width=featherM*uVisibilityFeather;
 if(width<=.0001)return distanceM<clearRadius?1.:0.;
 return 1.-smoothstep(clearRadius,clearRadius+width,distanceM);
}
float visibilityThreshold(vec2 pixel){
 return fract(52.9829189*fract(dot(floor(pixel),vec2(.06711056,.00583715))));
}
void visibilityDiscard(float opening){
 if(opening>=1.||opening>visibilityThreshold(gl_FragCoord.xy))discard;
}
#endif
`;

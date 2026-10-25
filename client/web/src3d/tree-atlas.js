/** Sample each mip inside its own capture tile. Hardware trilinear sampling at
 * an atlas boundary otherwise blends a crown tip with the next view's bole.
 * Derivatives come from unclamped local UVs, so edge clamping cannot sharpen a
 * minified card or select a different mip as the camera crosses a texel.
 */
export const TREE_ATLAS_GLSL=`
float treeAtlasLod(vec2 uv,float resolution,float maximum){
 vec2 dx=dFdx(uv)*resolution,dy=dFdy(uv)*resolution;
 return clamp(log2(max(1.,max(length(dx),length(dy)))),0.,maximum);
}
vec4 treeAtlasSample(sampler2D atlasMap,vec2 tile,vec2 uv,vec2 grid,float resolution,float lod){
 float low=floor(lod),high=ceil(lod);
 vec2 insetLow=vec2(.5*exp2(low)/resolution),insetHigh=vec2(.5*exp2(high)/resolution);
 vec2 a=(tile+clamp(uv,insetLow,1.-insetLow))/grid;
 vec2 b=(tile+clamp(uv,insetHigh,1.-insetHigh))/grid;
 return mix(textureLod(atlasMap,a,low),textureLod(atlasMap,b,high),fract(lod));
}
`;
/** Last mip whose capture tiles still have integer extents. Beyond this,
 * generateMipmap itself combines cells (80px bough tiles stop at level four).
 */
export function treeAtlasMaxMip(resolution){let level=0;while(resolution>1&&resolution%2===0){resolution/=2;level++;}return level;}

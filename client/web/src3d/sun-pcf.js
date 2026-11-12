// r187 shadows use hardware depth comparisons instead of packed RGBA.
// Nine bilinear comparisons preserve the three-texel box footprint. Correct
// each tap's reference depth for the local slope of the receiving surface.
export const SUN_PCF_GLSL=`
#ifndef TUMBLER_SUN_PCF
#define TUMBLER_SUN_PCF
float filteredSunDepth(highp sampler2DShadow map, vec3 uv, vec2 texel, float bias){
 vec3 dx=dFdx(uv),dy=dFdy(uv);float determinant=dx.x*dy.y-dx.y*dy.x;
 vec2 slope=abs(determinant)>1e-12?vec2(dx.z*dy.y-dy.z*dx.y,dy.z*dx.x-dx.z*dy.x)/determinant:vec2(0.);
 float visible=0.;
 for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++){
  vec2 offset=vec2(float(x),float(y))*texel;
  visible+=texture(map,vec3(uv.xy+offset,uv.z+dot(slope,offset)+bias));
 }
 return visible/9.;
}
#endif
`;

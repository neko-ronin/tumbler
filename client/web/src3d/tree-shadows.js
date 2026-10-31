/** Tree receivers reuse the scene sun map already drawn for terrain/village.
 * No second scenery pass. Bind after sun creation; sync after the renderer's
 * shadow pass in material.onBeforeRender, including the first warm-up frame.
 */
import * as T from '../vendor/three.module.min.js';
// The renderer's own sun lookup lights everything outside its frustum, so a
// receiver at the map's rim goes from unshadowed to fully shadowed in one pixel
// and a descent shows the forest's shadows popping in. Fade the lookup out over
// the outer EDGE_FADE of the map instead; the baked ground decals fade out by
// the same amount (forest.js), so the hand-over is a cross-fade.
export const SHADOW_EDGE_FADE=.14;
{
  const chunk=T.ShaderChunk.shadowmap_pars_fragment,start=chunk.indexOf('float getShadow('),mark='return mix( 1.0, shadow, shadowIntensity );',end=chunk.indexOf(mark,start);
  if(start<0||end<0)throw new Error('three.js shadow chunk changed; update the shadow edge fade');
  T.ShaderChunk.shadowmap_pars_fragment=chunk.slice(0,end)+`vec2 rim=min(shadowCoord.xy,1.-shadowCoord.xy);shadow=mix(1.,shadow,smoothstep(0.,${SHADOW_EDGE_FADE.toFixed(3)},min(rim.x,rim.y)));\n\t`+chunk.slice(end);
}
export const treeShadow={map:{value:null},matrix:{value:new T.Matrix4()},texel:{value:new T.Vector2(1/2048,1/2048)},bias:{value:0},normalBias:{value:0},ready:{value:0}};
let light=null;
export function bindTreeSunShadow(sun){light=sun;updateTreeSunShadow();}
export function updateTreeSunShadow(){
 const shadow=light?.shadow;
 if(!shadow?.map){treeShadow.ready.value=0;return;}
 treeShadow.map.value=shadow.map.texture;treeShadow.matrix.value=shadow.matrix;
 treeShadow.texel.value.set(1/shadow.map.width,1/shadow.map.height);
 treeShadow.bias.value=shadow.bias;treeShadow.normalBias.value=shadow.normalBias;treeShadow.ready.value=1;
}
export function treeShadowUniforms(){return {uTreeSunMap:treeShadow.map,uTreeSunMatrix:treeShadow.matrix,uTreeSunTexel:treeShadow.texel,uTreeSunBias:treeShadow.bias,uTreeSunNormalBias:treeShadow.normalBias,uTreeSunReady:treeShadow.ready};}
export const TREE_SHADOW_GLSL=`
uniform sampler2D uTreeSunMap;uniform mat4 uTreeSunMatrix;uniform vec2 uTreeSunTexel;uniform float uTreeSunBias,uTreeSunNormalBias,uTreeSunReady;
float scenerySunLight(vec3 world,vec3 N){
 if(uTreeSunReady<.5)return 1.;
 vec4 q=uTreeSunMatrix*vec4(world+N*uTreeSunNormalBias,1.);vec3 uv=q.xyz/q.w;
 if(min(uv.x,uv.y)<=.001||max(uv.x,uv.y)>=.999||uv.z<=0.||uv.z>=1.)return 1.;
 vec3 dx=dFdx(uv),dy=dFdy(uv);float determinant=dx.x*dy.y-dx.y*dy.x;
 vec2 slope=abs(determinant)>1e-12?vec2(dx.z*dy.y-dy.z*dx.y,dy.z*dx.x-dx.z*dy.x)/determinant:vec2(0.);
 vec2 pixel=uv.xy/uTreeSunTexel-.5,base=floor(pixel),fraction=fract(pixel);
 float visible=0.;vec4 unpack=vec4(.99609375,.99609375/256.,.99609375/65536.,1./16777216.);
 // Fractional coverage keeps the cached texel grid from becoming ten visible
 // bands as the viewer moves across a trunk. Receiver-plane correction keeps
 // tilted cards and branches from falsely shadowing against adjacent taps.
 for(int y=-1;y<=2;y++)for(int x=-1;x<=2;x++){
  vec2 coordinate=(base+vec2(float(x),float(y))+.5)*uTreeSunTexel;
  float wx=x==-1?1.-fraction.x:(x==2?fraction.x:1.);
  float wy=y==-1?1.-fraction.y:(y==2?fraction.y:1.);
  float depth=dot(texture2D(uTreeSunMap,coordinate),unpack);
  visible+=wx*wy*step(uv.z+dot(slope,coordinate-uv.xy)+uTreeSunBias,depth);
 }
 float edge=min(min(uv.x,uv.y),min(1.-uv.x,1.-uv.y));
 return mix(1.,visible/9.,smoothstep(0.,${SHADOW_EDGE_FADE.toFixed(3)},edge));
}
`;

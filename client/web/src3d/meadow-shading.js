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

// No time/noise gust is synthesized here. Changing air.xy is the shared gust.
// Static tuft structure remains in world coordinates as the camera moves.
export const MEADOW_SURFACE_GLSL = `
float meadowResolved(float footprint,float scale){return 1.-smoothstep(.16,.65,footprint*scale);}
// Sparse, randomly oriented Gaussian leaf kernels, inspired by Lagae et al.
// (2009). Integrate each carrier along its own pixel derivatives: grazing
// angles retain resolved cross-grain without leaving parallel field-wide rows.
// The bounded 3x3 kernel support is continuous as the world cell changes.
float meadowBand(float phase,vec2 width){
  vec2 sinc=sin(width)/max(abs(width),vec2(.0001))*sign(width);
  sinc=mix(sinc,vec2(1.),lessThan(abs(width),vec2(.0001)));
  return cos(phase)*sinc.x*sinc.y*(1.-smoothstep(2.,5.,max(abs(width.x),abs(width.y))));
}
float meadowGrain(vec2 p){
  p*=.33;vec2 cell=floor(p),dx=dFdx(p),dy=dFdy(p);float grain=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 seed=cell+vec2(float(i),float(j));
    vec2 centre=vec2(hash(seed),hash(seed+13.7));
    vec2 d=p-seed-centre;float radius=length(d);
    float envelope=exp(-dot(d,d)*4.)*(1.-smoothstep(.65,1.,radius));
    float angle=hash(seed+41.3)*6.2831853;vec2 direction=vec2(cos(angle),sin(angle));
    float frequency=14.+hash(seed+83.1)*8.;
    grain+=envelope*meadowBand(dot(d,direction)*frequency+hash(seed+7.2)*6.2831853,
      vec2(dot(dx,direction),dot(dy,direction))*frequency*.5);
  }
  return grain;
}
float meadowNoise(vec2 p,float footprint){return mix(.5,vnoise(p),meadowResolved(footprint,1.));}
vec3 meadowSurface(vec2 p,vec3 up,float footprint,vec4 air){
  // Recover slope length in the horizontal map rather than stretching tufts
  // up a hillside. No UV seams or terrain resampling are needed.
  vec2 slope=-up.xz/max(.15,up.y);
  vec2 along=normalize(vec2(.81,.59)+slope*.4),across=vec2(-along.y,along.x);
  vec2 q=vec2(dot(p,across),dot(p,along))*vec2(1.,sqrt(1.+dot(slope,slope)));
  vec2 warp=vec2(vnoise(p*.037),vnoise(p*.037+19.7))-.5;
  // Unrelated scales, rotated domains, and bounded domain warp avoid a tile
  // or parallel stripes. Every octave fades by its own pixel footprint.
  float tussock=meadowNoise(q*.16+warp*.8,footprint*.22);
  float hummock=meadowNoise(q*.61+warp*1.8,footprint*.8);
  // Elongated interleaved leaf groups give the bed a fibrous grain instead
  // of round noise blobs. Domain warp prevents regular parallel bands.
  float tuft=meadowNoise(q*vec2(.8,.16)+warp*2.7,footprint*.95);
  float crossTuft=meadowNoise(vec2(q.y,-q.x)*vec2(1.3,.31)+warp*3.1+7.3,footprint*1.6);
  float fibre=meadowNoise(q*vec2(11.,2.7)+warp*2.,footprint*12.);
  float leaves=meadowGrain(p+warp*1.5);
  float speed=length(air.xy),lean=speed/(speed+3.);
  // Dark sockets and lighter tips read as depth at mid/long range; this is
  // albedo/normal structure on the existing opaque terrain, without shells.
  float relief=(tussock-.5)*.12+(hummock-.5)*.16+(tuft-.5)*.24+(crossTuft-.5)*.10+(fibre-.5)*.025+leaves*.055;
  float shade=1.+(tussock-.5)*.16+(hummock-.5)*.22+(tuft-.5)*.50+(crossTuft-.5)*.24+(fibre-.5)*.22+leaves*.32;
  float sockets=smoothstep(.28,.62,tussock);
  shade*=mix(.96,1.02,sockets);
  // Directional blade-bed normal tilts in the actual sampled wind, while
  // stronger shared gusts expose the pale leaf sides across whole hills.
  return vec3(shade,relief,lean);
}
`;

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

/** Stands and cat's paws, shared by the blades (per root, in the vertex shader) and the
 * terrain sward beneath them (per pixel), so ground and grass vary together.
 * meadowStand reads the grass cover texture (uCover), whose spare channels carry the stands
 * baked once at load (packMeadowStands): g dryness (meadowDrynessAt), b which stand, a seeding noise. No new sampler:
 * the terrain shader is at its 16 texture units. It returns rgb multiplying the sward's calibrated
 * colour (mean near 1, so the grass-on / grass-hidden calibration holds) and a, a blade
 * height scale: lush and tall to dry, short and straw. One fetch, rather than seven noise
 * evaluations per blade vertex, which cost about one vsync step in grass-heavy views.
 * meadowGust: gusts a few to ~25 m across, wide across the wind and short along it,
 * carried downwind by the integrated mean flow (uMeadowDrift.xy, metres; .zw its unit
 * direction), so a wave crosses the meadow at the wind's own speed. Its amplitude is
 * the caller's: it scales with the shared air's speed.
 */
export const MEADOW_CURE_GLSL = `
// Curing grass loses its green toward straw and sage rather than turning yellow-green:
// desaturate as it dries (review: dry stands read chartreuse when only multiplied warmer).
vec3 meadowCure(vec3 rgb,float dry){
  return mix(rgb,vec3(dot(rgb,vec3(.3,.59,.11)))*vec3(1.12,1.04,.8),dry*.25);  // taste knob: .55 reads late-summer straw, .25 stays green (user: greener)
}
`;
export const MEADOW_LIFE_GLSL = `
uniform vec4 uMeadowDrift;
float mlHash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float mlNoise(vec2 x){vec2 i=floor(x),f=fract(x),u=f*f*(3.-2.*f);
  return mix(mix(mlHash(i),mlHash(i+vec2(1,0)),u.x),mix(mlHash(i+vec2(0,1)),mlHash(i+1.),u.x),u.y);}
vec4 meadowStand(vec3 p,out float seeding,out float dry){
  vec3 f=texture2D(uCover,(vec2(p.x,-p.z)-uCoverGrid.xy)/(uCoverGrid.z*uCoverGrid.w)).gba;
  dry=f.r;seeding=f.b*(.35+.65*dry);
  // Fresh, after-rain green is the calibrated sward itself; dry ground warms a little.
  // Within the green, stands differ in hue as well as tone: deep blue-green sedge and rush beside
  // yellow-green grass, all fresh. Dry ground warms a little on top.
  vec3 c=mix(vec3(.95,1.,.94),vec3(1.1,1.03,.88),dry)*mix(vec3(.86,.98,.88),vec3(1.1,1.07,.88),f.g);
  return vec4(c,mix(1.12,.8,dry)*mix(.88,1.12,f.g));
}
${MEADOW_CURE_GLSL}
float meadowGust(vec2 p,float footprint){
  vec2 q=p-uMeadowDrift.xy,d=uMeadowDrift.zw;
  vec2 s=vec2(dot(q,d),dot(q,vec2(-d.y,d.x)));
  float fine=mix(mlNoise(s*vec2(.12,.05)+vec2(0.,uTime*.06)),.5,smoothstep(1.5,6.,footprint));
  float broad=mlNoise(s*vec2(.04,.017)-vec2(0.,uTime*.025)+9.1);
  return smoothstep(.42,.8,fine*.55+broad*.45);
}
`;

const fract=v=>v-Math.floor(v);
function standHash(x,y){let a=fract(x*.1031),b=fract(y*.1031),c=fract(x*.1031);const d=a*(b+33.33)+b*(c+33.33)+c*(a+33.33);a+=d;b+=d;c+=d;return fract((a+b)*c);}
function standNoise(x,y){const i=Math.floor(x),j=Math.floor(y),f=x-i,g=y-j,u=f*f*(3-2*f),v=g*g*(3-2*g);
  const a=standHash(i,j),b=standHash(i+1,j),c=standHash(i,j+1),d=standHash(i+1,j+1);return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;}
const smoothstep=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
/** The meadow's stand noise for a scene point (x east, z = -north): {moisture, stand, seeding}, each 0..1.
 * Moisture drifts (~200 m and ~55 m) under a domain warp so no lattice shows; it only roughs up the
 * dry boundary, which meadowDrynessAt sets from distance to water. */
export function meadowStandAt(x,z){
  const wx=x+standNoise(x*.011,z*.011)*45,wz=z+standNoise(x*.011+17.3,z*.011+17.3)*45;
  const moisture=standNoise(wx*.005,wz*.005)*.45+standNoise(wx*.018+3.7,wz*.018+3.7)*.4+standNoise(wx*.06-1.3,wz*.06-1.3)*.15;
  return {moisture,stand:standNoise(wx*.045+5.1,wz*.045+5.1),seeding:smoothstep(.55,.78,standNoise(wx*.05-11.7,wz*.05-11.7))};
}
/** Ecology first: a glacial valley's meadow is wettest beside its river and lake and dries with
 * distance from the water and height above it. `water(east, north)` gives the nearest water's
 * {distance, level} (the terrain's water field); the moisture noise only roughs up where that
 * boundary falls, so dry ground is not spread evenly in patches. Worked out once at load: as a
 * per-vertex texture read it cost the grass views about 12% of their frame rate. */
export function meadowDrynessAt(distance,above,moisture){
  const far=smoothstep(50,520,distance)*.72+smoothstep(4,55,above)*.28;
  return smoothstep(.58,.92,far+(moisture-.5)*.55);
}
/** Nearest water {distance, level} from the terrain's half-float field (style.waterLevel), bilinear. */
export function waterFieldSampler(texture,grid,fromHalf){
  if(!texture||!grid.w)return ()=>({distance:600,level:20});
  const size=texture.image.width,data=texture.image.data;
  const at=(i,j,c)=>fromHalf(data[(Math.min(size-1,Math.max(0,j))*size+Math.min(size-1,Math.max(0,i)))*2+c]);
  return (east,north)=>{
    const u=(east-grid.x)/grid.z*size-.5,v=(north-grid.y)/grid.z*size-.5,i=Math.floor(u),j=Math.floor(v),fu=u-i,fv=v-j;
    const read=c=>(at(i,j,c)*(1-fu)+at(i+1,j,c)*fu)*(1-fv)+(at(i,j+1,c)*(1-fu)+at(i+1,j+1,c)*fu)*fv;
    return {level:read(0),distance:read(1)};
  };
}
/** The grass cover texture's bytes: r the grass amount (as before), g dryness (the `dryness` option, meadowDrynessAt in the game), b/a meadowStandAt's
 * stand and seeding noise at each cover cell's centre (core east/north grid). The merged cover is
 * 24 km at 8 m (about 9 M cells), so only cells with grass, or beside grass so the bilinear
 * read at a sward's edge stays true, are evaluated; the rest are neutral. Outside the 4 km
 * core block, seen only from afar, one stand per 16 m block serves its four cells.
 * ponytail: ~0.4 ms per 1,000 evaluations on the main thread at load; move to a worker if it grows. */
export function packMeadowStands(amount,cover,{core=2048,dryness=(east,north,moisture)=>moisture}={}){
  const {resolution:n,quad,offsetX,offsetY}=cover,data=new Uint8Array(n*n*4),half=Math.ceil(n/2),memo=new Uint8Array(half*half*4);
  const write=(at,s)=>{data[at+1]=Math.round(s.moisture*255);data[at+2]=Math.round(s.stand*255);data[at+3]=Math.round(s.seeding*255);};
  for(let row=0;row<n;row++)for(let col=0;col<n;col++){
    const i=row*n+col;data[i*4]=amount[i];
    const near=amount[i]||(col>0&&amount[i-1])||(col<n-1&&amount[i+1])||(row>0&&amount[i-n])||(row<n-1&&amount[i+n]);
    if(!near){data[i*4+1]=data[i*4+2]=128;continue;}
    const east=offsetX+(col+.5)*quad,north=offsetY+(row+.5)*quad;
    if(Math.abs(east)<core&&Math.abs(north)<core){const s=meadowStandAt(east,-north);write(i*4,{...s,moisture:dryness(east,north,s.moisture)});continue;}
    const m=((row>>1)*half+(col>>1))*4;
    if(!memo[m+3]){const me=offsetX+((col&~1)+1)*quad,mn=offsetY+((row&~1)+1)*quad,s=meadowStandAt(me,-mn);memo[m]=Math.round(dryness(me,mn,s.moisture)*255);memo[m+1]=Math.round(s.stand*255);memo[m+2]=Math.round(s.seeding*255);memo[m+3]=1;}
    data[i*4+1]=memo[m];data[i*4+2]=memo[m+1];data[i*4+3]=memo[m+2];
  }
  return data;
}

/** Up to four places pressing the grass (the player now, then where they were): xyz in
 * scene space, w a strength that fades as the blades spring back. */
export const MEADOW_PUSH_GLSL = `
uniform vec4 uMeadowPush[4];
vec2 meadowPush(vec3 root){
  vec2 push=vec2(0.);
  for(int k=0;k<4;k++){
    vec4 at=uMeadowPush[k];vec2 d=root.xz-at.xz;float r=length(d);
    push+=d/max(r,.05)*at.w*(1.-smoothstep(.2,1.1,r))*(1.-smoothstep(1.2,2.,abs(root.y-at.y)));
  }
  return push;
}
`;

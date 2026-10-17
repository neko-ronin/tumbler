/** Client-only art direction. Shared uniforms keep every material on one clock. */
import * as T from '../vendor/three.module.min.js';

export const style = {
  time: { value: 0 },
  sun: { value: new T.Vector3(-0.6, 0.65, -0.45).normalize() },
  warmth: { value: 1 },
  cover: { value: null },
  coverGrid: { value: new T.Vector4() },
  snow: { value: null },
  // Where the map's wind blows TOWARD, as a unit scene (x, z); main.js sets it from wind.direction_deg.
  wind: { value: new T.Vector2(1, 0) },
};
// Bare ground the vertex colours leave to the shader, so rock and snow can
// break up per pixel instead of switching at the 8 m sample spacing.
const linear = hex => new T.Color(hex).toArray().map(v => v.toFixed(4)).join(',');
const GROUND = `const vec3 ROCK=vec3(${linear('#a2a39b')});const vec3 SNOW=vec3(${linear('#e4e5db')});
  const vec3 SILT=vec3(${linear('#7d7a5e')});const vec3 WETSOIL=vec3(${linear('#5a5240')});const vec3 SEDGE=vec3(${linear('#5f8a45')});const vec3 EARTH=vec3(${linear('#8a7656')});
  float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
  float vnoise(vec2 x){vec2 i=floor(x),f=fract(x),u=f*f*(3.-2.*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+1.),u.x),u.y);}
  float fbm(vec2 x){return vnoise(x)*.55+vnoise(x*2.03+7.1)*.3+vnoise(x*4.11-3.7)*.15;}
`;
const ramp = new T.DataTexture(new Uint8Array([100, 157, 209, 255]), 4, 1, T.RedFormat);
ramp.minFilter = ramp.magFilter = T.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;
// Foliage takes the same four tones, blended: a crown is a soft mass, and
// hard bands turn each clump into a cut gem.
const softRamp = ramp.clone();
softRamp.minFilter = softRamp.magFilter = T.LinearFilter;
softRamp.needsUpdate = true;

/** Real toon lighting, with the renderer's shadows, fog and colour management. */
export function toonMaterial(parameters = {}, { meadow = false, terrain = false, foliage = false, horizonM = 0 } = {}) {
  const material = terrain ? new T.MeshStandardMaterial({roughness: .96, ...parameters}) : new T.MeshToonMaterial({ gradientMap: foliage ? softRamp : ramp, ...parameters });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = style.time;
    shader.uniforms.uWind = style.wind;
    shader.uniforms.uSun = style.sun;
    if(terrain){shader.uniforms.uCover=style.cover;shader.uniforms.uCoverGrid=style.coverGrid;shader.uniforms.uSnow=style.snow;}
    shader.vertexShader = 'uniform float uTime; uniform vec2 uWind; varying vec3 vPlace;\n' + (terrain ? 'varying vec3 vUp;\n' : '') + (foliage ? 'varying float vTreeHue;\n' : '') + (meadow ? 'attribute float petal; attribute vec3 flowerTint; varying float vPetal; varying vec3 vFlower;\n' : '') + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      ${foliage ? `#ifdef USE_INSTANCING
        vTreeHue = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vTreeHue = .5;
      #endif` : ''}
      ${meadow ? `vPetal = petal; vFlower = flowerTint; vec3 root = instanceMatrix[3].xyz;
      // Gusts travel downwind and bend stems along the wind; the instance turn is undone so every cell agrees.
      vec3 down = normalize(vec3(uWind.x, 0., uWind.y) * mat3(instanceMatrix)), across = vec3(-down.z, 0., down.x);
      float bend = max(0., position.y);
      transformed += down * sin(uTime * 1.2 - dot(root.xz, uWind) * .031 + position.y) * .24 * bend
        + across * cos(uTime * .9 + root.x * .018) * .12 * bend;` : ''}
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 place = vec4(transformed, 1.);
      #ifdef USE_INSTANCING
        place = instanceMatrix * place;
      #endif
      vPlace = (modelMatrix * place).xyz;
      ${terrain ? 'vUp = normalize(mat3(modelMatrix) * objectNormal);' : ''}
      #include <project_vertex>
    `);
    shader.fragmentShader = (terrain?'uniform sampler2D uCover;uniform sampler2D uSnow;uniform vec4 uCoverGrid;varying vec3 vUp;\n'+GROUND:'')+'uniform float uTime; uniform vec3 uSun; varying vec3 vPlace;\n' + (foliage ? 'varying float vTreeHue;\n' : '') + (meadow ? 'varying float vPetal; varying vec3 vFlower;\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      ${meadow ? `diffuseColor.rgb = mix(diffuseColor.rgb, vFlower, vPetal);` : ""}
      ${foliage ? `float leafy = step(diffuseColor.r * 1.1, diffuseColor.g);
      // Neighbouring trees differ a little in green, as a stand does.
      diffuseColor.rgb *= mix(vec3(1.), mix(vec3(.9, 1., .95), vec3(1.08, 1.03, .86), vTreeHue), leafy);` : ""}
      ${terrain ? `vec2 stampUv=(vec2(vPlace.x,-vPlace.z)-uCoverGrid.xy)/(uCoverGrid.z*uCoverGrid.w);
      float stamped=texture2D(uCover,stampUv).r*step(0.,stampUv.x)*step(0.,stampUv.y)*step(stampUv.x,1.)*step(stampUv.y,1.);
      float lowBiome=1.-smoothstep(180.,360.,vPlace.y);
      float knownGround=1.-smoothstep(.42,.5,max(abs(stampUv.x-.5),abs(stampUv.y-.5)));
      diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.68,.65,.53),vec3(1.),stamped),lowBiome*knownGround);
      // Ground detail is noise at three scales, never a repeating wave:
      // meadow-sized lush/dry drifts, clumps, and grain that fades before it
      // is smaller than a pixel.
      vec2 ground=vec2(vPlace.x,-vPlace.z);
      float footprint=max(length(dFdx(vPlace)),length(dFdy(vPlace)));
      float drift=fbm(ground*.0065),clump=fbm(ground*.075),grain=vnoise(ground*1.3);
      diffuseColor.rgb*=mix(vec3(.84,.95,.85),vec3(1.16,1.06,.8),smoothstep(.25,.75,drift));
      diffuseColor.rgb*=1.+(clump-.5)*.22*(1.-smoothstep(2.,8.,footprint))+(grain-.5)*.12*(1.-smoothstep(.25,.9,footprint));
      // Rock where the ground is steep or high, with ragged edges; snow on
      // the high ground that is flat enough to hold it.
      float steep=length(vUp.xz)/max(.05,vUp.y);
      float slopeMask=smoothstep(.5,.78,steep+(clump-.5)*.4+(drift-.5)*.25);
      // Low steep ground is a cut bank of earth under turf, not granite.
      float lowland=1.-smoothstep(38.,70.,vPlace.y+(drift-.5)*20.);
      diffuseColor.rgb=mix(diffuseColor.rgb,EARTH*mix(.8,1.1,clump),slopeMask*lowland*smoothstep(.35,.7,grain*.4+clump*.6+.15));
      float rockMask=max(slopeMask*(1.-lowland),smoothstep(640.,790.,vPlace.y+(drift-.5)*160.));
      // Granite: pale and dark masses split by joints. The joints are a
      // ridge of noise, faded with distance so they never alias into lines.
      vec2 face=ground+vec2(vPlace.y*.7,-vPlace.y*.4);
      float mass=fbm(face*.035);
      float joint=pow(1.-abs(vnoise(face*.11)*2.-1.),10.)*smoothstep(.45,.7,vnoise(face*.043+5.3))*(1.-smoothstep(1.,4.,footprint));
      float strata=mass*.8+grain*.2-joint*.55;
      diffuseColor.rgb=mix(diffuseColor.rgb,ROCK*mix(.7,1.15,strata)*mix(vec3(1.04,.99,.92),vec3(.93,.97,1.04),drift),rockMask);
      float snowMask=smoothstep(1010.,1110.,vPlace.y+(clump-.5)*70.+(drift-.5)*90.)*(1.-smoothstep(.62,1.,steep+(clump-.5)*.35))*(1.-knownGround);
      diffuseColor.rgb=mix(diffuseColor.rgb,SNOW,snowMask);
      // Inside the block every water body stands at 20 m and no dry ground
      // away from them is below 25 m, so height alone finds the banks: a silty
      // bed, a wet line and a fringe of darker sedge, each edge broken by
      // noise. The far field's lowland lies below 20 m, so it is left out.
      ${horizonM ? '' : `float shoreline=vPlace.y-20.+(clump-.5)*.9+(grain-.5)*.25;
      vec3 bank=mix(SILT*mix(.75,1.1,grain),WETSOIL*mix(.85,1.1,clump),smoothstep(-.6,.1,shoreline));
      bank=mix(bank,SEDGE*mix(.8,1.1,clump),smoothstep(.5,1.4,shoreline));
      diffuseColor.rgb=mix(bank,diffuseColor.rgb,smoothstep(1.4,3.4,shoreline));
`}
      // Core snow stamp (the grass stamp's grid; depth/max in red) is the snow
      // riders feel, so on the block it replaces the height rule above.
      float coreSnow=smoothstep(.03,.14,texture2D(uSnow,stampUv).r+(drift-.5)*.04)*knownGround;
      diffuseColor.rgb=mix(diffuseColor.rgb,SNOW*mix(.97,1.03,grain),coreSnow);
      float relief=(rockMask*(mass*2.2-joint*.4)+(1.-rockMask)*clump*.12)*(1.-smoothstep(1.5,5.,footprint));` : ''}
    `);
    if(terrain){
      // Bump the lighting normal by the same relief, so rock catches the sun.
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition),r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);
        float det=dot(sigmaX,r1)*faceDirection;
        normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));
      `);
    }
    if(horizonM){
      shader.uniforms.uHorizonM={value:horizonM};shader.uniforms.uWarmth=style.warmth;
      shader.fragmentShader='uniform float uHorizonM;uniform float uWarmth;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
        vec3 horizonRay=normalize(vPlace-cameraPosition);
        vec3 horizonColour=vec3(.52,.75,.79)+vec3(.32,.10,0.)*pow(max(0.,dot(horizonRay,uSun)),8.)*uWarmth;
        // Only the ring's last stretch fades, so its cut edge vanishes into
        // the painted ranges; the scene fog already hazes it with distance,
        // and a wider fade turned the enclosing ridges into pale curtains.
        float horizonFade=smoothstep(uHorizonM*.88,uHorizonM*.99,max(abs(vPlace.x),abs(vPlace.z)));
        gl_FragColor.rgb=mix(gl_FragColor.rgb,horizonColour,horizonFade);
      `);
    }
    if (foliage) {
      // A spray is one sheet seen from both sides: light it the same way
      // from either, along the crown's rounded normal. The begin chunk has
      // already flipped back faces; flipping a leafy one again undoes that.
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
        #include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= mix(1., faceDirection, leafy);
        #endif
      `);
      // Low sun behind a crown glows through its edges.
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float through = pow(max(0., dot(normalize(vPlace - cameraPosition), uSun)), 5.);
        outgoingLight += diffuseColor.rgb * vec3(1.05, 1.2, .55) * through * .55 * leafy;
        #include <opaque_fragment>
      `);
    }
    if (foliage || meadow) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
        float rim = pow(1. - max(0., dot(normal, normalize(vViewPosition))), 3.);
        outgoingLight += diffuseColor.rgb * rim * .20;
        #include <opaque_fragment>
      `);
    }
  };
  material.customProgramCacheKey = () => `cozy-v5:${+meadow}:${+terrain}:${+foliage}:${horizonM?1:0}`;
  return material;
}

/** Sky and soft cloud shapes use one background draw, no textures/post process.
 *
 * Past the far field's 3D ring the horizon is an illusion painted here: three
 * mountain ranges at fixed distances, drawn by the elevation angle they would
 * have from the camera's height, so they sink when you fly. Each map river
 * reach opens a gap toward its far end: a notch where the river comes down
 * from higher ground, a broad low gap where it leaves toward lower ground.
 */
export function makeSky(reaches = []) {
  const gaps = [0, 1].map(i => {
    const line = reaches[i]?.polyline_xyz_m;
    if (!line) return new T.Vector3(1, 0, 0);
    const [x, y, z] = line[line.length - 1], length = Math.hypot(x, y);
    return new T.Vector3(x / length, -y / length, z > line[0][2] ? 1 : -1);
  });
  const sky = new T.Mesh(new T.SphereGeometry(14000, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, toneMapped: false,
    uniforms: { uTime: style.time, uSun: style.sun, uWarmth: style.warmth, uWind: style.wind, uGapA: { value: gaps[0] }, uGapB: { value: gaps[1] } },
    vertexShader: `varying vec3 vRay; void main(){ vRay = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      varying vec3 vRay; uniform float uTime; uniform vec3 uSun; uniform float uWarmth; uniform vec2 uWind; uniform vec3 uGapA; uniform vec3 uGapB;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y);}
      void main(){
        vec3 ray=normalize(vRay); float h=max(0.,ray.y);
        vec3 horizon=vec3(.52,.75,.79);
        vec3 col=mix(horizon,vec3(.10,.35,.62),pow(h,.42));
        col += vec3(.32,.10,.0)*pow(max(0.,dot(ray,uSun)),8.)*uWarmth;
        float sun=pow(max(0.,dot(ray,uSun)),180.);
        col+=vec3(1.,.77,.38)*sun*.6;
        vec2 p=ray.xz/(.08+max(0.,ray.y))*2.7-uWind*uTime*.003;
        float cloud=noise(p)*.65+noise(p*2.1)*.25+noise(p*4.)*.1;
        float mask=smoothstep(.59,.73,cloud)*smoothstep(.14,.32,h);
        // Cumulus lives in the world volume pass, at the core cloud cells.
        vec2 dir=normalize(ray.xz+vec2(1e-5,0.));
        float elevation=asin(clamp(ray.y,-1.,1.));
        for(int layer=2;layer>=0;layer--){
          float k=float(layer),distanceM=mix(7500.,16000.,k*.5);
          float profile=noise(dir*(3.4+k*1.3)+k*13.1)*.62+noise(dir*(9.1+k*2.)+k*7.7)*.28+noise(dir*31.+k*3.3)*.1;
          float height=mix(850.,1750.,k*.5)+mix(900.,1300.,k*.5)*profile;
          for(int g=0;g<2;g++){
            vec3 gap=g==0?uGapA:uGapB;
            float off=acos(clamp(dot(dir,gap.xy),-1.,1.));
            height*=gap.z>0.?1.-.42*exp(-off*off/.012):1.-.78*exp(-off*off/.2);
          }
          float ridge=atan((height-cameraPosition.y)/distanceM);
          float cover=smoothstep(ridge+.0012,ridge-.0012,elevation);
          vec3 rock=mix(vec3(.34,.45,.45),vec3(.62,.7,.74),k*.5);
          rock*=1.+.12*dot(dir,normalize(uSun.xz))+.06*(noise(vec2(atan(dir.y,dir.x)*90.,elevation*70.))-.5);
          rock=mix(rock,vec3(.86,.88,.9),smoothstep(1500.,2300.,height)*smoothstep(ridge-.012,ridge-.002,elevation)*k*.5);
          // Each range dissolves into the valley haze below its crest.
          vec3 haze=mix(horizon,col,.35);
          rock=mix(rock,haze,mix(.25,.6,k*.5)+.35*smoothstep(0.,.07,ridge-elevation));
          col=mix(col,rock,cover);
        }
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.name = 'painted_sky'; sky.frustumCulled = false;
  return sky;
}

/** One opaque water pass; depth is sampled from the same core height grid. */
export function waterMaterial(grid, river, polyline=null, { ribbon = false } = {}) {
  const heights = new T.DataTexture(grid.values, grid.resolution, grid.resolution, T.RedFormat, T.FloatType);
  heights.minFilter = heights.magFilter = T.LinearFilter;
  heights.needsUpdate = true;
  const flowSize=128,flowBytes=new Uint8Array(flowSize*flowSize*4);
  for(let row=0;row<flowSize;row++)for(let col=0;col<flowSize;col++){
    const x=grid.offsetX+(col+.5)/flowSize*grid.quad*(grid.resolution-1),y=grid.offsetY+(row+.5)/flowSize*grid.quad*(grid.resolution-1);
    let distance=Infinity,dx=1,dy=0;
    if(river&&polyline)for(let i=1;i<polyline.length;i++){
      const a=polyline[i-1],b=polyline[i],vx=b[0]-a[0],vy=b[1]-a[1],length=vx*vx+vy*vy;
      const t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/length));
      const d=(x-a[0]-vx*t)**2+(y-a[1]-vy*t)**2;
      if(d<distance){distance=d;dx=vx/Math.sqrt(length);dy=-vy/Math.sqrt(length);}
    }
    const at=(row*flowSize+col)*4;flowBytes[at]=(dx*.5+.5)*255;flowBytes[at+1]=(dy*.5+.5)*255;flowBytes[at+3]=255;
  }
  const flow=new T.DataTexture(flowBytes,flowSize,flowSize);flow.minFilter=flow.magFilter=T.LinearFilter;flow.needsUpdate=true;
  return new T.ShaderMaterial({
    name: ribbon ? 'river_reach_optical' : river ? 'river_optical' : 'reservoir_optical', transparent: true, depthWrite: false,
    defines: ribbon ? { RIBBON: '' } : {},
    uniforms: { uTime: style.time, uSun: style.sun, uHeights: { value: heights },
      uGrid: { value: new T.Vector4(grid.offsetX, grid.offsetY, grid.quad, grid.resolution) },
      uFlow:{value:flow},uRiver: { value: river ? 1 : 0 }, ...T.UniformsUtils.merge([T.UniformsLib.fog]) },
    fog: true,
    vertexShader: `varying vec3 vPlace; varying vec3 vView;
      #ifdef RIBBON
        attribute float across; varying float vAcross;
      #endif
      #include <fog_pars_vertex>
      void main(){vPlace=(modelMatrix*vec4(position,1.)).xyz;vView=cameraPosition-vPlace;
      #ifdef RIBBON
        vAcross=across;
      #endif
      vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform float uRiver; uniform vec3 uSun; uniform sampler2D uHeights; uniform sampler2D uFlow; uniform vec4 uGrid;
      varying vec3 vPlace; varying vec3 vView;
      #ifdef RIBBON
        varying float vAcross;
      #endif
      #include <fog_pars_fragment>
      float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
      // Value noise with its analytic gradient: (value, d/dx, d/dy).
      vec3 noised(vec2 x){vec2 i=floor(x),f=fract(x),u=f*f*f*(f*(f*6.-15.)+10.),du=30.*f*f*(f*(f-2.)+1.);
        float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+1.),k=a-b-c+d;
        return vec3(a+(b-a)*u.x+(c-a)*u.y+k*u.x*u.y,du*vec2(b-a+k*u.y,c-a+k*u.x));}
      // The ground under this pixel, interpolated over the same two triangles
      // per cell the terrain mesh draws, so depth reaches zero where the
      // visible bank actually meets the surface.
      float bed(vec2 world){vec2 g=(world-uGrid.xy)/uGrid.z,c=floor(g),f=g-c;
        float r=uGrid.w,a=texture2D(uHeights,(c+.5)/r).r,b=texture2D(uHeights,(c+vec2(1.5,.5))/r).r,
          e=texture2D(uHeights,(c+vec2(.5,1.5))/r).r,d=texture2D(uHeights,(c+1.5)/r).r;
        return f.x>=f.y?a+(b-a)*f.x+(d-b)*f.y:a+(e-a)*f.y+(d-e)*f.x;}
      // Ripple slope, advected along the current by two crossfaded phases so
      // the pattern drifts without stretching. Each octave fades out before it
      // is finer than a pixel, which removes the distant moire stripes.
      vec2 ripples(vec2 p,vec2 flow,float footprint,out float calm){
        float speed=mix(.35,1.6,uRiver),gust=noised(p*.012+vec2(uTime*.021,-uTime*.013)).x;
        calm=smoothstep(.15,.85,gust);
        vec2 slope=vec2(0.);
        for(int phase=0;phase<2;phase++){
          float t=fract(uTime*.09+float(phase)*.5),w=1.-abs(t*2.-1.);
          vec2 q=p-flow*speed*(t-.5)*11.+float(phase)*vec2(17.3,-9.1);
          float freq=.11,amp=.045;
          for(int octave=0;octave<7;octave++){
            float fade=1.-smoothstep(.12,.45,footprint*freq);
            slope+=noised(q*freq+float(octave)*vec2(3.7,8.1)).yz*amp*fade*w;
            freq*=2.1;amp*=.84;q=mat2(.8,.6,-.6,.8)*q;
          }
        }
        return slope*mix(.45,1.15,calm);
      }
      void main(){
        vec2 world=vec2(vPlace.x,-vPlace.z);
        vec2 uv=((world-uGrid.xy)/uGrid.z+.5)/uGrid.w;
        float depth=max(0.,vPlace.y-bed(world));
        vec2 p=vPlace.xz;
        vec2 flow=texture2D(uFlow,uv).rg*2.-1.;
        // Mean of the two pixel axes: the long axis alone flattens grazing water.
        vec2 axes=vec2(length(dFdx(p)),length(dFdy(p)));float footprint=(axes.x+axes.y)*.5,calm;
        vec2 slope=ripples(p,flow,footprint,calm);
        vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 eye=normalize(vView);
        float fresnel=.02+.98*pow(1.-max(0.,dot(n,eye)),5.);
        float sediment=clamp(depth/8.,0.,1.);
        vec3 water=mix(vec3(.15,.31,.18),vec3(.025,.115,.095),sediment);
        vec3 reflected=reflect(-eye,n);
        vec3 sky=mix(vec3(.51,.64,.64),vec3(.16,.39,.59),clamp(reflected.y,0.,1.));
        float facing=max(0.,dot(reflect(-uSun,n),eye));
        // A broad sun path broken by gusts, plus small glints that only
        // appear where a ripple faces the sun exactly and the pixel is small
        // enough to hold one; distant water keeps the soft path only.
        float sheen=pow(facing,mix(28.,90.,calm))*mix(.06,.16,calm);
        float glint=smoothstep(.8,.97,noised(p*6.3+flow*uTime*.6+vec2(0.,uTime*.35)).x)*pow(facing,900.)*(1.-smoothstep(.03,.2,footprint));
        vec3 col=mix(water,sky,fresnel*.86)+vec3(1.,.94,.78)*(sheen+glint*4.);
        float caustic=pow(1.-abs(noised(p*.55+vec2(uTime*.11,-uTime*.07)).x*2.-1.),7.)*.05*exp(-depth*.65);
        col+=vec3(.31,.43,.19)*caustic;
        // Lapping foam only where the water thins, travelling up the shore.
        float shore=1.-smoothstep(.03,.38,depth);
        float foam=shore*smoothstep(.45,.95,noised(p*.9+vec2(uTime*.13,0.)).x+.15*sin(uTime*1.1-depth*16.));
        col=mix(col,vec3(.71,.77,.65),foam*.22);
        // Optical path grows with depth AND grazing angle: dense green pools,
        // clear shallow water over the actual stones and fish below. The last
        // few decimetres fade to nothing, so the bank shows no drawn edge.
        float opacity=clamp(1.-exp(-depth*.17/max(.16,eye.y)),.16,.94);
        opacity=max(opacity,fresnel*.90)*smoothstep(0.,.32,depth);
        opacity=max(opacity,foam*.3*smoothstep(0.,.08,depth));
        #ifdef RIBBON
          // A reach on the coarse far-field grid has no bank fine enough to
          // end it, so the ribbon's own edges fade instead.
          opacity*=1.-smoothstep(.55,1.,abs(vAcross));
        #endif
        gl_FragColor=vec4(col,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`
  });
}

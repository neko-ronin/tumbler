/** Client-only art direction. Shared uniforms keep every material on one clock. */
import * as T from '../vendor/three.module.min.js';
import {FOREST_FIELD_GLSL,forestUniforms} from './forest-field.js';
import {ACTOR_SHADOW_GLSL} from './actor-shadow.js';
import {TREE_SHADOW_GLSL,treeShadowUniforms} from './tree-shadows.js';
import {CLOUD_GROUND_LIGHT_GLSL} from './cloud-shadow-field.js';
import {ATMOSPHERE_SKY_GLSL} from './atmosphere-sky.js';
import {MEADOW_AIR_GLSL,MEADOW_SURFACE_GLSL,MEADOW_BEND_GLSL} from './meadow-shading.js';

export const style = {
  time: { value: 0 },
  sun: { value: new T.Vector3(-0.6, 0.65, -0.45).normalize() },
  warmth: { value: 1 },
  sunEffects: { value: 1 },
  actorShadow:{value:null},actorShadowMatrix:{value:new T.Matrix4()},actorShadowTexel:{value:new T.Vector2(1/1024,1/1024)},actorShadowReady:{value:0},
  cloudGroundHeight:{value:null},cloudBase:{value:980},
  cloudGround:{value:null},cloudGroundGrid:{value:new T.Vector4(0,0,1,1)},
  cloudGroundReady:{value:0},cloudTop:{value:1600},
  cover: { value: null },
  coverGrid: { value: new T.Vector4() },
  snow: { value: null },
  meadowAirFrom: {value:null},meadowAirTo: {value:null},
  meadowAirGrid: {value:new T.Vector4(-2048,-2048,4096,1)},meadowAirMix: {value:1},
  meadowFocus:{value:new T.Vector3()},
  // Where the map's wind blows TOWARD, in scene (x, z); main.js sets bearing and relative simulated strength.
  air: {value:null},
  airGrid: {value:new T.Vector4(0,0,640,0)},
  wind: { value: new T.Vector2(1, 0) },
  // Regional cloud detail must not change when the observer enters a local gust.
  cloudWind:{value:new T.Vector2(1,0)},
};
// Shared air samples packed as scene (east, south) velocity, lift, roughness.
const AIR_GLSL=`uniform sampler2D uAir;uniform vec4 uAirGrid;uniform vec2 uWind;
vec4 localAir(vec2 p){vec2 uv=(p-uAirGrid.xy)/uAirGrid.z;
  float inside=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.)*uAirGrid.w;
  return mix(vec4(uWind*4.2,0.,0.),texture2D(uAir,clamp(uv,0.,1.)),inside);}
`;
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

export function sunShadowUniforms(){
 return {...treeShadowUniforms(),uActorShadow:style.actorShadow,uActorShadowMatrix:style.actorShadowMatrix,uActorShadowTexel:style.actorShadowTexel,uActorShadowReady:style.actorShadowReady,
  uCloudGround:style.cloudGround,uCloudGroundHeight:style.cloudGroundHeight,uCloudGroundGrid:style.cloudGroundGrid,uCloudGroundReady:style.cloudGroundReady,uCloudBase:style.cloudBase,uCloudTop:style.cloudTop};
}
export function sunShadowShader(shader){
 Object.assign(shader.uniforms,sunShadowUniforms());shader.fragmentShader=TREE_SHADOW_GLSL+ACTOR_SHADOW_GLSL+CLOUD_GROUND_LIGHT_GLSL+shader.fragmentShader;
}

/** Real toon lighting, with the renderer's shadows, fog and colour management. */
export function toonMaterial(parameters = {}, { meadow = false, terrain = false, foliage = false, horizonM = 0, meadowRange = [150,225], meadowFocused=false, canopy=false,grassBlades=false,canopyStart=[25,44] } = {}) {
  const material = terrain ? new T.MeshStandardMaterial({roughness: .96, ...parameters}) : new T.MeshToonMaterial({ gradientMap: foliage||meadow ? softRamp : ramp, ...parameters });
  material.onBeforeCompile = (shader) => {
    sunShadowShader(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      float sunlight=${material.userData.receiveActorShadow===false?'1.':'actorSunLight(vPlace)'}*${terrain||meadow?'cloudGroundLight(vPlace)':'cloudObjectLight(vPlace,uSun)'};
      reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;
    `);
    shader.uniforms.uTime = style.time;
    shader.uniforms.uWind = style.wind;
    shader.uniforms.uAir=style.air;shader.uniforms.uAirGrid=style.airGrid;
    shader.uniforms.uSun = style.sun;
    if(terrain||meadow){
      shader.uniforms.uMeadowAirFrom=style.meadowAirFrom;shader.uniforms.uMeadowAirTo=style.meadowAirTo;
      shader.uniforms.uMeadowAirGrid=style.meadowAirGrid;shader.uniforms.uMeadowAirMix=style.meadowAirMix;
    }
    if(meadow){shader.uniforms.uMeadowRange={value:new T.Vector2(...meadowRange)};shader.uniforms.uMeadowFocus=style.meadowFocus;}
    if(canopy)shader.uniforms.uCanopyStart={value:new T.Vector2(...canopyStart)};
    if(terrain)Object.assign(shader.uniforms,forestUniforms());
    if(terrain||meadow){shader.uniforms.uCover=style.cover;shader.uniforms.uCoverGrid=style.coverGrid;shader.uniforms.uSnow=style.snow;}
    shader.vertexShader = (canopy?'uniform vec2 uCanopyStart;varying vec2 vGrassUv;varying float vGrassSeed;\n':'')+((terrain||meadow)?MEADOW_AIR_GLSL:'')+AIR_GLSL+'uniform float uTime; varying vec3 vPlace;\n' + (terrain ? 'varying vec3 vUp;\n' : '') + (foliage ? 'varying float vTreeHue;\n' : '') + (meadow ? MEADOW_BEND_GLSL+'uniform vec2 uMeadowRange;uniform vec3 uMeadowFocus; varying float vMeadowFade; attribute float petal; attribute vec3 flowerTint; attribute vec3 bladeRoot; attribute float flex; attribute float plant; attribute vec3 meadowTraits; varying float vPetal; varying vec3 vFlower; varying float vPlant; varying float vLeafTone;\n' : '') + shader.vertexShader;
    if(meadow)shader.vertexShader=shader.vertexShader.replace('#include <beginnormal_vertex>',`#include <beginnormal_vertex>
      vec3 root=(instanceMatrix*vec4(bladeRoot,1.)).xyz;
      vPlant=step(plant,meadowTraits.x);
      // Interleave clump endings across twelve metres rather than tracing
      // the moving window with a single circular contour.
      float fadeOffset=(meadowTraits.y-1.)*40.;
      vMeadowFade=1.-smoothstep(uMeadowRange.x+fadeOffset,uMeadowRange.y+fadeOffset,distance(root,${meadowFocused?'uMeadowFocus':'cameraPosition'}));
      ${canopy?'vMeadowFade*=smoothstep(uCanopyStart.x+fadeOffset,uCanopyStart.y+fadeOffset,distance(root,cameraPosition));':''}
      vec3 meadowPosition=vec3(bladeRoot.x,0.,bladeRoot.z);
      // Coarse tile culling also submits plants beyond the fade and unused
      // blossom forms. They need no eight-read air interpolation or flex work.
      if(vMeadowFade>.001&&vPlant>.5){
      vec4 air=meadowAir(root.xz);
      float speed=length(air.xy);
      // Core vectors/gusts drive the lean. Small, independently phased tip
      // flutter is a plant response to that air's roughness, not another gust.
      vec3 localWind=vec3(air.x,0.,air.y)*mat3(instanceMatrix);
      localWind/=vec3(dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz),dot(instanceMatrix[1].xyz,instanceMatrix[1].xyz),dot(instanceMatrix[2].xyz,instanceMatrix[2].xyz));
      localWind.y=0.;localWind/=1.+speed*.055;
      ${canopy||grassBlades?`// Flexible canopy response amplifies the actual signed gust;
      // its phase, position and direction still come entirely from shared air.
      localWind*=1.+clamp(air.z*.4,-.5,1.);`:''}
      float phase=meadowTraits.z+dot(bladeRoot.xz,vec2(17.1,31.7))+flex*7.;
      float flutter=(sin(uTime*(2.6+flex)+phase)+.45*sin(uTime*5.3+phase*.7))*.14*air.w*speed/(speed+2.);
      localWind+=vec3(-localWind.z,0.,localWind.x)*flutter;
      vec3 coefficient=meadowBendCoefficient(localWind,flex);
      meadowPosition=meadowBentPosition(position,bladeRoot,coefficient);
      objectNormal=meadowBentNormal(objectNormal,position,bladeRoot,coefficient);
      ${canopy||grassBlades?`// Keep the silhouette: coverage fades instead of flattening
      // the broad carrier onto the terrain.`:`
      meadowPosition.y*=vMeadowFade;objectNormal.y/=max(.03,vMeadowFade);`}
      }
      vLeafTone=meadowTraits.y*(.82+.18*clamp(position.y,0.,1.));
    `);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      ${foliage ? `#ifdef USE_INSTANCING
        vTreeHue = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
      #else
        vTreeHue = .5;
      #endif` : ''}
      ${foliage ? `#ifdef USE_INSTANCING
        vec4 air=localAir(instanceMatrix[3].xz);
        vec3 localWind=vec3(air.x,0.,air.y)*mat3(instanceMatrix);
        transformed+=localWind*min(.08,max(0.,position.y)*.002)*(.9+.1*sin(uTime*2.+position.y));
      #endif` : ''}
      ${meadow ? `vPetal=petal;vFlower=flowerTint;transformed=meadowPosition;` : ''}
      ${canopy?'vGrassUv=uv;vGrassSeed=meadowTraits.z;':''}
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
    shader.fragmentShader = (canopy?'varying vec2 vGrassUv;varying float vGrassSeed;\n'+GROUND:'')+(terrain||meadow?'uniform sampler2D uCover;uniform sampler2D uSnow;uniform vec4 uCoverGrid;\n':'')+(terrain?'varying vec3 vUp;\n'+FOREST_FIELD_GLSL+GROUND+MEADOW_AIR_GLSL+MEADOW_SURFACE_GLSL:'')+'uniform float uTime; uniform vec3 uSun; varying vec3 vPlace;\n' + (foliage ? 'varying float vTreeHue;\n' : '') + (meadow ? 'varying float vMeadowFade; varying float vPetal; varying vec3 vFlower; varying float vPlant; varying float vLeafTone;\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      ${meadow ? `if(vMeadowFade<=.001||vPlant<.5)discard;
      vec2 grassUv=(vec2(vPlace.x,-vPlace.z)-uCoverGrid.xy)/(uCoverGrid.z*uCoverGrid.w);
      if(min(grassUv.x,grassUv.y)<0.||max(grassUv.x,grassUv.y)>1.||texture2D(uCover,grassUv).r<.5||texture2D(uSnow,grassUv).r>.03||vPlace.y<22.)discard;
      diffuseColor.rgb = mix(diffuseColor.rgb*vLeafTone,vFlower,vPetal);` : ""}
      ${grassBlades?'diffuseColor.a*=vMeadowFade;':''}
      ${canopy?`// Individually cut out tapered leaves in crossed, bent cards.
      float bladeCoordinate=vGrassUv.x*28.,bladeId=floor(bladeCoordinate);
      float seed=hash(vec2(bladeId,vGrassSeed*51.));
      float bladeHeight=mix(.48,1.,seed),height=vGrassUv.y/bladeHeight;
      float centre=.25+.5*hash(vec2(bladeId+17.,vGrassSeed*31.));
      centre+=(hash(vec2(bladeId+43.,vGrassSeed))-.5)*.38*height*height;
      float width=(.24+.09*seed)*max(0.,1.-height*height);
      float edge=abs(fract(bladeCoordinate)-centre),aa=max(.008,fwidth(bladeCoordinate)*.35);
      float leaf=(1.-smoothstep(width-aa,width+aa,edge))*(1.-smoothstep(1.-fwidth(height),1.+fwidth(height),height));
      float resolved=1.-smoothstep(.65,1.65,fwidth(bladeCoordinate));
      // Integrated subpixel coverage, never a solid rectangle with a flat top.
      float averagedCanopy=.55*(1.-smoothstep(.12,.95,vGrassUv.y));
      leaf=mix(averagedCanopy,leaf,resolved);
      diffuseColor.a*=leaf*vMeadowFade;
      if(diffuseColor.a<.001)discard;
      diffuseColor.rgb*=mix(1.,mix(.85,1.12,seed),resolved);` : ''}
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
      // Only the core grass stamp receives sward detail and wind. Banks,
      // snow, rocky faces and the world beyond the stamp keep their material.
      float sward=stamped*(1.-coreSnow)*(1.-rockMask)*(1.-snowMask)*smoothstep(22.,24.,vPlace.y);
      vec4 grassAir=meadowAir(vPlace.xz);
      vec3 grass=meadowSurface(vPlace.xz,normalize(vUp),footprint,grassAir);
      // Match the average canopy tone beneath the blade coverage fade.
      diffuseColor.rgb*=mix(1.,grass.x*.54,sward);
      // The signed core gust travels through this field. Leaf-side exposure
      // amplifies its light/dark response without authoring another wave.
      diffuseColor.rgb*=1.+clamp(grassAir.z*.065,-.18,.18)*sward;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.14,1.12,.92),grass.z*sward*.48);
      // A needle bed belongs beneath existing forest crowns. Its footprint
      // comes from the core individuals, so meadow and clearings keep turf.
      vec4 forestSoil=forestAt(vPlace);
      float forestMask=forestCoverAt(vPlace)*knownGround*(1.-coreSnow)*(1.-rockMask);
      float moss=smoothstep(.43,.68,fbm(ground*.45)+.12*(clump-.5));
      vec3 litterTexture=forestLitter(ground);
      vec3 litter=litterTexture*mix(.85,1.14,clump);
      litter=mix(litter,litter*vec3(.77,.96,.65),moss*.25);
      litter*=mix(1.,.87,forestSoil.b);
      diffuseColor.rgb=mix(diffuseColor.rgb,litter,forestMask);
      float relief=forestMask*(grain*.007+dot(litterTexture,vec3(.2126,.7152,.0722))*.018)+sward*grass.y*(1.-forestMask)+(rockMask*(mass*2.2-joint*.4)+(1.-rockMask)*clump*.12)*(1.-smoothstep(1.5,5.,footprint));` : ''}
    `);
    if(terrain){
      // Bump the lighting normal by the same relief, so rock catches the sun.
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition),r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);
        float det=dot(sigmaX,r1)*faceDirection;
        normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));
        vec3 grassLean=vec3(grassAir.x,0.,grassAir.y);
        grassLean-=normalize(vUp)*dot(grassLean,normalize(vUp));
        // Transform a tangent-plane wind bend into view space for lighting.
        normal=normalize(normal-mat3(viewMatrix)*grassLean*(.055*grass.z*sward));
      `);
    }
    if(horizonM){
      shader.uniforms.uHorizonM={value:horizonM};shader.uniforms.uWarmth=style.warmth;
      shader.fragmentShader='uniform float uHorizonM;uniform float uWarmth;\n'+ATMOSPHERE_SKY_GLSL+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
        vec3 horizonRay=normalize(vPlace-cameraPosition);
        vec3 horizonColour=clearSky(normalize(vec3(horizonRay.x,.001,horizonRay.z)),uSun,uWarmth,cameraPosition.y);
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
  material.customProgramCacheKey = () => `cozy-meadow-v17:${+meadow}:${+terrain}:${+foliage}:${horizonM?1:0}:${+meadowFocused}:${+canopy}:${+grassBlades}:${+(material.userData.receiveActorShadow!==false)}`;
  return material;
}

/** Clear sky and the existing distant ranges use one background draw.
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
      ${ATMOSPHERE_SKY_GLSL}
      void main(){
        vec3 ray=normalize(vRay);
        vec3 horizon=clearSky(normalize(vec3(ray.x,.001,ray.z)),uSun,uWarmth,cameraPosition.y);
        vec3 col=clearSky(ray,uSun,uWarmth,cameraPosition.y);
        float alignment=max(0.,dot(ray,uSun));
        // A softly cut painted disc, 1.4 degrees across, inside the old halo.
        // Angular units keep it round and stable as flight FOV changes.
        float angle=atan(length(cross(ray,uSun)),alignment);
        float pixel=max(fwidth(angle),.00015);
        float disc=1.-smoothstep(.0118-pixel,.0118+pixel,angle);
        float rim=(1.-smoothstep(.015,.020,angle))*(1.-disc);
        vec3 sunTint=mix(vec3(1.,.92,.72),vec3(1.,.70,.32),uWarmth);
        col+=sunTint*(pow(alignment,180.)*.38+rim*.20);
        col=mix(col,mix(vec3(1.8,1.60,1.03),vec3(1.85,1.28,.55),uWarmth),disc);
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
    uniforms: { ...sunShadowUniforms(),uTime: style.time, uSun: style.sun, uHeights: { value: heights },
      uGrid: { value: new T.Vector4(grid.offsetX, grid.offsetY, grid.quad, grid.resolution) },
      uAir:style.air,uAirGrid:style.airGrid,uWind:style.wind,uFlow:{value:flow},uRiver: { value: river ? 1 : 0 }, ...T.UniformsUtils.merge([T.UniformsLib.fog]) },
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
    fragmentShader: ACTOR_SHADOW_GLSL+CLOUD_GROUND_LIGHT_GLSL+AIR_GLSL+`
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
        vec4 air=localAir(p);float windSpeed=length(air.xy);
        vec2 down=air.xy/max(.01,windSpeed),across=vec2(-down.y,down.x);
        float windRipple=sin(dot(p,down)*3.-uTime*windSpeed*1.7+sin(dot(p,across)*.16));
        slope+=down*windRipple*min(.045,windSpeed*.004)*(1.-smoothstep(.25,1.2,footprint));
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
        float sunlight=cloudObjectLight(vPlace,uSun)*actorSunLight(vPlace);
        vec3 col=mix(water*mix(.65,1.,sunlight),sky,fresnel*.86)+vec3(1.,.94,.78)*(sheen+glint*4.)*sunlight;
        float caustic=pow(1.-abs(noised(p*.55+vec2(uTime*.11,-uTime*.07)).x*2.-1.),7.)*.05*exp(-depth*.65);
        col+=vec3(.31,.43,.19)*caustic*sunlight;
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

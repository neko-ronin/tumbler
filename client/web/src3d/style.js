/** Client-only art direction. Shared uniforms keep every material on one clock. */
import * as T from '../vendor/three.module.min.js';
import {FOREST_FIELD_GLSL,forestUniforms} from './forest-field.js';
import {ACTOR_SHADOW_GLSL} from './actor-shadow.js';
import {TREE_SHADOW_GLSL,treeShadowUniforms} from './tree-shadows.js';
import {CLOUD_GROUND_LIGHT_GLSL} from './cloud-shadow-field.js';
import {ATMOSPHERE_SKY_GLSL} from './atmosphere-sky.js';
import {GRANITE_GLSL,graniteTextures,mountainUniforms} from './granite-shading.js';
import {MEADOW_AIR_GLSL,MEADOW_SURFACE_GLSL,MEADOW_BEND_GLSL} from './meadow-shading.js';
import {TURF_SURFACE_GLSL} from './turf-texture.js';

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
  snowGrid:{value:new T.Vector4()},
  meadowAirFrom: {value:null},meadowAirTo: {value:null},
  meadowAirGrid: {value:new T.Vector4(-2048,-2048,4096,1)},meadowAirMix: {value:1},
  meadowFocus:{value:new T.Vector3()},
  // Ground under the grass, as a multiple of TURF_REFERENCE: the colour at which the lit terrain
  // matches the toon-lit blades on screen (docs/reviews/ground-turf-2026-11-25). Calibration knob.
  turfGround:{value:new T.Vector3(.411,.426,.392)},
  // Toon blades take more ambient light than the lit terrain: in tree shadow grass read 1.36x red,
  // 1.30x blue over the ground. Lifts only the indirect light on ground under grass. Calibration knob.
  turfShade:{value:new T.Vector3(1.56,1.15,1.53)},
  // At grazing view the eye sees blade faces and light tips, not tops: the ground's colour
  // there, as a multiple of turfGround, weighted by (1 - |view . up|) squared. Calibration knob.
  turfGrazing:{value:new T.Vector3(1.28,1.11,1.)},
  // Where the map's wind blows TOWARD, in scene (x, z); main.js sets bearing and relative simulated strength.
  air: {value:null},
  airGrid: {value:new T.Vector4(0,0,640,0)},
  wind: { value: new T.Vector2(1, 0) },
  // Regional cloud detail must not change when the observer enters a local gust.
  cloudWind:{value:new T.Vector2(1,0)},
  // Water surface level (r) and distance to the nearest water (g) over the block, from
  // the map's water bodies (terrain.js buildWaterBodies); w=1 once it is set.
  waterLevel:{value:null},waterLevelGrid:{value:new T.Vector4(0,0,1,0)},
  // The lake's planar reflection (mirror.js): its texture, world-to-uv matrix, the lake's
  // level, and 1 on frames that drew it (0 falls back to the painted reflection).
  mirror:{value:null},mirrorMatrix:{value:new T.Matrix4()},mirrorLevel:{value:0},mirrorOn:{value:0},
  // 1 while the camera is under the water's surface (underwater.js): the bed's caustics and absorption.
  underwater:{value:0},
  // The lake's baked probes (reflections.js fills them): the water's underside looks up the sky, clouds and
  // shore through Snell's window in the nearest one. Colour atlas, (count, rows, sin_min, scale), points.
  cloudDome:{value:null},cloudDomeMatrix:{value:new T.Matrix4()},cloudDomeOn:{value:0},
  probeColour:{value:null},probeDistance:{value:null},probeInfo:{value:new T.Vector4(0,1,-.02,1)},probePoints:{value:Array.from({length:8},()=>new T.Vector3())},
  // The water's look (phase 14 comparison, `?water_look=`): 0 the chosen clear alpine deepening to blue-green,
  // 1 clear throughout (Horizon), 2 deep blue-green throughout (Subnautica). Water only.
  waterLook:{value:0},
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
// Open air scatters with distance, not to a wall: a fifth of the view at 5 km, two thirds
// at 24 km, so a world this size keeps its depth. It's the same curve as the range's own air.
// Underwater fog, tens of metres deep, keeps its full strength. A fog near past the valley's
// 2.5 km stretches the curve with it: the trail map's overhead view thins the air that way.
T.ShaderChunk.fog_fragment=T.ShaderChunk.fog_fragment.replace('smoothstep( fogNear, fogFar, vFogDepth )','( fogFar > 1000. ? 1. - exp( -vFogDepth / ( 22000. * max( 1., fogNear / 2500. ) ) ) : smoothstep( fogNear, fogFar, vFogDepth ) )');
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
export function toonMaterial(parameters = {}, { meadow = false, terrain = false, foliage = false, horizonM = 0, meadowRange = [150,225], meadowFocused=false, canopy=false,grassBlades=false,granite=false,canopyStart=[25,44] } = {}) {
  const material = terrain||granite ? new T.MeshStandardMaterial({roughness: .96, ...parameters}) : new T.MeshToonMaterial({ gradientMap: foliage||meadow ? softRamp : ramp, ...parameters });
  material.onBeforeCompile = (shader) => {
    sunShadowShader(shader);
    shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
      float sunlight=${material.userData.receiveActorShadow===false?'1.':'actorSunLight(vPlace)'}*${terrain||meadow?'cloudGroundLight(vPlace)':'cloudObjectLight(vPlace,uSun)'};
      reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;
      ${terrain||granite?`reflectedLight.indirectDiffuse*=mix(vec3(1.),granite.ambient*vec3(1.05,.95,.86),${terrain?'rockMask*(1.-coreSnow)':'stone'});`:''}
      ${terrain?'reflectedLight.indirectDiffuse*=mix(vec3(1.),uTurfShade,sward);':''}
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
    if(terrain)Object.assign(shader.uniforms,forestUniforms(),{uTurfGround:style.turfGround,uTurfGrazing:style.turfGrazing,uTurfShade:style.turfShade});
    if(terrain||granite)Object.assign(shader.uniforms,mountainUniforms,graniteTextures());
    if(terrain){shader.uniforms.uWaterLevel=style.waterLevel;shader.uniforms.uWaterLevelGrid=style.waterLevelGrid;shader.uniforms.uUnderwater=style.underwater;}
    if(terrain||meadow){shader.uniforms.uCover=style.cover;shader.uniforms.uCoverGrid=style.coverGrid;shader.uniforms.uSnow=style.snow;shader.uniforms.uSnowGrid=style.snowGrid;}
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
    shader.fragmentShader = ((terrain||granite)?GRANITE_GLSL:'')+(canopy?'varying vec2 vGrassUv;varying float vGrassSeed;\n'+GROUND:'')+(terrain||meadow?'uniform sampler2D uCover;uniform sampler2D uSnow;uniform vec4 uCoverGrid;uniform vec4 uSnowGrid;\n':'')+(terrain?'varying vec3 vUp;uniform sampler2D uWaterLevel;uniform vec4 uWaterLevelGrid;uniform float uUnderwater;uniform vec3 uTurfGround,uTurfGrazing,uTurfShade;\n'+FOREST_FIELD_GLSL+GROUND+TURF_SURFACE_GLSL+MEADOW_AIR_GLSL+MEADOW_SURFACE_GLSL:'')+'uniform float uTime; uniform vec3 uSun; varying vec3 vPlace;\n' + (foliage ? 'varying float vTreeHue;\n' : '') + (meadow ? 'varying float vMeadowFade; varying float vPetal; varying vec3 vFlower; varying float vPlant; varying float vLeafTone;\n' : '') + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      ${meadow ? `if(vMeadowFade<=.001||vPlant<.5)discard;
      vec2 grassUv=(vec2(vPlace.x,-vPlace.z)-uCoverGrid.xy)/(uCoverGrid.z*uCoverGrid.w);
      // Roots were chosen from the same graded field (main.js), which already fades for snow,
      // shore and slope; here only truly bare ground refuses a leaf, so the thinning is not
      // clipped back to a hard line at one contour (ground-seams review).
      if(min(grassUv.x,grassUv.y)<0.||max(grassUv.x,grassUv.y)>1.||texture2D(uCover,grassUv).r<.004)discard;
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
      vec2 snowUv=(vec2(vPlace.x,-vPlace.z)-uSnowGrid.xy)/(uSnowGrid.z*uSnowGrid.w);
      float snowInside=step(0.,snowUv.x)*step(0.,snowUv.y)*step(snowUv.x,1.)*step(snowUv.y,1.);
      float lowBiome=1.-smoothstep(180.,360.,vPlace.y);
      float knownGround=1.-smoothstep(.46,.5,max(abs(stampUv.x-.5),abs(stampUv.y-.5)));
      // Where grass grows, the ground is the blades' own fixed palette (grass keeps its
      // colour; the turf is calibrated to it), free of the height bands and drift below.
      float turfOnly=stamped*knownGround;
      diffuseColor.rgb=mix(diffuseColor.rgb,TURF_REFERENCE,turfOnly);
      diffuseColor.rgb*=mix(vec3(1.),mix(vec3(.68,.65,.53),vec3(1.),stamped),lowBiome*knownGround);
      // Ground detail is noise at three scales, never a repeating wave:
      // meadow-sized lush/dry drifts, clumps, and grain that fades before it
      // is smaller than a pixel.
      vec2 ground=vec2(vPlace.x,-vPlace.z);
      float footprint=max(length(dFdx(vPlace)),length(dFdy(vPlace)));
      float drift=fbm(ground*.0065),clump=fbm(ground*.075),grain=vnoise(ground*1.3);
      diffuseColor.rgb*=mix(mix(vec3(.84,.95,.85),vec3(1.16,1.06,.8),smoothstep(.25,.75,drift)),vec3(1.),turfOnly);
      // Turf (turf-texture.js): blades near, tussocks mid, then only this clump and
      // drift noise, which never repeats. It replaces the grain that read as paint.
      Turf turf=turfSurface(ground,footprint);
      diffuseColor.rgb*=turf.albedo*turf.ao*(1.+(clump-.5)*.22*(1.-smoothstep(2.,8.,footprint)));
      // Rock where the ground is steep or high, with ragged edges; snow on
      // the high ground that is flat enough to hold it.
      float steep=length(vUp.xz)/max(.05,vUp.y);
      float slopeMask=smoothstep(.5,.78,steep+(clump-.5)*.4+(drift-.5)*.25);
      // The nearest water's own surface (the lake at 30 m, the river falling
      // 31 to 20 m) and how near it is, for the walls and the banks below.
      vec4 waterAt=texture2D(uWaterLevel,clamp((ground-uWaterLevelGrid.xy)/uWaterLevelGrid.z,0.,1.));
      float waterLevel=mix(20.,waterAt.r,uWaterLevelGrid.w),nearWater=mix(1.,1.-smoothstep(40.,90.,waterAt.g),uWaterLevelGrid.w);
      // Low steep ground is a cut bank of earth under turf, not granite. A
      // wall is rock to the water: the lake's shaped walls rise at about 3 to 1,
      // while the banks of the narrows and the river stand under 0.6, so ground
      // steeper than about 1 to 1 keeps its granite however low it stands, with
      // the same ragged edge. The wall's lowest 8 m triangle reaches down to the
      // flat shelf, so its smoothed normal reads gentle; its own facet reads
      // 0.4 to 1.3 there (banks' waterline facets: mostly under 0.3), so in the
      // first metres over the water the facet alone is enough.
      vec3 facetUp=cross(dFdx(vPlace),dFdy(vPlace));
      float facetSteep=length(facetUp.xz)/max(.05*length(facetUp),abs(facetUp.y)),ragged=(clump-.5)*.4+(drift-.5)*.25;
      float wall=max(smoothstep(.75,1.25,max(steep,facetSteep)+ragged),
        smoothstep(.4,.7,facetSteep+ragged*.5)*(1.-smoothstep(1.5,3.5,vPlace.y-waterLevel))*nearWater);
      float low=1.-smoothstep(38.,70.,vPlace.y+(drift-.5)*20.),lowland=low*(1.-wall);
      diffuseColor.rgb=mix(diffuseColor.rgb,EARTH*mix(.8,1.1,clump),slopeMask*lowland*smoothstep(.35,.7,grain*.4+clump*.6+.15));
      float rockMask=max(max(slopeMask*(1.-lowland),wall*low),smoothstep(1620.,1980.,vPlace.y+(drift-.5)*160.));
      GraniteSurface granite=GraniteSurface(vec3(0.),0.,.96,0.,0.,vec3(0.),1.);
      if(rockMask>.001){
        granite=graniteSurface(vPlace,normalize(vUp),footprint);
        // The valley's own walls (the lake's, the rock step's; below the mountains): near-vertical granite carries
        // dark lichen and varnish streaks where water runs over the brow, and tan iron stain between them
        // (Yosemite's walls; NPS). Stretched along the fall line, which only holds on a wall this steep.
        float face=smoothstep(1.,2.2,steep)*(1.-smoothstep(260.,320.,vPlace.y));
        if(face>.001){
          float streak=smoothstep(.5,.78,graniteNoise(vec3(vPlace.x*.045,vPlace.y*.0035,vPlace.z*.045)+17.)*.7
            +graniteNoise(vec3(vPlace.x*.17,vPlace.y*.011,vPlace.z*.17)+29.)*.4)*face;
          float oxide=smoothstep(.58,.84,graniteNoise(vec3(vPlace.x*.028,vPlace.y*.006,vPlace.z*.028)+41.))*face*(1.-streak);
          granite.color*=mix(vec3(1.),vec3(.42,.40,.38),streak*.7)*mix(vec3(1.),vec3(1.07,.97,.86),oxide*.55);
        }
      }
      diffuseColor.rgb=mix(diffuseColor.rgb,granite.color,rockMask);
      float snowMask=smoothstep(1010.,1110.,vPlace.y+(clump-.5)*70.+(drift-.5)*90.)*(1.-smoothstep(.62,1.,steep+(clump-.5)*.35))*(1.-knownGround);
      diffuseColor.rgb=mix(diffuseColor.rgb,SNOW,snowMask);
      // The banks, measured from the nearest water's own surface: a pebbly silt
      // bed under the water, a damp dark band just above it and a fringe of
      // darker sedge, each edge broken by noise. Ground far from any water keeps
      // its own colour.
      // Only a gentle wobble in the waterline: stronger noise here spotted the
      // gentle shelf with dark patches a few metres across.
      float shoreline=vPlace.y-waterLevel+(drift-.5)*.18+(grain-.5)*.06;
      // Under the water a pale sand-and-pebble bed with a faint, fine grain; the
      // water itself tints and darkens it with depth.
      vec3 bed=SILT*vec3(1.2,1.22,1.1)*mix(.92,1.05,grain);
      // Above it the bank keeps its own ground, with a fringe of sedge.
      vec3 bank=mix(diffuseColor.rgb,SEDGE*mix(.85,1.08,drift),.45*smoothstep(.25,.6,shoreline)*(1.-smoothstep(1.2,2.4,shoreline))*(1.-rockMask));
      bank=mix(bed,bank,smoothstep(-.06,.03,shoreline));
      diffuseColor.rgb=mix(diffuseColor.rgb,bank,(1.-smoothstep(1.6,2.6,shoreline))*knownGround*nearWater);
      // Splash zone: the ground's own colour, wet (darker, a little richer), over
      // the first thirty-odd centimetres above the water.
      float damp=(1.-smoothstep(.05,.35,shoreline))*smoothstep(-.06,.01,shoreline)*knownGround*nearWater;
      // Rock stays wet higher, to about 0.8 m: its top edge wanders in streaks
      // a metre or so wide, which on a steep face run down it, and it is glossy.
      float wetTop=.62+.5*(vnoise(ground*1.1)-.5)+.25*(clump-.5);
      float wetRock=rockMask*(1.-smoothstep(wetTop-.12,wetTop+.06,shoreline))*smoothstep(-.06,.01,shoreline)*knownGround*nearWater;
      damp=max(damp,wetRock);
      diffuseColor.rgb*=mix(vec3(1.),vec3(.52,.55,.5),damp);
      // Seen from under the surface (phase 10): light reaching the bed loses its red first with
      // depth, and the rippled surface focuses it into a drifting net of caustics. From above,
      // the water's own shader already draws both, so this applies only with the eye under.
      float submerged=(waterLevel-vPlace.y)*uUnderwater*knownGround*nearWater;
      if(submerged>0.){
        vec2 cp=ground*1.35;
        float c1=1.-abs(vnoise(cp+vec2(uTime*.23,uTime*.17))*2.-1.),c2=1.-abs(vnoise(cp*1.37-vec2(uTime*.19,-uTime*.21)+5.3)*2.-1.);
        float caustic=pow(c1*c2,5.)*(1.-smoothstep(.08,.5,footprint))*smoothstep(0.,.4,submerged)*exp(-submerged*.09);
        diffuseColor.rgb*=mix(vec3(1.),vec3(.42,.76,.8),1.-exp(-submerged*.08));
        diffuseColor.rgb*=1.+caustic*2.4;
      }
      // Core snow stamp (the original block grid; depth/max in red) is the snow
      // riders feel, so on the block it replaces the height rule above.
      float coreSnow=smoothstep(.03,.14,texture2D(uSnow,clamp(snowUv,0.,1.)).r*snowInside+(drift-.5)*.04)*knownGround;
      diffuseColor.rgb=mix(diffuseColor.rgb,SNOW*mix(.97,1.03,grain),coreSnow);
      // Only the core grass stamp receives sward detail and wind. Banks,
      // snow, rocky faces and the world beyond the stamp keep their material.
      float sward=stamped*(1.-coreSnow)*(1.-rockMask)*(1.-snowMask)*smoothstep(22.,24.,vPlace.y)*mix(1.,smoothstep(1.,3.,shoreline),nearWater);
      vec4 grassAir=meadowAir(vPlace.xz);
      vec3 grass=meadowSurface(vPlace.xz,normalize(vUp),footprint,grassAir);
      // The ground under grass renders the colour of the blades above it: uTurfGround is
      // calibrated by grass-on/grass-hidden captures, since terrain and toon blades light differently.
      float grazing=1.-abs(dot(normalize(cameraPosition-vPlace),normalize(vUp)));
      diffuseColor.rgb*=mix(vec3(1.),grass.x*uTurfGround*mix(vec3(1.),uTurfGrazing,grazing*grazing),sward);
      // The signed core gust travels through this field. Leaf-side exposure
      // amplifies its light/dark response without authoring another wave.
      diffuseColor.rgb*=1.+clamp(grassAir.z*.065,-.18,.18)*sward;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(1.14,1.12,.92),grass.z*sward*.48);
      // A needle bed belongs beneath existing forest crowns. Its footprint
      // comes from the core individuals, so meadow and clearings keep turf.
      vec4 forestSoil=forestAt(vPlace);
      float forestMask=forestCoverAt(vPlace)*knownGround*(1.-coreSnow)*(1.-rockMask)*smoothstep(.08,.48,forestSoil.r);
      float moss=smoothstep(.43,.68,fbm(ground*.45)+.12*(clump-.5));
      // Audit: the bed was sampled three times per terrain fragment even in
      // meadow (mask 0) and from heights where it blurs to its mean. Skip it
      // where it cannot show; one top-mip tap stands in for it from afar.
      vec3 litterTexture=forestMask<.004?vec3(.3):footprint>10.?textureLod(uForestLitter,ground/1.5,9.).rgb:forestLitter(ground);
      vec3 litter=litterTexture*mix(.85,1.14,clump);
      litter=mix(litter,litter*vec3(.77,.96,.65),moss*.25);
      litter*=mix(1.,.87,forestSoil.b);
      diffuseColor.rgb=mix(diffuseColor.rgb,litter,forestMask);
      float relief=forestMask*(grain*.007+dot(litterTexture,vec3(.2126,.7152,.0722))*.018)+sward*grass.y*(1.-forestMask)+(rockMask*granite.relief+(1.-rockMask)*clump*.12)*(1.-smoothstep(1.5,5.,footprint))+rockMask*granite.farRelief;` : ''}
    `);
    if(granite){
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        vec3 graniteUp=normalize(cross(dFdx(vPlace),dFdy(vPlace)));
        GraniteSurface granite=graniteSurface(vPlace,graniteUp,max(length(dFdx(vPlace)),length(dFdy(vPlace))));
        float stone=step(diffuseColor.g,diffuseColor.r*1.18);
        diffuseColor.rgb=mix(diffuseColor.rgb,granite.color,stone);
        float relief=(granite.relief+granite.farRelief)*stone;
      `);
    }
    if(terrain||granite){
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        ${terrain?'float turfMask=(1.-rockMask)*(1.-coreSnow)*(1.-snowMask)*(1.-forestMask)*mix(1.,smoothstep(-.06,.03,shoreline),knownGround*nearWater);roughnessFactor=mix(roughnessFactor,turf.roughness,turfMask);':''}
        roughnessFactor=mix(roughnessFactor,granite.roughness,${terrain?'rockMask*(1.-coreSnow)':'stone'});
        ${terrain?'roughnessFactor=mix(roughnessFactor,.34,wetRock*(1.-coreSnow));':''}
      `);
      // Bump the lighting normal by the same relief, so rock catches the sun.
      shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 sigmaX=dFdx(-vViewPosition),sigmaY=dFdy(-vViewPosition),r1=cross(sigmaY,normal),r2=cross(normal,sigmaX);
        float det=dot(sigmaX,r1)*faceDirection;
        normal=normalize(abs(det)*normal-sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2));
        // The baked slopes are mip-filtered, so they hold where bump derivatives cannot.
        normal=normalize(normal+mat3(viewMatrix)*granite.detail*${terrain?'rockMask*(1.-coreSnow)':'stone'});
        ${terrain?`// Rock breaks; it doesn't round. Part of each 8 m facet's true normal keeps the edges, but not on
        // walls: there one 8 m cell spans 20 m or more of height and its two triangles face apart, so the
        // facets print a row of light and dark fangs down every oblique wall. Walls keep the granite's relief.
        // Under 260 to 320 m (the valley's walls, rims and feet, where curved brows and toes cross the grid
        // obliquely) no facet at all: it printed narrow spikes up the foot of the falls' step (2026-11-26).
        if(rockMask>.001){vec3 facet=normalize(cross(dFdx(vViewPosition),dFdy(vViewPosition)));normal=normalize(mix(normal,facet*sign(dot(facet,normal)),.38*rockMask*(1.-coreSnow)*(1.-smoothstep(1.5,6.,footprint))*(1.-smoothstep(1.,2.2,steep))*smoothstep(260.,320.,vPlace.y)));}`:''}
        ${terrain?`// Turf normal map: texture v runs north, scene z south.
        normal=normalize(normal+mat3(viewMatrix)*vec3(-turf.slope.x,0.,turf.slope.y)*.35*turfMask);
        vec3 grassLean=vec3(grassAir.x,0.,grassAir.y);
        grassLean-=normalize(vUp)*dot(grassLean,normalize(vUp));
        // Transform a tangent-plane wind bend into view space for lighting.
        normal=normalize(normal-mat3(viewMatrix)*grassLean*(.055*grass.z*sward));`:''}
      `);
    }
    if(horizonM){
      shader.uniforms.uHorizonM={value:horizonM};shader.uniforms.uWarmth=style.warmth;
      shader.fragmentShader='uniform float uHorizonM;uniform float uWarmth;\n'+ATMOSPHERE_SKY_GLSL+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`#include <fog_fragment>
        // The distant range's own air: it thins into the sky's horizon colour rather
        // than the scene's fog, and is gone by the mesh's circular edge.
        vec3 horizonRay=normalize(vPlace-cameraPosition);
        vec3 horizonColour=clearSky(normalize(vec3(horizonRay.x,.001,horizonRay.z)),uSun,uWarmth,cameraPosition.y);
        float horizonAir=max(1.-exp(-length(vPlace-cameraPosition)/uHorizonM*1.2),smoothstep(uHorizonM*.8,uHorizonM*.98,length(vPlace.xz)));
        gl_FragColor.rgb=mix(gl_FragColor.rgb,horizonColour,horizonAir);
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
  material.customProgramCacheKey = () => `cozy-granite-v22:${+granite}:${+meadow}:${+terrain}:${+foliage}:${horizonM?1:0}:${+meadowFocused}:${+canopy}:${+grassBlades}:${+(material.userData.receiveActorShadow!==false)}`;
  return material;
}

/** The clear sky, drawn first and behind everything: the distant range stands past this sphere. */
export function makeSky() {
  const sky = new T.Mesh(new T.SphereGeometry(14000, 32, 16), new T.ShaderMaterial({
    side: T.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
    uniforms: { uTime: style.time, uSun: style.sun, uWarmth: style.warmth, uWind: style.wind },
    vertexShader: `varying vec3 vRay; void main(){ vRay = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `
      varying vec3 vRay; uniform float uTime; uniform vec3 uSun; uniform float uWarmth; uniform vec2 uWind;
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
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.name = 'painted_sky'; sky.frustumCulled = false; sky.renderOrder = -1000;
  return sky;
}

/** One opaque water pass; depth is sampled from the same core height grid. */
/** Surface speed in m/s at each polyline point, Manning-like: it grows with the square root of the fall (z per
 * metre, over a 120 m window) and is faster where the channel narrows. The lake-level reach creeps, the outlet
 * runs. The water's look and its voice (water-audio.js) both read it. */
export function surfaceSpeeds(polyline,halfWidths=null){
  return (polyline??[]).map((p,i)=>{
    if(p.length<3)return .6;
    let a=i,b=i,run=0;
    while(run<120&&(a>0||b<polyline.length-1)){if(a>0)run+=Math.hypot(polyline[a][0]-polyline[a-1][0],polyline[a][1]-polyline[a-1][1]),a--;if(b<polyline.length-1)run+=Math.hypot(polyline[b+1][0]-polyline[b][0],polyline[b+1][1]-polyline[b][1]),b++;}
    const slope=Math.max(0,(polyline[a][2]-polyline[b][2])/Math.max(1,run));
    const narrow=Math.min(1.4,Math.max(.7,Math.sqrt(30/(halfWidths?.[i]??30))));
    return Math.min(3,.3+19*Math.sqrt(slope)*narrow);
  });
}

// One float texture per height grid: the river reads the whole 3009² landscape (36 MB), and building it per
// material would upload it again for every piece of water drawn on it.
const heightTextures = new WeakMap();
function heightTexture(grid) {
  let heights = heightTextures.get(grid);
  if (!heights) {
    heights = new T.DataTexture(grid.values, grid.resolution, grid.resolution, T.RedFormat, T.FloatType);
    heights.minFilter = heights.magFilter = T.LinearFilter;
    heights.needsUpdate = true;
    heightTextures.set(grid, heights);
  }
  return heights;
}

/** `vertexCurrent`: the mesh carries its current per vertex (`current`: flow x, flow z, m/s; `channel`: seconds
 * along, metres across) instead of the textures below, which are too coarse over the whole river's 24 km. */
export function waterMaterial(grid, river, polyline=null, { vertexCurrent = false, riverSurface = null, halfWidths = null } = {}) {
  const heights = heightTexture(grid);
  const flowSize=128,flowBytes=new Uint8Array(flowSize*flowSize*4);
  const fall=surfaceSpeeds(polyline,halfWidths);
  // Seconds the current takes to reach each polyline point: patterns drawn in this time ride at
  // the local speed and never shear, however long the clock runs.
  const seconds=[0];for(let i=1;i<fall.length;i++)seconds.push(seconds[i-1]+Math.hypot(polyline[i][0]-polyline[i-1][0],polyline[i][1]-polyline[i-1][1])*2/(fall[i-1]+fall[i]));
  for(let row=0;row<flowSize;row++)for(let col=0;col<flowSize;col++){
    const x=grid.offsetX+(col+.5)/flowSize*grid.quad*(grid.resolution-1),y=grid.offsetY+(row+.5)/flowSize*grid.quad*(grid.resolution-1);
    let distance=Infinity,dx=1,dy=0,speed=.35;
    if(river&&polyline)for(let i=1;i<polyline.length;i++){
      const a=polyline[i-1],b=polyline[i],vx=b[0]-a[0],vy=b[1]-a[1],length=vx*vx+vy*vy;
      const t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/length));
      const d=(x-a[0]-vx*t)**2+(y-a[1]-vy*t)**2;
      if(d<distance){distance=d;dx=vx/Math.sqrt(length);dy=-vy/Math.sqrt(length);speed=fall[i-1]*(1-t)+fall[i]*t;}
    }
    const at=(row*flowSize+col)*4;flowBytes[at]=(dx*.5+.5)*255;flowBytes[at+1]=(dy*.5+.5)*255;flowBytes[at+2]=Math.min(1,speed/3)*255;flowBytes[at+3]=255;
  }
  const flow=new T.DataTexture(flowBytes,flowSize,flowSize);flow.minFilter=flow.magFilter=T.LinearFilter;flow.needsUpdate=true;
  // The current's own coordinates per texel (16 m on the block): that time, and the signed distance (m)
  // left of the river's line, rounded so at bends they turn smoothly. Only texels within `reach` of
  // the line are filled.
  const channelSize=river&&polyline?.length>1?256:1,channel=new Float32Array(channelSize*channelSize*2),nearest=new Float32Array(channelSize*channelSize).fill(Infinity);
  if(channelSize>1){
    // Smoothed over about 70 m: the map's line turns tighter than the river is wide at some bends,
    // and coordinates taken from such a corner fold into chevrons on its inside.
    let line=polyline.map((p,i)=>[p[0],p[1],seconds[i]]);
    for(let k=0;k<24;k++)line=line.map((p,i)=>i===0||i===line.length-1?p:p.map((v,j)=>(line[i-1][j]+2*v+line[i+1][j])/4));
    for(let k=0;k<2;k++)line=[line[0],...line.slice(1).flatMap((b,i)=>{const a=line[i];return [a.map((v,j)=>v*.75+b[j]*.25),a.map((v,j)=>v*.25+b[j]*.75)];}),line.at(-1)];
    const cell=grid.quad*grid.resolution/channelSize,x0=grid.offsetX-grid.quad/2,y0=grid.offsetY-grid.quad/2,reach=160;
    const index=(v,o)=>Math.floor((v-o)/cell-.5);
    for(let i=1;i<line.length;i++){
      const a=line[i-1],b=line[i],vx=b[0]-a[0],vy=b[1]-a[1],length=vx*vx+vy*vy;if(!length)continue;
      const c0=Math.max(0,index(Math.min(a[0],b[0])-reach,x0)),c1=Math.min(channelSize-1,index(Math.max(a[0],b[0])+reach,x0)+1);
      const r0=Math.max(0,index(Math.min(a[1],b[1])-reach,y0)),r1=Math.min(channelSize-1,index(Math.max(a[1],b[1])+reach,y0)+1);
      for(let row=r0;row<=r1;row++)for(let col=c0;col<=c1;col++){
        const x=x0+(col+.5)*cell,y=y0+(row+.5)*cell,t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/length));
        const d=(x-a[0]-vx*t)**2+(y-a[1]-vy*t)**2,at=row*channelSize+col;
        if(d<nearest[at]){nearest[at]=d;channel[at*2]=a[2]+(b[2]-a[2])*t;channel[at*2+1]=(vx*(y-a[1])-vy*(x-a[0]))/Math.sqrt(length);}
      }
    }
  }
  const current=new T.DataTexture(channel,channelSize,channelSize,T.RGFormat,T.FloatType);current.minFilter=current.magFilter=T.LinearFilter;current.needsUpdate=true;
  let riverBed=null;
  if(riverSurface){const g=riverSurface.data.grid;riverBed=new T.DataTexture(Float32Array.from(g.heights_m),g.columns,g.rows,T.RedFormat,T.FloatType);riverBed.minFilter=riverBed.magFilter=T.NearestFilter;riverBed.needsUpdate=true;}
  return new T.ShaderMaterial({
    name: river ? 'river_optical' : 'reservoir_optical', transparent: true, depthWrite: false, premultipliedAlpha: true, side: T.DoubleSide,
    // Each pixel takes water once per frame: where ribbon rows fold on a bend, or the river and the lake
    // overlap, a second layer would blend the tint twice into a visible fan or band (2026-11-26 seam marks).
    // ponytail: the first water drawn at a pixel wins, so a farther surface could hide a nearer one where two
    // separate waters overlap on screen; a depth-only water prepass fixes that if a view ever shows it.
    stencilWrite: true, stencilRef: 1, stencilFunc: T.NotEqualStencilFunc, stencilZPass: T.ReplaceStencilOp,
    defines: {...(vertexCurrent?{VERTEX_CURRENT:''}:{}),...(riverSurface?{RIVER_BED:''}:{})},
    uniforms: { ...sunShadowUniforms(),uTime: style.time, uSun: style.sun, uWarmth: style.warmth, uHeights: { value: heights },
      uRiverBed:{value:riverBed},uRiverOrigin:{value:new T.Vector3(...(riverSurface?.data.grid.offset_xy_m??[0,0]),riverSurface?.data.grid.sample_m??4)},uRiverSize:{value:new T.Vector2(riverSurface?.data.grid.columns??1,riverSurface?.data.grid.rows??1)},
      uGrid: { value: new T.Vector4(grid.offsetX, grid.offsetY, grid.quad, grid.resolution) },
      uLook:style.waterLook,uCloudDome:style.cloudDome,uCloudDomeMatrix:style.cloudDomeMatrix,uCloudDomeOn:style.cloudDomeOn,uProbeColour:style.probeColour,uProbeDistance:style.probeDistance,uProbeInfo:style.probeInfo,uProbePoints:style.probePoints,uMirror:style.mirror,uMirrorMatrix:style.mirrorMatrix,uMirrorLevel:style.mirrorLevel,uMirrorOn:style.mirrorOn,uAir:style.air,uAirGrid:style.airGrid,uWind:style.wind,uFlow:{value:flow},uChannel:{value:current},uRiver: { value: river ? 1 : 0 }, ...T.UniformsUtils.merge([T.UniformsLib.fog]) },
    fog: true,
    vertexShader: `varying vec3 vPlace; varying vec3 vView;
      #ifdef VERTEX_CURRENT
        attribute vec3 current; attribute vec2 channel; varying vec3 vCurrent; varying vec2 vChannel;
      #endif
      #include <fog_pars_vertex>
      void main(){vPlace=(modelMatrix*vec4(position,1.)).xyz;vView=cameraPosition-vPlace;
      #ifdef VERTEX_CURRENT
        vCurrent=current;vChannel=channel;
      #endif
      vec4 mvPosition=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: TREE_SHADOW_GLSL+ACTOR_SHADOW_GLSL+CLOUD_GROUND_LIGHT_GLSL+AIR_GLSL+ATMOSPHERE_SKY_GLSL+`
      uniform float uWarmth;
      uniform sampler2D uMirror;uniform mat4 uMirrorMatrix;uniform float uMirrorLevel,uMirrorOn;
      uniform sampler2D uRiverBed;uniform vec3 uRiverOrigin;uniform vec2 uRiverSize;
      uniform sampler2D uProbeColour,uProbeDistance,uCloudDome; uniform mat4 uCloudDomeMatrix; uniform float uCloudDomeOn; uniform vec4 uProbeInfo; uniform vec3 uProbePoints[8];
      uniform float uTime; uniform float uLook; uniform float uRiver; uniform vec3 uSun; uniform sampler2D uHeights; uniform sampler2D uFlow; uniform sampler2D uChannel; uniform vec4 uGrid;
      varying vec3 vPlace; varying vec3 vView;
      #ifdef VERTEX_CURRENT
        varying vec3 vCurrent; varying vec2 vChannel;
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
      float bed(vec2 world){
        #ifdef RIVER_BED
        vec2 rg=(world-uRiverOrigin.xy)/uRiverOrigin.z;
        if(min(rg.x,rg.y)>=0.&&rg.x<=uRiverSize.x-1.&&rg.y<=uRiverSize.y-1.){
          vec2 c=min(floor(rg),uRiverSize-2.),f=rg-c;
          float a=texture2D(uRiverBed,(c+.5)/uRiverSize).r,b=texture2D(uRiverBed,(c+vec2(1.5,.5))/uRiverSize).r,
            e=texture2D(uRiverBed,(c+vec2(.5,1.5))/uRiverSize).r,d=texture2D(uRiverBed,(c+1.5)/uRiverSize).r;
          return f.x>=f.y?a+(b-a)*f.x+(d-b)*f.y:a+(e-a)*f.y+(d-e)*f.x;
        }
        #endif
        vec2 g=(world-uGrid.xy)/uGrid.z,c=floor(g),f=g-c;
        float r=uGrid.w,a=texture2D(uHeights,(c+.5)/r).r,b=texture2D(uHeights,(c+vec2(1.5,.5))/r).r,
          e=texture2D(uHeights,(c+vec2(.5,1.5))/r).r,d=texture2D(uHeights,(c+1.5)/r).r;
        return f.x>=f.y?a+(b-a)*f.x+(d-b)*f.y:a+(e-a)*f.y+(d-e)*f.x;}
      // Ripple slope, advected along the current by two crossfaded phases so
      // the pattern drifts without stretching, at the river's own surface
      // speed (m/s). Running water's ripples are drawn out along the current
      // in proportion to that speed. Each octave fades out before it is finer
      // than a pixel, which removes the distant moire stripes.
      vec2 ripples(vec2 p,vec2 flow,float speed,float footprint,out float calm,out float streak){
        float gust=noised(p*.012+vec2(uTime*.021,-uTime*.013)).x;
        calm=smoothstep(.15,.85,gust);streak=0.;
        vec2 across=vec2(-flow.y,flow.x);float drawn=1./(1.+1.6*speed*uRiver);
        vec2 slope=vec2(0.);
        for(int phase=0;phase<2;phase++){
          float t=fract(uTime*.09+float(phase)*.5),w=1.-abs(t*2.-1.);
          vec2 q=p-flow*speed*(t-.5)*11.+float(phase)*vec2(17.3,-9.1);
          // Coordinates along and across the current; the along axis is stretched.
          vec2 u=vec2(dot(q,flow)*drawn,dot(q,across));
          float freq=.11,amp=.032;
          for(int octave=0;octave<6;octave++){
            float fade=1.-smoothstep(.12,.45,footprint*freq);
            vec2 g=noised(u*freq+float(octave)*vec2(3.7,8.1)).yz*amp*fade*w;
            slope+=flow*drawn*g.x+across*g.y;
            freq*=2.1;amp*=.84;u=mat2(.96,.28,-.28,.96)*u;
          }
          // Slick lines and flecks riding the current.
          streak+=smoothstep(.62,.92,noised(vec2(u.x*.09,u.y*.55)+vec2(5.,1.)).x)*w*(1.-smoothstep(.2,1.,footprint*.55));
        }
        return slope*mix(.45,1.15,calm)*mix(1.,1.3,uRiver*smoothstep(.8,2.2,speed));
      }
      void main(){
        vec2 world=vec2(vPlace.x,-vPlace.z);
        vec2 uv=((world-uGrid.xy)/uGrid.z+.5)/uGrid.w;
        float depth=max(0.,vPlace.y-bed(world));
        vec2 p=vPlace.xz;
        #ifdef VERTEX_CURRENT
          vec2 flow=normalize(vCurrent.xy+vec2(1e-4,0.));float speed=vCurrent.z;
        #else
          vec3 current=texture2D(uFlow,uv).rgb;
          vec2 flow=normalize(current.rg*2.-1.+vec2(1e-4,0.));
          float speed=current.b*3.;
        #endif
        // Mean of the two pixel axes: the long axis alone flattens grazing water.
        vec2 axes=vec2(length(dFdx(p)),length(dFdy(p)));float footprint=(axes.x+axes.y)*.5,calm,streak;
        vec2 slope=ripples(p,flow,speed,footprint,calm,streak);
        vec4 air=localAir(p);float windSpeed=length(air.xy);
        vec2 down=air.xy/max(.01,windSpeed),across=vec2(-down.y,down.x);
        float windRipple=sin(dot(p,down)*3.-uTime*windSpeed*1.7+sin(dot(p,across)*.16));
        slope+=down*windRipple*min(.045,windSpeed*.004)*(1.-smoothstep(.25,1.2,footprint))*(1.-.7*uRiver);
        vec3 n=normalize(vec3(-slope.x,1.,-slope.y));
        vec3 eye=normalize(vView);
        if(cameraPosition.y<vPlace.y){
          // From below (phase 10): Snell's window. Rays from the eye within 48.6 deg of straight up
          // leave into the sky, squeezed toward the rim where the shore's forest and walls stand;
          // beyond it the surface mirrors the water under it (total internal reflection).
          // A third of the ripples' tilt: the full tilt frays the window's rim into cloud-like fringes.
          vec3 calmN=normalize(mix(vec3(0.,1.,0.),n,.35)),up=-eye,leaving=refract(up,-calmN,1.333);
          float through=smoothstep(.645,.73,dot(up,calmN));
          vec3 sky=clearSky(normalize(vec3(leaving.x,max(leaving.y,.015),leaving.z)),uSun,uWarmth,vPlace.y);
          if(uProbeInfo.x>.5){
            // The nearest baked probe (taken just over the lake): the real walls and forest around the rim, the
            // whole hemisphere squeezed into the window as it is from below.
            int n=int(uProbeInfo.x),k=0;float best=1e12;
            for(int i=0;i<8;i++){if(i>=n)break;vec2 o=uProbePoints[i].xz-vPlace.xz;float d=dot(o,o);if(d<best){best=d;k=i;}}
            vec3 dir=normalize(vec3(leaving.x,max(leaving.y,0.),leaving.z));
            float v=clamp((dir.y-uProbeInfo.z)/(1.-uProbeInfo.z),.5/uProbeInfo.y,1.-.5/uProbeInfo.y);
            vec2 uv=vec2(atan(dir.z,dir.x)*.15915494+.5,(float(k)+v)/uProbeInfo.x);
            // Open sky in the probe (distance code 4095) keeps the painted sky; the clouds come from the cloud pass.
            vec4 e=texture2D(uProbeDistance,uv);
            if((e.r*4080.+e.g*15.9375)/4095.<.99999)sky=texture2D(uProbeColour,uv).rgb*uProbeInfo.w;
          }else{
            float rise=leaving.y+.015*noised(vec2(atan(leaving.z,leaving.x)*9.,0.)).x;
            // No probes: the valley's forest and granite walls (to about 15 deg) as a dark ring at the rim.
            sky=mix(sky,mix(vec3(.024,.046,.032),vec3(.11,.13,.125),smoothstep(.03,.14,rise)),(1.-smoothstep(.12,.3,rise))*.9);
          }
          // The clouds, from the cloud pass's upward dome, at the refracted direction (premultiplied).
          if(uCloudDomeOn>.5&&leaving.y>.05){
            vec4 clip=uCloudDomeMatrix*vec4(cameraPosition+leaving*20000.,1.);vec2 duv=clip.xy/clip.w*.5+.5;
            if(clip.w>0.&&duv.x>0.&&duv.y>0.&&duv.x<1.&&duv.y<1.){vec4 c=texture2D(uCloudDome,duv);sky=sky*(1.-c.a)+c.rgb;}
          }
          float toSun=max(0.,dot(normalize(leaving+vec3(0.,1e-4,0.)),uSun));
          sky+=vec3(1.,.95,.82)*(pow(toSun,400.)*5.+pow(toSun,12.)*.3)*cloudObjectLight(vPlace,uSun);
          gl_FragColor=vec4(mix(fogColor*.9,sky*.92,through),1.);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
          return;
        }
        float fresnel=.02+.98*pow(1.-max(0.,dot(n,eye)),5.);
        // Clear alpine water: the bed shows through the shallows tinted
        // turquoise, the shelf's edge turns blue-green and the basin is deep
        // blue-green.
        vec3 water=mix(vec3(.045,.27,.23),vec3(.014,.16,.145),smoothstep(.3,4.5,depth));
        water=mix(water,vec3(.005,.068,.066),smoothstep(3.,18.,depth));
        // The two looks the human asked to compare near the end: clear throughout keeps the shallows' tint
        // to the basin and lets light further down; deep blue-green throughout closes over even the shelf.
        float absorb=.13;
        if(uLook>.5&&uLook<1.5){water=mix(vec3(.05,.29,.25),vec3(.025,.21,.19),smoothstep(.5,18.,depth));absorb=.065;}
        else if(uLook>1.5){water=mix(vec3(.012,.13,.14),vec3(.004,.05,.075),smoothstep(.5,10.,depth));absorb=.24;}
        // The reflection is the painted sky's own colour; rays that leave the
        // water low meet the valley's forested walls, a dark band broken by the ripples.
        vec3 reflected=reflect(-eye,n);reflected.y=abs(reflected.y);
        vec3 sky=clearSky(normalize(vec3(reflected.x,max(reflected.y,.015),reflected.z)),uSun,uWarmth,cameraPosition.y);
        // Half the ripple's tilt: the walls stand where the calm surface would show them.
        float rise=mix(eye.y,reflected.y,.35)+.015*noised(vec2(atan(reflected.z,reflected.x)*9.,0.)).x;
        // Forest at the waterline, shaded granite above it, sky over the rim.
        vec3 walls=mix(vec3(.024,.046,.032),vec3(.11,.13,.125),smoothstep(.015,.07,rise));
        sky=mix(sky,walls,(1.-smoothstep(.05,.16,rise))*.85);
        // Where a mirror was drawn and this surface lies at the lake's level, the reflection is
        // the scene itself, its lookup bent by the ripples' slope.
        float mirrored=uMirrorOn*(1.-smoothstep(.25,.5,abs(vPlace.y-uMirrorLevel)));
        if(mirrored>0.){
          vec4 m=uMirrorMatrix*vec4(vPlace.x,uMirrorLevel,vPlace.z,1.);
          sky=mix(sky,texture2D(uMirror,m.xy/m.w+vec2(slope.x,-slope.y)*.15).rgb,mirrored);
        }
        float facing=max(0.,dot(reflect(-uSun,n),eye));
        // A broad sun path broken by gusts, plus small glints that only
        // appear where a ripple faces the sun exactly and the pixel is small
        // enough to hold one; distant water keeps the soft path only.
        float sheen=pow(facing,mix(28.,90.,calm))*mix(.06,.16,calm);
        float glint=smoothstep(.8,.97,noised(p*6.3+flow*speed*uTime*.6+vec2(0.,uTime*.35)).x)*pow(facing,900.)*(1.-smoothstep(.03,.2,footprint));
        float sunlight=cloudObjectLight(vPlace,uSun)*actorSunLight(vPlace);
        #ifdef RIVER_BED
          sunlight*=scenerySunLight(vPlace,vec3(0.,1.,0.));
        #endif
        // A rippled surface's reflection is a little blurred and dimmed; the body colour holds through it.
        vec3 col=mix(water*mix(.6,1.,sunlight),sky,fresnel*.82);
        vec3 light=vec3(1.,.94,.78)*(sheen+glint*4.)*sunlight;
        // Caustics on the shallow bed, added after blending (premultiplied) so
        // they show however clear the water is.
        float caustic=pow(1.-abs(noised(p*.55+flow*speed*uTime*.4+vec2(uTime*.11,-uTime*.07)).x*2.-1.),6.)*exp(-depth*.5)*smoothstep(0.,.25,depth)*sunlight;
        // Slicks and flecks on running water, only where it runs.
        col=mix(col,mix(sky,vec3(.62,.68,.66),.4),streak*.16*uRiver*smoothstep(.7,2.,speed));
        // Running water read from afar: foam lines and broad aerated bands carried down the current,
        // and riffles where the river falls fastest. Drawn in the current's own coordinates (seconds
        // of flow, metres across), each fades before a pixel spans it across the current, and none
        // shows up close, where the ripples already carry the flow.
        float carried=0.;
        if(uRiver>.5){
          #ifdef VERTEX_CURRENT
            vec2 ch=vChannel;
          #else
            vec2 ch=texture2D(uChannel,uv).rg;
          #endif
          float running=smoothstep(.8,1.2,speed)*smoothstep(.06,.3,footprint),wide=fwidth(ch.y)+.01,go=ch.x-uTime;
          // Foam lines: thin, long, nearly parallel to the banks (twenty times longer than their spacing).
          float lines=smoothstep(.86,.98,1.-abs(noised(vec2(go/100.,ch.y/6.)+vec2(3.1,0.)).x*2.-1.))*(1.-smoothstep(.25,.7,wide/6.));
          lines*=smoothstep(.35,.65,noised(vec2(go/160.,ch.y/20.)+vec2(1.7,9.)).x);
          float bands=smoothstep(.45,.85,noised(vec2(go/90.,ch.y/26.)+vec2(11.,4.)).x)*(1.-smoothstep(.3,.8,wide/26.));
          float riffle=smoothstep(.55,.85,noised(vec2(ch.x/22.,ch.y/16.)+vec2(7.,2.)).x)*smoothstep(.9,1.6,speed)*(1.-smoothstep(.3,.8,wide/16.));
          float broken=smoothstep(.45,.8,noised(vec2(go/8.,ch.y/3.)+vec2(2.,5.)).x)*(1.-smoothstep(.25,.7,wide/3.));
          carried=running*clamp(lines*.32+bands*.1+riffle*(.18+.3*broken),0.,1.);
          col=mix(col,mix(sky,vec3(.74,.8,.78),.6),carried);
        }
        // Lapping foam only where the water thins, travelling up the shore.
        float shore=1.-smoothstep(.03,.3,depth);
        float foam=shore*smoothstep(.5,.95,noised(p*.9+vec2(uTime*.13,0.)).x+.15*sin(uTime*1.1-depth*16.));
        col=mix(col,vec3(.62,.68,.6),foam*.18);
        // Optical path grows with depth AND grazing angle: the shallows stay
        // clear over the stones, the deep water closes over. The reflection
        // fades in over the last 0.7 m too, so the bank shows no drawn edge.
        float edge=smoothstep(0.,.7,depth);
        float opacity=clamp(1.-exp(-depth*absorb/max(.16,eye.y)),.14,.95);
        // Over the shelf the bed outshines the reflection; it closes over with depth.
        opacity=max(opacity,fresnel*.94*mix(.5,1.,smoothstep(.5,3.5,depth)))*edge;
        opacity=max(opacity,foam*.25*smoothstep(0.,.08,depth));
        opacity=max(opacity,carried*.8*edge);
        col+=light*edge/max(opacity,.3);
        gl_FragColor=vec4(col,opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
        gl_FragColor.rgb=gl_FragColor.rgb*gl_FragColor.a+vec3(.8,.9,.75)*caustic*.09*(1.-opacity);
      }`
  });
}

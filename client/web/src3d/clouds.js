/** Raymarched cumulus volumes. The core owns each cloud cell and its altitude.
 * Render at half scale and stop every ray at the opaque world's depth. The
 * same shader works inside a cloud; no opaque sphere or camera-facing sprite.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
import {createCloudShadows} from './cloud-shadows.js';
import {createCloudLighting,CLOUD_LIGHT_GLSL} from './cloud-lighting.js';
import {cloudCellBounds,skyFor} from './cloud-shadow-field.js';
import {createSunRays} from './sun-rays.js';
import {buildCloudNoise,cloudForm,CLOUD_DENSITY_GLSL} from './cloud-field.js';
import {ATMOSPHERE_SKY_GLSL} from './atmosphere-sky.js';
// Denser view rays retain eroded cloud detail during close flight.
export const CLOUD_VIEW_STEPS=96;
// Clouds whose centre lies farther than this from the valley's centre (either axis) are the
// distant sky: drawn by the same shape and light recipe with fewer samples, no light cache
// and no relief samples, which their size on screen cannot show.
export const CLOUD_NEAR_M=6500,CLOUD_FAR_STEPS=40;
// Samples are never closer than this along a ray. A long span through a tower still gets the full
// count (about 25 m apart on a 2.5 km span); a short one, such as a ray through a thin dusk deck,
// gets fewer instead of being sampled every few metres.
export const CLOUD_MIN_STEP_M=10;
export const isDistantCell=cell=>Math.max(Math.abs(cell.centre_xy_m[0]),Math.abs(cell.centre_xy_m[1]))>CLOUD_NEAR_M;
export function createCloudPass(renderer,scene,camera,atmosphereByTime,ground){
  const opaque=new T.WebGLRenderTarget(1,1,{samples:Math.min(4,renderer.capabilities.maxSamples),depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)});
  opaque.texture.colorSpace=T.LinearSRGBColorSpace;
  const cloudy=new T.WebGLRenderTarget(1,1,{depthBuffer:false});
  const volumes=new T.Scene(),size=new T.Vector2();
  const forward={value:new T.Vector3()};
  const texture=new T.Data3DTexture(buildCloudNoise(),48,48,48);texture.format=T.RGBAFormat;
  texture.minFilter=texture.magFilter=T.LinearFilter;texture.wrapS=texture.wrapT=texture.wrapR=T.RepeatWrapping;texture.needsUpdate=true;
  const geometry=new T.BoxGeometry(1,1,1);
  // Each time of day has its own sky (skyFor). One is built the first time its light is
  // used and kept, so changing the light swaps cloud sets without rebuilding them.
  const built=new Map();let sky=null;
  function buildSky(atmosphere){
  // Only near clouds get a light cache; distant ones estimate sunlight from height.
  const near=atmosphere.cloud_cells.filter(cell=>!isDistantCell(cell));
  const lighting=createCloudLighting(renderer,{...atmosphere,cloud_cells:near},texture,style);
  const shadows=createCloudShadows(renderer,atmosphere,texture,ground);
  const boxes=[];
  for(const cell of atmosphere.cloud_cells){
    const index=near.indexOf(cell),far=index<0;
    const bounds=cloudCellBounds(cell,atmosphere),centre=new T.Vector3(...bounds.centre),extent=new T.Vector3(...bounds.extent);
    const form=cloudForm(cell.seed,bounds.extent);
    const material=new T.ShaderMaterial({glslVersion:T.GLSL3,side:T.BackSide,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{uCloudLight:{value:lighting.target.texture},uCloudLightOrigin:{value:far?new T.Vector2():lighting.origins[index]},uCloudLightSize:{value:lighting.size},uDepth:{value:opaque.depthTexture},uNoise:{value:texture},uCentre:{value:centre},uExtent:{value:extent},uResolution:{value:size},uNear:{value:camera.near},uFar:{value:camera.far},uForward:forward,uSun:style.sun,uTime:style.time,uWind:style.cloudWind,uSeed:{value:cell.seed},uBillow:{value:form.billows},uForm:{value:new T.Vector4(...form.form)},uBillowRate:{value:form.rate},uSupport:{value:form.support},uRelief:{value:.045*form.form[3]/form.form[1]},uWarmth:style.warmth},
      vertexShader:`out vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
      defines:far?{CLOUD_FAR:1}:{},
      fragmentShader:`precision highp sampler3D;
        #ifdef CLOUD_FAR
        #define STEPS ${CLOUD_FAR_STEPS}
        #else
        #define STEPS ${CLOUD_VIEW_STEPS}
        #endif
        in vec3 vWorld;out vec4 fragColor;
        uniform sampler2D uDepth;uniform sampler3D uNoise;uniform vec3 uCentre,uExtent,uForward,uSun;uniform vec2 uResolution,uWind;uniform float uNear,uFar,uTime,uSeed;
        uniform float uWarmth,uBillowRate,uRelief,uSupport;
        ${ATMOSPHERE_SKY_GLSL}
        ${CLOUD_DENSITY_GLSL}
        ${CLOUD_LIGHT_GLSL}
        void main(){
          vec3 ray=normalize(vWorld-cameraPosition);
          vec3 inv=1./ray;vec3 a=(uCentre-uExtent*.5-cameraPosition)*inv,b=(uCentre+uExtent*.5-cameraPosition)*inv;
          vec3 lo=min(a,b),hi=max(a,b);
          float entry=max(0.,max(max(lo.x,lo.y),lo.z)),exit=min(min(hi.x,hi.y),hi.z);
          float depth=texture(uDepth,gl_FragCoord.xy/uResolution).r;
          float viewDepth=uNear*uFar/(uFar-depth*(uFar-uNear));
          float ground=viewDepth/max(.001,dot(ray,uForward));exit=min(exit,ground);
          if(exit<=entry)discard;
          vec2 span=cloudSpan(cameraPosition,ray,entry,exit,uSupport);entry=span.x;exit=span.y;
          if(exit<=entry)discard;
          int steps=int(clamp(ceil((exit-entry)/${CLOUD_MIN_STEP_M}.),1.,float(STEPS)));
          float stepM=(exit-entry)/float(steps);float trans=1.;vec3 light=vec3(0.);
#ifdef CLOUD_EMPTY_SKIP
          cloudDensityRate=uBillowRate*length(ray/uExtent)*stepM;
#endif
          float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
          float forward=pow(max(0.,dot(ray,uSun)),12.);
          // Low sun lights cloud cream and peach; the sky's blue fill keeps the shade cool, not lavender.
          vec3 sunTint=mix(vec3(1.,.98,.90),vec3(1.16,.83,.53),uWarmth);
          for(int i=0;i<STEPS;i++){
            if(i>=steps)break;
#ifdef CLOUD_EMPTY_SKIP
            cloudEmptySteps=0.;
#endif
            vec3 p=cameraPosition+ray*(entry+(float(i)+jitter)*stepM);float t=entry+(float(i)+jitter)*stepM,d=cloudDensity(p,true);
            // Cloud thins over its last 90 m before terrain, so a base meeting a ridge fades instead of cutting.
            d*=clamp((ground-t)/90.,0.,1.);
            if(d>.001){
#ifdef CLOUD_FAR
              // At distance a cloud reads as lit crown and shaded base: estimate the sunlight
              // reaching a point from its height in the cell instead of the light cache.
              float rise=clamp((p.y-uCentre.y)/uExtent.y+.5,0.,1.);
              vec2 sunTransmission=vec2(.08+.92*pow(rise,1.4),.45+.55*rise);
              float direct=sunTransmission.r+.20*sunTransmission.g,crease=0.;
#else
              vec2 sunTransmission=cachedCloudLight(p);
              // Beer-Lambert extinction plus a softer second scattering lobe.
              float direct=sunTransmission.r+.20*sunTransmission.g;
              // The cached light is too coarse to see one billow shade its neighbour;
              // a single nearby sample toward the sun restores that relief.
              direct*=exp(-cloudDensity(p+uSun*uRelief,true)*uRelief*.02);
              // A second, farther sample lets one lobe shade the next: deep creases between plumes.
              float crease=cloudDensity(p+uSun*uRelief*3.5,false);direct*=exp(-crease*uRelief*3.5*.02);
#endif
              // Thin cloud at a sunlit surface scatters less back toward the eye than deep cloud
              // (the 'powder' look), so lobe edges darken; looking toward the sun they glow instead.
              direct*=mix(.68+.32*(1.-exp(-d*2.4)),1.,pow(max(0.,dot(ray,uSun)),2.));
              // Shade deepens toward the base over a fixed depth, however tall the tower.
              float height=clamp((p.y-uCentre.y+.5*uExtent.y)/max(620.,.6*uExtent.y),0.,1.);
              // Sky light reaches a sunless flank less than the open crown: slide it toward
              // the base tone, never below it, so shade and base do not darken each other twice.
              // Sky light follows the time of day: cool by day, rose-grey when the sun is low.
              vec3 ambient=mix(mix(vec3(.065,.12,.21),vec3(.12,.13,.16),uWarmth),mix(vec3(.28,.39,.54),vec3(.45,.47,.52),uWarmth),height*mix(.45,1.,sunTransmission.g));
              // Thin outer cloud catches more sky than a crease does, which gives shaded billows their form.
              ambient*=mix(1.22,.80,d);
              // Deep in a crease the sky is half hidden too: shade there goes darker and bluer.
              ambient*=mix(vec3(.70,.77,.92),vec3(1.),exp(-crease*1.6));
              vec3 col=ambient+sunTint*(direct*1.3+forward*.38*sunTransmission.g);
              float absorb=1.-exp(-d*stepM*.014);
              light+=col*absorb*trans;trans*=1.-absorb;if(trans<.012)break;
            }
#ifdef CLOUD_EMPTY_SKIP
            i+=int(cloudEmptySteps);
#endif
          }
          float alpha=1.-trans;if(alpha<.008)discard;
          // Haze uses the same clear-air colour as the background at this ray.
          float haze=1.-exp(-entry*.000065);
          vec3 colour=mix(light/max(.001,alpha),clearSky(ray,uSun,uWarmth,cameraPosition.y),haze);
          fragColor=vec4(colour,alpha);
        }`
    });
    const exterior=new T.ShaderMaterial({glslVersion:T.GLSL3,side:T.BackSide,transparent:true,depthWrite:false,depthTest:false,
      defines:{...material.defines,CLOUD_EMPTY_SKIP:1},uniforms:material.uniforms,vertexShader:material.vertexShader,fragmentShader:material.fragmentShader});
    const box=new T.Mesh(geometry,material);box.userData.cloudMarch={full:material,skip:exterior};box.position.copy(centre);box.scale.copy(extent);box.name=`cumulus_${cell.seed}`;boxes.push(box);
  }
  return {atmosphere,lighting,shadows,boxes};
  }
  /** Show the sky for a light preset (day, golden, dusk); see skyFor. */
  function setSky(name){
    const atmosphere=skyFor(atmosphereByTime,name);
    if(sky?.atmosphere===atmosphere)return;
    if(!built.has(atmosphere))built.set(atmosphere,buildSky(atmosphere));
    sky=built.get(atmosphere);
    volumes.clear();for(const box of sky.boxes)volumes.add(box);
    sky.shadows.activate();sky.lighting.update(true);sky.shadows.update(true);marchWarm=false;
  }
  const fullscreen=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const rays=createSunRays(opaque.depthTexture,cloudy.texture,opaque.texture);
  fullscreen.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthWrite:false,depthTest:false,
    uniforms:{uWorld:{value:opaque.texture},uCloud:{value:cloudy.texture},uDepth:{value:opaque.depthTexture},uRays:{value:rays.target.texture},uRayStrength:rays.strength,uRayDepth:{value:new T.Vector2(camera.near,camera.far)},uWarmth:style.warmth},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D uWorld,uCloud,uDepth,uRays;uniform float uRayStrength,uWarmth;uniform vec2 uRayDepth;varying vec2 vUv;
      vec3 composite(vec2 uv){vec4 c=texture2D(uCloud,uv);return texture2D(uWorld,uv).rgb*(1.-c.a)+c.rgb;}
      void main(){
        vec3 color=composite(vUv);
        // A small amount of aerial scattering is visible in front of distant
        // forest surfaces too. Reject nearby solids with full-resolution depth;
        // the source aperture itself rejects a sun hidden behind a ridge.
        if(uRayStrength>.001){
          float depth=texture2D(uDepth,vUv).r,sky=step(.9999998,depth);
          float metres=uRayDepth.x*uRayDepth.y/(uRayDepth.y-depth*(uRayDepth.y-uRayDepth.x));
          float airPath=mix(smoothstep(8.,100.,metres)*.38,1.,sky);
          color+=texture2D(uRays,vUv).r*uRayStrength*.13*airPath*(1.-texture2D(uCloud,vUv).a)
            *mix(vec3(1.,.91,.72),vec3(1.,.73,.40),uWarmth);
        }
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`

  })));
  const dimensions=new T.Vector2(),savedColor=new T.Color();
  let marchWarm=false;setSky('golden');
  const resetMarch=()=>{marchWarm=false;};renderer.domElement.addEventListener('webglcontextrestored',resetMarch);
  function selectMarch(){
    // Only above-cloud views showed a repeatable gain. Edge and inside views
    // retain the original shader, including its cost and sample locations.
    const above=camera.position.y>sky.atmosphere.cloud_top_m;
    for(const box of volumes.children)box.material=box.userData.cloudMarch[above?'skip':'full'];
  }
  function render({strength=1,target=null}={}){
    style.sunEffects.value=strength;
    renderer.getDrawingBufferSize(dimensions);
    if(opaque.width!==dimensions.x||opaque.height!==dimensions.y){opaque.setSize(dimensions.x,dimensions.y);cloudy.setSize(Math.ceil(dimensions.x*.5),Math.ceil(dimensions.y*.5));size.set(cloudy.width,cloudy.height);}
    sky.lighting.update();sky.shadows.update();
    selectMarch();
    camera.getWorldDirection(forward.value);
    renderer.setRenderTarget(opaque);renderer.render(scene,camera);
    const color=renderer.getClearColor(savedColor),alpha=renderer.getClearAlpha();
    renderer.setClearColor(0,0);renderer.setRenderTarget(cloudy);renderer.clear();
    if(!marchWarm){
      // Draw both real pipelines against initialized world depth. The journal's
      // GPU fence includes this work, so crossing cloud top cannot compile a
      // new path after the scene has been revealed. Repeat after context loss.
      for(const box of volumes.children)box.material=box.userData.cloudMarch.full;
      renderer.render(volumes,camera);
      for(const box of volumes.children)box.material=box.userData.cloudMarch.skip;
      renderer.render(volumes,camera);marchWarm=true;selectMarch();
    }
    renderer.render(volumes,camera);
    rays.render(renderer,camera,dimensions.x,dimensions.y,strength);
    renderer.setClearColor(color,alpha);renderer.setRenderTarget(target);renderer.render(fullscreen,quadCamera);
  }
  return {render,rays,volumes,opaque,cloudy,setSky,get sky(){return sky.atmosphere;},get shadows(){return sky.shadows;},get lighting(){return sky.lighting;},dispose(){renderer.domElement.removeEventListener('webglcontextrestored',resetMarch);for(const b of built.values()){b.lighting.dispose();b.shadows.dispose();}rays.dispose();opaque.dispose();cloudy.dispose();texture.dispose();geometry.dispose();fullscreen.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});[...built.values()].flatMap(b=>b.boxes).forEach(m=>{m.userData.cloudMarch.full.dispose();m.userData.cloudMarch.skip.dispose();});}};
}

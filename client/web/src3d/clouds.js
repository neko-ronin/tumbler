/** Raymarched cumulus volumes. The core owns each cloud cell and its altitude.
 * Render at half scale and stop every ray at the opaque world's depth. The
 * same shader works inside a cloud; no opaque sphere or camera-facing sprite.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
import {createCloudShadows} from './cloud-shadows.js';
import {createCloudLighting,CLOUD_LIGHT_GLSL} from './cloud-lighting.js';
import {cloudCellBounds} from './cloud-shadow-field.js';
import {createSunRays} from './sun-rays.js';
import {buildCloudNoise,CLOUD_DENSITY_GLSL} from './cloud-field.js';
import {ATMOSPHERE_SKY_GLSL} from './atmosphere-sky.js';
// Denser view rays retain eroded cloud detail during close flight.
export const CLOUD_VIEW_STEPS=96;
export function createCloudPass(renderer,scene,camera,atmosphere,ground){
  const opaque=new T.WebGLRenderTarget(1,1,{samples:Math.min(4,renderer.capabilities.maxSamples),depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)});
  opaque.texture.colorSpace=T.LinearSRGBColorSpace;
  const cloudy=new T.WebGLRenderTarget(1,1,{depthBuffer:false});
  const volumes=new T.Scene(),size=new T.Vector2();
  const forward={value:new T.Vector3()};
  const texture=new T.Data3DTexture(buildCloudNoise(),48,48,48);texture.format=T.RGBAFormat;
  texture.minFilter=texture.magFilter=T.LinearFilter;texture.wrapS=texture.wrapT=texture.wrapR=T.RepeatWrapping;texture.needsUpdate=true;
  const lighting=createCloudLighting(renderer,atmosphere,texture,style);
  const shadows=createCloudShadows(renderer,atmosphere,texture,ground);
  const geometry=new T.BoxGeometry(1,1,1);
  for(const [index,cell]of atmosphere.cloud_cells.entries()){
    const bounds=cloudCellBounds(cell,atmosphere),centre=new T.Vector3(...bounds.centre),extent=new T.Vector3(...bounds.extent);
    const material=new T.ShaderMaterial({glslVersion:T.GLSL3,side:T.BackSide,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{uCloudLight:{value:lighting.target.texture},uCloudLightOrigin:{value:lighting.origins[index]},uCloudLightSize:{value:lighting.size},uDepth:{value:opaque.depthTexture},uNoise:{value:texture},uCentre:{value:centre},uExtent:{value:extent},uResolution:{value:size},uNear:{value:camera.near},uFar:{value:camera.far},uForward:forward,uSun:style.sun,uTime:style.time,uWind:style.cloudWind,uSeed:{value:cell.seed},uWarmth:style.warmth},
      vertexShader:`out vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
      fragmentShader:`precision highp sampler3D;
        in vec3 vWorld;out vec4 fragColor;
        uniform sampler2D uDepth;uniform sampler3D uNoise;uniform vec3 uCentre,uExtent,uForward,uSun;uniform vec2 uResolution,uWind;uniform float uNear,uFar,uTime,uSeed;
        uniform float uWarmth;
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
          exit=min(exit,viewDepth/max(.001,dot(ray,uForward)));
          if(exit<=entry)discard;
          float stepM=(exit-entry)/${CLOUD_VIEW_STEPS}.;float trans=1.;vec3 light=vec3(0.);
#ifdef CLOUD_EMPTY_SKIP
          cloudDensityRate=5.3*length(ray/uExtent)*stepM;
#endif
          float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
          float forward=pow(max(0.,dot(ray,uSun)),12.);
          vec3 sunTint=mix(vec3(1.,.98,.90),vec3(1.12,.75,.43),uWarmth);
          for(int i=0;i<${CLOUD_VIEW_STEPS};i++){
#ifdef CLOUD_EMPTY_SKIP
            cloudEmptySteps=0.;
#endif
            vec3 p=cameraPosition+ray*(entry+(float(i)+jitter)*stepM);float d=cloudDensity(p,true);
            if(d>.001){
              vec2 sunTransmission=cachedCloudLight(p);
              // Beer-Lambert extinction plus a softer second scattering lobe.
              float direct=sunTransmission.r+.20*sunTransmission.g;
              float height=clamp((p.y-uCentre.y)/uExtent.y+.5,0.,1.);
              vec3 ambient=mix(vec3(.065,.12,.21),vec3(.28,.39,.54),height);
              vec3 col=ambient+sunTint*(direct*1.02+forward*.38*sunTransmission.g);
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
      defines:{CLOUD_EMPTY_SKIP:1},uniforms:material.uniforms,vertexShader:material.vertexShader,fragmentShader:material.fragmentShader});
    const box=new T.Mesh(geometry,material);box.userData.cloudMarch={full:material,skip:exterior};box.position.copy(centre);box.scale.copy(extent);box.name=`cumulus_${cell.seed}`;volumes.add(box);
  }
  const fullscreen=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const flightFX={value:0};
  const rays=createSunRays(opaque.depthTexture,cloudy.texture,opaque.texture);
  fullscreen.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthWrite:false,depthTest:false,
    uniforms:{uWorld:{value:opaque.texture},uCloud:{value:cloudy.texture},uDepth:{value:opaque.depthTexture},uFlightFX:flightFX,uRays:{value:rays.target.texture},uRayStrength:rays.strength,uWarmth:style.warmth},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D uWorld,uCloud,uDepth,uRays;uniform float uFlightFX,uRayStrength,uWarmth;varying vec2 vUv;
      vec3 composite(vec2 uv){vec4 c=texture2D(uCloud,uv);return texture2D(uWorld,uv).rgb*(1.-c.a)+c.rgb;}
      void main(){
        vec2 radial=vUv-.5;float radius=length(radial);
        float edge=smoothstep(.28,.68,radius)*uFlightFX;
        vec3 color=composite(vUv);
        // Depth-aware peripheral radial blur. Centre/path stays sharp; no history buffer.
        if(edge>.01){
          float depth=texture2D(uDepth,vUv).r,total=1.;
          for(int i=1;i<=3;i++){
            vec2 uv=clamp(vUv-radial*float(i)*.004*edge,vec2(.001),vec2(.999));
            float agree=1.-smoothstep(.00002,.0006,abs(texture2D(uDepth,uv).r-depth));
            color+=composite(uv)*agree;total+=agree;
          }
          color/=total;
        }
        color*=1.-edge*.09;
        // Repeat the full-resolution solid mask after upsampling so rays can
        // never bleed onto a mountain or through the foreground wing/pilot.
        if(uRayStrength>.001){
          float sky=step(.9999998,texture2D(uDepth,vUv).r);
          color+=texture2D(uRays,vUv).r*uRayStrength*.10*sky*(1.-texture2D(uCloud,vUv).a)
            *mix(vec3(1.,.91,.72),vec3(1.,.73,.40),uWarmth);
        }
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`

  })));
  const dimensions=new T.Vector2(),savedColor=new T.Color();
  let marchWarm=false;
  const resetMarch=()=>{marchWarm=false;};renderer.domElement.addEventListener('webglcontextrestored',resetMarch);
  function selectMarch(){
    // Only above-cloud views showed a repeatable gain. Edge and inside views
    // retain the original shader, including its cost and sample locations.
    const above=camera.position.y>atmosphere.cloud_top_m;
    for(const box of volumes.children)box.material=box.userData.cloudMarch[above?'skip':'full'];
  }
  function render({speed=0,strength=1}={}){
    flightFX.value=speed*strength;
    style.sunEffects.value=strength;
    renderer.getDrawingBufferSize(dimensions);
    if(opaque.width!==dimensions.x||opaque.height!==dimensions.y){opaque.setSize(dimensions.x,dimensions.y);cloudy.setSize(Math.ceil(dimensions.x*.5),Math.ceil(dimensions.y*.5));size.set(cloudy.width,cloudy.height);}
    lighting.update();shadows.update();
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
    renderer.setClearColor(color,alpha);renderer.setRenderTarget(null);renderer.render(fullscreen,quadCamera);
  }
  return {render,flightFX,rays,volumes,opaque,cloudy,shadows,lighting,dispose(){renderer.domElement.removeEventListener('webglcontextrestored',resetMarch);lighting.dispose();shadows.dispose();rays.dispose();opaque.dispose();cloudy.dispose();texture.dispose();geometry.dispose();fullscreen.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});volumes.children.forEach(m=>{m.userData.cloudMarch.full.dispose();m.userData.cloudMarch.skip.dispose();});}};
}

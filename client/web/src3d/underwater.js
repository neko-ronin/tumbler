/** What the camera sees under the water's surface (phase 10). Presentation only: the core's
 * `waterAt(x, y)` says where the water is and its surface; this module decides nothing else.
 *
 * Each frame, `update(dt, light)` asks whether the camera is below the surface and, while it is:
 *  - sets the scene fog to the water's colour (bright turquoise near the surface, deep blue-green
 *    by 20 m, scaled by the light preset) and its distance (20 m, a real alpine lake's);
 *    fog is written every frame, so a light change underwater cannot leave the air's fog behind;
 *  - shows shafts of sunlight refracted through the surface and drifting motes around the eye
 *    (one draw call each, wrapped around the camera so they never run out);
 *  - sets `style.underwater` (terrain: caustics and depth absorption on the bed);
 *  - pulls the camera's far plane in to just past the fog's full strength: everything beyond is
 *    pure fog colour already, so culling it changes no pixel and spares drawing the whole valley.
 * The water surface draws its own underside (Snell's window) whenever the eye is below it.
 * On surfacing the air's fog distances return and its colour comes from `light.fog`.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';

const SUN_IN_WATER=new T.Color('#e6f5d8');
// Per water look (style.waterLook): the fog's colour near the surface and by 20 m, and how far one sees there.
const LOOKS=[
  {shallow:new T.Color('#3f9c90'),deep:new T.Color('#0f4d52'),far:[20,20]},  // chosen: clear alpine to blue-green; 20 m, a real alpine lake's (the human, 2026-11-22)
  {shallow:new T.Color('#4aa898'),deep:new T.Color('#1d6a66'),far:[75,55]},  // clear throughout
  {shallow:new T.Color('#1f6f76'),deep:new T.Color('#08303f'),far:[38,26]},  // deep blue-green throughout
];
const BRIGHTNESS={day:1,golden:.8,dusk:.52};
const f=x=>x.toFixed(2);  // a GLSL float literal
// A fixed sequence (an LCG), so every load and every capture places shafts and motes alike.
const sequence=(seed=1)=>()=>(seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296;
const SHAFTS=72,SHAFT_FIELD_M=60,SHAFT_LENGTH_M=30,MOTES=700,MOTE_FIELD_M=18;

/** Depth below the surface -> fog colour (linear, scaled by `brightness`) and fog distance. */
export function underwaterFog(depth,brightness,into=new T.Color(),look=0){
  const k=Math.min(1,Math.max(0,depth/20)),s=k*k*(3-2*k),l=LOOKS[look]??LOOKS[0];
  into.copy(l.shallow).lerp(l.deep,s).multiplyScalar(brightness);
  return {color:into,far:l.far[0]+(l.far[1]-l.far[0])*s};
}

/** The sun's light inside the water: the downward direction it refracts into (Snell, n = 1.333). */
export function refractedSun(sun,into=new T.Vector3()){
  const i=into.copy(sun).normalize().negate(),eta=1/1.333,cos=-i.y,k=1-eta*eta*(1-cos*cos);
  return i.multiplyScalar(eta).add(new T.Vector3(0,eta*cos-Math.sqrt(Math.max(0,k)),0)).normalize();
}

export function createUnderwater({scene,camera,waterAt,sky=null,overlayAfter=null}){
  const group=new T.Group();group.name='underwater';group.visible=false;scene.add(group);
  // A faint tint over the view: water colours even the nearest things a little.
  const tint=document.createElement('div');
  Object.assign(tint.style,{position:'fixed',inset:'0',pointerEvents:'none',display:'none',mixBlendMode:'multiply'});
  overlayAfter?.insertAdjacentElement('afterend',tint);
  const shared={uTime:style.time,uSurface:{value:30},uOrigin:{value:new T.Vector2()},uRay:{value:new T.Vector3(0,-1,0)},uLight:{value:new T.Color()}};

  // Shafts: quads along the refracted sun, turned about their axis to face the eye.
  const quad=new T.PlaneGeometry(2,1,1,4);quad.translate(0,.5,0);
  const shaftGeometry=new T.InstancedBufferGeometry().copy(quad);shaftGeometry.instanceCount=SHAFTS;
  const seeds=new Float32Array(SHAFTS*4);const next=sequence(7);for(let i=0;i<seeds.length;i++)seeds[i]=next();
  shaftGeometry.setAttribute('seed',new T.InstancedBufferAttribute(seeds,4));
  const shafts=new T.Mesh(shaftGeometry,new T.ShaderMaterial({uniforms:shared,transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`attribute vec4 seed;uniform float uTime,uSurface;uniform vec2 uOrigin;uniform vec3 uRay;varying vec2 vAt;varying float vFade,vPulse;
      void main(){
        // World-fixed positions wrapped around the field's origin: shafts stay put as the eye moves.
        vec2 base=uOrigin+mod(seed.xy*${f(SHAFT_FIELD_M)}-uOrigin+${f(SHAFT_FIELD_M/2)},${f(SHAFT_FIELD_M)})-${f(SHAFT_FIELD_M/2)};
        base+=vec2(sin(uTime*.13+seed.z*20.),cos(uTime*.11+seed.w*20.))*.8;
        float along=position.y*${f(SHAFT_LENGTH_M)}*(.6+.4*seed.z);
        vec3 centre=vec3(base.x,uSurface,base.y)+uRay*along;
        vec3 side=normalize(cross(uRay,cameraPosition-centre));
        vec3 world=centre+side*position.x*(.25+.9*seed.w);
        vAt=vec2(position.x,position.y);
        vFade=(1.-smoothstep(.6,1.,length(base-uOrigin)/${f(SHAFT_FIELD_M/2)}))*exp(-distance(world,cameraPosition)/30.)*smoothstep(5.,14.,distance(world,cameraPosition));
        vPulse=.55+.45*sin(uTime*(.35+.3*seed.x)+seed.y*40.);
        gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
    fragmentShader:`uniform vec3 uLight;varying vec2 vAt;varying float vFade,vPulse;
      void main(){float a=exp(-vAt.x*vAt.x*3.)*pow(1.-vAt.y,1.6)*smoothstep(0.,.06,vAt.y)*vFade*vPulse;gl_FragColor=vec4(uLight*a,1.);}`}));
  shafts.frustumCulled=false;shafts.renderOrder=10;group.add(shafts);

  // Motes: fine suspended particles, wrapped in a cube around the eye, drifting slowly.
  const motePositions=new Float32Array(MOTES*3);for(let i=0;i<motePositions.length;i++)motePositions[i]=next()*MOTE_FIELD_M;
  const moteGeometry=new T.BufferGeometry();moteGeometry.setAttribute('position',new T.BufferAttribute(motePositions,3));
  const motes=new T.Points(moteGeometry,new T.ShaderMaterial({uniforms:{...shared,uScale:{value:1}},transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`uniform float uTime,uScale,uSurface;varying float vFade;
      void main(){
        vec3 drift=position+vec3(uTime*.05,uTime*.02,-uTime*.04);
        vec3 world=cameraPosition+mod(drift-cameraPosition+${f(MOTE_FIELD_M/2)},${f(MOTE_FIELD_M)})-${f(MOTE_FIELD_M/2)};
        float d=distance(world,cameraPosition);
        vFade=(1.-smoothstep(${f(MOTE_FIELD_M*.3)},${f(MOTE_FIELD_M/2)},d))*smoothstep(.3,1.,d)*step(world.y,uSurface);
        vec4 view=viewMatrix*vec4(world,1.);gl_Position=projectionMatrix*view;gl_PointSize=clamp(uScale*.05/-view.z,1.5,4.);}`,
    fragmentShader:`uniform vec3 uLight;varying float vFade;
      void main(){vec2 c=gl_PointCoord-.5;gl_FragColor=vec4(uLight*1.2*vFade*(1.-smoothstep(.2,.5,length(c))),1.);}`}));
  motes.frustumCulled=false;motes.renderOrder=11;group.add(motes);

  const fogColor=new T.Color(),ray=new T.Vector3();
  let active=false,air=null,depthNow=0;
  return {
    group,
    get active(){return active;},
    /** The eye's depth under the surface in metres, 0 above it. */
    get depth(){return depthNow;},
    /** `light` is the current light preset ({fog, color, intensity, name}). Returns whether the eye is under. */
    update(dt,light,viewportHeight=900){
      const overhead=waterAt(camera.position.x,-camera.position.z);
      const under=!!overhead&&camera.position.y<overhead.surface_z;
      if(under&&!active)air={near:scene.fog.near,far:scene.fog.far,cameraFar:camera.far};
      if(!under&&active&&air){scene.fog.near=air.near;scene.fog.far=air.far;camera.far=air.cameraFar;camera.updateProjectionMatrix();scene.fog.color.set(light.fog);scene.background.copy(scene.fog.color);}
      active=under;group.visible=under;tint.style.display=under?'block':'none';style.underwater.value=under?1:0;
      if(sky)sky.visible=!under;
      depthNow=under?overhead.surface_z-camera.position.y:0;
      if(!under)return false;
      const depth=depthNow,brightness=BRIGHTNESS[light.name]??1;
      const fog=underwaterFog(depth,brightness,fogColor,style.waterLook.value);
      scene.fog.color.copy(fog.color);scene.fog.near=0;scene.fog.far=fog.far;scene.background.copy(fog.color);
      const far=Math.min(air.cameraFar,fog.far*1.1);if(camera.far!==far){camera.far=far;camera.updateProjectionMatrix();}
      tint.style.background=`#${fog.color.clone().lerp(new T.Color(1,1,1),.55).getHexString(T.SRGBColorSpace)}`;
      refractedSun(style.sun.value,ray);
      shared.uSurface.value=overhead.surface_z;shared.uRay.value.copy(ray);
      // Centre the shafts' field where they cross the eye's depth, so the eye stands among them.
      const t=depth/Math.max(.2,-ray.y);shared.uOrigin.value.set(camera.position.x-ray.x*t,camera.position.z-ray.z*t);
      shared.uLight.value.copy(SUN_IN_WATER).multiplyScalar(.08*brightness*(light.intensity??2)/2);
      motes.material.uniforms.uScale.value=viewportHeight/(2*Math.tan(camera.fov*Math.PI/360));
      return true;
    },
  };
}

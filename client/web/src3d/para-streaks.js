/** Motes of air sliding past the first-person eye: the speed cue that still works
 * in open air, far above anything to give parallax. One draw, no per-streak CPU;
 * the vertex shader wraps a fixed set of seeds in a box around the camera.
 * ponytail: motes hold still in the world, so they read ground speed rather than
 * airspeed. Advect by the shared wind if a strong tailwind ever looks wrong. */
import * as T from '../vendor/three.module.min.js';
const COUNT=160,BOX=44;
export function createParaStreaks(){
 const seeds=new Float32Array(COUNT*6),ends=new Float32Array(COUNT*2);let seed=9127;
 const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let i=0;i<COUNT;i++){const p=[next(),next(),next()];seeds.set(p,i*6);seeds.set(p,i*6+3);ends[i*2+1]=1;}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(seeds,3));geometry.setAttribute('aEnd',new T.BufferAttribute(ends,1));
 const uniforms={uCamera:{value:new T.Vector3()},uVelocity:{value:new T.Vector3()},uOpacity:{value:0}};
 const material=new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.NormalBlending,uniforms,
  vertexShader:`attribute float aEnd;uniform vec3 uCamera,uVelocity;varying float vFade;
   void main(){vec3 rel=mod(position*${BOX.toFixed(1)}-uCamera,${BOX.toFixed(1)})-${(BOX/2).toFixed(1)};
    float d=length(rel);vFade=(1.-aEnd)*smoothstep(${(BOX/2).toFixed(1)},${(BOX/4).toFixed(1)},d)*smoothstep(1.5,5.,d);
    gl_Position=projectionMatrix*viewMatrix*vec4(uCamera+rel-uVelocity*.045*aEnd,1.);}`,
  fragmentShader:`uniform float uOpacity;varying float vFade;void main(){gl_FragColor=vec4(.93,.95,.97,vFade*uOpacity);}`});
 const mesh=new T.LineSegments(geometry,material);mesh.name='para_streaks';mesh.frustumCulled=false;mesh.visible=false;mesh.renderOrder=2;
 return {mesh,uniforms,update(sample,camera,view,strength=1){
  const speed=Math.hypot(...(sample?.velocity??[0,0,0])),amount=view==='first'&&sample?.active?Math.max(0,Math.min(1,(speed-12)/26))*strength:0;
  mesh.visible=amount>.01;if(!mesh.visible)return;
  uniforms.uCamera.value.copy(camera.position);uniforms.uVelocity.value.set(sample.velocity[0],sample.velocity[2],-sample.velocity[1]);uniforms.uOpacity.value=.62*amount;
 },dispose(){geometry.dispose();material.dispose();}};
}

/** Cached solar transmission onto terrain/meadow, sampled at core ground heights.
 * 256² over the published far field, updated at 2 Hz. Only sunlight is attenuated;
 * hemisphere fill, surface colour and existing tree shadows remain independent.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
import {CLOUD_DENSITY_GLSL} from './cloud-field.js';
import {cloudCellBounds,cloudGroundFootprint} from './cloud-shadow-field.js';
export function createCloudShadows(renderer,atmosphere,noise,ground){
 const resolution=256,g=ground.farField;
 const minHeight=Math.min(ground.block.minimum,g.minimum),maxHeight=Math.max(ground.block.maximum,g.maximum);
 const grid=new T.Vector4(g.minX,-g.maxY,g.maxX-g.minX,g.maxY-g.minY);
 const heights=new Float32Array(resolution**2);
 for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++)heights[y*resolution+x]=ground.height(grid.x+(x+.5)/resolution*grid.z,-(grid.y+(y+.5)/resolution*grid.w))??0;
 const height=new T.DataTexture(heights,resolution,resolution,T.RedFormat,T.FloatType);
 height.minFilter=height.magFilter=T.NearestFilter;height.needsUpdate=true;
 const target=new T.WebGLRenderTarget(resolution,resolution,{depthBuffer:false});
 target.texture.minFilter=target.texture.magFilter=T.LinearFilter;
 style.cloudGround.value=target.texture;style.cloudGroundGrid.value.copy(grid);style.cloudTop.value=atmosphere.cloud_top_m;
 const scene=new T.Scene(),camera=new T.Camera(),geometry=new T.PlaneGeometry(2,2);
 for(const cell of atmosphere.cloud_cells){
  const bounds=cloudCellBounds(cell,atmosphere),material=new T.ShaderMaterial({glslVersion:T.GLSL3,depthTest:false,depthWrite:false,transparent:true,premultipliedAlpha:true,blending:T.MultiplyBlending,
   uniforms:{uHeight:{value:height},uGrid:{value:grid},uNoise:{value:noise},uCentre:{value:new T.Vector3(...bounds.centre)},uExtent:{value:new T.Vector3(...bounds.extent)},uSun:style.sun,uWind:style.cloudWind,uTime:style.time,uSeed:{value:cell.seed}},
   vertexShader:'out vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
   fragmentShader:`precision highp sampler3D;in vec2 vUv;out vec4 fragColor;
    uniform sampler2D uHeight;uniform sampler3D uNoise;uniform vec4 uGrid;uniform vec3 uCentre,uExtent,uSun;uniform vec2 uWind;uniform float uTime,uSeed;
    ${CLOUD_DENSITY_GLSL}
    void main(){
     vec2 xy=uGrid.xy+vUv*uGrid.zw;vec3 receiver=vec3(xy.x,texture(uHeight,vUv).r+.5,xy.y);
     vec3 inv=1./(uSun+vec3(.000001)),a=(uCentre-uExtent*.5-receiver)*inv,b=(uCentre+uExtent*.5-receiver)*inv;
     vec3 lo=min(a,b),hi=max(a,b);float entry=max(0.,max(max(lo.x,lo.y),lo.z)),exit=min(min(hi.x,hi.y),hi.z);
     if(exit<=entry||uSun.y<=0.){fragColor=vec4(1.);return;}
     float stride=(exit-entry)/24.,depth=0.;
     for(int i=0;i<24;i++)depth+=cloudDensity(receiver+uSun*(entry+(float(i)+.5)*stride),true)*stride;
     fragColor=vec4(vec3(exp(-depth*.014)),1.);
    }`});
  const quad=new T.Mesh(geometry,material);quad.frustumCulled=false;quad.userData.bounds=bounds;scene.add(quad);
 }
 let last=-Infinity,sun=new T.Vector3(),wind=new T.Vector2();const color=new T.Color();
 function update(force=false){
  if(!force&&style.time.value>=last&&style.time.value-last<.5&&sun.distanceToSquared(style.sun.value)<1e-8&&wind.distanceToSquared(style.cloudWind.value)<.01)return;
  last=style.time.value;sun.copy(style.sun.value);wind.copy(style.cloudWind.value);
  const saved=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();renderer.getClearColor(color);
  renderer.setRenderTarget(target);renderer.setClearColor(0xffffff,1);renderer.clear();
  renderer.setScissorTest(true);
  for(const quad of scene.children){
   const footprint=cloudGroundFootprint(quad.userData.bounds,sun.toArray(),minHeight,maxHeight);
   if(!footprint)continue;
   const lo=footprint.low.map((v,i)=>Math.max(0,Math.floor((v-grid.getComponent(i))/grid.getComponent(i+2)*resolution)-1));
   const hi=footprint.high.map((v,i)=>Math.min(resolution,Math.ceil((v-grid.getComponent(i))/grid.getComponent(i+2)*resolution)+1));
   if(hi[0]<=lo[0]||hi[1]<=lo[1])continue;
   renderer.setScissor(lo[0],lo[1],hi[0]-lo[0],hi[1]-lo[1]);
   // Each quad keeps its own cell uniform set; no repeated full-scene redraw.
   for(const other of scene.children)other.visible=other===quad;
   renderer.render(scene,camera);
  }
  scene.children.forEach(q=>q.visible=true);renderer.setScissorTest(false);renderer.setClearColor(color,alpha);renderer.setRenderTarget(saved);
  style.cloudGroundReady.value=1;
 }
 return {target,height,grid,scene,update,dispose(){style.cloudGroundReady.value=0;target.dispose();height.dispose();geometry.dispose();scene.children.forEach(q=>q.material.dispose());}};
}

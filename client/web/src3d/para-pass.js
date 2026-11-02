/** Para-only final optics. No history, noise, chromatic separation or centre blur.
 * A half-float linear composite keeps radiance until the single final tone map.
 * Unsupported float render targets bypass this pass; fixed optics stay exact. */
import * as T from '../vendor/three.module.min.js';
export function createParaPass(renderer,camera){
 const supported=renderer.extensions.has('EXT_color_buffer_float');
 const target=new T.WebGLRenderTarget(1,1,{depthBuffer:false,type:T.HalfFloatType});target.texture.colorSpace=T.LinearSRGBColorSpace;
 const size=new T.Vector2(),focus=new T.Vector3(),axis=new T.Vector3(),direction=new T.Vector3();
 const uniforms={uColor:{value:target.texture},uDepth:{value:null},uRange:{value:new T.Vector2(camera.near,camera.far)},uFocus:{value:new T.Vector2(.5,.5)},uSmear:{value:0},uLens:{value:0},uAspect:{value:1},uPixel:{value:new T.Vector2(1,1)}};
 const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:`uniform sampler2D uColor,uDepth;uniform vec2 uRange,uFocus,uPixel;uniform float uSmear,uLens,uAspect;varying vec2 vUv;
   float metres(vec2 p){float d=texture2D(uDepth,p).r;return uRange.x*uRange.y/(uRange.y-d*(uRange.y-uRange.x));}
   void main(){
    vec2 delta=vUv-uFocus;float radius=length(delta*vec2(uAspect,1.));
    float edge=smoothstep(.24,.76,radius);float depth=metres(vUv);
    float equipment=smoothstep(3.,7.,depth);
    vec2 uv=clamp(vUv+delta*dot(delta,delta)*.009*uLens*edge*equipment,uPixel*.5,vec2(1.)-uPixel*.5);
    vec3 color=texture2D(uColor,uv).rgb;float total=1.;float reference=metres(uv);
    if(edge*uSmear*equipment>.005){
     for(int i=1;i<=3;i++){
      vec2 p=clamp(uv-delta*float(i)*.0035*edge*uSmear*equipment,uPixel*.5,vec2(1.)-uPixel*.5);
      float agree=1.-smoothstep(.025,.12,abs(metres(p)-reference)/max(1.,reference));
      color+=texture2D(uColor,p).rgb*agree;total+=agree;
     }
     color/=total;
    }
    color*=1.-edge*.035*uSmear;
    gl_FragColor=vec4(color,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }`});
 const scene=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1),geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));geometry.setAttribute('uv',new T.Float32BufferAttribute([0,0,2,0,0,2],2));scene.add(new T.Mesh(geometry,material));
 let warmed=false;
 return {target,uniforms,supported,
  prepare(){renderer.getDrawingBufferSize(size);if(target.width!==size.x||target.height!==size.y)target.setSize(size.x,size.y);},
  warm(){if(!supported)return;this.prepare();renderer.compile(scene,quadCamera);warmed=true;},
  render(depth,sample){
   this.prepare();uniforms.uDepth.value=depth;uniforms.uRange.value.set(camera.near,camera.far);uniforms.uAspect.value=camera.aspect;uniforms.uPixel.value.set(1/size.x,1/size.y);
   uniforms.uSmear.value=sample.smear;uniforms.uLens.value=sample.lens;
   axis.set(...[sample.velocity[0],sample.velocity[2],-sample.velocity[1]]).normalize();camera.getWorldDirection(direction);
   if(axis.dot(direction)>.3){focus.copy(camera.position).addScaledVector(axis,500).project(camera);uniforms.uFocus.value.set(Math.max(.25,Math.min(.75,focus.x*.5+.5)),Math.max(.25,Math.min(.75,focus.y*.5+.5)));}else uniforms.uFocus.value.set(.5,.5);
   renderer.setRenderTarget(null);renderer.render(scene,quadCamera);
  },get warmed(){return warmed;},dispose(){target.dispose();geometry.dispose();material.dispose();}};
}

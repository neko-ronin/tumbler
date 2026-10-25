/** Quarter-resolution screen-space atmospheric shafts. Reuses world depth and
 * cloud opacity; no geometry redraw, history, bloom or full-size extra pass.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';

export function createSunRays(depth,cloud,world) {
  const target=new T.WebGLRenderTarget(1,1,{depthBuffer:false});
  const source={value:new T.Vector3(0,0,0)},shape={value:new T.Vector2(1,1)};
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const material=new T.ShaderMaterial({depthTest:false,depthWrite:false,
    uniforms:{uDepth:{value:depth},uCloud:{value:cloud},uWorld:{value:world},uSource:source,uShape:shape},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D uDepth,uCloud,uWorld;uniform vec3 uSource;uniform vec2 uShape;varying vec2 vUv;
      float openSky(vec2 uv){
        float inside=step(0.,uv.x)*step(0.,uv.y)*step(uv.x,1.)*step(uv.y,1.);
        return inside*step(.9999998,texture2D(uDepth,uv).r)*(1.-texture2D(uCloud,uv).a);
      }
      void main(){
        // The bright source also rejects the painted distant mountain ranges,
        // which intentionally do not write scene depth.
        float disc=openSky(uSource.xy)*.5;
        float sourceLight=openSky(uSource.xy)*smoothstep(.72,1.05,texture2D(uWorld,uSource.xy).r);
        for(int i=0;i<8;i++){
          float a=float(i)*.785398;
          vec2 uv=uSource.xy+vec2(cos(a)/uShape.x,sin(a))*uShape.y*.12;
          disc+=openSky(uv)*.0625;
          sourceLight=max(sourceLight,openSky(uv)*smoothstep(.72,1.05,texture2D(uWorld,uv).r));
        }
        float neighbourhood=0.;
        for(int i=0;i<8;i++){
          float a=float(i)*.785398;
          neighbourhood+=openSky(uSource.xy+vec2(cos(a)/uShape.x,sin(a))*uShape.y);
        }
        neighbourhood*=.125;
        // Rays are an occasional partial-occlusion cue, absent in clear sky.
        float partial=max(4.*neighbourhood*(1.-neighbourhood),4.*disc*(1.-disc));
        float occasion=disc*partial*sourceLight;
        vec2 offset=vUv-uSource.xy;
        float radius=length(offset*vec2(uShape.x,1.));
        float light=0.;
        for(int i=0;i<20;i++){
          float t=(float(i)+.5)/20.;
          light+=openSky(mix(vUv,uSource.xy,t*.92))*(1.-t*.45);
        }
        light/=15.5;
        float fade=1.-smoothstep(.04,.46,radius);
        // Store a normalized mask; applying the small gain after upsampling
        // avoids quantizing a subtle beam to two or three 8-bit levels.
        float corona=exp(-radius*radius/.0012)*occasion*.35;
        gl_FragColor=vec4(vec3(light*occasion*fade+corona),1.);
      }`
  });
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),material);scene.add(quad);
  const projected=new T.Vector3(),forward=new T.Vector3();
  const strength={value:0};
  function render(renderer,view,width,height,effects) {
    view.getWorldDirection(forward);
    const facing=forward.dot(style.sun.value);
    projected.copy(style.sun.value).multiplyScalar(10000).add(view.position).project(view);
    const x=projected.x*.5+.5,y=projected.y*.5+.5;
    // Fade BEFORE the source leaves the frame: no clamped border streaks.
    const border=Math.min(x,y,1-x,1-y);
    strength.value=effects*T.MathUtils.smoothstep(facing,.45,.82)*T.MathUtils.smoothstep(border,0,.08);
    if(strength.value<=.001)return;
    source.value.set(x,y,1);
    shape.value.set(width/height,.045/Math.tan(T.MathUtils.degToRad(view.fov)*.5));
    const w=Math.ceil(width*.25),h=Math.ceil(height*.25);
    if(target.width!==w||target.height!==h)target.setSize(w,h);
    renderer.setRenderTarget(target);renderer.render(scene,camera);
  }
  return {target,strength,source,material,render,dispose(){target.dispose();quad.geometry.dispose();material.dispose();}};
}

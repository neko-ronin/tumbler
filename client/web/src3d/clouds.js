/** Raymarched cumulus volumes. The core owns each cloud cell and its altitude.
 * Render at half scale and stop every ray at the opaque world's depth. The
 * same shader works inside a cloud; no opaque sphere or camera-facing sprite.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
import {createSunRays} from './sun-rays.js';
export function createCloudPass(renderer,scene,camera,atmosphere){
  const opaque=new T.WebGLRenderTarget(1,1,{samples:Math.min(4,renderer.capabilities.maxSamples),depthTexture:new T.DepthTexture(1,1,T.UnsignedIntType)});
  opaque.texture.colorSpace=T.LinearSRGBColorSpace;
  const cloudy=new T.WebGLRenderTarget(1,1,{depthBuffer:false});
  const volumes=new T.Scene(),size=new T.Vector2();
  const forward={value:new T.Vector3()};
  const noiseData=new Uint8Array(32**3);
  const hash=(x,y,z)=>{const n=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return n-Math.floor(n);};
  const noise=(x,y,z)=>{const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);const f=[x-ix,y-iy,z-iz].map(v=>v*v*(3-2*v));let n=0;for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)n+=hash(ix+i,iy+j,iz+k)*(i?f[0]:1-f[0])*(j?f[1]:1-f[1])*(k?f[2]:1-f[2]);return n;};
  for(let z=0;z<32;z++)for(let y=0;y<32;y++)for(let x=0;x<32;x++)noiseData[(z*32+y)*32+x]=255*noise(x/4,y/4,z/4);
  const texture=new T.Data3DTexture(noiseData,32,32,32);texture.format=T.RedFormat;
  texture.minFilter=texture.magFilter=T.LinearFilter;texture.wrapS=texture.wrapT=texture.wrapR=T.RepeatWrapping;texture.needsUpdate=true;
  const geometry=new T.BoxGeometry(1,1,1);
  for(const cell of atmosphere.cloud_cells){
    const [x,y]=cell.centre_xy_m,[sx,sy,declaredHeight]=cell.size_m;
    const sz=Math.min(declaredHeight,atmosphere.cloud_top_m-atmosphere.cloud_base_m);
    const centre=new T.Vector3(x,atmosphere.cloud_base_m+sz*.5,-y),extent=new T.Vector3(sx,sz,sy);
    const material=new T.ShaderMaterial({glslVersion:T.GLSL3,side:T.BackSide,transparent:true,depthWrite:false,depthTest:false,
      uniforms:{uDepth:{value:opaque.depthTexture},uNoise:{value:texture},uCentre:{value:centre},uExtent:{value:extent},uResolution:{value:size},uNear:{value:camera.near},uFar:{value:camera.far},uForward:forward,uSun:style.sun,uTime:style.time,uWind:style.wind,uSeed:{value:cell.seed}},
      vertexShader:`out vec3 vWorld;void main(){vWorld=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);}`,
      fragmentShader:`precision highp sampler3D;
        in vec3 vWorld;out vec4 fragColor;
        uniform sampler2D uDepth;uniform sampler3D uNoise;uniform vec3 uCentre,uExtent,uForward,uSun;uniform vec2 uResolution,uWind;uniform float uNear,uFar,uTime,uSeed;
        float density(vec3 world){
          vec3 p=(world-uCentre)/uExtent;
          float shape=1.-length(p*vec3(2.7,2.5,2.7));
          shape=max(shape,.90-length((p-vec3(-.18,.13,.04))*vec3(3.3,3.5,3.)));
          shape=max(shape,.95-length((p-vec3(.17,.10,-.06))*vec3(3.5,3.2,3.3)));
          // The billows drift downwind at 0.6 m/s inside the core's fixed cell.
          float n=texture(uNoise,(p-vec3(uWind.x,0.,uWind.y)*uTime*.6/uExtent)*2.6+vec3(uSeed*.13,0.,0.)).r;
          float fine=texture(uNoise,p*9.+uSeed*.071).r;
          float edge=smoothstep(0.,.10,.5-max(abs(p.x),abs(p.z)))*smoothstep(0.,.08,.5-abs(p.y));
          return smoothstep(.02,.24,shape+(n-.55)*.30+(fine-.5)*.07)*smoothstep(-.5,-.34,p.y)*edge;
        }
        void main(){
          vec3 ray=normalize(vWorld-cameraPosition);
          vec3 inv=1./ray;vec3 a=(uCentre-uExtent*.5-cameraPosition)*inv,b=(uCentre+uExtent*.5-cameraPosition)*inv;
          vec3 lo=min(a,b),hi=max(a,b);
          float entry=max(0.,max(max(lo.x,lo.y),lo.z)),exit=min(min(hi.x,hi.y),hi.z);
          float depth=texture(uDepth,gl_FragCoord.xy/uResolution).r;
          float viewDepth=uNear*uFar/(uFar-depth*(uFar-uNear));
          exit=min(exit,viewDepth/max(.001,dot(ray,uForward)));
          if(exit<=entry)discard;
          float stepM=(exit-entry)/40.;float trans=1.;vec3 light=vec3(0.);
          float jitter=fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453);
          for(int i=0;i<40;i++){
            vec3 p=cameraPosition+ray*(entry+(float(i)+jitter)*stepM);float d=density(p);
            if(d>.001){float shade=density(p+uSun*65.);float absorb=1.-exp(-d*stepM*.025);
              vec3 col=mix(vec3(.37,.47,.53),vec3(1.,.97,.88),clamp(1.-shade*.70,0.,1.));
              col+=vec3(.13,.12,.10)*pow(max(0.,dot(ray,uSun)),8.);
              light+=col*absorb*trans;trans*=1.-absorb;if(trans<.015)break;}
          }
          float alpha=1.-trans;if(alpha<.008)discard;
          fragColor=vec4(light/max(.001,alpha),alpha);
        }`
    });
    const box=new T.Mesh(geometry,material);box.position.copy(centre);box.scale.copy(extent);box.name=`cumulus_${cell.seed}`;volumes.add(box);
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
  function render({speed=0,strength=1}={}){
    flightFX.value=speed*strength;
    style.sunEffects.value=strength;
    renderer.getDrawingBufferSize(dimensions);
    if(opaque.width!==dimensions.x||opaque.height!==dimensions.y){opaque.setSize(dimensions.x,dimensions.y);cloudy.setSize(Math.ceil(dimensions.x*.5),Math.ceil(dimensions.y*.5));size.set(cloudy.width,cloudy.height);}
    camera.getWorldDirection(forward.value);
    renderer.setRenderTarget(opaque);renderer.render(scene,camera);
    const color=renderer.getClearColor(savedColor),alpha=renderer.getClearAlpha();
    renderer.setClearColor(0,0);renderer.setRenderTarget(cloudy);renderer.clear();renderer.render(volumes,camera);
    rays.render(renderer,camera,dimensions.x,dimensions.y,strength);
    renderer.setClearColor(color,alpha);renderer.setRenderTarget(null);renderer.render(fullscreen,quadCamera);
  }
  return {render,flightFX,rays,volumes,opaque,cloudy,dispose(){rays.dispose();opaque.dispose();cloudy.dispose();texture.dispose();geometry.dispose();fullscreen.children.forEach(m=>{m.geometry.dispose();m.material.dispose();});volumes.children.forEach(m=>m.material.dispose());}};
}

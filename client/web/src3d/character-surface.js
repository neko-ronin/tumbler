/** Character-only fibre/cloth shading. Shared vertex colours remain the coat's authority. */
import * as T from '../vendor/three.module.min.js';
import {sunShadowShader,style} from './style.js';

const FIBRES = `
  float hairHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float hairCoverage(vec2 uv,float layer){
    vec2 cell=uv*vec2(176.,112.);
    vec2 id=floor(cell),p=fract(cell)-.5;
    p+=vec2(hairHash(id+3.1)-.5,hairHash(id+17.7)-.5)*.36;
    p.x+=p.y*.18+layer*.09;
    float width=mix(.40,.13,layer),strand=length(p/vec2(width,.80));
    float aa=max(.08,fwidth(strand));
    return (1.-smoothstep(1.-aa,1.+aa,strand))*step(layer*.64,hairHash(id+41.));
  }
`;

export function installCharacterSurfaces(model) {
  const meshes=[];model.traverse(node=>{if(node.isMesh)meshes.push(node);});
  model.updateMatrixWorld(true);
  const inverse=new T.Matrix4().copy(model.matrixWorld).invert(),materials=new Set(),shells=[];
  const eye=new T.Vector3(.12,1.34,.224); // the open eye's centre (core EYE, z flipped)
  // A little bloom without a post pass: an inflated additive shell round each
  // whisker that lights only where the sun glints along it.
  const halo=new T.ShaderMaterial({uniforms:{uSun:style.sun},transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec3 vNormalWorld;varying vec3 vToCamera;
      void main(){vec4 world=modelMatrix*vec4(position+normal*.006,1.);vNormalWorld=normalize(mat3(modelMatrix)*normal);
        vToCamera=normalize(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`uniform vec3 uSun;varying vec3 vNormalWorld;varying vec3 vToCamera;
      void main(){vec3 n=normalize(vNormalWorld);float glint=pow(max(dot(n,normalize(uSun+vToCamera)),0.),14.);
        float core=pow(max(dot(n,vToCamera),0.),2.);gl_FragColor=vec4(vec3(1.,.97,.9)*glint*core*.55,1.);}`});
  materials.add(halo);
  // Fur fog: nested haze shells round the ear's root read as a soft volume --
  // dense where the shell faces the eye, fading to nothing at its silhouette,
  // broken up by noise -- hiding where the ear leaves the hat.
  const fog=color=>new T.ShaderMaterial({uniforms:{uColor:{value:color.clone()},uDensity:{value:.34}},transparent:true,depthWrite:false,
    vertexShader:`varying vec3 vNormalWorld;varying vec3 vToCamera;varying vec3 vWorld;
      void main(){vec4 world=modelMatrix*vec4(position,1.);vWorld=world.xyz;vNormalWorld=normalize(mat3(modelMatrix)*normal);
        vToCamera=normalize(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`uniform vec3 uColor;uniform float uDensity;varying vec3 vNormalWorld;varying vec3 vToCamera;varying vec3 vWorld;
      float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
      float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                   mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
      void main(){vec3 n=normalize(vNormalWorld);float facing=abs(dot(n,vToCamera));
        float alpha=uDensity*pow(facing,1.8)*(.5+.5*noise(vWorld*140.));
        gl_FragColor=vec4(uColor*(.85+.25*n.y),alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`});
  for(const mesh of meshes){
    const source=mesh.material,name=source.name,part=mesh.parent.name;
    const fur=/^fur/.test(name),knit=name==='beanie',cloth=/hakama|sash|flannel/.test(name);
    const rest=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),scale=new T.Vector3();rest.decompose(new T.Vector3(),new T.Quaternion(),scale);
    const length=part.startsWith('cheek') ? .014 : part==='head' ? .013 : part==='cat_tail' ? .014 : .009;
    // Metals stay partly diffuse: neither scene has an environment map, so full metal reads black.
    function surface(layer=0){
      const material=new T.MeshStandardMaterial({name,color:source.color.clone(),vertexColors:source.vertexColors,map:source.map,
        side:layer?T.DoubleSide:source.side,roughness:fur ? .92 : knit||cloth ? .96 : /iris|eye_white/.test(name) ? .22 : name==='steel' ? .28 : name==='gunmetal' ? .42 : name==='whisker' ? .12 : .68,
        metalness:name==='gold' ? .65 : name==='steel' ? .55 : name==='gunmetal' ? .5 : 0,transparent:source.transparent,opacity:source.opacity,depthWrite:true});
      if(name==='iris'){material.emissive.set('#a6b83c');material.emissiveIntensity=.025;}
      if(name==='glow'){material.emissive.copy(material.color);material.emissiveIntensity=1.6;}
      material.onBeforeCompile=shader=>{
        sunShadowShader(shader);shader.uniforms.uSun=style.sun;
        shader.vertexShader='varying vec3 vSunPlace;\n'+shader.vertexShader;
        shader.fragmentShader='uniform vec3 uSun;varying vec3 vSunPlace;\n'+shader.fragmentShader;
        shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`vSunPlace=(modelMatrix*vec4(transformed,1.)).xyz;\n#include <project_vertex>`);
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          float sunlight=actorSunLight(vSunPlace)*cloudObjectLight(vSunPlace,uSun);reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;`);
        shader.uniforms.uCoatRest={value:rest};shader.uniforms.uCoatScale={value:scale};shader.uniforms.uCoatEye={value:eye};
        shader.vertexShader='varying vec2 vCoatUv; varying vec3 vCoatRest; uniform mat4 uCoatRest; uniform vec3 uCoatScale;\n'+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vCoatUv=uv;vCoatRest=(uCoatRest*vec4(position,1.)).xyz;
          ${layer?`transformed+=normal*${(length*layer).toFixed(6)}/max(uCoatScale,vec3(.001));`:''}`);
        shader.fragmentShader='varying vec2 vCoatUv; varying vec3 vCoatRest; uniform vec3 uCoatEye;\n'+FIBRES+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          ${fur?`float grain=hairHash(floor(vCoatUv*vec2(880.,560.)));
            diffuseColor.rgb*=mix(.96,1.04,grain);`:''}
          ${layer?`if(length((vCoatRest-uCoatEye)/vec3(.092,.088,.078))<1.&&vCoatRest.z>.20)discard;
            if(length((vCoatRest-vec3(0.,1.196,.315))/vec3(.082,.043,.065))<1.)discard;
            if(length((vCoatRest-vec3(-.118,1.348,.23))/vec3(.118,.092,.09))<1.)discard; // under the eyepatch
            float cover=hairCoverage(vCoatUv,${layer.toFixed(2)});if(cover<.35)discard;
            diffuseColor.rgb*=${(.92+.16*layer).toFixed(3)};`:''}
        `);
        // Whiskers are glassy keratin: a hard glint along each one in the sun.
        if(name==='whisker')shader.fragmentShader=shader.fragmentShader.replace('reflectedLight.directSpecular*=sunlight;',`reflectedLight.directSpecular*=sunlight;
          vec3 sunView=normalize((viewMatrix*vec4(uSun,0.)).xyz);
          float glint=pow(max(dot(normal,normalize(sunView+normalize(vViewPosition))),0.),40.);
          reflectedLight.directSpecular+=vec3(glint*3.5*sunlight);`);
        // Ears are thin: low sun behind one glows warm through it, strongest
        // where the pinna is thinnest, toward the tip.
        if(/^ear/.test(part))shader.fragmentShader=shader.fragmentShader.replace('reflectedLight.directSpecular*=sunlight;',`reflectedLight.directSpecular*=sunlight;
          float backlit=pow(clamp(dot(normalize(vSunPlace-cameraPosition),uSun),0.,1.),3.);
          reflectedLight.directDiffuse+=vec3(1.,.42,.30)*backlit*sunlight*${name==='ear_skin'?'1.1':'.55'};`);
        if(fur)shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          float furRim=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),3.);
          reflectedLight.indirectDiffuse+=diffuseColor.rgb*furRim*.06;`);
        if(knit||cloth)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          float weave=sin(vCoatUv.x*900.)*sin(vCoatUv.y*760.);
          float detail=1.-smoothstep(.12,.5,length(fwidth(vCoatUv*vec2(900.,760.))));
          vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition),rx=cross(dy,normal),ry=cross(normal,dx);
          float det=dot(dx,rx)*faceDirection;
          normal=normalize(abs(det)*normal-sign(det)*(dFdx(weave)*rx+dFdy(weave)*ry)*.00013*detail);`);
      };
      material.customProgramCacheKey=()=>`ronin-fibre-v2:${name}:${layer}:${length}`;
      materials.add(material);return material;
    }
    if(name==='ear_haze'){mesh.material=fog(source.color);materials.add(mesh.material);source.dispose();mesh.castShadow=false;continue;}
    mesh.material=surface();source.dispose();
    // Hair cards: alpha strands, seen from both sides, sorted rather than depth-written.
    if(name==='ear_hair'){mesh.material.side=T.DoubleSide;mesh.material.depthWrite=false;mesh.material.alphaTest=.03;}
    if(name==='whisker'){const glow=new T.Mesh(mesh.geometry,halo);glow.name=part+'.glint';glow.castShadow=false;mesh.add(glow);}
    if(!fur||/eyelid|lower_lid/.test(part))continue;
    for(let i=1;i<=4;i++){
      const shell=mesh.isSkinnedMesh?new T.SkinnedMesh(mesh.geometry,surface(i/4)):new T.Mesh(mesh.geometry,surface(i/4));
      shell.name=part+'.fur'+i;shell.castShadow=false;shell.receiveShadow=true;shell.frustumCulled=false;
      mesh.add(shell);
      if(shell.isSkinnedMesh){shell.bind(mesh.skeleton,mesh.bindMatrix);}
      shells.push(shell);
    }
  }
  return {shells,dispose(){for(const m of materials)m.dispose();}};
}

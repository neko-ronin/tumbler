/** Character-only fibre/cloth shading. Shared vertex colours remain the coat's authority. */
import * as T from '../vendor/three.module.min.js';

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
  const eye=new T.Vector3(.12,1.34,.244);
  for(const mesh of meshes){
    const source=mesh.material,name=source.name,part=mesh.parent.name;
    const fur=/^fur/.test(name),knit=name==='beanie',cloth=/hakama|sash|flannel/.test(name);
    const rest=new T.Matrix4().multiplyMatrices(inverse,mesh.matrixWorld),scale=new T.Vector3();rest.decompose(new T.Vector3(),new T.Quaternion(),scale);
    const length=part.startsWith('cheek') ? .023 : part==='head' ? .013 : part==='cat_tail' ? .014 : .009;
    function surface(layer=0){
      const material=new T.MeshStandardMaterial({name,color:source.color.clone(),vertexColors:source.vertexColors,map:source.map,
        side:layer?T.DoubleSide:source.side,roughness:fur ? .92 : knit||cloth ? .96 : /iris|eye_white/.test(name) ? .22 : .68,
        metalness:name==='gold' ? .65 : 0,transparent:source.transparent,opacity:source.opacity,depthWrite:true});
      if(name==='iris'){material.emissive.set('#a6b83c');material.emissiveIntensity=.025;}
      material.onBeforeCompile=shader=>{
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
            float cover=hairCoverage(vCoatUv,${layer.toFixed(2)});if(cover<.35)discard;
            diffuseColor.rgb*=${(.92+.16*layer).toFixed(3)};`:''}
        `);
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
      material.customProgramCacheKey=()=>`ronin-fibre-v1:${name}:${layer}:${length}`;
      materials.add(material);return material;
    }
    mesh.material=surface();source.dispose();
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

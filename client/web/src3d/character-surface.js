/** Character-only fibre/cloth shading. Shared vertex colours remain the coat's authority. */
import * as T from '../vendor/three.module.min.js';
import {sunShadowShader,style} from './style.js';
// How strongly backlit sun glows through his ears.
const EAR_GLOW=.3;

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

// Each Cat Ronin's face, in rest coordinates (metres, z forward): its fur stays
// short over the open eye (eye: the opening, core EYE_AT with z flipped; only
// in front of eyeFront), the mouth, the nose leather and under the eyepatch
// (bare: centre, radii), and on the current model grows longer round the jowls
// and throat (reach). `config.face` picks one; the game's model is `ronin`.
const FACES={
  ronin:{eye:[.128,1.335,.222],eyeRadii:[.10,.09,.085],eyeFront:.17,reach:true,
    bare:[[[0,1.19,.27],[.085,.045,.07]],[[0,1.241,.285],[.05,.03,.05]],[[-.128,1.345,.22],[.135,.106,.10]]]},
  original:{eye:[.12,1.34,.224],eyeRadii:[.092,.088,.078],eyeFront:.20,reach:false,
    bare:[[[0,1.196,.315],[.082,.043,.065]],[[-.118,1.348,.23],[.118,.092,.09]]]},
};
const vec3=values=>`vec3(${values.map(value=>value.toFixed(3)).join(',')})`;

export function installCharacterSurfaces(model, faceName='ronin') {
  const meshes=[];model.traverse(node=>{if(node.isMesh)meshes.push(node);});
  model.updateMatrixWorld(true);
  const inverse=new T.Matrix4().copy(model.matrixWorld).invert(),materials=new Set(),shells=[];
  const face=FACES[faceName];
  if(!face)throw new Error(`Unknown character face ${faceName}`);
  const eye=new T.Vector3(...face.eye);
  // A little bloom without a post pass: an inflated additive shell round each
  // whisker that lights only where the sun glints along it, in direct sun.
  const halo=new T.ShaderMaterial({uniforms:{uSun:style.sun},transparent:true,depthWrite:false,blending:T.AdditiveBlending,
    vertexShader:`varying vec3 vNormalWorld;varying vec3 vToCamera;varying vec3 vWorld;
      void main(){vec4 world=modelMatrix*vec4(position+normal*.006,1.);vWorld=world.xyz;vNormalWorld=normalize(mat3(modelMatrix)*normal);
        vToCamera=normalize(cameraPosition-world.xyz);gl_Position=projectionMatrix*viewMatrix*world;}`,
    fragmentShader:`uniform vec3 uSun;varying vec3 vNormalWorld;varying vec3 vToCamera;varying vec3 vWorld;
      void main(){vec3 n=normalize(vNormalWorld);float glint=pow(max(dot(n,normalize(uSun+vToCamera)),0.),14.);
        float sun=actorSunLight(vWorld)*cloudObjectLight(vWorld,uSun)*scenerySunLight(vWorld,n);
        float core=pow(max(dot(n,vToCamera),0.),2.);gl_FragColor=vec4(vec3(1.,.97,.9)*glint*core*.55*sun,1.);}`});
  halo.onBeforeCompile=sunShadowShader;
  materials.add(halo);
  // Fur fog (the original model's ear_haze): nested haze shells round the ear's
  // root read as a soft volume -- dense where the shell faces the eye, fading
  // to nothing at its silhouette, broken up by noise -- hiding where the ear
  // leaves the hat.
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
    const length=part==='head' ? .013 : part==='cat_tail' || part.startsWith('cheek') ? .014 : /^chest_ruff/.test(part) ? .02 : .009;
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
        // The renderer's own sun shadow already darkens directDiffuse/Specular for
        // scenery. Light added after it (ear glow, rim, glints) must apply that
        // same scene sun map itself, so it shows only in direct sun, not in shade.
        shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
          float sunlight=actorSunLight(vSunPlace)*cloudObjectLight(vSunPlace,uSun);reflectedLight.directDiffuse*=sunlight;reflectedLight.directSpecular*=sunlight;
          float directSun=sunlight*scenerySunLight(vSunPlace,normalize((vec4(normal,0.)*viewMatrix).xyz));`);
        shader.uniforms.uCoatRest={value:rest};shader.uniforms.uCoatScale={value:scale};shader.uniforms.uCoatEye={value:eye};
        // Longer fur round the jowls and under the jaw, in rest coordinates, so
        // his cheeks and throat read fluffy at their edges.
        shader.vertexShader=`varying vec2 vCoatUv; varying vec3 vCoatRest; uniform mat4 uCoatRest; uniform vec3 uCoatScale;
          float furReach(vec3 p){${face.reach?`
            float jowl=smoothstep(.15,.24,abs(p.x))*smoothstep(1.06,1.16,p.y)*(1.-smoothstep(1.26,1.34,p.y))*smoothstep(-.05,.08,p.z);
            float throat=smoothstep(1.0,1.06,p.y)*(1.-smoothstep(1.1,1.16,p.y))*smoothstep(.0,.08,p.z)*(1.-smoothstep(.12,.2,abs(p.x)));
            return 1.+1.3*jowl+.9*throat;`:'return 1.;'}}
`+shader.vertexShader;
        shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
          vCoatUv=uv;vCoatRest=(uCoatRest*vec4(position,1.)).xyz;
          ${layer?`transformed+=normal*${(length*layer).toFixed(6)}*furReach(vCoatRest)/max(uCoatScale,vec3(.001));`:''}`);
        shader.fragmentShader='varying vec2 vCoatUv; varying vec3 vCoatRest; uniform vec3 uCoatEye;\n'+FIBRES+shader.fragmentShader;
        shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
          ${fur?`float grain=hairHash(floor(vCoatUv*vec2(880.,560.)));
            diffuseColor.rgb*=mix(.96,1.04,grain);`:''}
          ${layer?`if(length((vCoatRest-uCoatEye)/${vec3(face.eyeRadii)})<1.&&vCoatRest.z>${face.eyeFront.toFixed(3)})discard;
            ${face.bare.map(([centre,radii])=>`if(length((vCoatRest-${vec3(centre)})/${vec3(radii)})<1.)discard;`).join('\n            ')}
            float cover=hairCoverage(vCoatUv,${layer.toFixed(2)});if(cover<.35)discard;
            diffuseColor.rgb*=${(.92+.16*layer).toFixed(3)};`:''}
        `);
        // Whiskers are glassy keratin: a hard glint along each one in the sun.
        if(name==='whisker')shader.fragmentShader=shader.fragmentShader.replace(/(float directSun=[^\n]*)/,`$1
          vec3 sunView=normalize((viewMatrix*vec4(uSun,0.)).xyz);
          float glint=pow(max(dot(normal,normalize(sunView+normalize(vViewPosition))),0.),40.);
          reflectedLight.directSpecular+=vec3(glint*3.5*directSun);`);
        // Ears are thin: low sun behind one glows warm through it, strongest
        // where the pinna is thinnest, toward the tip.
        if(/^ear/.test(part))shader.fragmentShader=shader.fragmentShader.replace(/(float directSun=[^\n]*)/,`$1
          float backlit=pow(clamp(dot(normalize(vSunPlace-cameraPosition),uSun),0.,1.),3.);
          reflectedLight.directDiffuse+=vec3(1.,.42,.30)*backlit*directSun*${(EAR_GLOW*(name==='ear_skin'?1.1:.55)).toFixed(3)};`);
        // Fur catches the sun at grazing angles, as a rim along his silhouette.
        if(fur)shader.fragmentShader=shader.fragmentShader.replace(/(float directSun=[^\n]*)/,`$1
          float furRim=pow(1.-clamp(dot(normal,normalize(vViewPosition)),0.,1.),3.);
          reflectedLight.indirectDiffuse+=diffuseColor.rgb*furRim*.06*directSun;`);
        if(knit||cloth)shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
          float weave=sin(vCoatUv.x*900.)*sin(vCoatUv.y*760.);
          float detail=1.-smoothstep(.12,.5,length(fwidth(vCoatUv*vec2(900.,760.))));
          vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition),rx=cross(dy,normal),ry=cross(normal,dx);
          float det=dot(dx,rx)*faceDirection;
          normal=normalize(abs(det)*normal-sign(det)*(dFdx(weave)*rx+dFdy(weave)*ry)*.00013*detail);`);
      };
      material.customProgramCacheKey=()=>`ronin-fibre-v2:${faceName}:${name}:${layer}:${length}`;
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

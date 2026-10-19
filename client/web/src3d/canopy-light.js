/** Thin dyed fabric lighting. Independent of the wing's geometry/deformation. */
import {style} from './style.js';

export function applyCanopyLighting(material) {
  const previous=material.onBeforeCompile;
  const previousKey=material.customProgramCacheKey();
  material.onBeforeCompile=shader=>{
    previous(shader);
    shader.uniforms.uCanopyEffects=style.sunEffects;
    shader.uniforms.uCanopyWarmth=style.warmth;
    shader.vertexShader='varying vec3 vCloth;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCloth=position;');
    shader.fragmentShader='varying vec3 vCloth; uniform float uCanopyEffects,uCanopyWarmth;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>', `
      float sail=smoothstep(2.6,3.1,vCloth.y);
      float detail=1.-smoothstep(.008,.035,max(length(dFdx(vCloth)),length(dFdy(vCloth))));
      float weave=sin(vCloth.x*240.)*sin(vCloth.z*240.)*.025;
      outgoingLight*=1.+weave*detail*sail;
      // normal faces the viewer on either side of the double-sided cloth.
      // Light must enter its opposite side, and continue toward the viewer.
      vec3 clothNormal=inverseTransformDirection(normal,viewMatrix);
      vec3 throughRay=normalize(vPlace-cameraPosition);
      float alignment=smoothstep(.35,.94,dot(throughRay,uSun));
      float incidence=smoothstep(.04,.65,-dot(clothNormal,uSun));
      // Dark reinforcement absorbs instead of turning into a luminous stripe.
      float dye=smoothstep(.08,.42,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)));
      vec3 transmitted=mix(vec3(1.,.83,.52),vec3(1.22,.65,.22),uCanopyWarmth);
      outgoingLight+=diffuseColor.rgb*transmitted*alignment*incidence*.85*sail*dye*uCanopyEffects;
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=>`${previousKey}:canopy-light-v2`;
  return material;
}

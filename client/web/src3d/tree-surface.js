/** Shared browser tree light: stable leaf normals, scene light colors and
 * optional world shadows. Atlas captures keep only static surface lighting. */
import * as T from '../vendor/three.module.min.js';
import {TREE_WOOD_GLSL} from './tree-lighting.js';
import {FOREST_FIELD_GLSL,forestUniforms} from './forest-field.js';
const referenceLight={sun:new T.Color('#fff1d3'),fill:new T.Color('#dcebf3'),ground:new T.Color('#7d8064')};
export const treeLighting={sun:{value:new T.Vector3(1,1,1)},fill:{value:new T.Vector3(1,1,1)},ground:{value:new T.Vector3(1,1,1)}};
export function setTreeLighting({sun='#fff1d3',fill='#dcebf3',ground='#7d8064',intensity=2.3,ambient=2.1}={}){
  for(const [key,hex]of Object.entries({sun,fill,ground})){const color=new T.Color(hex),base=referenceLight[key],scale=key==='sun'?intensity/2.3:ambient/2.1;treeLighting[key].value.set(color.r/base.r,color.g/base.g,color.b/base.b).multiplyScalar(scale);}
}
export const treeLightingKey=()=>Object.values(treeLighting).flatMap(u=>u.value.toArray().map(v=>v.toFixed(4))).join(',');
export function createTreeSurface(recipe,{sun,shadowShader=null,interval='studyInterval',sprayMap=null,palette=['#294b37','#3f6a47','#648658'].map(c=>new T.Color(c).toArray()),inspection=false,mask=false}={}) {
  const material=new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide,fog:!inspection&&!mask,alphaToCoverage:Boolean(sprayMap)});
  if(inspection||mask)material.toneMapped=false;
  material.defaultAttributeValues={[interval]:[0,1],leafKind:[0],canopyAO:[1]};
  material.onBeforeCompile=shader=>{
    shadowShader?.(shader);Object.assign(shader.uniforms,forestUniforms());
    if(sprayMap){shader.uniforms.uTreeSprayMap={value:sprayMap};shader.uniforms.uTreePalette={value:palette.map(rgb=>new T.Vector3(...rgb))};shader.uniforms.uTreeCutoff={value:recipe.sprayCutoff??.3};}
    Object.assign(shader.uniforms,{uTreeSun:sun,uTreeSunTint:treeLighting.sun,uTreeSkyTint:treeLighting.fill,uTreeGroundTint:treeLighting.ground,uTreeBands:{value:recipe.toonBands},uTreeRim:{value:recipe.rimStrength},
      uTreeOcclusion:{value:recipe.canopyShade},uTreeTransmission:{value:recipe.transmission*Math.exp((.4-recipe.leafThickness)*1.4)}});
    shader.vertexShader=`attribute float leafKind,canopyAO;attribute vec2 ${interval};varying float vTreeLeaf,vTreeAO;varying vec2 vTreeInterval,vTreeUV;varying vec3 vTreeNormal,vTreeWorld,vTreeLocal;\n`+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      mat4 treeWorld=modelMatrix;
      #ifdef USE_INSTANCING
      treeWorld*=instanceMatrix;
      #endif
      vTreeLocal=position;vTreeLeaf=leafKind;vTreeAO=canopyAO;vTreeInterval=${interval};vTreeUV=uv;
      mat3 basis=mat3(treeWorld);
      vTreeNormal=normalize(cross(basis[1],basis[2])*normal.x+cross(basis[2],basis[0])*normal.y+cross(basis[0],basis[1])*normal.z);vTreeWorld=(treeWorld*vec4(position,1.)).xyz;
    `);
    shader.fragmentShader=(sprayMap?'uniform sampler2D uTreeSprayMap;uniform vec3 uTreePalette[3];uniform float uTreeCutoff;\n':'')+'uniform vec3 uTreeSun,uTreeSunTint,uTreeSkyTint,uTreeGroundTint;uniform float uTreeBands,uTreeRim,uTreeOcclusion,uTreeTransmission;varying float vTreeLeaf,vTreeAO;varying vec2 vTreeInterval,vTreeUV;varying vec3 vTreeNormal,vTreeWorld,vTreeLocal;\n'+FOREST_FIELD_GLSL+TREE_WOOD_GLSL+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      ${sprayMap?`if(vTreeLeaf>1.5){vec4 spray=texture2D(uTreeSprayMap,vTreeUV);float alpha=spray.a;
        // The source PNG carries the original canonical redwood colors.
        // Remap its monotone green channel onto this species' exact three
        // original material colors, including the occupied village palette.
        float tone=spray.g;
        diffuseColor.rgb=diffuse*(tone<.14412847?mix(uTreePalette[0],uTreePalette[1],clamp((tone-.07036010)/(.14412847-.07036010),0.,1.)):
          mix(uTreePalette[1],uTreePalette[2],clamp((tone-.14412847)/(.23839757-.14412847),0.,1.)));
        float cutoff=uTreeCutoff,edge=max(fwidth(alpha),.025);diffuseColor.a=smoothstep(cutoff-edge,cutoff+edge,alpha);
        if(alpha<cutoff)discard;}`:''}
      float threshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(threshold<vTreeInterval.x||threshold>=vTreeInterval.y)discard;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      // Leaf normals describe the physical spray orientation. Keep them
      // independent of which side the camera sees, as the previous foliage
      // shader did. Only opaque wood uses the face-corrected normal.
      vec3 N=normalize(vTreeNormal)*(vTreeLeaf>.5?1.:(gl_FrontFacing?1.:-1.)),V=normalize(cameraPosition-vTreeWorld),L=normalize(uTreeSun);
      float diffuse=dot(N,L)*.5+.5,scaled=diffuse*(uTreeBands-1.);
      float bands=(floor(scaled)+smoothstep(.36,.64,fract(scaled)))/(uTreeBands-1.);
      float ao=mix(1.,vTreeAO,uTreeOcclusion),through=pow(max(0.,dot(-V,L)),5.);
      float rim=pow(1.-abs(dot(N,V)),2.5)*smoothstep(-.1,.65,dot(N,L));
      vec3 fill=mix(uTreeGroundTint,uTreeSkyTint,N.y*.5+.5);
      // Broad, continuous leaf response keeps fine sprays from banding.
      float diffuseLight=mix(diffuse,bands,.18);
      float sunlight=${shadowShader?'cloudObjectLight(vTreeWorld,L)*actorSunLight(vTreeWorld)':'1.'};
      vec3 leafLight=fill*vec3(.25,.32,.34)*ao+uTreeSunTint*(.10+.95*diffuseLight)*ao;
      float transmission=through*(.3+.7*abs(dot(N,L)))*mix(.35,1.,ao);
      outgoingLight=diffuseColor.rgb*(leafLight+uTreeSunTint*vec3(1.08,1.18,.65)*uTreeTransmission*transmission*.85+
        rim*uTreeRim*.08*uTreeSunTint)*mix(.60,1.,sunlight);
      if(vTreeLeaf<.5)outgoingLight=treeWoodLight(diffuseColor.rgb,vTreeLocal,vTreeWorld,N,L,uTreeSunTint,uTreeSkyTint,uTreeGroundTint,sunlight*${shadowShader?'forestCanopyLight(vTreeWorld)':'1.'},ao);
      ${mask?'outgoingLight=vec3(0.);':inspection?'outgoingLight=vTreeLeaf>.5?vec3(0.,1.,0.):vec3(1.,0.,0.);':''}
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey=()=> `tree-surface-v5-${interval}-${Boolean(shadowShader)}-${Boolean(sprayMap)}-${inspection}-${mask}`;
  if(!mask)material.studioMaskMaterial=createTreeSurface(recipe,{sun,shadowShader,interval,sprayMap,palette,mask:true});
  return material;
}

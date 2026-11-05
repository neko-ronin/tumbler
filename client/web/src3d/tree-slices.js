/** Spatial slices of the same source, with an independent bole.
 * Captures are clipped into slabs in the source frame. Camera movement never
 * rotates or lifts a whole tree about its bounding-box centre. */
import * as T from '../vendor/three.module.min.js';
import {TREE_ATLAS_GLSL,treeAtlasMaxMip} from './tree-atlas.js';
import {style,sunShadowShader} from './style.js';
import {updateTreeSunShadow} from './tree-shadows.js';
import {retainWood} from '../../../shared/geometry/tree-design/card-clusters.js';
import {clusteredTreeGeometry} from './forest.js';
import {treeLighting} from './tree-surface.js';
import {TREE_WOOD_GLSL} from './tree-lighting.js';
import {forestUniforms,FOREST_FIELD_GLSL} from './forest-field.js';
import {treeCaptureRect} from './tree-capture.js';
export function bakeTreeSlices(renderer,source,sourceMaterial,settings){
 const layers=settings.layers??12,resolution=settings.resolution??128,views=6,total=views*layers;
 if(!Number.isInteger(layers)||layers<1||layers>32||![64,128,256].includes(resolution))throw Error('Tree slices require 1–32 layers and 64/128/256 texels');
 const target=new T.WebGLArrayRenderTarget(resolution,resolution,total,{depthBuffer:false}),texture=target.texture;
 texture.colorSpace=T.LinearSRGBColorSpace;texture.generateMipmaps=true;texture.minFilter=T.LinearMipmapLinearFilter;texture.magFilter=T.LinearFilter;
 renderer.initRenderTarget(target);texture.generateMipmaps=false;
 const scratch=new T.WebGLRenderTarget(resolution,resolution,{samples:4});
 scratch.texture.colorSpace=T.LinearSRGBColorSpace;
 // A renderer-owned target recreates its framebuffer after graphics loss.
 // r180's copyTextureToTexture caches scratch framebuffers across that loss.
 const copyScene=new T.Scene(),copyCamera=new T.Camera(),copyGeometry=new T.PlaneGeometry(2,2),copyMaterial=new T.ShaderMaterial({
  uniforms:{uCapture:{value:scratch.texture}},depthTest:false,depthWrite:false,toneMapped:false,
  vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
  fragmentShader:'uniform sampler2D uCapture;varying vec2 vUv;void main(){gl_FragColor=texture2D(uCapture,vUv);}'
 });copyScene.add(new T.Mesh(copyGeometry,copyMaterial));
 const leaf=[],wood=[];for(let i=0;i<source.index.count;i+=3){const ids=[0,1,2].map(j=>source.index.getX(i+j));(ids.some(id=>source.attributes.leafKind.getX(id)>.5)?leaf:wood).push(...ids);}
 const kept=retainWood(source.attributes.position.array,new Uint32Array(wood),3072),retainedFaces=new Set();
 for(let i=0;i<kept.indices.length;i+=3)retainedFaces.add(kept.indices.slice(i,i+3).join(','));
 const crown=[...leaf];for(let i=0;i<wood.length;i+=3)if(!retainedFaces.has(wood.slice(i,i+3).join(',')))crown.push(wood[i],wood[i+1],wood[i+2]);
 const capture=source.clone();capture.setIndex(crown);capture.computeBoundingBox();
 const box=new T.Box3(),point=new T.Vector3();for(const id of crown)box.expandByPoint(point.fromBufferAttribute(source.attributes.position,id));
 const size=box.getSize(new T.Vector3()),centre=box.getCenter(new T.Vector3()),positions=[],uv=[],tiles=[],choices=[];
 const scene=new T.Scene(),mesh=new T.Mesh(capture,sourceMaterial);scene.add(mesh);sourceMaterial.defaultAttributeValues={...sourceMaterial.defaultAttributeValues,forestInterval:[0,1]};
 const camera=new T.OrthographicCamera(-1,1,1,-1,.1,2000),clipA=new T.Plane(),clipB=new T.Plane();
 const previous={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new T.Vector4()),scissor:renderer.getScissor(new T.Vector4()),scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new T.Color()),alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear,localClippingEnabled:renderer.localClippingEnabled,planes:sourceMaterial.clippingPlanes};
 let captured=false;
 try{
 renderer.localClippingEnabled=true;sourceMaterial.clippingPlanes=[clipA,clipB];sourceMaterial.needsUpdate=true;
 renderer.setRenderTarget(scratch);treeCaptureRect(renderer,0,0,resolution,resolution);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.autoClear=false;
 for(let axis=0;axis<3;axis++){
  const right=new T.Vector3(...[[1,0,0],[0,0,-1],[1,0,0]][axis]),up=new T.Vector3(...[[0,1,0],[0,1,0],[0,0,-1]][axis]),normal=new T.Vector3().crossVectors(right,up),depthAxis=[2,0,1][axis];
  const width=(axis===1?size.z:size.x)*1.06,height=(axis===2?size.z:size.y)*1.06;
  Object.assign(camera,{left:-width/2,right:width/2,top:height/2,bottom:-height/2});camera.up.copy(up);camera.updateProjectionMatrix();
  for(let layer=0;layer<layers;layer++){
   const low=box.min.getComponent(depthAxis)+size.getComponent(depthAxis)*layer/layers,high=box.min.getComponent(depthAxis)+size.getComponent(depthAxis)*(layer+1)/layers;
   const at=centre.clone().setComponent(depthAxis,(low+high)/2),basis=new T.Vector3().setComponent(depthAxis,1);
   clipA.set(basis,-low);clipB.set(basis.clone().negate(),high);
   for(let sign=0;sign<2;sign++){
    camera.position.copy(centre).addScaledVector(normal,sign?-1000:1000);camera.lookAt(centre);camera.updateMatrixWorld();
    const tile=(axis*2+sign)*layers+layer;
    renderer.setRenderTarget(scratch);renderer.clear();renderer.render(scene,camera);renderer.setRenderTarget(null);
    if(tile===total-1)texture.generateMipmaps=true;
    renderer.setRenderTarget(target,tile);renderer.render(copyScene,copyCamera);
   }
   for(const [u,v]of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){
    positions.push(...at.clone().addScaledVector(right,(u-.5)*width).addScaledVector(up,(v-.5)*height).toArray());uv.push(u,v);tiles.push(axis*2*layers+layer);choices.push(axis);
   }
  }
 }
 captured=true;
 }finally{sourceMaterial.clippingPlanes=previous.planes;sourceMaterial.needsUpdate=true;renderer.localClippingEnabled=previous.localClippingEnabled;renderer.setRenderTarget(previous.target);renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);renderer.setClearColor(previous.color,previous.alpha);renderer.autoClear=previous.autoClear;capture.dispose();scratch.dispose();copyGeometry.dispose();copyMaterial.dispose();if(!captured)target.dispose();}
 // Cluster only wood, never alpha carriers. Its base stays in the source frame.
 const woodGeometry=source.clone();woodGeometry.setIndex(new T.BufferAttribute(kept.indices,1));
 // Compact first: unused source foliage must not affect the clustering cells.
 const raw=woodGeometry.toNonIndexed();raw.computeBoundingBox();const compact=clusteredTreeGeometry(raw,settings.woodTriangles??700,{minCell:Math.max(.12,size.y*.012),lockBelow:raw.boundingBox.min.y+.01});woodGeometry.dispose();raw.dispose();
 const p=compact.geometry.attributes.position,c=compact.geometry.attributes.color;
 for(let i=0;i<compact.geometry.index.count;i++){const id=compact.geometry.index.getX(i);positions.push(p.getX(id),p.getY(id),p.getZ(id));uv.push(0,0);tiles.push(-1);choices.push(-1);}
 const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geometry.setAttribute('sliceTile',new T.Float32BufferAttribute(tiles,1));geometry.setAttribute('sliceAxis',new T.Float32BufferAttribute(choices,1));
 // Reuse the ordinary tree surface for independent wood to keep scene lighting.
 const woodStart=layers*3*6,colors=new Float32Array(positions.length).fill(1),normals=new Float32Array(positions.length);
 for(let i=woodStart;i<positions.length/3;i++){const id=compact.geometry.index.getX(i-woodStart);for(let a=0;a<3;a++){colors[i*3+a]=c.getComponent(id,a);normals[i*3+a]=compact.geometry.attributes.normal.getComponent(id,a);}}
 geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.setAttribute('normal',new T.BufferAttribute(normals,3));geometry.computeBoundingBox();geometry.computeBoundingSphere();compact.geometry.dispose();
 // Share only complete, identical attribute tuples. Expanded triangles retain
 // their order and every value; adjacent slabs and wood normals stay separate.
 const attributes=Object.entries(geometry.attributes),unique=new Map(),remap=[],packed=attributes.map(()=>[]);
 for(let i=0;i<geometry.attributes.position.count;i++){
  const values=attributes.flatMap(([,a])=>Array.from({length:a.itemSize},(_,c)=>a.getComponent(i,c))),key=values.join(',');let id=unique.get(key);
  if(id===undefined){id=unique.size;unique.set(key,id);let offset=0;attributes.forEach(([,a],j)=>{packed[j].push(...values.slice(offset,offset+a.itemSize));offset+=a.itemSize;});}
  remap.push(id);
 }
 attributes.forEach(([name,a],i)=>geometry.setAttribute(name,new T.Float32BufferAttribute(packed[i],a.itemSize)));geometry.setIndex(remap);
 const material=new T.MeshBasicMaterial({map:target.texture,vertexColors:true,alphaTest:settings.alphaCutoff??.22,alphaToCoverage:Boolean(settings.coverage),side:T.DoubleSide,toneMapped:false,fog:true});material.onBeforeRender=updateTreeSunShadow;
 material.onBeforeCompile=shader=>{
  sunShadowShader(shader);shader.uniforms.uSliceSun=style.sun;Object.assign(shader.uniforms,forestUniforms(),{uSliceCentre:{value:centre},uTreeRedBark:{value:+Boolean(sourceMaterial.userData.treeRedBark)},uWoodSun:treeLighting.sun,uWoodSky:treeLighting.fill,uWoodGround:treeLighting.ground});
  shader.vertexShader='attribute float sliceTile,sliceAxis;attribute vec2 forestInterval;uniform vec3 uSliceCentre;varying float vSliceTile;varying vec2 vSliceInterval,vSliceRange;varying vec3 vSliceWorld,vWoodNormal,vWoodLocal;\n'+shader.vertexShader;
  shader.fragmentShader=TREE_ATLAS_GLSL+FOREST_FIELD_GLSL+TREE_WOOD_GLSL+'varying float vSliceTile;varying vec2 vSliceInterval,vSliceRange;varying vec3 vSliceWorld,vWoodNormal,vWoodLocal;uniform vec3 uSliceSun,uWoodSun,uWoodSky,uWoodGround;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_pars_fragment>','#ifdef USE_MAP\nuniform highp sampler2DArray map;\n#endif');
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
   vSliceInterval=forestInterval;vSliceWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;vWoodLocal=position;
   mat3 basis=mat3(modelMatrix*instanceMatrix);vWoodNormal=normalize(cross(basis[1],basis[2])*normal.x+cross(basis[2],basis[0])*normal.y+cross(basis[0],basis[1])*normal.z);
   vec3 ray=cameraPosition-(modelMatrix*instanceMatrix*vec4(uSliceCentre,1.)).xyz;
   vec3 localRay=vec3(dot(basis[0],ray)/dot(basis[0],basis[0]),dot(basis[1],ray)/dot(basis[1],basis[1]),dot(basis[2],ray)/dot(basis[2],basis[2]));
   vec3 direction=dot(localRay,localRay)>.000001?normalize(localRay):vec3(0.,0.,1.);
   vec3 weights=abs(direction);weights=smoothstep(vec3(.7),vec3(1.),weights/max(weights.x,max(weights.y,weights.z)));weights/=weights.x+weights.y+weights.z;
   vSliceRange=sliceAxis<.5?vec2(0.,weights.z):sliceAxis<1.5?vec2(weights.z,weights.z+weights.x):vec2(weights.z+weights.x,1.);
   float side=sliceAxis<.5?direction.z:sliceAxis<1.5?direction.x:direction.y;
   vSliceTile=sliceTile<0.?-1.:vSliceRange.y>vSliceRange.x?sliceTile+step(side,0.)*${layers.toFixed(1)}:-2.;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
   if(vSliceTile< -1.5)discard;
   if(vSliceTile>=0.){
    float axisChoice=fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189);if(axisChoice<vSliceRange.x||axisChoice>=vSliceRange.y)discard;
    vec2 sampleUv=vec2(gl_FrontFacing?vMapUv.x:1.-vMapUv.x,vMapUv.y);
    float lod=treeAtlasLod(sampleUv,${resolution.toFixed(1)},${Math.max(0,treeAtlasMaxMip(resolution)-3).toFixed(1)});
    vec4 leaf=textureLod(map,vec3(sampleUv,vSliceTile),lod);leaf.rgb/=max(.001,leaf.a);diffuseColor*=leaf;
   }
  `);
  shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\nif(vSliceTile< -1.5)gl_Position=vec4(2.,2.,2.,1.);');
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`${settings.coverage?'if(diffuseColor.a<alphaTest)discard;':'#include <alphatest_fragment>'}
   float choice=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));if(choice<vSliceInterval.x||choice>=vSliceInterval.y)discard;
  `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`float sunlight=cloudObjectLight(vSliceWorld,uSliceSun)*actorSunLight(vSliceWorld)*scenerySunLight(vSliceWorld,normalize(uSliceSun));
   if(vSliceTile>=0.)outgoingLight*=mix(.6,1.,sunlight);
   else outgoingLight=treeWoodLight(diffuseColor.rgb,vWoodLocal,vSliceWorld,normalize(vWoodNormal)*(gl_FrontFacing?1.:-1.),normalize(uSliceSun),uWoodSun,uWoodSky,uWoodGround,sunlight*forestCanopyLight(vSliceWorld),1.);\n#include <opaque_fragment>`);
 };
 material.customProgramCacheKey=()=>`tree-slices-v2-${layers}-${resolution}-${Boolean(settings.coverage)}`;
 return {geometry,material,target,textureBytes:total*resolution*resolution*4*4/3,detail:{layers,triangles:positions.length/9,woodTriangles:compact.triangles,captureViews:total,sourceTriangles:source.index.count/3,capturedTriangles:crown.length/3,retainedWoodTriangles:kept.indices.length/3},dispose(){geometry.dispose();material.dispose();target.dispose();}};
}

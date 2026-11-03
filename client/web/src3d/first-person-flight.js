/** Bounded browser interpretation of the shared close-body recipe. Uses the
 * ordinary world depth/light/cloud pipeline, never a camera-overlay scene. */
import * as T from '../vendor/three.module.min.js';
import {toonMaterial,style} from './style.js';
import {resolveFirstPersonDesign,generateFirstPerson,firstPersonPose} from '../../../shared/geometry/first-person/recipe.js';
import {controlGrip} from '../../../shared/geometry/flight/contacts.js';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export function createFirstPersonFlight(config,{compile=async()=>{}}={}){
 const group=new T.Group();group.name='procedural_first_person';group.visible=false;group.matrixAutoUpdate=false;
 const flow={value:new T.Vector3()},matrix=new T.Matrix4(),position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3(),inverse=new T.Matrix4(),hip=new T.Vector3(0,.65,0);
 let selected=resolveFirstPersonDesign(config);
 let model=null,requested=null,sequence=0,disposed=false,pending=null,warming=false,lastActive=false,lastView='chase';
 const stats={builds:0,updates:0,parts:0,triangles:0,lastBuildMs:0,lastUpdateMs:0,status:'unrequested'};
 function release(m){if(!m)return;group.remove(m.root);for(const mesh of m.meshes){mesh.material.dispose();mesh.dispose?.();}for(const geometry of m.geometries)geometry.dispose();}
 function material(channel,source,layer=0){
  const color=new T.Color(source.base).multiply(new T.Color(source.tint)),m=toonMaterial({color},{}),original=m.onBeforeCompile;
  m.onBeforeCompile=shader=>{original(shader);shader.uniforms.uCloseFlow=flow;shader.uniforms.uCloseTime=style.time;shader.uniforms.uClosePlaid={value:source.pattern==='plaid'?1:0};
   shader.vertexShader=(channel==='coat'?'attribute vec3 closeOrigin;\n':'')+'varying vec3 vCloseCoat;varying vec2 vCloseUv;uniform vec3 uCloseFlow;uniform float uCloseTime;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vCloseUv=uv;vCloseCoat=${channel==='knit'?'position':'(instanceMatrix*vec4(position,1.)).xyz'}${channel==='coat'?'-closeOrigin':''};
    ${layer?`vec3 sz=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
     vec3 f=vec3(dot(uCloseFlow,instanceMatrix[0].xyz/sz.x),dot(uCloseFlow,instanceMatrix[1].xyz/sz.y),dot(uCloseFlow,instanceMatrix[2].xyz/sz.z));
     transformed+=(normal*${(.003*layer).toFixed(5)}+f*${(.0015*layer*layer).toFixed(5)})/max(sz,vec3(.001));`:''}`);
   shader.fragmentShader='varying vec3 vCloseCoat;varying vec2 vCloseUv;uniform float uClosePlaid;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    ${channel==='coat'?`vec3 p=vCloseCoat;float stripe=sin(p.y*57.+p.z*22.+sin(p.x*31.+p.z*17.)*1.3);float dorsal=smoothstep(-.20,-.10,p.z);diffuseColor.rgb*=mix(1.,mix(.76,1.03,smoothstep(-.45,.35,stripe)),dorsal);`:''}
    ${layer?`vec2 fibre=vCloseUv*vec2(115.,76.),cell=floor(fibre),at=fract(fibre)-.5;float hair=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);at.x+=(hair-.5)*.3;float strand=length(at/vec2(${(.25-layer*.08).toFixed(3)},.65)),aa=max(.08,fwidth(strand));if((1.-smoothstep(1.-aa,1.+aa,strand))*step(${(layer*.6).toFixed(3)},hair)<.35)discard;`:''}
    ${channel==='knit'?`diffuseColor.rgb*=mix(1.,mix(.45,1.,mod(floor(vCloseUv.x*12.)+floor(vCloseUv.y*12.),2.)),uClosePlaid);`:''}
    ${channel==='knit'||channel==='cloth'?`vec2 rib=vCloseUv*vec2(${channel==='knit'?'95.,72.':'85.,115.'});float detail=1.-smoothstep(.5,1.5,length(fwidth(rib)));diffuseColor.rgb*=1.-detail*.10*(.5+.5*sin(rib.x*6.283));`:''}`);
  };m.customProgramCacheKey=()=>`fp-v2:${channel}:${layer}`;return m;
 }
 async function request(design){
  if(design.key===requested)return pending;
  requested=design.key;const token=++sequence;stats.status=design.supported?'building':design.reason;
  if(!design.supported){release(model);model=null;return;}
  pending=(async()=>{
   const start=performance.now();await pause();if(token!==sequence||disposed)return;
   const recipe=generateFirstPerson(design);await pause();if(token!==sequence||disposed)return;
   const makeGeometry=g=>{const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(g.positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(g.normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(g.uv,2));geometry.setIndex(g.indices);return geometry;};
   const geometry=makeGeometry(recipe.geometry),geometries=[geometry];
   const root=new T.Group(),body=new T.Group(),gear=new T.Group();root.add(body,gear);
   const initial=firstPersonPose(recipe,{mode:'parakite'},[controlGrip({mode:'parakite'},1),controlGrip({mode:'parakite'},-1)]),meshes=[],channels={};
   for(const [channel,source]of Object.entries(recipe.materials)){
    const count=initial.parts.filter(p=>p.material===channel).length,layers=channel==='coat'?[0,.5,1]:[0];channels[channel]=[];
    for(const layer of layers){
     let mesh;
     if(channel==='knit'){
      const source=recipe.geometries.knit,joined=new T.BufferGeometry(),vertices=source.positions.length/3;
      joined.setAttribute('position',new T.Float32BufferAttribute(new Float32Array(count*vertices*3),3).setUsage(T.DynamicDrawUsage));joined.setAttribute('normal',new T.Float32BufferAttribute(new Float32Array(count*vertices*3),3).setUsage(T.DynamicDrawUsage));joined.setAttribute('uv',new T.Float32BufferAttribute(Array.from({length:count},()=>source.uv).flat(),2));joined.setIndex(Array.from({length:count},(_,i)=>source.indices.map(n=>n+i*vertices)).flat());
      geometries.push(joined);mesh=new T.Mesh(joined,material(channel,recipe.materials[channel],layer));
     }else mesh=new T.InstancedMesh(geometry,material(channel,source,layer),count);
     mesh.name=`fp_${channel}_${layer}`;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;if(mesh.isInstancedMesh)mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);(channel==='webbing'?gear:body).add(mesh);meshes.push(mesh);channels[channel].push(mesh);
    }
   }
   geometry.setAttribute('closeOrigin',new T.InstancedBufferAttribute(new Float32Array(initial.parts.filter(p=>p.material==='coat').length*3),3).setUsage(T.DynamicDrawUsage));
   const next={recipe,geometry,geometries,root,body,gear,channels,meshes};
   fill(initial,next);try{await compile(root);}catch(error){release(next);if(token===sequence)stats.status='failed';throw error;}
   if(token!==sequence||disposed){release(next);return;}
   release(model);model=next;group.add(root);stats.builds++;stats.parts=initial.parts.length;stats.triangles=meshes.reduce((s,m)=>s+(m.count??1)*m.geometry.index.count/3,0);stats.lastBuildMs=performance.now()-start;stats.status='ready';
   fill(initial);
  })();return pending;
 }
 function fill(pose,target=model){
  target.geometry.attributes.closeOrigin.needsUpdate=true;const counts={};
  for(const part of pose.parts){const at=counts[part.material]??0;
   for(const mesh of target.channels[part.material]){
    if(part.surface){const g=part.surface;mesh.geometry.attributes.position.array.set(g.positions,at*g.positions.length);mesh.geometry.attributes.normal.array.set(g.normals,at*g.normals.length);}
    else {position.fromArray(part.position);rotation.fromArray(part.quaternion);scale.fromArray(part.scale);matrix.compose(position,rotation,scale);if(part.patternOrigin)target.geometry.attributes.closeOrigin.setXYZ(at,...part.patternOrigin);mesh.setMatrixAt(at,matrix);}
   }counts[part.material]=at+1;
  }
  for(const channel of Object.keys(counts))for(const mesh of target.channels[channel])if(mesh.isInstancedMesh)mesh.instanceMatrix.needsUpdate=true;else {mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.attributes.normal.needsUpdate=true;}
 }

 function update({active,view,pilotMatrix,pilotScale=1,state,grips,air,velocity}){
  lastActive=!!active;lastView=view??lastView;if(!active||!model||model.recipe.key!==requested){group.visible=warming&&!!model;stats.lastUpdateMs=0;return;}
  const start=performance.now();group.visible=true;model.body.visible=view==='first';
  // Scale about the real hip: the small-character option cannot move its pickup.
  group.matrix.copy(pilotMatrix);matrix.makeTranslation(hip.x*(1-pilotScale),hip.y*(1-pilotScale),hip.z*(1-pilotScale));group.matrix.multiply(matrix).scale(scale.setScalar(pilotScale));group.matrixWorldNeedsUpdate=true;group.updateMatrixWorld(true);inverse.copy(group.matrixWorld).invert();
  const local=grips.map(p=>position.copy(p).applyMatrix4(inverse).toArray());
  fill(firstPersonPose(model.recipe,state,local,style.time.value,{body:view==='first'}));
  const v=velocity??[0,0,0];flow.value.set((air?.wx??0)-v[0],(air?.lift??0)-v[2],-((air?.wy??0)-v[1]));rotation.setFromRotationMatrix(pilotMatrix).invert();flow.value.applyQuaternion(rotation).multiplyScalar(1/35).clampLength(0,1);
  stats.updates++;stats.lastUpdateMs=performance.now()-start;
 }
 return {group,stats,request,update,get ready(){return !!model&&model.recipe.key===requested;},get eye(){return selected.supported?selected.anatomy.eye:null;},async prewarm(){await request(selected);warming=!!model;group.visible=warming;if(model)model.body.visible=true;},finishWarm(){warming=false;group.visible=lastActive&&!!model;if(model)model.body.visible=lastView==='first';},setDesign(design){selected=resolveFirstPersonDesign({...config,appearance:design});return request(selected);},dispose(){disposed=true;sequence++;release(model);model=null;stats.status='disposed';}};
}

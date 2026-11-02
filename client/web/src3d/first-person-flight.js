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
 function release(m){if(!m)return;group.remove(m.root);for(const mesh of m.meshes){mesh.material.dispose();mesh.dispose();}m.geometry.dispose();}
 function material(channel,source,layer=0){
  const color=new T.Color(source.base).multiply(new T.Color(source.tint)),m=toonMaterial({color},{}),original=m.onBeforeCompile;
  m.onBeforeCompile=shader=>{original(shader);shader.uniforms.uCloseFlow=flow;shader.uniforms.uCloseTime=style.time;shader.uniforms.uClosePlaid={value:source.pattern==='plaid'?1:0};
   shader.vertexShader='varying vec2 vCloseUv;uniform vec3 uCloseFlow;uniform float uCloseTime;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    vCloseUv=uv;
    ${layer?`vec3 sz=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
     vec3 f=vec3(dot(uCloseFlow,instanceMatrix[0].xyz/sz.x),dot(uCloseFlow,instanceMatrix[1].xyz/sz.y),dot(uCloseFlow,instanceMatrix[2].xyz/sz.z));
     transformed+=(normal*${(.010*layer).toFixed(5)}+f*${(.007*layer*layer).toFixed(5)})/max(sz,vec3(.001));`:''}`);
   shader.fragmentShader='varying vec2 vCloseUv;uniform float uClosePlaid;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    ${channel==='coat'?`float stripe=sin(vCloseUv.y*23.+sin(vCloseUv.x*18.)*.7);diffuseColor.rgb*=mix(.72,1.05,smoothstep(-.6,.2,stripe));`:''}
    ${layer?`vec2 fibre=vCloseUv*vec2(115.,76.),cell=floor(fibre),at=fract(fibre)-.5;float hair=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);at.x+=(hair-.5)*.3;float strand=length(at/vec2(${(.25-layer*.08).toFixed(3)},.65)),aa=max(.08,fwidth(strand));if((1.-smoothstep(1.-aa,1.+aa,strand))*step(${(layer*.6).toFixed(3)},hair)<.35)discard;`:''}
    ${channel==='knit'?`diffuseColor.rgb*=mix(1.,mix(.45,1.,mod(floor(vCloseUv.x*12.)+floor(vCloseUv.y*12.),2.)),uClosePlaid);`:''}
    ${channel==='knit'||channel==='cloth'?`vec2 rib=vCloseUv*vec2(${channel==='knit'?'95.,72.':'85.,115.'});float detail=1.-smoothstep(.5,1.5,length(fwidth(rib)));diffuseColor.rgb*=1.-detail*.10*(.5+.5*sin(rib.x*6.283));`:''}`);
  };m.customProgramCacheKey=()=>`fp-v1:${channel}:${layer}`;return m;
 }
 async function request(design){
  if(design.key===requested)return pending;
  requested=design.key;const token=++sequence;stats.status=design.supported?'building':design.reason;
  if(!design.supported){release(model);model=null;return;}
  pending=(async()=>{
   const start=performance.now();await pause();if(token!==sequence||disposed)return;
   const recipe=generateFirstPerson(design);await pause();if(token!==sequence||disposed)return;
   const g=recipe.geometry,geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(g.positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(g.normals,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(g.uv,2));geometry.setIndex(g.indices);
   const root=new T.Group(),body=new T.Group(),gear=new T.Group();root.add(body,gear);
   const initial=firstPersonPose(recipe,{mode:'parakite'},[controlGrip({mode:'parakite'},1),controlGrip({mode:'parakite'},-1)]),meshes=[],channels={};
   for(const [channel,source]of Object.entries(recipe.materials)){
    const count=initial.parts.filter(p=>p.material===channel).length,layers=channel==='coat'?[0,.5,1]:[0];channels[channel]=[];
    for(const layer of layers){const mesh=new T.InstancedMesh(geometry,material(channel,source,layer),count);mesh.name=`fp_${channel}_${layer}`;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);(channel==='webbing'?gear:body).add(mesh);meshes.push(mesh);channels[channel].push(mesh);}
   }
   const next={recipe,geometry,root,body,gear,channels,meshes};
   fill(initial,next);try{await compile(root);}catch(error){release(next);if(token===sequence)stats.status='failed';throw error;}
   if(token!==sequence||disposed){release(next);return;}
   release(model);model=next;group.add(root);stats.builds++;stats.parts=initial.parts.length;stats.triangles=meshes.reduce((s,m)=>s+m.count*g.indices.length/3,0);stats.lastBuildMs=performance.now()-start;stats.status='ready';
   fill(initial);
  })();return pending;
 }
 function fill(pose,target=model){const counts={};for(const part of pose.parts){const at=counts[part.material]??0;position.fromArray(part.position);rotation.fromArray(part.quaternion);scale.fromArray(part.scale);matrix.compose(position,rotation,scale);for(const mesh of target.channels[part.material])mesh.setMatrixAt(at,matrix);counts[part.material]=at+1;}for(const channel of Object.keys(counts))for(const mesh of target.channels[channel])mesh.instanceMatrix.needsUpdate=true;}
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

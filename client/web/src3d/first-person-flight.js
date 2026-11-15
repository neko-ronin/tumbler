/** Bounded browser interpretation of the shared close-body recipe. Uses the
 * ordinary world depth/light/cloud pipeline, never a camera-overlay scene. */
import * as T from '../vendor/three.module.min.js';
import {toonMaterial,style} from './style.js';
import {resolveFirstPersonDesign,generateFirstPerson,firstPersonPose,createSeatedLegSwing} from '../../../shared/geometry/first-person/recipe.js';
import {controlGrip} from '../../../shared/geometry/flight/contacts.js';
const tint=new T.Color();
const surfaceChannel=channel=>channel==='shirt'||channel==='hakama';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
export function createFirstPersonFlight(config,{compile=async()=>{}}={}){
 const group=new T.Group();group.name='procedural_first_person';group.visible=false;group.matrixAutoUpdate=false;
 const flow={value:new T.Vector3()},matrix=new T.Matrix4(),position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3(),inverse=new T.Matrix4(),hip=new T.Vector3(0,.65,0);
 const legs=createSeatedLegSwing(),previousVelocity=new T.Vector3(),acceleration=new T.Vector3(),worldVelocity=new T.Vector3();
 let lastMode=null,hasVelocity=false;
 let selected=resolveFirstPersonDesign(config);
 let model=null,requested=null,sequence=0,disposed=false,pending=null,warming=false,lastActive=false,lastView='chase';
 const stats={builds:0,updates:0,parts:0,triangles:0,lastBuildMs:0,lastUpdateMs:0,status:'unrequested'};
 function release(m){if(!m)return;group.remove(m.root);if(m.screen){m.screen.geometry.dispose();m.screen.material.dispose();m.screenMap.dispose();}for(const mesh of m.meshes){mesh.material.dispose();mesh.dispose?.();}for(const geometry of m.geometries)geometry.dispose();}
 function material(channel,source,layer=0){
  const color=new T.Color(source.base).multiply(new T.Color(source.tint)),m=toonMaterial({color},{}),original=m.onBeforeCompile;
  m.onBeforeCompile=shader=>{original(shader);shader.uniforms.uCloseFlow=flow;
   shader.vertexShader=(surfaceChannel(channel)?'attribute vec3 closeCut; varying vec3 vCloseCut;\n':'')+(channel==='coat'?'attribute vec3 closeOrigin;\n':'')+'varying vec3 vCloseCoat;varying vec2 vCloseUv;uniform vec3 uCloseFlow;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    ${surfaceChannel(channel)?'vCloseCut=closeCut;':''}
    vCloseUv=uv;vCloseCoat=${surfaceChannel(channel)?'position':'(instanceMatrix*vec4(position,1.)).xyz'}${channel==='coat'?'-closeOrigin':''};
    ${layer?`vec3 sz=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
     vec3 f=vec3(dot(uCloseFlow,instanceMatrix[0].xyz/sz.x),dot(uCloseFlow,instanceMatrix[1].xyz/sz.y),dot(uCloseFlow,instanceMatrix[2].xyz/sz.z));
     transformed+=(normal*${(.003*layer).toFixed(5)}+f*${(.0015*layer*layer).toFixed(5)})/max(sz,vec3(.001));`:''}`);
   shader.fragmentShader=(surfaceChannel(channel)?'varying vec3 vCloseCut;\n':'')+'varying vec3 vCloseCoat;varying vec2 vCloseUv;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    ${channel==='coat'?`vec3 p=vCloseCoat;
     float stripe=cos(p.z*98.+p.y*61.+.75*sin(p.x*40.+p.y*25.));
     float marking=smoothstep(.19,.62,stripe)*(1.-smoothstep(-.095,-.025,p.z));
     vec3 silver=diffuseColor.rgb*mix(.8,1.21,smoothstep(-.015,.035,p.y));
     vec3 tabby=mix(silver,silver*vec3(.49,.53,.59),marking*.70);
     // The fingers stay close to their grip origin. Only the feet extend
     // through the pale toe markings from their ankle origin.
     float toes=smoothstep(.058,.109,p.z);
     diffuseColor.rgb=mix(tabby,diffuseColor.rgb*vec3(1.72,1.55,1.33),toes*.91);
    `:''}
    ${layer?`vec2 fibre=vCloseUv*vec2(115.,76.),cell=floor(fibre),at=fract(fibre)-.5;float hair=fract(sin(dot(cell,vec2(127.1,311.7)))*43758.5453);at.x+=(hair-.5)*.3;float strand=length(at/vec2(${(.25-layer*.08).toFixed(3)},.65)),aa=max(.08,fwidth(strand));if((1.-smoothstep(1.-aa,1.+aa,strand))*step(${(layer*.6).toFixed(3)},hair)<.35)discard;`:''}
    ${source.pattern==='flannel'?`
      // Yarn-dyed warp and weft. Most of the field is faded brick; narrow
      // dark crossings and warm threads pick out the repeat.
      vec2 repeat=vCloseUv/.108+vec2(.07,.23);
      vec2 edge=abs(fract(repeat)-.5),aa=clamp(fwidth(repeat)*.45,vec2(.003),vec2(.25));
      vec2 broad=1.-smoothstep(vec2(.22)-aa,vec2(.22)+aa,edge);
      vec2 fine=1.-smoothstep(vec2(.026)-aa,vec2(.026)+aa,abs(edge-.267));
      vec3 red=mix(vec3(1.26,1.13,1.04),vec3(.52,.62,.73),broad.x*.68);
      red=mix(red,red*vec3(.47,.57,.68),broad.y*.72);
      red=mix(red,vec3(1.57,1.43,1.21),.29*max(fine.x,fine.y));
      vec2 yarn=vCloseUv*vec2(285.,310.);
      float detail=1.-smoothstep(.32,.85,length(fwidth(yarn)));
      float weave=sin(yarn.x*6.283)*sin(yarn.y*6.283+1.1*sin(yarn.x*3.1416));
      float nap=sin(dot(vCloseUv,vec2(949.,-477.))+2.*sin(vCloseUv.y*1331.))*sin(vCloseUv.x*775.);
      float fade=.95+.10*sin(vCloseUv.x*159.+1.4*sin(vCloseUv.y*183.))*sin(vCloseUv.y*146.);
      diffuseColor.rgb*=red*fade*(1.+detail*(.10*weave+.035*nap));
      if(vCloseCut.z>.5){
        float seam=abs(vCloseUv.x-.009);
        float placket=1.-smoothstep(.013,.018,seam);
        float rail=1.-smoothstep(.0008,.0028,abs(seam-.014));
        float stitch=smoothstep(.24,.38,abs(fract(vCloseUv.y*176.)-.5));
        diffuseColor.rgb*=1.-.13*placket;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.48,rail*stitch*.45);
        vec2 button=vec2(vCloseUv.x-.009,fract((vCloseUv.y+.014)/.075)*.075-.0375);
        float buttonMask=1.-smoothstep(.004,.0058,length(button));
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.078,.036,.022)*(1.+button.y*65.),buttonMask);
      }else{
        float hem=vCloseCut.y;
        float cuff=smoothstep(.85,.91,hem),fold=1.-smoothstep(.006,.033,abs(hem-.912));
        float thread=(1.-smoothstep(.007,.018,abs(hem-.945)))*smoothstep(.19,.33,abs(fract(vCloseUv.x*190.)-.5));
        diffuseColor.rgb*=1.-.22*cuff-.20*fold;
        diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*1.65,thread*.48);
      }
    `:''}
    ${source.pattern==='twill'?`
      vec2 yarn=vCloseUv*vec2(213.,247.);
      float detail=1.-smoothstep(.33,.9,length(fwidth(yarn)));
      float diagonal=sin((yarn.x+yarn.y)*6.283+sin(yarn.y*6.283)*.52);
      float slub=sin(vCloseUv.x*371.+1.4*sin(vCloseUv.y*97.))*sin(vCloseUv.y*54.);
      float grain=1.+.075*detail*diagonal+.047*slub;
      float panel=cos((vCloseCut.x+.14)*6.283);
      diffuseColor.rgb*=vec3(.92,1.01,1.07)*grain*(1.+.095*panel);
      float seam=abs(vCloseCut.x-.10),hem=1.-vCloseCut.y;
      float edge=(1.-smoothstep(.004,.011,seam))+(1.-smoothstep(.010,.030,abs(hem-.035)));
      float stitches=smoothstep(.2,.34,abs(fract(vCloseUv.y*171.)-.5));
      diffuseColor.rgb*=1.-.13*min(edge,1.);
      diffuseColor.rgb+=vec3(.020,.024,.030)*stitches*(1.-smoothstep(.001,.005,abs(seam-.012)));
    `:''}
    ${channel==='strap'?`vec2 weave=vCloseUv*vec2(26.,190.);float near=1.-smoothstep(.5,1.5,length(fwidth(weave)));float herringbone=abs(fract(weave.x*.5+abs(fract(weave.y*.125)-.5))-.5);float selvedge=smoothstep(.0,.09,vCloseUv.x)*smoothstep(.0,.09,1.-vCloseUv.x);diffuseColor.rgb*=mix(.62,1.,selvedge)*(1.-near*.26*herringbone);`:''}
    `);
  };m.customProgramCacheKey=()=>`fp-v6:${channel}:${layer}`;return m;
 }
 // A real pilot's instrument, not a HUD: world-lit surroundings, hidden in chase.
 // Skipped without a DOM, where only the geometry is under test.
 function instrumentScreen(pose,parent){
  if(!pose||!globalThis.document)return {};
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=170;
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.anisotropy=4;
  const screen=new T.Mesh(new T.PlaneGeometry(pose.width,pose.height),new T.MeshBasicMaterial({map,toneMapped:false,fog:false}));
  screen.name='fp_instrument_screen';screen.frustumCulled=false;parent.add(screen);
  return {screen,screenCanvas:canvas,screenMap:map,screenAt:-1};
 }
 function drawInstrument(m,state,velocity){
  const now=style.time.value;if(!m.screen||Math.abs(now-m.screenAt)<.2)return;m.screenAt=now;
  const g=m.screenCanvas.getContext('2d'),w=m.screenCanvas.width,h=m.screenCanvas.height,vario=state.vario??0,v=velocity??[0,0,0];
  g.fillStyle='#b9c4a4';g.fillRect(0,0,w,h);g.fillStyle='#14190f';g.textBaseline='alphabetic';g.textAlign='right';
  g.font='700 92px ui-monospace,Menlo,monospace';g.fillText(String(Math.round(Math.hypot(v[0],v[1],v[2])*3.6)),w-58,92);
  g.font='700 22px ui-monospace,Menlo,monospace';g.fillText('km/h',w-6,92);
  g.font='700 42px ui-monospace,Menlo,monospace';g.textAlign='left';g.fillText((vario>=0?'+':'')+vario.toFixed(1),8,152);
  g.font='700 20px ui-monospace,Menlo,monospace';g.textAlign='right';g.fillText(Math.round(state.z)+' m',w-6,152);
  const bar=Math.max(-1,Math.min(1,vario/8))*44;g.fillRect(w-112,110-Math.max(0,bar)*.3,6,Math.max(2,Math.abs(bar)*.3));
  m.screenMap.needsUpdate=true;
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
     if(surfaceChannel(channel)){
      const surfaces=initial.parts.filter(p=>p.material===channel);
      const joined=new T.BufferGeometry(),indices=[],uv=[],cut=[];let vertices=0;
      for(const {id,surface} of surfaces){
       const torso=id==='torso',scale=channel==='shirt'?[.324,.29]:[.76,.55];
       for(let i=0;i<surface.uv.length;i+=2)cut.push(surface.uv[i]/scale[0],surface.uv[i+1]/scale[1],Number(torso));

       for(const index of surface.indices)indices.push(index+vertices);
       uv.push(...surface.uv);vertices+=surface.positions.length/3;
      }
      joined.setAttribute('position',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));
      joined.setAttribute('normal',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));
      joined.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
      joined.setAttribute('closeCut',new T.Float32BufferAttribute(cut,3));joined.setIndex(indices);
      geometries.push(joined);mesh=new T.Mesh(joined,material(channel,source,layer));
     }else{
      const own=recipe.geometries[channel]?makeGeometry(recipe.geometries[channel]):geometry;if(own!==geometry)geometries.push(own);
      mesh=new T.InstancedMesh(own,material(channel,source,layer),count);
      // Apparatus shares two draws; each part keeps its own colour.
      initial.parts.filter(p=>p.material===channel).forEach((p,i)=>{if(p.tint)mesh.setColorAt(i,tint.set(p.tint));});
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
     }
     mesh.name=`fp_${channel}_${layer}`;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;if(mesh.isInstancedMesh)mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);(channel==='webbing'?gear:body).add(mesh);meshes.push(mesh);channels[channel].push(mesh);
    }
   }
   geometry.setAttribute('closeOrigin',new T.InstancedBufferAttribute(new Float32Array(initial.parts.filter(p=>p.material==='coat').length*3),3).setUsage(T.DynamicDrawUsage));
   const next={recipe,geometry,geometries,root,body,gear,channels,meshes,...instrumentScreen(initial.instrument,body)};
   fill(initial,next);try{await compile(root);}catch(error){release(next);if(token===sequence)stats.status='failed';throw error;}
   if(token!==sequence||disposed){release(next);return;}
   release(model);model=next;group.add(root);stats.builds++;stats.parts=initial.parts.length;stats.triangles=meshes.reduce((s,m)=>s+(m.count??1)*m.geometry.index.count/3,0);stats.lastBuildMs=performance.now()-start;stats.status='ready';
   fill(initial);
  })();return pending;
 }
 function fill(pose,target=model){
  target.geometry.attributes.closeOrigin.needsUpdate=true;const counts={},surfaceOffsets={};
  for(const part of pose.parts){const at=counts[part.material]??0;
   for(const mesh of target.channels[part.material]){
    if(part.surface){
     const g=part.surface,offset=surfaceOffsets[part.material]??0;
     mesh.geometry.attributes.position.array.set(g.positions,offset);mesh.geometry.attributes.normal.array.set(g.normals,offset);
     surfaceOffsets[part.material]=offset+g.positions.length;
    }
    else {position.fromArray(part.position);rotation.fromArray(part.quaternion);scale.fromArray(part.scale);matrix.compose(position,rotation,scale);if(part.patternOrigin)target.geometry.attributes.closeOrigin.setXYZ(at,...part.patternOrigin);mesh.setMatrixAt(at,matrix);}
   }counts[part.material]=at+1;
  }
  for(const channel of Object.keys(counts))for(const mesh of target.channels[channel])if(mesh.isInstancedMesh)mesh.instanceMatrix.needsUpdate=true;else {mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.attributes.normal.needsUpdate=true;}
 }

 function update({active,view,pilotMatrix,pilotScale=1,state,grips,air,velocity,dt=0,reset=false}){
  lastActive=!!active;lastView=view??lastView;
  if(!active||!model||model.recipe.key!==requested){
   group.visible=warming&&!!model;stats.lastUpdateMs=0;
   lastMode=null;hasVelocity=false;legs.reset();
   return;
  }
  const start=performance.now();group.visible=true;model.body.visible=view==='first';
  // Scale about the real hip: the small-character option cannot move its pickup.
  group.matrix.copy(pilotMatrix);matrix.makeTranslation(hip.x*(1-pilotScale),hip.y*(1-pilotScale),hip.z*(1-pilotScale));group.matrix.multiply(matrix).scale(scale.setScalar(pilotScale));group.matrixWorldNeedsUpdate=true;group.updateMatrixWorld(true);inverse.copy(group.matrixWorld).invert();
  const local=grips.map(p=>position.copy(p).applyMatrix4(inverse).toArray());
  const [vx,vy,vz]=velocity??[0,0,0];
  rotation.setFromRotationMatrix(pilotMatrix).invert();
  flow.value.set((air?.wx??0)-vx,(air?.lift??0)-vz,vy-(air?.wy??0)).applyQuaternion(rotation);
  if(reset||state.mode!==lastMode){legs.reset();hasVelocity=false;lastMode=state.mode;}
  acceleration.set(0,0,0);
  if(dt>0&&velocity){
   worldVelocity.set(vx,vz,-vy);
   if(hasVelocity)acceleration.copy(worldVelocity).sub(previousVelocity).divideScalar(dt).applyQuaternion(rotation).clampLength(0,24);
   previousVelocity.copy(worldVelocity);hasVelocity=true;
  }else if(dt>0)hasVelocity=false;
  const legSwing=legs.update(dt,{lateral:acceleration.x,forward:acceleration.z,
   sideAir:flow.value.x,headwind:-flow.value.z,bank:pilotMatrix.elements[1]});
  const pose=firstPersonPose(model.recipe,state,local,style.time.value,{body:view==='first',pilotScale,legSwing});fill(pose);
  if(model.screen&&pose.instrument){model.screen.position.fromArray(pose.instrument.position);model.screen.quaternion.fromArray(pose.instrument.quaternion);drawInstrument(model,state,velocity);}
  flow.value.multiplyScalar(1/35).clampLength(0,1);
  stats.updates++;stats.lastUpdateMs=performance.now()-start;
 }
 return {group,stats,request,update,get ready(){return !!model&&model.recipe.key===requested;},get eye(){return selected.supported?selected.anatomy.eye:null;},get collarBounds(){return selected.anatomy?.collarBounds;},async prewarm(){await request(selected);warming=!!model;group.visible=warming;if(model)model.body.visible=true;},finishWarm(){warming=false;group.visible=lastActive&&!!model;if(model)model.body.visible=lastView==='first';},setDesign(design){selected=resolveFirstPersonDesign({...config,appearance:design});return request(selected);},dispose(){disposed=true;sequence++;release(model);model=null;stats.status='disposed';}};
}

/** Bounded browser interpretation of the shared close-body recipe. Uses the
 * ordinary world depth/light/cloud pipeline, never a camera-overlay scene. */
import * as T from '../vendor/three.module.min.js';
import {toonMaterial,style} from './style.js';
import {resolveFirstPersonDesign,generateFirstPerson,firstPersonPose,createSeatedLegSwing,unitGeometry} from '../../../shared/geometry/first-person/recipe.js';
import {controlGrip} from '../../../shared/geometry/flight/contacts.js';
import {coatGrain,groomGLSL,pawCoatSurface,forearmFringe,pawRimFringe} from './paw-groom.js';
import {paintUndercoat,paintFringe,undercoatFragment} from './paw-undercoat.js';
const tint=new T.Color();
const surfaceChannel=channel=>channel==='shirt'||channel==='hakama';
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
function pawFurGeometry(groom){
 const geometry=new T.BufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute(groom.positions,3));
 geometry.setAttribute('normal',new T.Float32BufferAttribute(groom.normals,3));
 geometry.setAttribute('uv',new T.Float32BufferAttribute(groom.uv,2));
 geometry.setAttribute('closeFibre',new T.Float32BufferAttribute(groom.fibres,3));
 geometry.setAttribute('closeRelief',new T.Float32BufferAttribute(groom.relief,3));
 geometry.setAttribute('closeFurTraits',new T.Float32BufferAttribute(groom.traits,3));
 geometry.setIndex(groom.indices);
 return geometry;
}

function coatTexture(texels,width,height,format,wrap){
 const texture=new T.DataTexture(texels,width,height,format);
 texture.wrapS=texture.wrapT=wrap;
 texture.generateMipmaps=true;
 texture.minFilter=T.LinearMipmapLinearFilter;
 texture.magFilter=T.LinearFilter;
 texture.needsUpdate=true;
 return texture;
}

export function createFirstPersonFlight(config,{compile=async()=>{}}={}){
 const group=new T.Group();group.name='procedural_first_person';group.visible=false;group.matrixAutoUpdate=false;
 const flow={value:new T.Vector3()},matrix=new T.Matrix4(),position=new T.Vector3(),rotation=new T.Quaternion(),scale=new T.Vector3(),inverse=new T.Matrix4(),hip=new T.Vector3(0,.65,0);
 const armX=new T.Vector3(),armY=new T.Vector3(),armZ=new T.Vector3();
 const bandAxis=new T.Vector3(),forearmOffset=new T.Vector3();
 const legs=createSeatedLegSwing(),previousVelocity=new T.Vector3(),acceleration=new T.Vector3(),worldVelocity=new T.Vector3();
 let lastMode=null,hasVelocity=false;
 let selected=resolveFirstPersonDesign(config);
 let model=null,requested=null,sequence=0,disposed=false,pending=null,warming=false,lastActive=false,lastView='chase';
 const stats={builds:0,updates:0,parts:0,triangles:0,lastBuildMs:0,lastUpdateMs:0,status:'unrequested'};
 function release(m){if(!m)return;group.remove(m.root);if(m.screen){m.screen.geometry.dispose();m.screen.material.dispose();m.screenMap.dispose();}for(const mesh of m.meshes){mesh.material.dispose();mesh.dispose?.();}for(const geometry of m.geometries)geometry.dispose();m.coatMaps.undercoat.dispose();m.coatMaps.fringe.dispose();}
 function material(channel,source,coatMaps,fur=false){
  const color=new T.Color(source.base).multiply(new T.Color(source.tint)),m=toonMaterial({color},{}),original=m.onBeforeCompile;
  if(fur){m.side=T.DoubleSide;m.transparent=true;m.depthWrite=false;m.forceSinglePass=true;}
  m.onBeforeCompile=shader=>{original(shader);shader.uniforms.uCloseFlow=flow;
   if(channel==='coat'&&!fur)shader.uniforms.uUndercoat={value:coatMaps.undercoat};
   if(fur)shader.uniforms.uFringe={value:coatMaps.fringe};
   shader.vertexShader=(surfaceChannel(channel)?'attribute vec3 closeCut; varying vec3 vCloseCut;\n':'')+(channel==='coat'?'attribute vec4 closeOrigin; attribute vec3 closeRelief; attribute float closePart; attribute vec4 closeBands; varying vec2 vArmCoord;\n':'')+(channel==='coat'&&!fur?'varying vec3 vNapAt,vNapNormal,vNapBend,vNapAxis;\n':'')+(fur?'attribute vec3 closeFibre; attribute vec3 closeFurTraits; varying vec3 vCloseFibre; varying float vFurGlint;\n'+groomGLSL:'')+'varying vec3 vCloseCoat;varying vec2 vCloseUv;uniform vec3 uCloseFlow;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
    ${surfaceChannel(channel)?'vCloseCut=closeCut;':''}
    vCloseUv=uv;vCloseCoat=${surfaceChannel(channel)?'position':'(instanceMatrix*vec4(position,1.)).xyz'}${channel==='coat'?'-closeOrigin.xyz':''};
    ${channel==='coat'?'transformed+=closeRelief*mix(.86,.62,closeOrigin.w);':''}
    ${channel==='coat'?`vArmCoord=vec2(dot(vCloseCoat,closeBands.xyz)+closeBands.w,step(.01,dot(closeBands.xyz,closeBands.xyz)));
     mat3 frame=mat3(instanceMatrix);
     vec3 sz=vec3(length(frame[0]),length(frame[1]),length(frame[2]));
     vec3 n=normalize(frame*(normal/(sz*sz)));
     float phase=dot(vCloseCoat,vec3(39.,62.,47.))+dot(closeOrigin.xyz,vec3(1.1,.4,.75));
     float gust=.78+.30*sin(uTime*5.2+phase)+.16*sin(uTime*8.1-phase*.6);
     vec3 airGust=uCloseFlow*gust;`:''}
    ${channel==='coat'&&!fur?`float closeBeam=min(1.,closePart);
     vec3 at=position*sz;
     vec3 localN=normalize(normal/sz);
     vec3 bend=transpose(frame)*(airGust-n*dot(n,airGust))/sz;
     // The beams run down local Y, and palms, feet and toes point down Z.
     vNapAt=mix(at,at.xzy,closeBeam)*6.8+vec3(.37,.61,.23)*float(gl_InstanceID);
     vNapNormal=mix(localN,localN.xzy,closeBeam);
     vec3 axis=frame*mix(vec3(0.,0.,1.),vec3(0.,1.,0.),closeBeam)/mix(sz.z,sz.y,closeBeam);
     vec3 swept=axis-n*dot(n,axis)+n*.22+airGust*.18;
     vNapAxis=mat3(modelMatrix)*swept;
     vNapBend=mix(bend,bend.xzy,closeBeam)*.044;`:''}
    ${fur?`vec3 root=(instanceMatrix*vec4(transformed,1.)).xyz;
     vec3 eye=normalize(transpose(mat3(modelViewMatrix))*(-(modelViewMatrix*vec4(root,1.)).xyz));
     float lengthScale=clamp(max(max(sz.x,sz.y),sz.z)*16.,.43,1.13);
     if(closeOrigin.w>0.)lengthScale*=groomGripScale(vCloseCoat);
     if(closePart<0.)lengthScale*=.44;
     vec3 wristLay=frame[1]/sz.y*1.40+frame[2]/sz.z*closeFurTraits.z*.35;
     vec3 toeLay=frame[2]/sz.z*.9+frame[0]/sz.x*closeFurTraits.z*.30;
     vec3 lay=mix(toeLay,wristLay,step(1.5,closePart));
     vec3 displacement=groomOffsetAlong(n,eye,airGust,closeFibre,closeFurTraits,lengthScale,lay);
     transformed+=transpose(frame)*displacement/(sz*sz);
     vFurGlint=pow(1.-abs(dot(n,eye)),2.);
     vCloseFibre=closeFibre;`:''}`);
   shader.fragmentShader=(surfaceChannel(channel)?'varying vec3 vCloseCut;\n':'')+(fur?'uniform sampler2D uFringe; varying vec3 vCloseFibre; varying float vFurGlint;\n':'')+(channel==='coat'?'varying vec2 vArmCoord;\n':'')+(channel==='coat'&&!fur?undercoatFragment+'\nvarying vec3 vNapAxis;\n':'')+'varying vec3 vCloseCoat;varying vec2 vCloseUv;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
    ${channel==='coat'?`vec3 p=vCloseCoat;
     float toes=smoothstep(.058,.109,p.z);
     vec3 silver=diffuseColor.rgb*mix(.88,1.12,smoothstep(-.025,.035,p.y));
     silver=mix(silver,diffuseColor.rgb*vec3(1.60,1.51,1.40),toes*.9);
     ${fur?`float variant=floor(vCloseFibre.z*8.);
     vec2 tuft=texture(uFringe,vec2((variant+vCloseUv.y)/8.,vCloseUv.x)).rg;
     float coverage=tuft.r;
     if(coverage<.025)discard;
     float pigment=(tuft.g-.5)/max(.08,coverage);
     float rootPigment=pigment;`:`vec2 hairs=coatDetail(uTime);
     float pigment=hairs.x+hairs.y;
     float rootPigment=hairs.x;
     vec3 halfLight=normalize(normalize(cameraPosition-vPlace)+normalize(uSun)+vec3(.00001));
     float alignment=dot(normalize(vNapAxis+vec3(.00001)),halfLight);
     float sheen=pow(max(0.,1.-alignment*alignment),5.);
     pigment+=max(hairs.y,0.)*sheen*.18;`}
     // A common wrist coordinate carries the upper band across the palm
     // seam and lets the cuff cover the lower part of the second band.
     float along=vArmCoord.x+rootPigment*.090;
     float edge=min(abs(along+.54),abs(along-.21))-.109;
     float aa=max(.018,fwidth(along));
     float bands=vArmCoord.y*(1.-smoothstep(-aa,aa,edge));
     vec3 charcoal=silver*mix(.195,.42,smoothstep(-.32,.24,pigment));
     vec3 grey=silver*mix(.15,1.13,smoothstep(-.46,.15,pigment));
     vec3 ground=mix(grey,charcoal,bands);
     float pale=smoothstep(.06,.40,pigment);
     float bandPale=smoothstep(.012,.38,pigment);
     diffuseColor.rgb=mix(ground,silver*1.78,mix(pale*.94,bandPale*.54,bands));

    `:''}
    ${fur?`diffuseColor.a*=smoothstep(.025,.78,coverage)*mix(.78,1.,vFurGlint);
      float tip=smoothstep(.14,1.,vCloseFibre.x);
      diffuseColor.rgb*=mix(.88,1.10,tip)*mix(.94,1.08,vCloseFibre.z);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.58,.56,.53),tip*(.04+.035*vFurGlint));
    `:''}
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
      // Match hakama_mend.R on the walking Ronin in cloth coordinates.
      vec2 mend=vec2((vCloseCut.x-.235)*.68,(.47-vCloseCut.y)*.84);
      mend=mat2(.99452,.10453,-.10453,.99452)*mend;
      vec2 halfSize=vec2(.042,.038);
      vec2 edgeDist=abs(mend)-halfSize;
      float fray=.0008*sin(mend.x*5310.+mend.y*4130.);
      float mendEdge=max(edgeDist.x,edgeDist.y)+fray;
      float mendAA=max(.0005,length(fwidth(mend))*.5);
      float mendMask=step(.5,vCloseCut.z)*(1.-smoothstep(-mendAA,mendAA,mendEdge));
      vec2 stitchDist=abs(mend)-(halfSize-.009);
      float stitchEdge=max(stitchDist.x,stitchDist.y);
      float along=stitchDist.x>stitchDist.y?mend.y:mend.x;
      float dash=1.-smoothstep(.23,.23+min(.22,mendAA/.014),abs(fract(along/.014)-.5));
      float thread=dash*(1.-smoothstep(.0013,.0013+mendAA,abs(stitchEdge)));
      vec3 indigo=diffuseColor.rgb*vec3(1.39,1.44,1.42);
      diffuseColor.rgb=mix(diffuseColor.rgb,mix(indigo,vec3(.40,.30,.17),thread),mendMask);
    `:''}
    ${channel==='strap'?`vec2 weave=vCloseUv*vec2(26.,190.);float near=1.-smoothstep(.5,1.5,length(fwidth(weave)));float herringbone=abs(fract(weave.x*.5+abs(fract(weave.y*.125)-.5))-.5);float selvedge=smoothstep(.0,.09,vCloseUv.x)*smoothstep(.0,.09,1.-vCloseUv.x);diffuseColor.rgb*=mix(.62,1.,selvedge)*(1.-near*.26*herringbone);`:''}
    `);
   if(channel==='coat'&&!fur){
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
      // Low-frequency geometry tilts the diffuse lobes; painted underfur
      // supplies micro-bump without changing the silhouette again.
      vec3 dx=dFdx(-vViewPosition),dy=dFdy(-vViewPosition);
      vec3 facet=cross(dx,dy);
      vec3 reliefNormal=facet*sign(dot(facet,normal))*inversesqrt(max(1e-18,dot(facet,facet)));
      normal=normalize(mix(normal,reliefNormal,.16));
      float height=(hairs.x*.65+hairs.y)*.00050;
      vec3 sx=cross(dy,normal),sy=cross(normal,dx);
      float det=dot(dx,sx);
      vec3 gradient=dFdx(height)*sx+dFdy(height)*sy;
      normal=normalize(normal-sign(det)*gradient/max(abs(det),1e-8));
    `);
   }
  };m.customProgramCacheKey=()=>`fp-v19:${channel}:${fur}`;return m;
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
   const geometry=makeGeometry(recipe.geometry),grain=coatGrain();
   const nap=paintUndercoat(),mask=paintFringe();
   const coatMaps={
    undercoat:coatTexture(nap.texels,nap.size,nap.size,T.RGFormat,T.RepeatWrapping),
    fringe:coatTexture(mask.texels,mask.width,mask.height,T.RGFormat,T.ClampToEdgeWrapping),
   };
   const coatSurface=pawCoatSurface(unitGeometry(18,12),grain),coatGeometry=makeGeometry(coatSurface);
   coatGeometry.setAttribute('closeRelief',new T.Float32BufferAttribute(coatSurface.relief,3));
   const geometries=[geometry,coatGeometry];
   const root=new T.Group(),body=new T.Group(),gear=new T.Group();root.add(body,gear);
   const initial=firstPersonPose(recipe,{mode:'parakite'},[controlGrip({mode:'parakite'},1),controlGrip({mode:'parakite'},-1)]),meshes=[],channels={};
   const coatParts=initial.parts.filter(p=>p.material==='coat');
   const forearmSlots=coatParts.map(p=>p.id==='left_forearm'?0:p.id==='right_forearm'?1:-1);
   let pawFringeCount=0;
   const pawSlots=coatParts.map(p=>/_(foot|toe_)/.test(p.id)?pawFringeCount++:-1);
   for(const [channel,source]of Object.entries(recipe.materials)){
    const count=initial.parts.filter(p=>p.material===channel).length,layers=channel==='coat'?[0,1,2]:[0];channels[channel]=[];
    for(const layer of layers){
     let mesh;
     if(surfaceChannel(channel)){
      const surfaces=initial.parts.filter(p=>p.material===channel);
      const joined=new T.BufferGeometry(),indices=[],uv=[],cut=[];let vertices=0;
      for(const {id,surface} of surfaces){
       const marked=id==='torso'||id==='right_hakama',scale=channel==='shirt'?[.324,.29]:[.76,.55];
       for(let i=0;i<surface.uv.length;i+=2)cut.push(surface.uv[i]/scale[0],surface.uv[i+1]/scale[1],Number(marked));

       for(const index of surface.indices)indices.push(index+vertices);
       uv.push(...surface.uv);vertices+=surface.positions.length/3;
      }
      joined.setAttribute('position',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));
      joined.setAttribute('normal',new T.BufferAttribute(new Float32Array(vertices*3),3).setUsage(T.DynamicDrawUsage));
      joined.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
      joined.setAttribute('closeCut',new T.Float32BufferAttribute(cut,3));joined.setIndex(indices);
      geometries.push(joined);mesh=new T.Mesh(joined,material(channel,source,coatMaps));
     }else{
      const own=layer?pawFurGeometry(layer===1?forearmFringe(coatSurface):pawRimFringe(coatSurface)):channel==='coat'?coatGeometry:recipe.geometries[channel]?makeGeometry(recipe.geometries[channel]):geometry;
      if(own!==geometry&&own!==coatGeometry)geometries.push(own);
      mesh=new T.InstancedMesh(own,material(channel,source,coatMaps,layer>0),[count,2,pawFringeCount][layer]);
      // Apparatus shares two draws; each part keeps its own colour.
      if(!layer)initial.parts.filter(p=>p.material===channel).forEach((p,i)=>{if(p.tint)mesh.setColorAt(i,tint.set(p.tint));});
      if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
     }
     mesh.name=`fp_${channel}_${layer}`;mesh.frustumCulled=false;mesh.castShadow=false;mesh.receiveShadow=true;if(mesh.isInstancedMesh)mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);(channel==='webbing'?gear:body).add(mesh);meshes.push(mesh);channels[channel].push(mesh);
    }
   }
   for(const mesh of channels.coat){
    for(const name of ['closeOrigin','closeBands']){
     mesh.geometry.setAttribute(name,new T.InstancedBufferAttribute(new Float32Array(mesh.count*4),4).setUsage(T.DynamicDrawUsage));
    }
   }

   const kinds=coatParts.map((p,i)=>forearmSlots[i]>=0?2:Number(/_(ankle|digit_|thumb_)/.test(p.id)));
   coatGeometry.setAttribute('closePart',new T.InstancedBufferAttribute(new Float32Array(kinds),1));
   channels.coat[1].geometry.setAttribute('closePart',new T.InstancedBufferAttribute(new Float32Array([2,2]),1));
   const pawKinds=coatParts.filter((_,i)=>pawSlots[i]>=0).map(p=>p.id.endsWith('_foot')?-1:0);
   channels.coat[2].geometry.setAttribute('closePart',new T.InstancedBufferAttribute(new Float32Array(pawKinds),1));
   const gripCoat=coatParts.map(p=>Number(!/_(foot|toe|ankle)/.test(p.id)));
   const next={recipe,geometries,coatMaps,gripCoat,forearmSlots,pawSlots,root,body,gear,channels,meshes,...instrumentScreen(initial.instrument,body)};
   fill(initial,next);try{await compile(root);}catch(error){release(next);if(token===sequence)stats.status='failed';throw error;}
   if(token!==sequence||disposed){release(next);return;}
   release(model);model=next;group.add(root);stats.builds++;stats.parts=initial.parts.length;stats.triangles=meshes.reduce((s,m)=>s+(m.count??1)*m.geometry.index.count/3,0);stats.lastBuildMs=performance.now()-start;stats.status='ready';
   fill(initial);
  })();return pending;
 }
 function fill(pose,target=model){
  const counts={},surfaceOffsets={};
  let bandOffset=0;
  for(const part of pose.parts){const at=counts[part.material]??0;
   for(const mesh of target.channels[part.material]){
    if(part.surface){
     const g=part.surface,offset=surfaceOffsets[part.material]??0;
     mesh.geometry.attributes.position.array.set(g.positions,offset);mesh.geometry.attributes.normal.array.set(g.normals,offset);
     surfaceOffsets[part.material]=offset+g.positions.length;
    }
    else {
     const forearm=part.material==='coat'?target.forearmSlots[at]:-1;
     const index=mesh===target.channels.coat[1]?forearm:mesh===target.channels.coat[2]?target.pawSlots[at]:at;
     if(index<0)continue;
     position.fromArray(part.position);rotation.fromArray(part.quaternion);scale.fromArray(part.scale);
     if(forearm>=0){
      // Preserve the beam's long axis and point its inner meridian at the
      // torso, independently of camera yaw and brake travel.
      armY.set(0,1,0).applyQuaternion(rotation);
      bandAxis.copy(armY).divideScalar(scale.y);
      bandOffset=position.dot(bandAxis)-forearmOffset.fromArray(part.patternOrigin).dot(bandAxis);

      armX.set(forearm===0?-1:1,0,0);
      armZ.crossVectors(armX,armY);
      if(armZ.lengthSq()<1e-8)armZ.set(0,0,1).applyQuaternion(rotation);
      armZ.normalize();armX.crossVectors(armY,armZ);
      rotation.setFromRotationMatrix(matrix.makeBasis(armX,armY,armZ));
     }
     matrix.compose(position,rotation,scale);
     if(part.patternOrigin){
      mesh.geometry.attributes.closeOrigin.setXYZW(index,...part.patternOrigin,target.gripCoat[at]);
      // Each forearm precedes its own palm in the shared posed part list.
      if(forearm>=0||part.id.endsWith('_palm')){
       mesh.geometry.attributes.closeBands.setXYZW(index,bandAxis.x,bandAxis.y,bandAxis.z,-bandOffset);
      }
     }
     mesh.setMatrixAt(index,matrix);
    }
   }counts[part.material]=at+1;
  }
  if(counts.coat)for(const mesh of target.channels.coat){
   mesh.geometry.attributes.closeOrigin.needsUpdate=true;
   mesh.geometry.attributes.closeBands.needsUpdate=true;
  }
  for(const channel of Object.keys(counts))for(const mesh of target.channels[channel])if(mesh.isInstancedMesh)mesh.instanceMatrix.needsUpdate=true;else {mesh.geometry.attributes.position.needsUpdate=true;mesh.geometry.attributes.normal.needsUpdate=true;}
 }

 function update({active,view,pilotMatrix,pilotScale=1,state,grips,air,velocity,dt=0,reset=false,lean=0}){
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
  const elapsed=Math.min(dt,.05);
  if(elapsed>0&&velocity){
   worldVelocity.set(vx,vz,-vy);
   if(hasVelocity)acceleration.copy(worldVelocity).sub(previousVelocity).divideScalar(elapsed).applyQuaternion(rotation).clampLength(0,24);
   previousVelocity.copy(worldVelocity);hasVelocity=true;
  }else if(elapsed>0)hasVelocity=false;
  // In the harness frame the legs feel gravity and lag opposite the
  // acceleration of their seated hip. At level trim gravity is the rest load.
  const frame=pilotMatrix.elements,gravity=9.81;
  const legSwing=legs.update(dt,{lean,lateral:acceleration.x+gravity*frame[1],
   vertical:acceleration.y+gravity*(frame[5]-1),forward:acceleration.z+gravity*frame[9],
   sideAir:flow.value.x,headwind:-flow.value.z});
  const pose=firstPersonPose(model.recipe,state,local,style.time.value,{body:view==='first',pilotScale,legSwing});fill(pose);
  if(model.screen&&pose.instrument){model.screen.position.fromArray(pose.instrument.position);model.screen.quaternion.fromArray(pose.instrument.quaternion);drawInstrument(model,state,state.coupled?.pilotVelocity??velocity);}
  flow.value.multiplyScalar(1/35).clampLength(0,1);
  stats.updates++;stats.lastUpdateMs=performance.now()-start;
 }
 return {group,stats,request,update,get ready(){return !!model&&model.recipe.key===requested;},get eye(){return selected.supported?selected.anatomy.eye:null;},get collarBounds(){return selected.anatomy?.collarBounds;},async prewarm(){await request(selected);warming=!!model;group.visible=warming;if(model)model.body.visible=true;},finishWarm(){warming=false;group.visible=lastActive&&!!model;if(model)model.body.visible=lastView==='first';},setDesign(design){selected=resolveFirstPersonDesign({...config,appearance:design});return request(selected);},dispose(){disposed=true;sequence++;release(model);model=null;stats.status='disposed';}};
}

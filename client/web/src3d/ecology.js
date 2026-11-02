/** Client of the core's water habitats and ephemeral meadow populations. */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {buildStylizedForest} from './forest.js';
import {buildRockLod,isRock} from './rock-lod.js';
import {style} from './style.js';
import {createVisit} from './insect-visits.js';
import {createSchool,stepSchool} from '../../../shared/ecology/aquatic.js';
export function buildEcology(habitats,meadowData,assets,ground,cover,renderer,sampleAir){
  const group=new T.Group();group.name='living_habitats';
  const MOTES=Math.min(150,Math.ceil(meadowData.windborne.per_hectare*2.3));
  const schools=new Map(habitats.habitats.map(h=>[h.id,createSchool(h)]));let lastTime=0;
  const matrix=new T.Matrix4(),position=new T.Vector3(),quat=new T.Quaternion(),scale=new T.Vector3(),up=new T.Vector3(0,1,0),tint=new T.Color();
  const make=(path,count)=>{const merged=mergePrimitives(assets[path].primitives,'opaque');merged.material.side=T.DoubleSide;const m=new T.InstancedMesh(merged.geometry,merged.material,count);m.name=path;m.count=0;m.frustumCulled=false;group.add(m);return m;};
  const fish=make('waterside/river_fish.glb',habitats.habitats.reduce((n,h)=>n+h.fish_count,0));
  const tail=make('waterside/fish_tail.glb',fish.instanceMatrix.count);
  const frog=make('waterside/frog.glb',habitats.habitats.length*2);
  const dragon=make('waterside/dragonfly.glb',habitats.habitats.length*3);
  const wings=make('waterside/dragonfly_wings.glb',habitats.habitats.length*3);
  const plantRecords=habitats.plantings.map(p=>({...p,scale:[p.scale,p.scale,p.scale]}));
  const bankForest=buildStylizedForest({instances:plantRecords},assets,renderer,{filter:r=>!isRock(r),name:'bank_plantings',tileM:128,enterM:85,leaveM:110});group.add(bankForest.group);
  const rocks=buildRockLod(plantRecords.filter(isRock),assets);group.add(rocks.group);
  const meadowMeshes=meadowData.species.map(species=>{const mesh=make(species.asset,Math.ceil(species.per_hectare*3.24));return {species:{...species,ids:new Int32Array(mesh.instanceMatrix.count)},mesh};});
  // Encounters with the player: one bee and one butterfly at a time borrow the ordinary flight (see insect-visits.js).
  const visits={bee:createVisit('bee'),butterfly:createVisit('butterfly')};let player=null,lastVisitTime=0;
  const wingTints=['#f08a24','#f2d649','#7aa6e8','#f4f1e6','#d8553f'];
  for(const {species,mesh} of meadowMeshes){
    const butterfly=species.kind==='butterfly',original=mesh.material.onBeforeCompile;
    mesh.setColorAt(0,new T.Color('#ffffff'));
    if(butterfly){mesh.geometry.setAttribute('aSeed',new T.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count),1));mesh.geometry.setAttribute('aCalm',new T.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count),1));}
    if(species.kind!=='bee')mesh.material.onBeforeCompile=shader=>{original(shader);shader.uniforms.uTime=style.time;
      // Butterflies hinge the wings about the body with a fold, and glide open between bursts; other insects keep the buzz shear.
      shader.vertexShader=(butterfly?'attribute float aSeed;attribute float aCalm;\n':'')+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
${butterfly?`float ph=aSeed*6.2832,flap=smoothstep(-.3,.3,sin(uTime*.9+ph*3.)),th=.45+sin(uTime*(24.+aSeed*6.)+ph)*.8*flap-.15*(1.-flap);
th=mix(th,1.05+.08*sin(uTime*1.4+ph),aCalm);float ax=abs(position.x);transformed.x=sign(position.x)*ax*cos(th);transformed.y+=ax*sin(th);`:`transformed.y+=sin(uTime*90.)*abs(position.x)*.65;`}`);};
    mesh.material.customProgramCacheKey=()=>`insect-wing-${species.kind}`;
  }
  // Windborne bits: glinting dust, tumbling petals and seed fluff, one instanced sprite mesh per kind.
  const sprite=(shape)=>{const n=32,d=new Uint8Array(n*n*4).fill(255);
    for(let y=0;y<n;y++)for(let x=0;x<n;x++)d[(y*n+x)*4+3]=Math.round(255*Math.max(0,Math.min(1,shape((x+.5)/n*2-1,(y+.5)/n*2-1))));
    const t=new T.DataTexture(d,n,n,T.RGBAFormat);t.generateMipmaps=true;t.minFilter=T.LinearMipmapLinearFilter;t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;};
  const moteKinds=[
    {size:.05,tints:['#fff1c8','#ffe6a8','#fffaf0'],map:sprite((u,v)=>Math.pow(Math.max(0,1-Math.hypot(u,v)),1.7)*1.4)},
    {size:.085,tints:['#e9b3bd','#eed48f','#f1e6d4','#c9d98f'],map:sprite((u,v)=>{const e=Math.hypot(u/.95,v/.5-.12*u*u);return Math.min(1,(1-e)*5)*(.82+.18*Math.abs(v));})},
    {size:.14,tints:['#ffffff','#fff8ea'],map:sprite((u,v)=>{const r=Math.hypot(u,v),k=Math.pow(Math.abs(Math.cos(Math.atan2(v,u)*7)),30);return Math.max(0,1-r)*(r<.14?3:k*1.2+.15*(r<.3));})},
  ].map(kind=>{
    const mesh=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({map:kind.map,transparent:true,depthWrite:false,side:T.DoubleSide,opacity:.5}),MOTES);
    mesh.frustumCulled=false;mesh.setColorAt(0,tint.set('#ffffff'));group.add(mesh);return {...kind,mesh,n:0};});
  const rnd=(i,k=0)=>{const v=Math.sin(i*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};
  // Each mote is its own: a kind (mostly dust), a drag that sets how much of the wind it takes, and its own slow wander.
  const motes=Array.from({length:MOTES},(_,i)=>{const k=[0,0,0,0,1,0,0,2,0,1][i%10],kind=moteKinds[k];
    return {x:NaN,y:0,z:0,gen:0,k,phase:rnd(i,1)*40,drag:.5+rnd(i,2)*.9,wander:.1+rnd(i,3)*.3,size:.5+rnd(i,4)*1.1,tint:new T.Color(kind.tints[Math.floor(rnd(i,5)*kind.tints.length)])};});
  const euler=new T.Euler(),identity=new T.Quaternion(),smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  // Bee wings beat too fast to see: a faint shimmering haze either side of the thorax stands in for them.
  const beeCount=meadowMeshes.find(m=>m.species.kind==='bee')?.mesh.instanceMatrix.count??0;
  const haze=(()=>{
    const pos=[],uv=[],idx=[];
    for(const side of [-1,1])for(const deg of [38,12,-16]){
      const a=deg*Math.PI/180,L=.085,ox=side*.012,oy=.028,dx=side*Math.cos(a)*L,dy=Math.sin(a)*L,base=pos.length/3;
      pos.push(ox,oy,-.022, ox+dx,oy+dy,-.022, ox+dx,oy+dy,.036, ox,oy,.036);uv.push(0,0,1,0,1,1,0,1);idx.push(base,base+1,base+2,base,base+2,base+3);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);
    const map=sprite((u,v)=>{const x=(u+1)/2,y=(v+1)/2,e=Math.hypot((x-.4)/.6,(y-.5)/.5);return Math.pow(Math.max(0,1-e),1.3)*(.8+.2*Math.cos(y*20));});
    const mesh=new T.InstancedMesh(g,new T.MeshBasicMaterial({map,color:'#f2f8f6',transparent:true,depthWrite:false,side:T.DoubleSide,opacity:.3}),Math.max(1,beeCount));
    mesh.frustumCulled=false;mesh.count=0;group.add(mesh);return mesh;
  })();
  // Bee fur: the body drawn again as stacked, slightly inflated shells over smooth normals. Each shell keeps only the
  // strands tall enough to reach it, so the silhouette is soft and has no facets. Strand cells are hashed from the
  // undisplaced surface point, which keeps every strand radial across the shells.
  const fur=(()=>{
    const parts=[[[0,-.002,-.03],[.034,.032,.04]],[[0,.001,.012],[.028,.027,.022]],[[0,-.002,.044],[.021,.02,.018]]],LAYERS=12,P=[],N=[],part=[],I=[];
    parts.forEach(([c,r],k)=>{
      const g=new T.SphereGeometry(1,18,13);g.rotateX(Math.PI/2);g.scale(...r);g.translate(...c);
      const off=P.length/3,count=g.attributes.position.count;
      for(let i=0;i<count*3;i++){P.push(g.attributes.position.array[i]);N.push(g.attributes.normal.array[i]);}
      for(let i=0;i<count;i++)part.push(k);for(const x of g.index.array)I.push(x+off);g.dispose();
    });
    const base=P.length/3,positions=[],normals=[],parts_=[],shells=[],index=[];
    for(let l=0;l<LAYERS;l++){positions.push(...P);normals.push(...N);parts_.push(...part);for(let i=0;i<base;i++)shells.push(l/(LAYERS-1));for(const x of I)index.push(x+l*base);}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));
    g.setAttribute('aPart',new T.Float32BufferAttribute(parts_,1));g.setAttribute('aShell',new T.Float32BufferAttribute(shells,1));g.setIndex(index);
    const material=new T.MeshStandardMaterial({roughness:1,metalness:0});
    material.onBeforeCompile=shader=>{
      shader.uniforms.uTime=style.time;shader.vertexShader='uniform float uTime;attribute float aShell;attribute float aPart;varying vec3 vFur;varying float vShell;varying float vPart;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
vFur=position;vShell=aShell;vPart=aPart;transformed+=normal*aShell*.0115;transformed.y-=aShell*aShell*.0018;transformed.xy+=vec2(sin(uTime*2.5+position.z*90.),cos(uTime*2.1+position.z*70.))*.0007*aShell*aShell;`);
      shader.fragmentShader=`varying vec3 vFur;varying float vShell;varying float vPart;
float h31(vec3 p){p=fract(p*vec3(.1031,.103,.0973));p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float band(float z,float lo,float hi){return smoothstep(lo-.0025,lo+.0025,z)*(1.-smoothstep(hi-.0025,hi+.0025,z));}
`+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
{
  // Flaps, not strands: cells wrap the body by angle and run along it, leaning back from head to tail.
  vec3 q=vec3(atan(vFur.y,vFur.x+1e-6)/6.2832*34.,0.,(vFur.z+vShell*.012)*105.);q.x+=.5*mod(floor(q.z),2.);vec3 cell=floor(q);
  vec2 jit=vec2(h31(cell+1.7),h31(cell+5.3))*.4-.2;float wide=.8+.4*h31(cell+7.9);
  float reach=.35+.65*h31(cell);vec2 f=abs(fract(q).xz-.5-jit)/vec2(.46*wide*(1.-vShell*.5),.5*(1.-vShell*.35));
  float m=pow(pow(f.x,2.5)+pow(f.y,2.5),.4),aa=max(.08,fwidth(m)),cover=1.-smoothstep(1.-aa,1.+aa,m);
  // A fine second pass of hairs reaches past the flaps, so the outline fringes softly. They fade with distance.
  vec3 q2=vec3(atan(vFur.y,vFur.x+1e-6)/6.2832*170.,0.,(vFur.z+vShell*.01)*430.),cell2=floor(q2);
  vec2 g=abs(fract(q2).xz-.5-(vec2(h31(cell2+8.1),h31(cell2+2.4))*.5-.25))/vec2(.4*(1.-vShell*.6),.5);
  float hairLod=1.-smoothstep(.12,.35,fwidth(q2.x)),hair=(1.-smoothstep(.75,1.,length(g)))*step(vShell,.4+.6*h31(cell2+3.3))*hairLod;
  if(vShell>.001&&((vShell>reach||cover<.35)&&hair<.3))discard;
  float z=vFur.z;vec3 gold=vec3(.87,.46,.023),dark=vec3(.024,.015,.009),headc=vec3(.9,.67,.25),col;
  if(vPart>1.5)col=headc;
  else if(vPart>.5)col=mix(gold,dark,band(z,.011,.024));
  else{
    col=mix(gold,dark,clamp(band(z,-.0205,-.0095)+band(z,-.0405,-.0295),0.,1.));
    col=mix(col,dark,1.-smoothstep(-.0525,-.0475,z));  // the whole rear end is black
  }
  diffuseColor.rgb=col*mix(.5,.98,vShell)*(.88+.2*reach)*(1.+.25*hair*vShell);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.95,.72,.34)*.55*mix(.4,1.,vShell),hair*vShell*.55);
}`).replace('#include <opaque_fragment>',`{float rim=pow(1.-clamp(dot(normalize(normal),normalize(vViewPosition)),0.,1.),2.6);outgoingLight+=vec3(1.,.8,.5)*rim*vShell*vShell*.5;}
#include <opaque_fragment>`);
    };
    const mesh=new T.InstancedMesh(g,material,Math.max(1,beeCount));mesh.frustumCulled=false;mesh.count=0;group.add(mesh);return mesh;
  })();
  function place(mesh,n,x,z,y,yaw=0,s=1,roll=0,pitch=0){position.set(x,y,-z);quat.setFromEuler(euler.set(pitch,yaw,roll,'YXZ'));scale.setScalar(s);matrix.compose(position,quat,scale);mesh.setMatrixAt(n,matrix);}
  function update(camera,time){
    bankForest.update(camera);rocks.update(camera);
    const dt=Math.min(.05,time-lastTime);lastTime=time;
    const watcher=player??{active:false,top:visits.bee.v.pos,nose:visits.butterfly.v.pos};
    visits.bee.tick(dt,watcher,time);visits.butterfly.tick(dt,watcher,time);let nf=0,nd=0,nr=0;
    for(const h of habitats.habitats){
      const [cx,cy,surface]=h.centre_m;
      if(Math.hypot(cx-camera.position.x,-cy-camera.position.z)>230||camera.position.y>surface+150)continue;
      const [tx,ty]=h.along;
      const school=schools.get(h.id);
      const dx=camera.position.x-cx,dy=-camera.position.z-cy;
      stepSchool(school,dt,[dx*tx+dy*ty,-dx*ty+dy*tx,camera.position.y-surface]);
      school.fish.forEach((f,i)=>{
        const x=cx+tx*f.p[0]-ty*f.p[1],y=cy+ty*f.p[0]+tx*f.p[1];
        const floor=ground.height(x,y)??surface-2;
        const z=Math.max(floor+.10,surface+f.p[2]);if(z>surface-.1)return;
        const vx=tx*f.v[0]-ty*f.v[1],vy=ty*f.v[0]+tx*f.v[1];
        const heading=Math.atan2(vx,-vy);
        place(fish,nf,x,y,z,heading,f.size);place(tail,nf,x,y,z,heading+Math.sin(time*(8+Math.hypot(...f.v)*8)+f.phase)*.3,f.size);nf++;
      });
      for(let i=0;i<3;i++){
        const [x,y,z]=h.shore_m;const phase=time*.7+h.seed+i*2.1;
        const px=x+Math.sin(phase)*3,py=y+Math.cos(phase*.73)*2,pz=z+1.0+Math.sin(phase*1.7)*.35;
        place(dragon,nd,px,py,pz,phase,.9);place(wings,nd,px,py,pz,phase,.9);nd++;
      }
      for(const [i,p] of h.frog_roosts_m.entries()){
        const hop=Math.max(0,Math.sin(time*.4+h.seed+i)-.92)*2;
        place(frog,nr++,p[0],p[1],p[2]+hop,Math.sin(h.seed+i)*3,1);
      }
    }
    for(const [mesh,n] of [[fish,nf],[tail,nf],[dragon,nd],[wings,nd],[frog,nr]]){mesh.count=n;mesh.instanceMatrix.needsUpdate=true;}
    for(const {species,mesh} of meadowMeshes){
      let n=0,nf=0;const butterfly=species.kind==='butterfly',seed=mesh.geometry.getAttribute('aSeed'),calmAttr=mesh.geometry.getAttribute('aCalm'),ids=species.ids;
      const size=90,cx=Math.floor(camera.position.x/size)*size,cy=Math.floor(-camera.position.z/size)*size;
      for(let i=0;i<mesh.instanceMatrix.count;i++){
        const angle=i*2.399;let px=cx+Math.sin(i*133.7)*size+Math.sin(time*.3+i)*2,py=cy+Math.cos(i*78.7)*size+Math.cos(time*.45+i)*2,heading=angle+time*.3,bob=0,s=1.2;
        const fly=butterfly?{ma:7,mb:5,ra:.22,rb:.17,fl:.5,wr:1.9,bob:.12,bobr:5,s:1.35+i%4*.18}:species.kind==='bee'?{ma:6,mb:4.5,ra:.13,rb:.1,fl:.9,wr:1.1,bob:.22,bobr:2.3,s:1.7+i%3*.15}:null;
        if(fly){
          // A wandering meander plus a quick flutter; the heading follows the velocity, so the insect flies where it faces.
          const f=1+i%5*.12,a=time*fly.ra*f+i,b=time*fly.rb*f+i*1.7,w=time*fly.wr+i*3;
          px=cx+Math.sin(i*133.7)*size+Math.sin(a)*fly.ma+Math.sin(w)*fly.fl;py=cy+Math.cos(i*78.7)*size+Math.cos(b)*fly.mb+Math.cos(w*1.3)*fly.fl;
          const vx=Math.cos(a)*fly.ma*fly.ra*f+Math.cos(w)*fly.fl*fly.wr,vy=-Math.sin(b)*fly.mb*fly.rb*f-Math.sin(w*1.3)*fly.fl*fly.wr*1.3;
          heading=Math.atan2(vx,-vy);bob=Math.sin(time*fly.bobr+i*2)*fly.bob;s=fly.s;
        }
        const visit=visits[species.kind];let guest=visit&&visit.v.id===i?visit.v:null;
        let z=0;
        if(!guest){
          if(!cover.contains(px,py))continue;
          const floor=ground.height(px,py);if(floor===null||camera.position.y>floor+70)continue;
          z=floor+species.height_m[0]+(.5+.5*Math.sin(time*(butterfly?.35:1)+i))* (species.height_m[1]-species.height_m[0])+bob;
          if(visit&&visit.claim(i,px,z,-py,watcher))guest=visit.v;
        }
        let roll=Math.sin(time*1.7+i*2.1)*.4,pitch=Math.sin(time*2.3+i)*.3-.1,calm=0,wings=1;
        if(guest){px=guest.pos.x;py=-guest.pos.z;z=guest.pos.y;heading=guest.heading;roll=guest.roll;pitch=guest.pitch;calm=guest.landed?1:0;wings=guest.landed?0:1;s=(fly?.s??s)*guest.fade*(butterfly?1-.45*guest.shrink:1);}
        else if(visit&&i===visit.v.lastId&&time-visit.v.releasedAt<1.2)s*=smooth(0,1.2,time-visit.v.releasedAt);
        if(species.kind==='bee'){
          // Heavy and unhurried: the body rolls and nods as it wallows along, and the wing haze shimmers (and stills when landed).
          place(mesh,n,px,py,z,heading,s,roll,pitch);if(Math.hypot(px-camera.position.x,z-camera.position.y,-py-camera.position.z)<24)place(fur,nf++,px,py,z,heading,s,roll,pitch);place(haze,n,px,py,z,heading,s*wings*(1+.1*Math.sin(time*97+i*5)),roll,pitch);
        }else place(mesh,n,px,py,z,heading,s,guest?roll:0,guest?pitch:0);
        if(calmAttr)calmAttr.array[n]=calm;
        mesh.setColorAt(n,tint.set(butterfly?wingTints[i%wingTints.length]:'#ffffff'));
        if(seed)seed.array[n]=(i*.618034)%1;
        ids[n]=i;
        n++;
      }
      if(species.kind==='bee'){haze.count=n;haze.instanceMatrix.needsUpdate=true;fur.count=nf;fur.instanceMatrix.needsUpdate=true;}
      mesh.count=n;mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;if(seed)seed.needsUpdate=true;if(calmAttr)calmAttr.needsUpdate=true;
    }
    for(const kind of moteKinds)kind.n=0;
    for(let i=0;i<MOTES;i++){
      const mote=motes[i];
      if(!Number.isFinite(mote.x)||Math.hypot(mote.x-camera.position.x,mote.y+camera.position.z)>45){
        // Spread the first batch through the disc, then respawn off-centre, drifting in world space. Never attach motion to the camera.
        const first=!Number.isFinite(mote.x),angle=rnd(i,10+mote.gen++)*6.2832,r=first?38*Math.sqrt(rnd(i,6)):33+rnd(i,7)*4;
        mote.x=camera.position.x+Math.sin(angle)*r;mote.y=-camera.position.z+Math.cos(angle)*r;
        mote.z=(ground.height(mote.x,mote.y)??0)+.5+rnd(i,8)*3.2;
      }
      const air=sampleAir(mote.x,mote.y,mote.z);
      mote.x+=(air.wx*mote.drag+Math.sin(time*.6+mote.phase)*mote.wander)*dt;mote.y+=(air.wy*mote.drag+Math.cos(time*.45+mote.phase*1.3)*mote.wander)*dt;
      const floor=(ground.height(mote.x,mote.y)??0)+.35;
      mote.z=Math.max(floor,Math.min(floor+4,mote.z+(air.lift*.15-.08)*dt));
      if(!cover.contains(mote.x,mote.y)||camera.position.y>mote.z+45)continue;
      const kind=moteKinds[mote.k],dist=Math.hypot(mote.x-camera.position.x,mote.y+camera.position.z);
      // Fade in from the spawn ring and out of the lens, so nothing pops.
      const s=kind.size*mote.size*smooth(45,33,dist)*smooth(.6,2,dist)*(mote.k===0?.8+.2*Math.sin(time*(1.5+mote.phase%2)+mote.phase):1);
      position.set(mote.x,mote.z+Math.sin(time*1.7+mote.phase)*.08,-mote.y);
      if(mote.k===1)quat.setFromEuler(euler.set(time*(.8+mote.phase%1.3)+mote.phase,time*1.1+mote.phase*2,time*1.5));
      else quat.copy(camera.quaternion??identity);
      kind.mesh.setMatrixAt(kind.n,matrix.compose(position,quat,scale.setScalar(s)));kind.mesh.setColorAt(kind.n++,mote.tint);
    }
    for(const kind of moteKinds){kind.mesh.count=kind.n;kind.mesh.instanceMatrix.needsUpdate=true;kind.mesh.instanceColor.needsUpdate=true;}
  }
  /** The closest live insects of one kind, as scene-space positions with a stable id, for spatial audio. */
  function nearby(kind,camera,maxM,limit){
    const found=[];
    for(const {species,mesh} of meadowMeshes){
      if(species.kind!==kind)continue;const a=mesh.instanceMatrix.array;
      for(let n=0;n<mesh.count;n++){const x=a[n*16+12],y=a[n*16+13],z=a[n*16+14],d=Math.hypot(x-camera.position.x,y-camera.position.y,z-camera.position.z);if(d<maxM)found.push({x,y,z,d,id:species.ids[n]});}
    }
    return found.sort((p,q)=>p.d-q.d).slice(0,limit);
  }
  return {group,update,nearby,visits,setPlayer(p){player=p;},rocks,dispose(){rocks.dispose();},rebuildImpostors(){bankForest.rebuildImpostors();},stats:{habitats:habitats.habitats.length,plantings:habitats.plantings.length}};
}

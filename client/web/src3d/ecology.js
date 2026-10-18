/** Client of the core's water habitats and ephemeral meadow populations. */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {buildStylizedForest} from './forest.js';
import {style} from './style.js';
import {createSchool,stepSchool} from '../../../shared/ecology/aquatic.js';
export function buildEcology(habitats,meadowData,assets,ground,cover,renderer,sampleAir){
  const group=new T.Group();group.name='living_habitats';
  const schools=new Map(habitats.habitats.map(h=>[h.id,createSchool(h)]));let lastTime=0;
  const matrix=new T.Matrix4(),position=new T.Vector3(),quat=new T.Quaternion(),scale=new T.Vector3(),up=new T.Vector3(0,1,0);
  const make=(path,count)=>{const merged=mergePrimitives(assets[path].primitives,'opaque');merged.material.side=T.DoubleSide;const m=new T.InstancedMesh(merged.geometry,merged.material,count);m.name=path;m.count=0;m.frustumCulled=false;group.add(m);return m;};
  const fish=make('waterside/river_fish.glb',habitats.habitats.reduce((n,h)=>n+h.fish_count,0));
  const tail=make('waterside/fish_tail.glb',fish.instanceMatrix.count);
  const frog=make('waterside/frog.glb',habitats.habitats.length*2);
  const dragon=make('waterside/dragonfly.glb',habitats.habitats.length*3);
  const wings=make('waterside/dragonfly_wings.glb',habitats.habitats.length*3);
  const plantRecords=habitats.plantings.map(p=>({...p,scale:[p.scale,p.scale,p.scale]}));
  const bankForest=buildStylizedForest({instances:plantRecords},assets,renderer,{filter:()=>true,name:'bank_plantings',tileM:128,enterM:85,leaveM:110});group.add(bankForest.group);
  const meadowMeshes=meadowData.species.map(species=>({species,mesh:make(species.asset,Math.ceil(species.per_hectare*3.24))}));
  for(const {species,mesh} of meadowMeshes){
    const original=mesh.material.onBeforeCompile;
    mesh.material.onBeforeCompile=shader=>{original(shader);shader.uniforms.uTime=style.time;shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
transformed.y+=sin(uTime*${species.kind==='butterfly'?'18.':'90.'})*abs(position.x)*.65;`);};
    mesh.material.customProgramCacheKey=()=>`insect-wing-${species.kind}`;
  }
  const debris=new T.InstancedMesh(new T.PlaneGeometry(.075,.12),new T.MeshBasicMaterial({color:'#efbd81',side:T.DoubleSide,transparent:true,opacity:.68}),100);debris.frustumCulled=false;group.add(debris);
  for(let i=0;i<100;i++)debris.setColorAt(i,new T.Color(['#e5b1b8','#e8cb8d','#b3ca78','#d8d2ab'][i%4]));
  const motes=Array.from({length:100},()=>({x:NaN,y:0,z:0}));
  function place(mesh,n,x,z,y,yaw=0,s=1){position.set(x,y,-z);quat.setFromAxisAngle(up,yaw);scale.setScalar(s);matrix.compose(position,quat,scale);mesh.setMatrixAt(n,matrix);}
  function update(camera,time){
    bankForest.update(camera);
    const dt=Math.min(.05,time-lastTime);lastTime=time;let nf=0,nd=0,nr=0;
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
      let n=0;const size=90,cx=Math.floor(camera.position.x/size)*size,cy=Math.floor(-camera.position.z/size)*size;
      for(let i=0;i<mesh.instanceMatrix.count;i++){
        const angle=i*2.399,px=cx+Math.sin(i*133.7)*size+Math.sin(time*.3+i)*2,py=cy+Math.cos(i*78.7)*size+Math.cos(time*.45+i)*2;
        if(!cover.contains(px,py))continue;
        const floor=ground.height(px,py);if(floor===null||camera.position.y>floor+70)continue;
        const z=floor+species.height_m[0]+(.5+.5*Math.sin(time+i))* (species.height_m[1]-species.height_m[0]);
        place(mesh,n++,px,py,z,angle+time*.3,species.kind==='butterfly'?1.6:1.2);
      }
      mesh.count=n;mesh.instanceMatrix.needsUpdate=true;
    }
    let count=0;
    for(let i=0;i<Math.min(100,Math.ceil(meadowData.windborne.per_hectare*.25));i++){
      const mote=motes[i];
      if(!Number.isFinite(mote.x)||Math.hypot(mote.x-camera.position.x,mote.y+camera.position.z)>45){
        // Respawn off-centre, then drift in world space. Never attach motion to the camera.
        const angle=i*2.399;
        mote.x=camera.position.x+Math.sin(angle)*35;mote.y=-camera.position.z+Math.cos(angle)*35;
        mote.z=(ground.height(mote.x,mote.y)??0)+.7+(i%9)*.35;
      }
      const air=sampleAir(mote.x,mote.y,mote.z);
      mote.x+=air.wx*dt;mote.y+=air.wy*dt;
      const floor=(ground.height(mote.x,mote.y)??0)+.35;
      mote.z=Math.max(floor,Math.min(floor+4,mote.z+(air.lift*.15-.08)*dt));
      if(!cover.contains(mote.x,mote.y)||camera.position.y>mote.z+45)continue;
      const strength=Math.min(2,Math.hypot(air.wx,air.wy)*.16);
      place(debris,count++,mote.x,mote.y,mote.z,Math.atan2(air.wx,air.wy)+Math.sin(time*3+i)*.12,1+strength*.2);
    }
    debris.count=count;debris.instanceMatrix.needsUpdate=true;
  }
  return {group,update,rebuildImpostors(){bankForest.rebuildImpostors();},stats:{habitats:habitats.habitats.length,plantings:habitats.plantings.length}};
}

/** Presentation of the gondola, and the player's ride on it; the line and its clock are
 * shared/activities/gondola.js. Stations, towers and rope are drawn once; the cabins are
 * instanced and follow the folk world's clock, so cats ride in the cabins drawn. Walking
 * on a station deck, G boards the next cabin; riding, T (or the button) is fast travel.
 */
import * as T from '../vendor/three.module.min.js';
import {cabinsAt,boardGondola,rideAt,stationNear} from '../../../shared/activities/gondola.js';

const scene3=(x,y,z)=>new T.Vector3(x,z,-y);

function material(color,options={}){return new T.MeshStandardMaterial({color,roughness:.8,metalness:.1,...options});}

function buildStatic(line){
  const c=line.config,group=new T.Group();group.name='gondola';
  const steel=material('#7c8186',{metalness:.6,roughness:.45}),timber=material('#8b6b4c',{roughness:.95}),roof=material('#4c524b'),wheel=material('#3a3d40',{metalness:.7,roughness:.4});
  const yawAcross=Math.atan2(line.n[1],line.n[0]),yawAlong=Math.atan2(line.u[1],line.u[0]),r=c.track_m/2;
  const box=(w,h,d,mat,at,yaw)=>{const m=new T.Mesh(new T.BoxGeometry(w,h,d),mat);m.position.copy(at);m.rotation.y=yaw;m.castShadow=m.receiveShadow=true;group.add(m);return m;};
  for(const s of line.stations){
    const [x,y]=s.xy_m,long=2*r+c.cabin.length_m+5,wide=c.track_m+c.cabin.width_m+5,base=Math.max(3,s.deck_z-s.ground_z+3);
    box(long,base,wide,timber,scene3(x,y,s.deck_z-base/2),yawAlong);
    for(const [i,j] of [[-1,-1],[-1,1],[1,-1],[1,1]]){
      const px=x+line.u[0]*i*long*.45+line.n[0]*j*wide*.45,py=y+line.u[1]*i*long*.45+line.n[1]*j*wide*.45;
      box(.35,s.cable_z+1.4-s.deck_z,.35,steel,scene3(px,py,(s.deck_z+s.cable_z+1.4)/2),yawAlong);
    }
    box(long+1.5,.3,wide+1.5,roof,scene3(x,y,s.cable_z+1.55),yawAlong);
    const bull=new T.Mesh(new T.TorusGeometry(r,.18,8,32),wheel);bull.position.copy(scene3(x,y,s.cable_z+.3));bull.rotation.x=Math.PI/2;group.add(bull);
  }
  for(const t of line.towers){
    const h=t.top_z-t.base_z+1,[x,y]=t.xy_m;
    const mast=new T.Mesh(new T.CylinderGeometry(.55,1.3,h,6),steel);mast.position.copy(scene3(x,y,t.base_z-1+h/2));mast.castShadow=true;group.add(mast);
    box(c.track_m+1.6,.5,.7,steel,scene3(x,y,t.top_z+.35),yawAcross);
    for(const side of [-1,1])box(.4,.5,1.8,wheel,scene3(x+line.n[0]*side*r,y+line.n[1]*side*r,t.top_z+.1),yawAcross);
  }
  // The haul rope: both tracks from station to station, and round each bullwheel.
  const rope=[],push=(a,b)=>rope.push(a.x,a.y,a.z,b.x,b.y,b.z);
  for(const side of [-1,1]){
    let prev=null;
    for(let d=0;d<=line.length+1e-6;d+=Math.min(4,line.length-d||4)){
      const [x,y]=line.at(d),p=scene3(x+line.n[0]*side*r,y+line.n[1]*side*r,line.z(d));
      if(prev)push(prev,p);prev=p;if(d>=line.length)break;
    }
  }
  for(const [i,s] of line.stations.entries()){
    const back=i?1:-1;let prev=null;
    for(let k=0;k<=16;k++){const a=Math.PI*k/16,p=scene3(s.xy_m[0]+(line.n[0]*Math.cos(a)+back*line.u[0]*Math.sin(a))*r,s.xy_m[1]+(line.n[1]*Math.cos(a)+back*line.u[1]*Math.sin(a))*r,s.cable_z);if(prev)push(prev,p);prev=p;}
  }
  const ropeGeometry=new T.BufferGeometry();ropeGeometry.setAttribute('position',new T.Float32BufferAttribute(rope,3));
  const ropeLine=new T.LineSegments(ropeGeometry,new T.LineBasicMaterial({color:'#2d2f30'}));ropeLine.name='gondola_rope';ropeLine.frustumCulled=false;group.add(ropeLine);
  return group;
}

/** One instanced mesh per cabin part; each part's geometry is placed in the cabin's frame
 * (x along the rope, y up from the floor). */
function buildCabins(line){
  const c=line.config,k=c.cabin,count=c.cabins,group=new T.Group();group.name='gondola_cabins';
  const arm=c.hanger_m-k.height_m;
  const part=(w,h,d,y,mat)=>{const g=new T.BoxGeometry(w,h,d);g.translate(0,y,0);const m=new T.InstancedMesh(g,mat,count);m.castShadow=true;m.frustumCulled=false;group.add(m);return m;};
  const parts=[
    part(k.length_m,.55,k.width_m,.275,material('#a63d2b')),                                 // lower body
    part(k.length_m,k.height_m-.55-.25,k.width_m,.55+(k.height_m-.8)/2,material('#2c3b45',{metalness:.3,roughness:.15,transparent:true,opacity:.42,depthWrite:false})), // glazing
    part(k.length_m+.1,.25,k.width_m+.1,k.height_m-.125,material('#d6d2c4')),                 // roof
    part(.14,arm,.14,k.height_m+arm/2,material('#55595c',{metalness:.7})),                     // hanger
  ];
  const m=new T.Matrix4(),q=new T.Quaternion(),up=new T.Vector3(0,1,0),one=new T.Vector3(1,1,1),p=new T.Vector3();
  return {group,update(t){
    for(const cab of cabinsAt(line,t)){
      m.compose(p.set(cab.x,cab.floor_z,-cab.y),q.setFromAxisAngle(up,cab.heading),one);
      for(const mesh of parts)mesh.setMatrixAt(cab.index,m);
    }
    for(const mesh of parts)mesh.instanceMatrix.needsUpdate=true;
  },dispose(){for(const mesh of parts){mesh.geometry.dispose();mesh.material.dispose();}}};
}

export function createGondolaLayer({line,scene,navigation,clock,panel}){
  const group=buildStatic(line),cabins=buildCabins(line);group.add(cabins.group);scene.add(group);
  const text=panel.querySelector('[data-gondola-text]'),action=panel.querySelector('[data-gondola-action]'),fast=panel.querySelector('[data-gondola-fast]');
  let ride=null,queued=false,fastQueued=false,greeting=null;
  const key=e=>{if(e.repeat||e.metaKey||e.ctrlKey||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.code==='KeyG')queued=true;if(e.code==='KeyT'&&ride)fastQueued=true;};
  window.addEventListener('keydown',key);
  action.addEventListener('click',()=>{queued=true;});
  fast.addEventListener('click',()=>{fastQueued=true;});
  const fmt=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

  /** Stand at a station's deck on foot, ready to board (the Explore menu's start). */
  function goTo(id){
    const s=line.stations.find(s=>s.id===id)??line.stations[0];
    const other=line.stations.find(o=>o!==s);
    ride=null;navigation.alight(...s.xy_m,Math.atan2(other.xy_m[1]-s.xy_m[1],other.xy_m[0]-s.xy_m[0]));
  }

  function update(){
    const t=clock(),s=navigation.state,walking=navigation.mode==='walk';
    let message=null,label=null,canFast=false;
    if(ride){
      const r=rideAt(line,ride,t),here=line.stations[ride.from];
      if(fastQueued&&!r.waiting)ride.fast=true;
      if(r.waiting){
        if(!walking||Math.hypot(s.x-here.xy_m[0],s.y-here.xy_m[1])>line.config.board_m*2||queued){ride=null;}
        else{message=`${here.label} station · next cabin in ${Math.ceil(r.wait_s)} s`;label='Cancel (G)';}
      }else if(ride.boarded&&navigation.mode!=='gondola'){ride=null;  // left for another activity
      }else if(!r.done){
        navigation.carry({x:r.x,y:r.y,z:r.floor_z,heading:r.heading+Math.PI/2});ride.boarded=true;
        message=`Gondola to ${r.to.label} · ${fmt(Math.max(0,ride.arrive_t-t))} · V: view · drag to look`;canFast=true;
      }else{
        const [x,y]=r.exit_xy_m;navigation.alight(x,y,r.heading);greeting={text:`${r.to.label}${r.to.launch?' · the launch is a few steps ahead':''}`,until:t+6};ride=null;
      }
    }else if(walking&&s){
      const station=stationNear(line,s.x,s.y);
      if(station){
        const other=line.stations.find(o=>o!==station);
        if(queued){ride=boardGondola(line,station.id,t);}
        message=`${station.label} station · gondola to ${other.label}`;label='Board (G)';
      }
    }
    if(!message&&greeting&&t<greeting.until)message=greeting.text;
    queued=false;fastQueued=false;
    panel.hidden=!message;if(message)text.textContent=message;
    action.hidden=!label;if(label)action.textContent=label;fast.hidden=!canFast;
  }
  return {group,line,goTo,update(){update();cabins.update(clock());},get riding(){return !!ride&&navigation.mode==='gondola';},
    get ride(){return ride;},dispose(){window.removeEventListener('keydown',key);cabins.dispose();group.traverse(o=>{if(o.isMesh||o.isLineSegments){o.geometry.dispose();o.material.dispose?.();}});scene.remove(group);}};
}

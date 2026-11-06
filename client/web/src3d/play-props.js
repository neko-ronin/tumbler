/** Presentation of Tumble Hill's props and their reactions (shared/play/reactions.js).
 *
 * Each prop is a few plain primitives; the core says which reaction a swing or a bump
 * gets and the push it starts with, and this file animates it: sways and wobbles are
 * damped sines, flown things are ballistic with a bounce, bursts and cuts hide the prop
 * and grow it back after respawn_s. Particles share one instanced, camera-facing pool.
 * Scene coordinates: x east, y up, z = -north.
 */
import * as T from '../vendor/three.module.min.js';
import {checkReactions,reactionFor,swingHits,bumpHits,launch} from '../../../shared/play/reactions.js';

// The client's meadow blades stand about a metre: the small props are drawn large enough to show over them.
const DRAW_M=220,PARTICLES=400,REARM_S=.35,G=9.81;
const mat=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.85,metalness:0,...extra});
const mesh=(geometry,material,x=0,y=0,z=0)=>{const m=new T.Mesh(geometry,material);m.position.set(x,y,z);return m;};
const rnd=(i,k=0)=>{const v=Math.sin(i*12.9898+k*78.233)*43758.5453;return v-Math.floor(v);};

/** One prop's parts: `body` turns for sways and spins, `top` is what a cut takes or a
 * swing sends flying, `halves` split apart, `swinger` hangs from a pivot. */
function build(kind,i){
  const root=new T.Group(),body=new T.Group();root.add(body);let top=body,halves=null,swinger=null;
  if(kind==='tall_grass'||kind==='fern'){
    const green=mat(kind==='fern'?'#4f7a32':'#7ea24a',{side:T.DoubleSide});
    for(let k=0;k<(kind==='fern'?7:10);k++){
      const a=k/(kind==='fern'?7:10)*Math.PI*2+rnd(i,k),blade=kind==='fern'?mesh(new T.PlaneGeometry(.16,.75),green):mesh(new T.ConeGeometry(.025,.9+rnd(i,k+9)*.4,4),green);
      blade.position.set(Math.cos(a)*.12,kind==='fern'?.3:.5,Math.sin(a)*.12);blade.rotation.set(Math.sin(a)*(kind==='fern'?.9:.2),a,Math.cos(a)*(kind==='fern'?.9:.2));body.add(blade);
    }
  }else if(kind==='dandelion'){
    body.add(mesh(new T.CylinderGeometry(.01,.014,1.05,4),mat('#6b8f3a'),0,.52,0));
    top=mesh(new T.SphereGeometry(.13,12,9),mat('#f4f1e6',{transparent:true,opacity:.85}),0,1.1,0);body.add(top);
  }else if(kind==='melon'){
    halves=[0,1].map(k=>{const h=mesh(new T.SphereGeometry(.42,16,12,k*Math.PI,Math.PI),mat(k?'#79b046':'#6aa13c',{side:T.DoubleSide}));h.scale.set(1,.85,1.2);h.position.y=.36;body.add(h);return h;});
  }else if(kind==='pine_cone'){
    top=mesh(new T.ConeGeometry(.1,.26,7),mat('#8a5a2e'),0,.1,0);top.rotation.z=1.4;body.add(top);
  }else if(kind==='mushroom'){
    // A toadstool tall enough to see over the meadow.
    body.add(mesh(new T.CylinderGeometry(.07,.09,.85,8),mat('#efe6d2'),0,.42,0));
    top=mesh(new T.SphereGeometry(.32,14,7,0,Math.PI*2,0,Math.PI/2),mat('#c2412f'),0,.82,0);body.add(top);
  }else if(kind==='straw_target'){
    body.add(mesh(new T.CylinderGeometry(.05,.05,1.5,6),mat('#6e5434'),0,.75,0));
    const face=mesh(new T.CylinderGeometry(.45,.45,.18,16),mat('#d9b45a'),0,1.2,0);face.rotation.x=Math.PI/2;body.add(face);
    const ring=mesh(new T.TorusGeometry(.22,.035,6,20),mat('#b8382c'),0,1.2,.1);body.add(ring);
  }else if(kind==='scarecrow'){
    root.add(mesh(new T.CylinderGeometry(.05,.05,1.9,6),mat('#6e5434'),0,.95,0));
    body.add(mesh(new T.BoxGeometry(1.3,.08,.08),mat('#6e5434'),0,1.35,0),mesh(new T.CylinderGeometry(.2,.28,.6,8),mat('#8a6a9a'),0,1.2,0),
      mesh(new T.SphereGeometry(.17,10,8),mat('#d9b45a'),0,1.68,0),mesh(new T.ConeGeometry(.24,.3,10),mat('#5b4a2e'),0,1.93,0));
  }else if(kind==='hanging_bell'){
    const wood=mat('#6e5434');
    root.add(mesh(new T.CylinderGeometry(.05,.06,2.3,6),wood,-.6,1.15,0),mesh(new T.CylinderGeometry(.05,.06,2.3,6),wood,.6,1.15,0),mesh(new T.BoxGeometry(1.4,.1,.1),wood,0,2.25,0));
    swinger=new T.Group();swinger.position.y=2.2;root.add(swinger);
    const bell=mesh(new T.CylinderGeometry(.09,.26,.42,14,1,true),mat('#c9a13b',{metalness:.7,roughness:.35,side:T.DoubleSide}),0,-.3,0);swinger.add(bell,mesh(new T.SphereGeometry(.06,8,6),mat('#3b3326'),0,-.5,0));
  }else if(kind==='snow_pile'){
    top=mesh(new T.SphereGeometry(.7,14,8),mat('#f3f8fb',{roughness:1}),0,0,0);top.scale.set(1,.55,1);body.add(top);
  }
  root.traverse(n=>{if(n.isMesh){n.castShadow=false;n.receiveShadow=true;}});
  top.userData.home=top.position.clone();top.userData.turn=top.rotation.clone();
  return {root,body,top,halves,swinger};
}

/** `hill` is tumble-hill.json, `table` reactions.json; `height(x, y)` the floor; `cue(name)` plays a sound. */
export function createPlayProps({hill,table,height,scene,cue=()=>{}}){
  checkReactions(table,hill.props);
  const group=new T.Group();group.name='tumble_hill_props';scene.add(group);
  const props=hill.props.map((thing,i)=>{
    const parts=build(thing.kind,i),[x,y]=thing.xy_m;group.add(parts.root);
    parts.root.position.set(x,height(x,y)??0,-y);parts.root.rotation.y=rnd(i,3)*Math.PI*2;
    return {...parts,i,live:{...thing,xy_m:[x,y]},home:[x,y],anim:null,t:0,cool:0,gone:0,angle:0,spin:0,fly:null,tilt:new T.Vector3(1,0,0)};
  });
  const things=props.map(p=>p.live);
  // Particles: camera-facing quads, coloured per instance, each with its own fall.
  const pool=new T.InstancedMesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({side:T.DoubleSide,transparent:true,opacity:.9,depthWrite:false}),PARTICLES);
  pool.frustumCulled=false;pool.count=0;pool.setColorAt(0,new T.Color());group.add(pool);
  const bits=[],FALL={blades:[6,1.5,.06],leaves:[4,2,.08],seeds:[.25,1.2,.035],juice:[9,.4,.05],spores:[.15,1.6,.03],straw:[7,1.4,.07],snow:[3,1.8,.07]};
  const spinQ=new T.Quaternion(),m4=new T.Matrix4(),pos=new T.Vector3(),scl=new T.Vector3(),col=new T.Color(),up=new T.Vector3(0,1,0);
  function spray(p,reaction,dir){
    const k=reaction.particles;if(!k)return;
    const [g,drag,size]=FALL[k.kind],o=p.root.position;
    for(let n=0;n<k.count&&bits.length<PARTICLES;n++){
      const a=rnd(p.i*31+n,bits.length)*Math.PI*2,s=1+rnd(n,p.i)*2.5;
      bits.push({x:o.x,y:o.y+(p.top===p.body?.5:p.top.position.y),z:o.z,vx:Math.cos(a)*s+dir.x*2,vy:1.5+rnd(n,7)*2.5,vz:Math.sin(a)*s+dir.z*2,
        g,drag,size:size*(.7+rnd(n,2)*.6),life:1.4+rnd(n,5)*1.6,color:k.colour});
    }
  }
  /** Start `action`'s reaction on prop p, pushed from `from` ([x, y]). */
  function react(p,action,from){
    const reaction=reactionFor(table,p.live.kind,action);if(!reaction||p.cool>0||p.gone>0)return false;
    p.cool=REARM_S;p.anim=reaction.anim;p.t=0;p.reaction=reaction;cue(reaction.sound);
    const [vx,vy,vz,spin]=launch(reaction,from,p.live),dir=new T.Vector3(p.live.xy_m[0]-from[0],0,-(p.live.xy_m[1]-from[1])).normalize();
    p.tilt.set(dir.z,0,-dir.x);  // lean away from the push: the axis across it
    spray(p,reaction,dir);
    if(reaction.anim==='fly'||reaction.anim==='split')p.fly={x:p.root.position.x,y:p.root.position.y,z:p.root.position.z,vx,vy:vz,vz:-vy,spin,rot:0};
    if(reaction.anim==='spin')p.spin=spin;
    return true;
  }
  const hide=(p,on)=>{(p.top===p.body?p.body:p.top).visible=!on;if(p.halves)for(const h of p.halves)h.visible=!on;};
  function update(dt,camera,bodies=[]){
    group.visible=camera.position.distanceTo(props[0].root.position)<DRAW_M+300;
    if(!group.visible||!(dt>0))return;
    for(const b of bodies)for(const t of bumpHits(table,things,[b.x,b.y],b.speed,b.radius??.35)){const p=props.find(q=>q.live===t);react(p,'bump',[b.x-(b.vx??0),b.y-(b.vy??0)]);}
    for(const p of props){
      p.cool=Math.max(0,p.cool-dt);p.t+=dt;const r=p.reaction,t=p.t;
      if(p.gone>0){p.gone-=dt;if(p.gone<=0){hide(p,false);p.anim='grow';p.t=0;p.top.position.copy(p.top.userData.home);p.top.rotation.copy(p.top.userData.turn);}}
      p.body.quaternion.identity();p.body.scale.set(1,1,1);if(p.swinger)p.swinger.rotation.set(0,0,0);
      if(p.angle)p.body.quaternion.setFromAxisAngle(up,p.angle);  // where a spin left it facing
      if(!p.anim)continue;
      const damped=r?Math.sin(2*Math.PI*(r.hz??1)*t)*Math.exp(-(r.damping_per_s??2)*t)*(r.amplitude_deg??0)*Math.PI/180:0;
      if(['sway','wobble','swing'].includes(p.anim)){
        (p.anim==='swing'?p.swinger.quaternion.identity():p.body.quaternion).premultiply(spinQ.setFromAxisAngle(p.tilt,damped));
        if(t*(r.damping_per_s??2)>6)p.anim=null;  // under a quarter of a percent of the first swing
      }
      else if(p.anim==='spin'){p.spin*=Math.exp(-(r.damping_per_s??1)*dt);p.angle+=p.spin*dt;if(p.spin<.05)p.anim=null;}
      else if(p.anim==='squash'){const k=Math.exp(-6*t);p.body.scale.set(1+.4*k,1-.6*k,1+.4*k);if(t>1)p.anim=null;}
      else if(p.anim==='cut'||p.anim==='burst'){
        // Gone at once (a cut leaves a stub), back after respawn_s.
        if(p.anim==='cut'){p.body.scale.set(1,Math.max(.12,1-t*12),1);if(t>.1){p.anim=null;p.gone=r.respawn_s??20;p.body.scale.set(1,.12,1);}}
        else{hide(p,true);p.anim=null;p.gone=r.respawn_s??20;}
      }else if(p.anim==='grow'){const k=Math.min(1,t/1.5);p.body.scale.set(1,.12+.88*k*k*(3-2*k),1);if(k>=1)p.anim=null;}
      if(p.anim==='spin')p.body.quaternion.setFromAxisAngle(up,p.angle);
      if(p.fly&&p.anim==='split'){
        p.halves.forEach((h,k)=>{const side=k?1:-1;h.position.set(-p.tilt.x*side*t*1.6,.36+Math.max(0,.6*t-1.5*t*t),-p.tilt.z*side*t*1.6);h.rotation.z=side*Math.min(1.4,t*4);});
        if(t>1.4){hide(p,true);p.fly=null;p.anim=null;p.gone=r.respawn_s??40;p.halves.forEach(h=>{h.position.set(0,.36,0);h.rotation.z=0;});}
      }else if(p.fly){
        // Ballistic, with a bounce and rolling friction on the floor. A thing that grows
        // back loses only its top (a mushroom cap); anything else goes with it and stays.
        const f=p.fly;f.vy-=G*dt;f.x+=f.vx*dt;f.y+=f.vy*dt;f.z+=f.vz*dt;f.rot+=f.spin*dt;
        const floor=height(f.x,-f.z)??f.y;
        if(f.y<=floor){f.y=floor;if(Math.abs(f.vy)>1.2)f.vy*=-.35;else f.vy=0;f.vx*=.9;f.vz*=.9;f.spin*=.85;}
        if(r.respawn_s){p.top.position.set(f.x-p.root.position.x,f.y-p.root.position.y+p.top.userData.home.y,f.z-p.root.position.z).applyAxisAngle(up,-p.root.rotation.y);p.top.rotation.x=f.rot;}
        else{p.root.position.set(f.x,f.y,f.z);p.live.xy_m=[f.x,-f.z];p.body.rotation.x=f.rot;}
        if(f.vy===0&&Math.hypot(f.vx,f.vz)<.05){p.fly=null;p.anim=null;if(r.respawn_s){p.gone=r.respawn_s;hide(p,true);}}
      }
    }
    let n=0;
    for(let k=bits.length-1;k>=0;k--){
      const b=bits[k];b.life-=dt;if(b.life<=0){bits.splice(k,1);continue;}
      const d=Math.exp(-b.drag*dt);b.vx*=d;b.vz*=d;b.vy=b.vy*d-b.g*dt;b.x+=b.vx*dt;b.y+=b.vy*dt;b.z+=b.vz*dt;
      const floor=height(b.x,-b.z);if(floor!==null&&b.y<floor+.02){b.y=floor+.02;b.vx=b.vz=b.vy=0;}
      m4.compose(pos.set(b.x,b.y,b.z),camera.quaternion,scl.setScalar(b.size*Math.min(1,b.life*2)));pool.setMatrixAt(n,m4);pool.setColorAt(n++,col.set(b.color));
    }
    pool.count=n;pool.instanceMatrix.needsUpdate=true;if(pool.instanceColor)pool.instanceColor.needsUpdate=true;
  }
  /** A katana blow from [x, y] facing `heading` (rad, from east). Returns what it touched. */
  function swing(from,heading){
    if(!group.visible)return [];
    const hits=swingHits(table,things.filter((_,i)=>props[i].gone<=0),from,heading);
    for(const t of hits)react(props.find(p=>p.live===t),'swing',from);
    return hits.map(t=>t.id);
  }
  return {group,update,swing,react,props,dispose(){group.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.dispose();}});scene.remove(group);}};
}

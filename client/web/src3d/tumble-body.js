/** S0 TUMBLE SPIKE: throwaway, not production. See docs/design/S0-TUMBLE-SPIKE.md.
 *
 * A spring body over the authored clips while a body is down (shared/activities/balance.js:
 * trip, tumble, slide, recover, roll). Presentation only: the core still owns where the body
 * is and how fast it goes; this owns how it looks getting there.
 *
 * - Root: the body turns about (ground normal × velocity) at |v|/r, on the ground it is on,
 *   whatever way it faces, so a body tripping across a slope log-rolls instead of
 *   somersaulting about the wrong axis. It keeps its vertical momentum over a lip (a hop the
 *   core does not have) and squashes, volume kept, when it lands.
 * - Contact: the trunk (hips, spine, head) rests on the terrain at its lowest point, so the
 *   body lies on the slope instead of standing upright in the world with its head in the hill.
 * - Limbs: verlet chains (elbow, paw; knee, ankle; head tip) hung off the posed trunk, pulled
 *   toward where the clip puts them by a per-phase stiffness, swung by the spin, dropped by
 *   gravity and kept out of the ground; the bones are then aimed at the particles.
 *
 * Shared by the player (character.js) and the cat folk (folk.js): both rigs name these bones.
 */
import * as T from '../vendor/three.module.min.js';

const G=9.81,SUB_S=1/120,EASE_IN_S=.12,EASE_OUT_S=.3,DAMP_PER_S=3,FRICTION=.3,LIP_G=1.5,LIP_M=.03,RISE_PER_S=35,DROP_PER_S=20,SINK_M=.04;
// How hard the limbs follow the clip (1/s; fewer at speed, so they flail), and whether the
// feet bear weight (trip, recover) or only the trunk does.
const PHASES={trip:{stiff:12,feet:true},tumble:{stiff:5},roll:{stiff:9},slide:{stiff:3},recover:{stiff:16,feet:true}};
// Radii as a fraction of the body's hip height.
const R={trunk:.27,head:.29,elbow:.07,paw:.09,knee:.09,ankle:.14};

const v3=()=>new T.Vector3(),UP=new T.Vector3(0,1,0);

/** Points on a rig, by bone, with an optional offset along the bone (+Y in these rigs). */
function rigPoints(model){
  const bone=name=>model.getObjectByName(name),hips=bone('hips'),head=bone('head');
  const size=hips.position.y*model.scale.y;
  const at=(b,len=0,r=0)=>({bone:b,local:new T.Vector3(0,len,0),r:r*size});
  const chains=[];
  for(const s of ['L','R']){
    const ua=bone('upper_arm.'+s),fa=bone('forearm.'+s),th=bone('thigh.'+s),sh=bone('shin.'+s),he=bone('heel.'+s);
    if(ua&&fa)chains.push({bones:[ua,fa],points:[at(fa,0,R.elbow),at(fa,fa.position.length(),R.paw)],kind:'paw'});
    if(th&&sh&&he)chains.push({bones:[th,sh],points:[at(sh,0,R.knee),at(he,0,R.ankle)],kind:'foot'});
  }
  const headTip=at(head,head.position.length()*.55,R.head);
  chains.push({bones:[head],points:[headTip],kind:'head',neck:true});
  const trunk=[at(hips,0,R.trunk),at(bone('spine'),0,R.trunk),headTip];
  const feet=chains.filter(c=>c.kind==='foot').map(c=>c.points[1]);
  // The body turns about the middle of its parts, not its hips: a tuck rolls round instead of
  // vaulting over its own head.
  const centre=[...trunk,...chains.flatMap(c=>c.points)];
  return {hips,size,chains,trunk,feet,centre};
}
const worldOf=(p,out)=>p.bone.localToWorld(out.copy(p.local));

export function createTumbleBody(model,{radius=.45}={}){
  const rig=rigPoints(model);
  for(const c of rig.chains)for(const p of c.points)Object.assign(p,{pos:v3(),prev:v3(),tgt:v3(),last:v3()});
  for(const c of rig.chains)Object.assign(c,{anchor:v3(),anchorLast:v3()});
  const st={w:0,phase:null,lie:null,posed:false,fresh:true,q:new T.Quaternion(),om:v3(),py:0,vy:0,air:false,rate:0,floor:0,h:0,squash:0,squashV:0,t:0,seed:Math.random()*6.3,impact:0,lift:0};
  const saved=new Map(),qBack=new T.Quaternion(),qFront=new T.Quaternion(),qUp=new T.Quaternion(),qGoal=new T.Quaternion(),q1=new T.Quaternion(),p1=v3(),s1=v3(),qL=new T.Quaternion(),pL=v3(),dq=new T.Quaternion(),tq=new T.Quaternion(),pq=new T.Quaternion(),bq=new T.Quaternion();
  const n=v3(),f=v3(),axis=v3(),omGoal=v3(),pivotM=v3(),pivotW=v3(),a=v3(),b=v3(),c=v3(),d=v3(),m=new T.Matrix4();
  const height=(ground,x,z)=>ground(x,-z)??-Infinity;

  /** World orientation for lying on the slope: on his back feet first (propped 0.35 rad up
   * off it), or on his front head first. The first call of a slide picks whichever is nearer. */
  function lying(out){
    const y=a.copy(f).negate(),z=b.copy(n);
    qBack.setFromRotationMatrix(m.makeBasis(c.crossVectors(y,z),y,z)).multiply(dq.setFromAxisAngle(c.set(1,0,0),.35));
    y.copy(f);z.copy(n).negate();qFront.setFromRotationMatrix(m.makeBasis(c.crossVectors(y,z),y,z));
    st.lie??=Math.abs(qBack.dot(st.q))>=Math.abs(qFront.dot(st.q))?'back':'front';
    return out.copy(st.lie==='back'?qBack:qFront);
  }
  /** Angular velocity that closes the gap to `goal` in about 1/k s. */
  function toward(goal,k,out){
    dq.copy(goal).multiply(tq.copy(st.q).invert());if(dq.w<0)dq.set(-dq.x,-dq.y,-dq.z,-dq.w);
    const s=Math.sqrt(Math.max(0,1-dq.w*dq.w)),angle=2*Math.acos(Math.min(1,dq.w));
    return s<1e-6?out.set(0,0,0):out.set(dq.x/s,dq.y/s,dq.z/s).multiplyScalar(angle*k);
  }
  function setRoot(object,py){
    // The hips go where the trunk rests; the model's origin follows from its orientation.
    pivotW.set(object.position.x,py,object.position.z);
    a.copy(pivotM).multiply(model.scale).applyQuaternion(st.q);
    object.worldToLocal(pL.copy(pivotW).sub(a));
    qL.copy(object.getWorldQuaternion(tq)).invert().multiply(st.q);
    model.quaternion.copy(q1).slerp(qL,st.w);model.position.copy(p1).lerp(pL,st.w);
    model.updateMatrixWorld(true);
  }

  /** `bal`: the balance state (phase, progress, vx, vy) while down, else null. `ground(x, y)`
   * is the floor height (x east, y north). Call after the clip has posed the bones. */
  function update(dt,bal,{object,ground}){
    const on=!!(bal&&PHASES[bal.phase]);
    st.w=on?Math.min(1,st.w+dt/EASE_IN_S):Math.max(0,st.w-dt/EASE_OUT_S);
    if(st.w<=0||!(dt>0)){st.fresh=true;st.phase=null;return false;}
    if(on&&bal.phase!==st.phase){st.phase=bal.phase;st.lie=null;}
    const k=PHASES[st.phase]??PHASES.recover;st.t+=dt;
    object.updateWorldMatrix(true,false);
    q1.copy(model.quaternion);p1.copy(model.position);s1.copy(model.scale);
    model.updateMatrixWorld(true);pivotM.set(0,0,0);
    for(const p of rig.centre)pivotM.add(model.worldToLocal(worldOf(p,a)));pivotM.divideScalar(rig.centre.length);
    if(st.fresh){object.getWorldQuaternion(st.q).multiply(q1);st.om.set(0,0,0);}
    // The ground under him and his velocity along it.
    const x=object.position.x,z=object.position.z;
    n.set(height(ground,x-.4,z)-height(ground,x+.4,z),.8,height(ground,x,z-.4)-height(ground,x,z+.4));
    if(!Number.isFinite(n.lengthSq())||n.lengthSq()<1e-9)n.copy(UP);n.normalize();
    const vx=bal?.vx??0,vy=bal?.vy??0;a.set(vx,0,-vy);a.y=-n.dot(a)/n.y;
    const speed=a.length(),fall=a.y;  // how fast the ground under him drops as he moves over it (m/s)
    if(speed>.5)f.copy(a).divideScalar(speed);
    else{f.set(0,0,1).applyQuaternion(object.quaternion);f.addScaledVector(n,-f.dot(n)).normalize();}
    axis.crossVectors(n,f).normalize();
    // Angular velocity: topple over the feet, roll with the ground, or settle into a pose.
    const phase=on?st.phase:'stand';
    if(phase==='trip')omGoal.copy(axis).multiplyScalar(5.5*Math.min(1,bal.progress??0)+speed/radius*.3);
    else if(phase==='tumble'||phase==='roll'){
      // An irregular body does not roll true: a slow twist about the travel direction.
      omGoal.copy(axis).multiplyScalar(speed/radius).addScaledVector(f,speed/radius*.3*Math.sin(st.t*2.3+st.seed));
    }
    else if(phase==='slide')toward(lying(qGoal),5,omGoal);
    else toward(object.getWorldQuaternion(qUp),phase==='recover'?6:9,omGoal);
    st.om.lerp(omGoal,1-Math.exp(-dt*(phase==='tumble'||phase==='roll'?8:12)));
    const turn=st.om.length()*dt;
    if(turn>1e-7)st.q.premultiply(dq.setFromAxisAngle(c.copy(st.om).normalize(),turn)).normalize();
    // Squash and stretch along the world vertical, volume kept, on a wobbly spring; before the
    // body is rested on the ground, so a squashed body still touches it.
    st.squashV+=(-300*st.squash-14*st.squashV)*dt;st.squash=Math.max(-.35,Math.min(.35,st.squash+st.squashV*dt));
    const sq=1+st.squash*st.w;
    for(const [i,key] of ['x','y','z'].entries()){const cos=d.set(+(i===0),+(i===1),+(i===2)).applyQuaternion(st.q).y;model.scale[key]=s1[key]*sq**((3*cos*cos-1)/2);}
    // Rest the trunk on the ground (and the feet, while they bear weight), then let it fly over lips.
    setRoot(object,object.position.y);
    let lift=-Infinity;
    for(const p of k.feet||st.w<1?[...rig.trunk,...rig.feet]:rig.trunk){worldOf(p,c);lift=Math.max(lift,height(ground,c.x,c.z)+p.r-c.y);}
    if(!Number.isFinite(lift))lift=0;
    // Over a lip: the ground under him (the core keeps him on it) drops away faster than he could
    // fall after it, so he flies on with its vertical speed until the body meets it again. Only
    // the terrain counts; the body's own height over it (the lift) changes as it turns, and the
    // spin is driven, not dynamic, so those changes are eased instead of flown.
    const floor=object.position.y,rate=fall;
    if(st.fresh){st.h=lift;st.py=floor+lift;st.air=false;st.rate=rate;st.floor=floor;}
    st.impact=0;st.lift=lift;
    // A drop under LIP_M is followed down: the heightfield's own facets are not lips.
    if(!st.air&&floor<st.floor+(st.rate-LIP_G*G*dt)*dt-LIP_M){st.air=true;st.vy=st.rate;}
    st.rate=rate;st.floor=floor;
    if(st.air){
      st.vy-=G*dt;st.py+=st.vy*dt;
      if(st.py<=floor+lift){
        st.impact=rate-st.vy;st.air=false;st.h=lift;
        if(st.impact>1.2)st.squashV-=Math.min(4,st.impact)*.9;
        // A hard landing bounces once, a little.
        if(st.impact>4){st.vy=rate+.25*st.impact;st.air=true;st.py=floor+lift;}
      }
    }
    if(!st.air){
      // Soft contact: a turn that brings a new part lowest pushes him up over a few frames
      // (sinking at most SINK_M), and one that lifts a part lets him down over a few more.
      st.h=st.h<lift?Math.max(lift-SINK_M,st.h+(lift-st.h)*(1-Math.exp(-dt*RISE_PER_S))):st.h+(lift-st.h)*(1-Math.exp(-dt*DROP_PER_S));
      st.py=floor+st.h;
    }
    setRoot(object,st.py);
    simulate(dt,k,speed,ground,on?1:st.w);
    st.fresh=false;st.posed=true;
    return true;
  }

  // The particles start on the clip's pose, so the limbs need no blend in; on the way out they
  // are weighted back to the clip by `weight`.
  function simulate(dt,k,speed,ground,weight){
    for(const ch of rig.chains){ch.anchor.copy(ch.bones[0].getWorldPosition(a));for(const p of ch.points)worldOf(p,p.tgt);}
    if(st.fresh)for(const ch of rig.chains){ch.anchorLast.copy(ch.anchor);for(const p of ch.points){p.pos.copy(p.tgt);p.prev.copy(p.tgt);p.last.copy(p.tgt);}}
    const steps=Math.max(1,Math.ceil(dt/SUB_S-1e-9)),h=dt/steps,damp=Math.exp(-DAMP_PER_S*h);
    for(const ch of rig.chains){
      const stiff=(ch.neck?2:1)*k.stiff/(1+speed/6),pull=1-Math.exp(-stiff*h);
      for(let s=1;s<=steps;s++){
        const u=s/steps,u0=(s-1)/steps;
        let parent=b.lerpVectors(ch.anchorLast,ch.anchor,u),parentTgt=ch.anchor;
        for(const p of ch.points){
          const tgt=c.lerpVectors(p.last,p.tgt,u),carried=d.lerpVectors(p.last,p.tgt,u0).negate().add(tgt);
          // Inertia in the world, damped only relative to where the clip carries the limb,
          // so a fast-moving body does not drag its limbs behind as if through syrup.
          const vel=a.subVectors(p.pos,p.prev).sub(carried).multiplyScalar(damp).add(carried);
          p.prev.copy(p.pos);p.pos.add(vel);p.pos.y-=G*h*h;
          p.pos.lerp(tgt,pull);
          // Keep the bone's length from the clip, measured from the joint above (follow the
          // leader), and the joint out of the ground; twice, since each undoes a little of the other.
          for(let pass=0;pass<2;pass++){
            a.subVectors(p.pos,parent);const dist=a.length();if(dist>1e-6)p.pos.copy(parent).addScaledVector(a,p.tgt.distanceTo(parentTgt)/dist);
            const floor=height(ground,p.pos.x,p.pos.z)+p.r;
            if(p.pos.y<floor){p.pos.y=floor;if(!pass){p.prev.y=floor;p.prev.x+=(p.pos.x-p.prev.x)*FRICTION;p.prev.z+=(p.pos.z-p.prev.z)*FRICTION;}}
          }
          parent=p.pos;parentTgt=p.tgt;
        }
      }
      ch.anchorLast.copy(ch.anchor);for(const p of ch.points)p.last.copy(p.tgt);
      // Aim each bone at its particle.
      ch.bones.forEach((bone,i)=>{
        const p=ch.points[i];if(!saved.has(bone))saved.set(bone,bone.quaternion.clone());
        const from=bone.getWorldPosition(a),now=worldOf(p,c).sub(from).normalize(),want=d.copy(p.pos).sub(from).normalize();
        tq.setFromUnitVectors(now,want);dq.identity().slerp(tq,weight);
        bone.parent.getWorldQuaternion(pq).invert();bone.getWorldQuaternion(bq);
        bone.quaternion.copy(pq.multiply(dq).multiply(bq));bone.updateMatrixWorld(true);
      });
    }
  }
  /** Put back the bone rotations the chains turned and the model's own transform, before the
   * mixer and the caller's pose run again: a caller that writes only some Euler angles would
   * otherwise inherit this frame's roll. */
  function restore(){
    for(const [bone,q] of saved)bone.quaternion.copy(q);saved.clear();
    if(st.posed){model.quaternion.copy(q1);model.position.copy(p1);model.scale.copy(s1);st.posed=false;}
  }
  return {update,restore,get active(){return st.w>0;},get weight(){return st.w;},state:st,rig};
}

/** For comparing the two approaches: how deep each kind of part of a posed body dips into the
 * ground (m), how far its lowest part is off it (negative: in it), and the largest world
 * acceleration of any part (m/s²). Smooth tumbling stays near ω²r (about 200 m/s² at 9 m/s); a
 * pop, a part jumping between frames, shows as a spike well above that. Works on any rig
 * `rigPoints` reads, whichever way it was posed. */
export function createGauge(model){
  const rig=rigPoints(model),parts=[...rig.trunk.slice(0,2).map(p=>['trunk',p]),...rig.chains.map(c=>[c.kind,c.points.at(-1)])];
  const hist=parts.map(()=>[]),w=v3();
  return function gauge(object,ground,dt){
    object.updateMatrixWorld(true);const dip={trunk:0,head:0,paw:0,foot:0};let acc=0,clear=Infinity;
    parts.forEach(([kind,p],i)=>{
      worldOf(p,w);const floor=ground(w.x,-w.z);
      if(Number.isFinite(floor)){const gap=w.y-p.r-floor;dip[kind]=Math.max(dip[kind],-gap);clear=Math.min(clear,gap);}
      const h=hist[i];h.unshift(w.clone());if(h.length>3)h.pop();
      if(h.length===3&&dt>0)acc=Math.max(acc,w.copy(h[0]).sub(h[1]).sub(h[1]).add(h[2]).length()/(dt*dt));
    });
    return {dip,clear,acc};
  };
}

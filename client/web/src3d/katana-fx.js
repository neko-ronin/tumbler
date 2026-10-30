/** Katana presentation: the light trail the blade sweeps while he attacks, the
 * shock rings, flash and sparks of a blow that lands, and the blade's glow
 * swelling with the fight. Everything is drawn in the character object's frame
 * (his feet stay put while he attacks), additive and unlit: no light is added,
 * so no scene shader recompiles. The group sits beside the character, following
 * his transform, so his own bounds stay his. Cues come from the katana clips' events. */
import * as T from '../vendor/three.module.min.js';
const TRAIL_S=.22,HISTORY=24,SUB=4,SPARKS=120,GLOW=1.6,TIP_M=.16,INNER=.3;
const GLOW_COLOR=new T.Color(.25,.95,.8);

export function createKatanaFx(object,model,scale){
  const handle=model.getObjectByName('katana'),tipBone=model.getObjectByName('blade.4');
  const glows=new Set();model.traverse(n=>{if(n.isMesh&&n.material.name==='glow')glows.add(n.material);});
  const additive=extra=>({transparent:true,depthWrite:false,blending:T.AdditiveBlending,toneMapped:false,...extra});
  const group=new T.Group();group.name='katana_fx';group.matrixAutoUpdate=false;

  // Trail: a ribbon between a point 30% up the blade and its tip, over the last
  // TRAIL_S seconds, smoothed with Catmull-Rom so a 30 FPS spin still reads as an arc.
  const points=(HISTORY-1)*SUB+1,trailPos=new Float32Array(points*6),trailColor=new Float32Array(points*8),index=[];
  for(let i=0;i<points-1;i++){const a=i*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}
  const trailGeometry=new T.BufferGeometry();
  trailGeometry.setAttribute('position',new T.BufferAttribute(trailPos,3).setUsage(T.DynamicDrawUsage));
  trailGeometry.setAttribute('color',new T.BufferAttribute(trailColor,4).setUsage(T.DynamicDrawUsage));
  trailGeometry.setIndex(index);
  const trail=new T.Mesh(trailGeometry,new T.MeshBasicMaterial(additive({vertexColors:true,side:T.DoubleSide})));
  trail.frustumCulled=false;group.add(trail);
  const history=[];

  // A soft round dot for sparks.
  const dot=new Uint8Array(16*16*4);
  for(let y=0;y<16;y++)for(let x=0;x<16;x++){const r=Math.hypot(x-7.5,y-7.5)/7.5;dot.set([255,255,255,Math.round(255*Math.max(0,1-r)**2)],(y*16+x)*4);}
  const dotTexture=new T.DataTexture(dot,16,16);dotTexture.needsUpdate=true;
  const sparkPos=new Float32Array(SPARKS*3),sparkColor=new Float32Array(SPARKS*4),sparkVel=new Float32Array(SPARKS*3),sparkLife=new Float32Array(SPARKS),sparkAge=new Float32Array(SPARKS).fill(1);
  const sparkGeometry=new T.BufferGeometry();
  sparkGeometry.setAttribute('position',new T.BufferAttribute(sparkPos,3).setUsage(T.DynamicDrawUsage));
  sparkGeometry.setAttribute('color',new T.BufferAttribute(sparkColor,4).setUsage(T.DynamicDrawUsage));
  const sparks=new T.Points(sparkGeometry,new T.PointsMaterial(additive({size:.07*scale,map:dotTexture,vertexColors:true})));
  sparks.frustumCulled=false;group.add(sparks);
  let nextSpark=0;

  // Shock rings and a flash where a blow meets the ground.
  const ringGeometry=new T.RingGeometry(.86,1,64).rotateX(-Math.PI/2);
  const rings=[0,1].map(()=>{const m=new T.Mesh(ringGeometry,new T.MeshBasicMaterial(additive({color:GLOW_COLOR,side:T.DoubleSide,opacity:0})));m.visible=false;group.add(m);return {mesh:m,age:1,life:1,reach:1};});
  const flash=new T.Mesh(new T.SphereGeometry(1,16,12),new T.MeshBasicMaterial(additive({color:new T.Color(.8,1,.95),opacity:0})));flash.visible=false;group.add(flash);
  let flashAge=1;

  const v=new T.Vector3(),base=new T.Vector3(),tip=new T.Vector3();
  let glow=GLOW,charge=0;
  function bladePoints(){
    object.worldToLocal(handle.getWorldPosition(base));
    object.worldToLocal(tipBone.localToWorld(tip.set(0,TIP_M,0)));
    return [base.clone().lerp(tip,INNER),tip.clone()];
  }
  function spawn(count,at,speed,lift,life){
    for(let k=0;k<count;k++){
      const i=nextSpark;nextSpark=(nextSpark+1)%SPARKS;
      const a=Math.random()*Math.PI*2,u=Math.random(),s=speed*(.4+.6*Math.random());
      sparkPos.set([at.x,at.y,at.z],i*3);
      sparkVel.set([Math.cos(a)*s*Math.sqrt(1-u*u),lift*(.5+Math.random())+s*u*.5,Math.sin(a)*s*Math.sqrt(1-u*u)],i*3);
      sparkAge[i]=0;sparkLife[i]=life*(.5+Math.random()*.5);
    }
  }
  function ring(slot,at,reach,life){const r=rings[slot];r.age=0;r.life=life;r.reach=reach;r.mesh.position.set(at.x,.04*scale,at.z);r.mesh.visible=true;}
  function cue(name){
    if(name==='charge')charge=1;
    else if(name==='impact'){
      const [,t]=bladePoints();t.y=Math.max(.04*scale,t.y);
      ring(0,t,2.6*scale,.45);ring(1,t,1.4*scale,.7);
      flash.position.copy(t);flashAge=0;flash.visible=true;
      spawn(70,t,3.2*scale,2.2*scale,.8);charge=.6;
    }
    else if(name==='ring'||name==='flick'){const [,t]=bladePoints();spawn(name==='ring'?14:20,t,1.2*scale,.6*scale,.45);}
    else if(name==='land'){object.worldToLocal(model.getWorldPosition(v));v.y=0;ring(1,v,1.1*scale,.4);spawn(16,v.setY(.05*scale),1.4*scale,.5*scale,.35);}
  }
  /** attacking: emit the trail; drawn: the blade is out (its glow idles brighter). */
  function update(dt,attacking,drawn){
    if(!group.parent&&object.parent)object.parent.add(group);
    group.matrix.copy(object.matrix);group.matrixWorldNeedsUpdate=true;group.visible=object.visible;
    // Trail history: age out old samples, add this frame's while attacking.
    for(const h of history)h.age+=dt;
    while(history.length&&history[0].age>TRAIL_S)history.shift();
    if(attacking){const [a,b]=bladePoints();history.push({a,b,age:0});if(history.length>HISTORY)history.shift();}
    const n=history.length;let count=0;
    if(n>=2){
      const at=(i,k)=>history[Math.max(0,Math.min(n-1,i))][k];
      const cr=(p0,p1,p2,p3,t,out)=>{const t2=t*t,t3=t2*t;
        return out.set(0,0,0).addScaledVector(p0,-.5*t3+t2-.5*t).addScaledVector(p1,1.5*t3-2.5*t2+1).addScaledVector(p2,-1.5*t3+2*t2+.5*t).addScaledVector(p3,.5*t3-.5*t2);};
      for(let i=0;i<n-1;i++)for(let s=0;s<(i===n-2?SUB+1:SUB);s++){
        const t=s/SUB,age=history[i].age+(history[i+1].age-history[i].age)*t,fade=Math.max(0,1-age/TRAIL_S),o=count*6,c=count*8;
        cr(at(i-1,'a'),at(i,'a'),at(i+1,'a'),at(i+2,'a'),t,v);trailPos.set([v.x,v.y,v.z],o);
        cr(at(i-1,'b'),at(i,'b'),at(i+1,'b'),at(i+2,'b'),t,v);trailPos.set([v.x,v.y,v.z],o+3);
        // Newest is near white, fading through the blade's glow; the outer edge burns brighter.
        const hot=fade*fade;
        trailColor.set([GLOW_COLOR.r+hot*.6,GLOW_COLOR.g+hot*.05,GLOW_COLOR.b+hot*.2,.18*fade,GLOW_COLOR.r+hot*.75,1,GLOW_COLOR.b+hot*.3,.85*fade],c);
        count++;
      }
    }
    trailGeometry.setDrawRange(0,Math.max(0,count-1)*6);
    trail.visible=count>1;
    trailGeometry.attributes.position.needsUpdate=trailGeometry.attributes.color.needsUpdate=true;
    // Sparks: gravity and drag, white-hot to glow colour to nothing.
    let live=false;
    for(let i=0;i<SPARKS;i++){
      if(sparkAge[i]>=1){sparkColor[i*4+3]=0;continue;}
      live=true;sparkAge[i]+=dt/sparkLife[i];
      const drag=Math.exp(-dt*2.5);sparkVel[i*3]*=drag;sparkVel[i*3+2]*=drag;sparkVel[i*3+1]-=9.8*scale*dt;
      for(let k=0;k<3;k++)sparkPos[i*3+k]+=sparkVel[i*3+k]*dt;
      if(sparkPos[i*3+1]<.02*scale){sparkPos[i*3+1]=.02*scale;sparkVel[i*3+1]*=-.35;}
      const f=Math.max(0,1-sparkAge[i]),w=f*f;
      sparkColor.set([GLOW_COLOR.r+w*.75,GLOW_COLOR.g+w*.05,GLOW_COLOR.b+w*.2,f],i*4);
    }
    sparks.visible=live;
    sparkGeometry.attributes.position.needsUpdate=sparkGeometry.attributes.color.needsUpdate=true;
    for(const r of rings){
      if(!r.mesh.visible)continue;r.age+=dt/r.life;
      if(r.age>=1){r.mesh.visible=false;continue;}
      const e=1-(1-r.age)**3;r.mesh.scale.setScalar(.1+r.reach*e);r.mesh.material.opacity=(1-r.age)**1.5;
    }
    if(flash.visible){flashAge+=dt/.18;flash.visible=flashAge<1;flash.scale.setScalar((.08+.25*flashAge)*scale);flash.material.opacity=(1-flashAge)**2;}
    // Glow: idles at the material's own level holstered, warmer drawn, hot in a
    // swing, and flares on a charge cue.
    charge=Math.max(0,charge-dt*1.6);
    const goal=(attacking?4:drawn?2.2:GLOW)+charge*8;
    glow+=(goal-glow)*(1-Math.exp(-dt*12));
    for(const m of glows)m.emissiveIntensity=glow;
  }
  function dispose(){
    group.removeFromParent();trailGeometry.dispose();trail.material.dispose();sparkGeometry.dispose();sparks.material.dispose();dotTexture.dispose();
    ringGeometry.dispose();for(const r of rings)r.mesh.material.dispose();flash.geometry.dispose();flash.material.dispose();
  }
  return {update,cue,dispose,get trailPoints(){return trail.visible?trailGeometry.drawRange.count/6+1:0;},get sparksLive(){return sparks.visible;}};
}

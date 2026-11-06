/** Presentation of the cat folk; their lives run in shared/npc/folk.js.
 * Each cat is its own parsed GLB (skinned meshes cannot share a node tree), a
 * mixer that cross-fades the clip the core names, a blink layer, and while it
 * flies a pooled flight rig. window.tumbler.folk is the agent's door: observe,
 * command and hand-over by cat id, plus the shared event stream.
 */
import * as T from '../vendor/three.module.min.js';
import {parseGLB,buildAssetMeshes} from './glb.js';
import {createFlightRig} from './flight-rig.js';
import {flightFrame,pilotFrame} from '../../../shared/activities/flight.js';
import {createFolkWorld,createFolk,stepFolk,observe,command,setController,setDecider,suggest,addThing,setThing,playerSay,FEATURES,VERBS} from '../../../shared/npc/folk.js';
import {features} from '../../../shared/npc/mind.js';
import {DOWN} from '../../../shared/activities/balance.js';
import {createTumbleBody} from './tumble-body.js';

const SRGB=Uint8Array.from({length:256},(_,v)=>{const c=v/255;return Math.round(255*(c<=.0031308?c*12.92:1.055*c**(1/2.4)-.055));});
const FADE_S=.3,LABEL_M=45,MAX_RIGS=3,DRAW_M=700,HEAD_YAW=1.1,HEAD_PITCH=.45,HEAD_TURN=7,EYE_PX=256;

function basis(frame,out){
  return out.makeBasis(new T.Vector3(frame.left[0],frame.left[2],-frame.left[1]),new T.Vector3(frame.up[0],frame.up[2],-frame.up[1]),
    new T.Vector3(frame.forward[0],frame.forward[2],-frame.forward[1])).setPosition(frame.origin[0],frame.origin[2],-frame.origin[1]);
}

function puppet(asset,model){
  const object=new T.Group();object.name=`folk_${model.id}`;
  const root=buildAssetMeshes(asset);object.add(root);
  root.traverse(node=>{if(node.isMesh){node.castShadow=false;node.receiveShadow=true;}});
  const mixer=new T.AnimationMixer(root);
  const actions=Object.fromEntries(asset.animations.map(clip=>[clip.name,mixer.clipAction(clip)]));
  for(const name of model.clips)if(!actions[name])throw new Error(`${model.id} is missing clip ${name}`);
  actions.blink.play();
  let current=null,name=null;
  const head=root.getObjectByName('head'),pitchAxis=new T.Vector3(),q=new T.Quaternion(),parent=new T.Quaternion(),world=new T.Quaternion(),base=new T.Quaternion(),headAt=new T.Vector3();
  let yaw=0,pitch=0,looked=false;
  return {object,root,mixer,actions,body:null,
    /** Clips may not key the head, so a turn from last frame must not carry into this one. */
    restoreHead(){if(looked)head.quaternion.copy(base);looked=false;},
    /** Turn the head on top of the clip, toward a world point ({x, y, z}, Z up), or ease back to the clip. */
    look(target,facing,dt){
      if(!head)return;
      let wantYaw=0,wantPitch=0;
      if(target){
        object.updateWorldMatrix(true,true);head.getWorldPosition(headAt);
        const dx=target.x-headAt.x,dy=target.y+headAt.z,off=Math.atan2(Math.sin(Math.atan2(dy,dx)-facing),Math.cos(Math.atan2(dy,dx)-facing));
        // Past a shoulder, a cat looks ahead rather than wringing its neck.
        if(Math.abs(off)<HEAD_YAW*1.5){wantYaw=Math.max(-HEAD_YAW,Math.min(HEAD_YAW,off));wantPitch=Math.max(-HEAD_PITCH,Math.min(HEAD_PITCH,Math.atan2(target.z-headAt.y,Math.hypot(dx,dy))));}
      }
      const k=1-Math.exp(-dt*HEAD_TURN);yaw+=(wantYaw-yaw)*k;pitch+=(wantPitch-pitch)*k;
      if(Math.abs(yaw)+Math.abs(pitch)<.002)return;
      base.copy(head.quaternion);looked=true;
      // The turn is in world terms: about up by yaw, then about the body's own left by -pitch (nose up).
      pitchAxis.set(Math.cos(facing+yaw+Math.PI/2),0,-Math.sin(facing+yaw+Math.PI/2));
      head.parent.getWorldQuaternion(parent);head.getWorldQuaternion(world);
      q.setFromAxisAngle(pitchAxis,-pitch).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),yaw)).multiply(world);
      head.quaternion.copy(parent.invert().multiply(q));
    },
    play(next,speed){
      if(next!==name){
        const action=actions[next]??actions.idle;action.reset().play();
        if(current)current.crossFadeTo(action,FADE_S,false);
        current=action;name=next;
        actions.blink.setEffectiveWeight(next==='nap'?0:1);
      }
      // Planted paws: play a gait at the speed its stride covers the ground.
      const ground=asset.animations.find(c=>c.name===next)?.userData.ground_speed_mps;
      current.timeScale=ground&&speed>.05?Math.max(.5,Math.min(2.2,speed/ground)):1;
    },
    dispose(){root.traverse(n=>{if(n.isMesh){n.geometry.dispose();n.material.dispose();}});}};
}

export async function createFolkLayer({fetchData,worldmap,placement,flightConfig,walkConfig,height,ground,hitTest,gondola=null,balance=null,assets,scene,camera,canvas}){
  const config=await fetchData('shared/npc/folk.json');
  const models=await fetchData(config.models);
  const bytes=await Promise.all(models.models.map(m=>fetchData(`shared/geometry/${m.cinematic?.asset??m.asset}`,false)));
  const events=[];
  const world=createFolkWorld({config,worldmap,placement,flight:flightConfig,walk:walkConfig,height,ground,hitTest,gondola,balance,
    onEvent:e=>{events.push(e);if(events.length>256)events.shift();}});
  const cats=createFolk(world,models,{seed:Math.floor(Math.random()*1e9),aloft:true});
  const byModel=Object.fromEntries(models.models.map(m=>[m.id,m]));
  const group=new T.Group();group.name='cat_folk';scene.add(group);
  const puppets=new Map(cats.map((cat,i)=>{const p=puppet(parseGLB(bytes[i]),byModel[cat.id]);group.add(p.object);return [cat.id,p];}));
  // Name and speech labels: plain DOM, only for cats near the camera.
  const labels=new Map(cats.map(cat=>{
    const el=document.createElement('div');el.className='folk-label';el.hidden=true;
    Object.assign(el.style,{position:'absolute',pointerEvents:'none',transform:'translate(-50%,-100%)',font:'12px/1.3 system-ui,sans-serif',color:'#fff',
      textShadow:'0 1px 2px #000a',textAlign:'center',whiteSpace:'nowrap',zIndex:5});
    canvas.parentElement.appendChild(el);return [cat.id,el];
  }));
  const rigs=[],flying=new Map(),flightMatrix=new T.Matrix4(),pilotMatrix=new T.Matrix4(),pilotTransform=new T.Matrix4(),v=new T.Vector3(),up=new T.Vector3(0,1,0);

  function rigFor(cat){
    if(flying.has(cat.id))return flying.get(cat.id);
    let rig=rigs.find(r=>!r.owner);
    if(!rig&&rigs.length<MAX_RIGS){rig=createFlightRig(assets,flightConfig);rigs.push(rig);group.add(rig.group);}
    if(!rig)return null;  // ponytail: more than MAX_RIGS fliers draw harness-only; raise the cap if the roster grows
    rig.owner=cat.id;rig.group.visible=true;flying.set(cat.id,rig);return rig;
  }
  function releaseRig(cat){const rig=flying.get(cat.id);if(!rig)return;rig.owner=null;rig.group.visible=false;flying.delete(cat.id);}

  /** `player` is the player's state on foot ({x, y, speed}) or null; the cats play with it. */
  function update(dt,player=null){
    if(!(dt>0))return;
    world.player=player&&{x:player.x,y:player.y,z:player.z,heading:player.heading,speed:player.speed??0};
    stepFolk(world,dt,[camera.position.x,-camera.position.z]);
    for(const cat of cats){
      const p=puppets.get(cat.id),s=cat.body.state,model=byModel[cat.id];
      if(cat.body.mode==='flight'){
        const rig=rigFor(cat);
        const coupled=s.coupled&&!s.grounded&&!s.collapsed;
        basis(flightFrame(s,flightConfig),flightMatrix);basis(pilotFrame(s,flightConfig),pilotMatrix);
        if(rig){rig.group.position.setFromMatrixPosition(flightMatrix);rig.group.quaternion.setFromRotationMatrix(flightMatrix);}
        p.object.position.setFromMatrixPosition(pilotMatrix);p.object.quaternion.setFromRotationMatrix(pilotMatrix);
        // Seated, the hips ride where the harness attaches.
        p.object.position.addScaledVector(v.copy(up).applyQuaternion(p.object.quaternion),model.flight_attachment.position_m[1]-model.hip_m);
        if(rig){
          pilotTransform.copy(flightMatrix).invert().multiply(pilotMatrix);
          rig.update(dt,{...s,harnessed:true},{pilotScale:1,pilotAttachment:[0,model.hip_m+.05,0],pilotTransform:coupled?pilotTransform:undefined});
        }
      }else{
        releaseRig(cat);
        p.object.position.set(s.x,s.z,-s.y);
        const goal=new T.Quaternion().setFromAxisAngle(up,cat.body.facing+Math.PI/2);
        // Tumbling or rolling down a slope (balance.js), it turns over about its middle.
        // S0 spike (tumble-body.js): with api.tumbleMode 's0' the spring body turns it instead.
        const b=s.balance,over=api.tumbleMode!=='s0'&&b&&['tumble','roll'].includes(b.phase)?b.spin:0;
        if(over){p.object.quaternion.copy(goal).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1,0,0),over));p.object.position.y+=model.hip_m*(1-Math.cos(over));}
        else p.object.quaternion.slerp(goal,1-Math.exp(-dt*8));
      }
      // Skinned meshes are never frustum-culled (glb.js); a far cat is a speck, so skip its draw and its mixer.
      p.object.visible=camera.position.distanceTo(p.object.position)<DRAW_M;
      if(p.object.visible){
        p.restoreHead();p.body?.restore();p.play(cat.body.clip,cat.body.clipSpeed);p.mixer.update(dt);
        if(api.tumbleMode==='s0'&&cat.body.mode!=='flight'){
          // ponytail: radius scales balance.json's body_radius_m (0.45) by hip height; Ronin's hips are ~0.5 m.
          p.body??=createTumbleBody(p.root,{radius:.45*model.hip_m/.5});
          const b=s.balance,ph=balance?.config.phases,down=b&&DOWN.has(b.phase);
          p.body.update(dt,down?{...b,progress:b.phase==='trip'?b.t/ph.trip_s:b.phase==='recover'?b.t/ph.recover_s:0}:null,{object:p.object,ground:height});
        }
        const drawnFacing=2*Math.atan2(p.object.quaternion.y,p.object.quaternion.w)-Math.PI/2;
        p.look(cat.body.mode==='walk'&&!DOWN.has(s.balance?.phase)&&camera.position.distanceTo(p.object.position)<LABEL_M?cat.body.look:null,drawnFacing,dt);
      }
      const label=labels.get(cat.id),distance=camera.position.distanceTo(p.object.position);
      if(distance<LABEL_M||cat.said&&distance<LABEL_M*2){
        v.copy(p.object.position).setY(p.object.position.y+(cat.height_m??1.4)+.25).project(camera);
        label.hidden=v.z>1;label.style.left=`${(v.x*.5+.5)*100}%`;label.style.top=`${(-v.y*.5+.5)*100}%`;
        label.textContent=cat.said?`${cat.name}: “${cat.said.text}”`:`${cat.name}${cat.activity?` · ${cat.activity}`:''}`;
      }else label.hidden=true;
    }
  }

  /** What a cat sees right now, as a PNG data URL, for a vision model. `renderer` is the page's
   * (window.tumbler.renderer). Null if the frame cannot be read back. */
  function see(id,renderer,{size=EYE_PX,fov=70}={}){
    const cat=find(id),p=puppets.get(id),eye=observe(world,cat).eye,target=new T.WebGLRenderTarget(size,size);
    const view=new T.PerspectiveCamera(fov,1,.1,6000),h=eye.heading_deg*Math.PI/180;
    view.position.set(eye.position[0],eye.position[2],-eye.position[1]);view.lookAt(eye.position[0]+Math.cos(h)*10,eye.position[2],-eye.position[1]-Math.sin(h)*10);
    const was=renderer.getRenderTarget(),shown=p.object.visible;p.object.visible=false;
    try{
      renderer.setRenderTarget(target);renderer.render(scene,view);
      const px=new Uint8Array(size*size*4);renderer.readRenderTargetPixels(target,0,0,size,size,px);
      if(!px.some((v,i)=>i%4!==3&&v))return null;
      const out=document.createElement('canvas');out.width=out.height=size;const c=out.getContext('2d'),image=c.createImageData(size,size);
      // A render target holds linear light; the page's colour conversion only happens on screen.
      for(let i=0;i<px.length;i+=4)for(let k=0;k<3;k++)px[i+k]=SRGB[px[i+k]];
      for(let y=0;y<size;y++)image.data.set(px.subarray((size-1-y)*size*4,(size-y)*size*4),y*size*4);
      c.putImageData(image,0,0);return out.toDataURL('image/png');
    }finally{renderer.setRenderTarget(was);p.object.visible=shown;target.dispose();}
  }

  const find=id=>{const cat=cats.find(c=>c.id===id);if(!cat)throw new Error(`No cat ${id}; try ${cats.map(c=>c.id).join(', ')}`);return cat;};
  const api={world,cats,events,verbs:VERBS,tumbleMode:new URLSearchParams(globalThis.location?.search??'').get('tumble')==='s0'?'s0':'s1',
    list:()=>cats.map(c=>({id:c.id,name:c.name,doing:c.activity,mode:c.body.mode,controller:c.controller})),
    observe:id=>observe(world,find(id)),command:(id,cmd)=>command(world,find(id),cmd),
    setController:(id,controller)=>setController(world,find(id),controller),suggest:id=>suggest(world,find(id)),
    /** For a classifier: FEATURES names the vector; setDecider(id or null for all, fn) lets it choose. */
    featureNames:FEATURES,features:id=>features(world,find(id)),setDecider:(id,fn)=>setDecider(world,id===null?null:find(id),fn),
    /** Interactive items, the game's side: place one, change its state, listen with world.onThingChanged. */
    addThing:thing=>addThing(world,thing),setThing:(id,patch)=>setThing(world,id,patch,'player'),
    say:text=>playerSay(world,text),see,
    /** Move the camera to look at a cat (debug and screenshots). */
    focus(id){const p=puppets.get(id).object.position;camera.position.set(p.x+4,p.y+2.2,p.z+4);camera.lookAt(p.x,p.y+.8,p.z);return p.toArray();}};
  return {group,update,api,dispose(){for(const p of puppets.values())p.dispose();for(const r of rigs)r.dispose();for(const l of labels.values())l.remove();scene.remove(group);}};
}

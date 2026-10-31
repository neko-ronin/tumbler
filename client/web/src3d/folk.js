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
import {createFolkWorld,createFolk,stepFolk,observe,command,setController,suggest,VERBS} from '../../../shared/npc/folk.js';

const FADE_S=.3,LABEL_M=45,MAX_RIGS=3,DRAW_M=700;

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
  return {object,mixer,actions,
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

export async function createFolkLayer({fetchData,worldmap,placement,flightConfig,walkConfig,height,ground,hitTest,gondola=null,assets,scene,camera,canvas}){
  const config=await fetchData('shared/npc/folk.json');
  const models=await fetchData(config.models);
  const bytes=await Promise.all(models.models.map(m=>fetchData(`shared/geometry/${m.cinematic?.asset??m.asset}`,false)));
  const events=[];
  const world=createFolkWorld({config,worldmap,placement,flight:flightConfig,walk:walkConfig,height,ground,hitTest,gondola,
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

  function update(dt){
    if(!(dt>0))return;
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
        const face=cat.body.face&&cats.find(c=>c.id===cat.body.face);
        const heading=face?Math.atan2(face.body.state.y-s.y,face.body.state.x-s.x):s.heading??0;
        const goal=new T.Quaternion().setFromAxisAngle(up,heading+Math.PI/2);
        p.object.quaternion.slerp(goal,1-Math.exp(-dt*8));
      }
      // Skinned meshes are never frustum-culled (glb.js); a far cat is a speck, so skip its draw and its mixer.
      p.object.visible=camera.position.distanceTo(p.object.position)<DRAW_M;
      if(p.object.visible){p.play(cat.body.clip,cat.body.clipSpeed);p.mixer.update(dt);}
      const label=labels.get(cat.id),distance=camera.position.distanceTo(p.object.position);
      if(distance<LABEL_M||cat.said&&distance<LABEL_M*2){
        v.copy(p.object.position).setY(p.object.position.y+(cat.height_m??1.4)+.25).project(camera);
        label.hidden=v.z>1;label.style.left=`${(v.x*.5+.5)*100}%`;label.style.top=`${(-v.y*.5+.5)*100}%`;
        label.textContent=cat.said?`${cat.name}: “${cat.said.text}”`:`${cat.name}${cat.activity?` · ${cat.activity}`:''}`;
      }else label.hidden=true;
    }
  }

  const find=id=>{const cat=cats.find(c=>c.id===id);if(!cat)throw new Error(`No cat ${id}; try ${cats.map(c=>c.id).join(', ')}`);return cat;};
  const api={world,cats,events,verbs:VERBS,
    list:()=>cats.map(c=>({id:c.id,name:c.name,doing:c.activity,mode:c.body.mode,controller:c.controller})),
    observe:id=>observe(world,find(id)),command:(id,cmd)=>command(world,find(id),cmd),
    setController:(id,controller)=>setController(world,find(id),controller),suggest:id=>suggest(world,find(id)),
    /** Move the camera to look at a cat (debug and screenshots). */
    focus(id){const p=puppets.get(id).object.position;camera.position.set(p.x+4,p.y+2.2,p.z+4);camera.lookAt(p.x,p.y+.8,p.z);return p.toArray();}};
  return {group,update,api,dispose(){for(const p of puppets.values())p.dispose();for(const r of rigs)r.dispose();for(const l of labels.values())l.remove();scene.remove(group);}};
}

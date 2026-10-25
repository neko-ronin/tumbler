/** Presentation of the shared Ronin puppet; movement stays in shared/activities/. */
import * as T from '../vendor/three.module.min.js';
import { buildAssetMeshes } from './glb.js';
import { installCharacterSurfaces } from './character-surface.js';
import { trunkRadiusAt } from '../../../shared/activities/climb.js';
const PAW_RADIUS=.05,FLIP_PIVOT_M=.85,STRETCH=.1,SQUASH=.16;

export function createCharacter(asset, config) {
  const object = new T.Group();
  object.name = 'player_cat_ronin';
  const model = buildAssetMeshes(asset);
  const textures=new Set(),skeletons=new Set(),geometries=new Set();
  model.traverse(node=>{if(node.isMesh){geometries.add(node.geometry);if(node.material.map)textures.add(node.material.map);if(node.isSkinnedMesh)skeletons.add(node.skeleton);}});
  model.scale.setScalar(config.scale);
  model.position.y = -config.sole_y_m * config.scale;
  object.add(model);
  object.visible = false;
  // The original site's buffalo-check shirt is a shader. Recreate the check
  // with a tiny local texture using the existing WebGL toon material.
  const pixels = new Uint8Array([149, 42, 39, 255, 83, 27, 28, 255, 83, 27, 28, 255, 43, 19, 22, 255]);
  const plaid = new T.DataTexture(pixels, 2, 2);
  plaid.colorSpace = T.SRGBColorSpace;
  plaid.wrapS = plaid.wrapT = T.RepeatWrapping;
  plaid.repeat.set(7, 5);
  plaid.magFilter = T.NearestFilter;
  plaid.needsUpdate = true;
  model.traverse(node => {
    if (!node.isMesh) return;
    // World sun shadows are cached across 80 m moves. A dynamic contact
    // footprint below avoids leaving a frozen Ronin silhouette behind.
    node.castShadow = false;
    node.receiveShadow = true;
    if (node.material.name === 'flannel' && !node.material.map) { node.material.color.set('#ffffff'); node.material.map = plaid; }
  });
  const surfaces=installCharacterSurfaces(model);
  const shadePixels = new Uint8Array(32 * 32 * 4);
  for (let y=0;y<32;y++) for (let x=0;x<32;x++) {
    const i=(y*32+x)*4,r=Math.hypot((x-15.5)/15.5,(y-15.5)/15.5);
    shadePixels.set([31,39,29,Math.round(Math.max(0,1-r)**2*125)],i);
  }
  const shadeTexture=new T.DataTexture(shadePixels,32,32);shadeTexture.needsUpdate=true;
  const shadow=new T.Mesh(new T.PlaneGeometry(1.6,1.2),new T.MeshBasicMaterial({map:shadeTexture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}));
  shadow.rotation.x=-Math.PI/2;shadow.position.y=.025;object.add(shadow);
  const mixer = new T.AnimationMixer(model);
  const actions = Object.fromEntries(asset.animations.map(clip => [clip.name, mixer.clipAction(clip)]));
  for (const name of Object.values(config.clips)) if (!actions[name]) throw new Error(`Ronin is missing clip ${name}`);
  for (const name of Object.values(config.jump_clips??{})) if (!actions[name]) throw new Error(`Ronin is missing jump clip ${name}`);
  const feet=[],paws={};model.traverse(node=>{if(node.isMesh&&/^foot\./.test(node.parent?.name??''))feet.push(node);if(node.isMesh&&/^paw\./.test(node.parent?.name??''))paws[node.parent.name]=node;});
  const footBox=new T.Box3();let lastJump=0;
  let current = null, clipName = null,lean=0,barkFit=0,swimShot=null,swimShotLeft=0,pitch=0,idleTime=0,pivotClip=null,pivotLeft=0,tailAction=null,tailName=null,tailCategory=null,tailTime=0,tailIndex=0,lastPose=null,landedTime=0,blinkTime=3.7,elapsed=0;
  for(const names of Object.values(config.tail_clips??{}))for(const name of names)if(!actions[name])throw new Error(`Ronin is missing tail clip ${name}`);
  for(const name of [config.landing?.heavy,config.pivot?.left,config.pivot?.right,...(config.idle_sequence??[]).map(step=>step.clip),...Object.values(config.climb_clips??{}),...Object.values(config.fall_clips??{}),...Object.values(config.swim_clips??{})])
    if(name&&!actions[name])throw new Error(`Ronin is missing clip ${name}`);
  // Idle extras: after `after_s` seconds standing, play the clip once, or keep
  // it (`hold`) until he moves. The latest step that is due wins.
  /** The climbing clip for this moment on the trunk; null when the contract names none. */
  function climbClip(climb={}){
    const clips=config.climb_clips;if(!clips)return null;
    if(['mount','grip','perch'].includes(climb.climbPhase))return clips[climb.climbPhase];
    return Math.abs(climb.vz??0)>=Math.abs(climb.around??0)?(climb.vz>0?clips.up:clips.down):(climb.around>0?clips.around_right:clips.around_left);
  }
  /** The swimming clip for this phase; wading walks. Null when the contract names none. */
  function swimClip(swim={}){
    if(!config.swim_clips)return null;
    return swim.swimPhase==='wade'?config.clips.stroll??config.clips.walk:config.swim_clips[swim.swimPhase]??config.swim_clips.tread;
  }
  function idleExtra(){
    const step=(config.idle_sequence??[]).findLast(step=>idleTime>=step.after_s);
    return step&&(step.hold||idleTime<step.after_s+actions[step.clip].getClip().duration)?step.clip:null;
  }
  // Katana layer: holstered/drawn loops and the draw/sheathe transitions. It is
  // the only layer that moves the katana bones, and while the blade is out it
  // outweighs the body clip on the arm it authors. Cues ride in the clip.
  const katana=config.katana;let katanaState=null,katanaAction=null,cueIndex=0;
  if(katana)for(const state of ['holstered','draw','drawn','sheathe'])if(!actions[katana[state]])throw new Error(`Ronin is missing katana clip ${katana[state]}`);
  function playKatana(state,fade){
    const next=actions[katana[state]].reset().setEffectiveWeight(state==='holstered'?1:katana.arm_weight);
    if(state==='draw'||state==='sheathe'){next.setLoop(T.LoopOnce,1);next.clampWhenFinished=true;}
    if(fade)next.fadeIn(fade);next.play();
    if(katanaAction&&katanaAction!==next)fade?katanaAction.fadeOut(fade):katanaAction.stop();
    katanaAction=next;katanaState=state;cueIndex=0;
  }
  if(katana)playKatana('holstered',0);
  function update(dt, pose, speed = 0, context = {}) {
    const jump=context.jump;
    // A big drop lands in a deep crouch over the (longer) shared landing phase.
    const heavy=jump?.jumpPhase==='landing'&&config.landing&&jump.landingSpeed>config.landing.heavy_mps;
    // Bounce and tumble after a high fall play their own clips when the contract names them.
    const fall=['bounce','tumble'].includes(jump?.jumpPhase)&&config.fall_clips?.[jump.jumpPhase];
    const authoredJump=jump&&(fall||(heavy?config.landing.heavy:config.jump_clips?.[jump.jumpStyle]));
    idleTime=pose==='idle'&&!context.grounded?idleTime+dt:0;
    // A sharp turn from near standstill steps round: context.facing is the signed
    // angle (rad, positive left) from where the model faces to where it travels.
    pivotLeft-=dt;
    if(config.pivot&&pivotLeft<=0&&speed<1.5&&['idle','stroll','walk'].includes(pose)&&Math.abs(context.facing??0)>config.pivot.min_rad){
      pivotClip=context.facing>0?config.pivot.left:config.pivot.right;pivotLeft=actions[pivotClip].getClip().duration;actions[pivotClip].reset();
    }
    const pivoting=pivotLeft>0&&!jump;
    // Into and out of the water: a one-off wade-in or scramble-out before the next loop.
    const swims=config.swim_clips;swimShotLeft-=dt;
    if(swims&&(pose==='swim')!==(lastPose==='swim')&&lastPose!==null){swimShot=pose==='swim'?swims.enter:swims.exit;swimShotLeft=actions[swimShot].getClip().duration;actions[swimShot].reset();}
    const shot=swimShotLeft>0?swimShot:null;
    // context.bodyClip / context.tailClip audition a named clip on that layer (studio).
    const name = context.bodyClip??shot??authoredJump??(pivoting?pivotClip:null)??(pose==='idle'?idleExtra():null)??(pose==='climb'?climbClip(context.climb):null)??(pose==='swim'?swimClip(context.swim):null)??config.clips[['jump','climb','swim'].includes(pose)?'idle':pose];
    const action = actions[name];
    if (!action) throw new Error(`Unknown Ronin pose ${pose}`);
    if (action !== current) {
      // Sitting down and getting up take longer than a change of step; a jump
      // must read on the frame he leaves the ground.
      const fade=current&&[name,clipName].some(clip=>config.idle_sequence?.some(step=>step.hold&&step.clip===clip))?.5:pivoting||authoredJump?.08:.18;
      action.reset().fadeIn(fade).play();
      if(pivoting||shot)action.setLoop(T.LoopOnce,1).clampWhenFinished=true;
      // Gait clips share a phase convention (left paw down at the same point),
      // so a walk/run change picks up mid-stride instead of restarting it.
      const gait=clip=>clip.userData.ground_speed_mps;
      if(current&&gait(current.getClip())&&gait(action.getClip()))action.time=current.time/current.getClip().duration*action.getClip().duration;
      current?.fadeOut(fade);
      current = action; clipName = name;
    }
    if(authoredJump&&!context.bodyClip){
      if(lastJump!==jump.jumpCount&&!heavy&&!fall){action.reset().setLoop(T.LoopOnce,1).play();lastJump=jump.jumpCount;}
      const phase=jump.jumpProgress??0;
      const progress=heavy||fall?phase:jump.jumpPhase==='takeoff'?phase/6:jump.jumpPhase==='landing'?5/6+phase/6:1/6+phase*2/3;
      action.paused=true;action.time=action.getClip().duration*progress;action.clampWhenFinished=true;
    }else action.paused=false;
    // A gait clip names the speed at which its planted paws stay put.
    const ground=action.getClip().userData.ground_speed_mps;
    action.timeScale = ground ? Math.max(.25, speed / ground) : pose === 'walk' ? Math.max(.25, speed / config.walk.walk_mps)
      : pose === 'run' ? Math.max(.25, speed / config.walk.run_mps) : 1;
    // Lean into turns like a runner: atan(lateral acceleration / g), eased.
    const leanGoal=['stroll','walk','run'].includes(pose)?Math.max(-.3,Math.min(.3,Math.atan(speed*(context.turnRate??0)/9.81))):0;
    lean+=(leanGoal-lean)*(1-Math.exp(-dt*8));model.rotation.z=-lean;
    // Starts and stops: pitch into acceleration (forward), back against braking.
    const pitchGoal=['idle','stroll','walk','run'].includes(pose)?Math.max(-.18,Math.min(.22,.7*Math.atan((context.accel??0)/9.81)))
      // A dive points his (prone) body along its path: nose down going down.
      :pose==='swim'&&context.swim?.swimPhase==='dive'?Math.max(-1.2,Math.min(1.2,Math.atan2(-(context.swim.vz??0),Math.max(.1,context.swim.speed??0)))):0;
    // The chain's third jump somersaults forward, finishing by the apex.
    const t=Math.min(1,(jump?.jumpProgress??0)/.5),flip=jump?.jumpTier===3&&jump.jumpPhase==='airborne'?2*Math.PI*t*t*(3-2*t):0;
    pitch+=(pitchGoal-pitch)*(1-Math.exp(-dt*10));model.rotation.x=pitch+flip;
    // Squash and stretch, volume kept: long while he moves fast vertically (the
    // launch, the drop), round through the hang at the peak, squat at touchdown
    // and springing back up over the landing.
    const stretch=jump?.jumpPhase==='airborne'?STRETCH*Math.min(1,((jump.vz??0)/(jump.jumpVz||1))**2)
      :jump?.jumpPhase==='landing'?-SQUASH*(1-(jump.jumpProgress??1))**2:0;
    model.scale.set(config.scale/Math.sqrt(1+stretch),config.scale*(1+stretch),config.scale/Math.sqrt(1+stretch));
    if(lastPose==='flight'&&pose==='idle')landedTime=3;
    lastPose=pose;landedTime=Math.max(0,landedTime-dt);
    let category=pose==='flight'?(context.mode??'paraglider'):pose;
    if(pose==='flight'&&Math.abs(context.bank??0)>.18)category=context.bank<0?'turn_left':'turn_right';
    if(landedTime>0)category='landed';
    if(context.grounded||context.mode==='landed')category='landed';
    const choices=context.tailClip?[context.tailClip]:config.tail_clips?.[category];
    if(context.tailClip)category='studio:'+context.tailClip;
    tailTime-=dt;
    if(choices&&(category!==tailCategory||tailTime<=0)){
      if(category!==tailCategory)tailIndex=0;else tailIndex=(tailIndex+1)%choices.length;
      const next=actions[choices[tailIndex]];
      if(next!==tailAction){next.reset().fadeIn(.4).play();tailAction?.fadeOut(.4);tailAction=next;}
      tailCategory=category;tailName=choices[tailIndex];tailTime=next.getClip().duration*(category==='idle'?1:2);
    }
    elapsed+=dt;blinkTime-=dt;
    if(blinkTime<=0&&config.blink_clip){const blink=actions[config.blink_clip];blink.reset().setLoop(T.LoopOnce,1).play();blink.clampWhenFinished=true;blinkTime=3.2+1.7*(.5+.5*Math.sin(elapsed*1.37));}
    if(katana&&pose==='flight'&&katanaState!=='holstered')playKatana('holstered',.1);
    mixer.update(dt);
    if(katana){
      const events=katanaAction.getClip().userData?.events??[];
      while(cueIndex<events.length&&events[cueIndex].time<=katanaAction.time)api.onCue?.(events[cueIndex++].name);
      const finished=katanaAction.time>=katanaAction.getClip().duration-1e-4;
      if(finished&&katanaState==='draw')playKatana('drawn',.1);
      else if(finished&&katanaState==='sheathe')playKatana('holstered',.1);
    }
    // Keep the animated soles above the actual terrain, including slope under
    // either foot. This adjusts the rendered puppet only; physics owns its arc.
    model.position.y=-config.sole_y_m*config.scale;
    // On a trunk, move him toward or away from the bark (along his facing) so the
    // planted paws touch it whatever its radius: clips are authored on a 1.5 m trunk.
    const trunk=pose==='climb'?context.climb?.trunk:null;
    model.position.z=trunk?barkFit:0;
    if(trunk){
      model.updateWorldMatrix(true,true);const gaps=[];
      const centre=new T.Vector3(trunk.x,0,-trunk.y),me=object.getWorldPosition(new T.Vector3()),toward=centre.clone().sub(me).setY(0).normalize();
      for(const contact of api.contacts)if(contact.target==='bark'&&paws[contact.bone]){
        // Along his facing: how far the paw is from where it would touch the bark at its sideways offset.
        const v=paws[contact.bone].getWorldPosition(new T.Vector3()).sub(centre).setY(0),along=-v.dot(toward);
        const side=Math.hypot(v.x+toward.x*along,v.z+toward.z*along),reach=trunkRadiusAt(trunk,me.y)+PAW_RADIUS;
        if(side<reach)gaps.push(along-Math.sqrt(reach*reach-side*side));
      }
      if(gaps.length)barkFit=Math.max(-.6,Math.min(.6,barkFit+gaps.reduce((a,b)=>a+b)/gaps.length*(1-Math.exp(-dt*15))));
      model.position.z=barkFit;
    }else barkFit=0;
    // Turn the somersault about his middle rather than his soles.
    if(flip){model.position.y+=FLIP_PIVOT_M*(1-Math.cos(flip));model.position.z-=FLIP_PIVOT_M*Math.sin(flip);}
    if(pose!=='flight'&&context.groundZ!==undefined){
      model.updateWorldMatrix(true,true);let lift=0;
      for(const foot of feet){
        footBox.copy(foot.geometry.boundingBox).applyMatrix4(foot.matrixWorld);
        const centre=footBox.getCenter(new T.Vector3());
        const floor=context.groundHeight?.(centre.x,-centre.z)??context.groundZ;
        lift=Math.max(lift,floor-footBox.min.y);
      }
      model.position.y+=lift;
    }
    shadow.visible=pose!=='flight';
    if(shadow.visible){
      const gap=Math.max(0,object.position.y-(context.groundZ??object.position.y));
      shadow.position.y=(context.groundZ??object.position.y)-object.position.y+.025;
      shadow.material.opacity=1/(1+gap*1.5);shadow.scale.setScalar(1+gap*.2);
      if(context.groundHeight){
        const x=object.position.x,y=-object.position.z,h=context.groundHeight;
        const normal=new T.Vector3((h(x-.4,y)-h(x+.4,y))/.8,1,(h(x,y+.4)-h(x,y-.4))/.8).normalize();
        shadow.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),normal.applyQuaternion(object.quaternion.clone().invert()));
      }
    }
  }
  /** Draw when holstered, sheathe when drawn; ignored mid-transition. */
  function toggleKatana(){
    if(katanaState==='holstered')playKatana('draw',.08);
    else if(katanaState==='drawn')playKatana('sheathe',.08);
    return katanaState;
  }
  const api = { object, model, update, toggleKatana, onCue:null, mixer, actions,
    /** Paws the playing body clip has planted now: [{bone, target}] (from glTF extras.contacts). */
    get contacts(){const clip=current?.getClip(),t=current?.time??0;return (clip?.userData.contacts??[]).filter(c=>t>=c.start-1e-6&&t<=c.end+1e-6);}, get clip() { return clipName; },get bodyAction(){return current;},get tailAction(){return tailAction;},get katanaAction(){return katanaAction;},get tailClip(){return tailName;},get katana(){return katanaState;}, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); surfaces.dispose();for(const s of skeletons)s.dispose();for(const t of textures)t.dispose();for(const g of geometries)g.dispose();plaid.dispose();shadeTexture.dispose();shadow.geometry.dispose();shadow.material.dispose(); } };
  return api;
}

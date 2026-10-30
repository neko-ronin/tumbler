/** Presentation of the shared Ronin puppet; movement stays in shared/activities/. */
import * as T from '../vendor/three.module.min.js';
import { buildAssetMeshes } from './glb.js';
import { installCharacterSurfaces } from './character-surface.js';
import { trunkRadiusAt } from '../../../shared/activities/climb.js';
import { gaitFor } from '../../../shared/activities/walk.js';
import { createKatanaFx } from './katana-fx.js';
const PAW_RADIUS=.05,FOOT_REACH_M=.2,PLANTED_M=.03,BODY_RISE_S=.07,BODY_DROP_S=.006,FLIP_PIVOT_M=.85,FLIP_START=.42,FLIP_END=.85,ROLL_PIVOT_M=.42,ROLL_START=.12,ROLL_END=.78,STRETCH=.1,SQUASH=.16;

export function createCharacter(asset, config) {
  const object = new T.Group();
  object.name = 'player_cat_ronin';
  const model = buildAssetMeshes(asset);
  const textures=new Set(),skeletons=new Set(),geometries=new Set();
  model.traverse(node=>{if(node.isMesh){geometries.add(node.geometry);if(node.material.map)textures.add(node.material.map);if(node.isSkinnedMesh)skeletons.add(node.skeleton);}});
  model.scale.setScalar(config.scale);
  model.position.y = -config.sole_y_m * config.scale;
  object.add(model);
  const flightBone=config.flight_attachment&&model.getObjectByName(config.flight_attachment.bone);
  if(config.flight_attachment&&!flightBone)throw new Error(`Ronin is missing attachment bone ${config.flight_attachment.bone}`);
  const attachmentPoint=new T.Vector3(),attachmentTarget=new T.Vector3();
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
  const surfaces=installCharacterSurfaces(model,config.face);
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
  const feet=[],paws={},bodyMeshes=[];model.traverse(node=>{if(node.isMesh&&!node.isSkinnedMesh&&node.geometry.boundingBox||node.isSkinnedMesh&&!/^cat_tail|\.fur\d/.test(node.name))bodyMeshes.push(node);});model.traverse(node=>{if(node.isMesh&&/^foot\./.test(node.parent?.name??''))feet.push(node);if(node.isMesh&&/^paw\./.test(node.parent?.name??''))paws[node.parent.name]=node;});
  const footBox=new T.Box3(),meshBox=new T.Box3();let lastJump=0,bodyLift=0,bodyWorld=null;
  // Legs for foot planting: hip (thigh), knee (shin), ankle (heel) and the foot meshes.
  const legs=['L','R'].map(side=>({thigh:model.getObjectByName('thigh.'+side),shin:model.getObjectByName('shin.'+side),heel:model.getObjectByName('heel.'+side),
    meshes:feet.filter(mesh=>mesh.parent.name==='foot.'+side)})).filter(leg=>leg.thigh&&leg.shin&&leg.heel&&leg.meshes.length);
  // Leg rotations as the clip left them, put back before the mixer runs so IK
  // never accumulates on a channel the playing clip does not animate.
  const legPose=[];
  const v=()=>new T.Vector3(),q=()=>new T.Quaternion();
  /** Turn a bone by a world-space rotation. */
  function turnWorld(bone,rotation){
    const parent=bone.parent.getWorldQuaternion(q()).invert(),world=bone.getWorldQuaternion(q());
    bone.quaternion.copy(parent.multiply(rotation).multiply(world));bone.updateWorldMatrix(false,true);
  }
  /** Raise this leg's ankle `rise` metres (world up) with two-bone IK: bend the
   * knee in the plane it already bends in, swing the thigh onto the target and
   * keep the foot's world orientation, so the paw stays as level as the clip had it. */
  function raiseFoot(leg,rise){
    for(const bone of [leg.thigh,leg.shin,leg.heel])legPose.push([bone,bone.quaternion.clone()]);
    const hip=leg.thigh.getWorldPosition(v()),knee=leg.shin.getWorldPosition(v()),ankle=leg.heel.getWorldPosition(v());
    const shinBefore=leg.shin.getWorldQuaternion(q()),target=ankle.clone().setY(ankle.y+rise);
    const upper=knee.clone().sub(hip),lower=ankle.clone().sub(knee),a=upper.length(),b=lower.length();
    const reach=Math.max(Math.abs(a-b)+1e-3,Math.min(a+b-1e-4,target.distanceTo(hip)));
    const bend=Math.acos(Math.max(-1,Math.min(1,(reach*reach-a*a-b*b)/(2*a*b))))-upper.angleTo(lower);
    let axis=v().crossVectors(upper,lower);
    // A straight leg bends its knee forward (+Z in the model is his front).
    if(axis.lengthSq()<1e-10)axis.crossVectors(v().set(0,0,1).transformDirection(model.matrixWorld),upper);
    turnWorld(leg.shin,q().setFromAxisAngle(axis.normalize(),bend));
    const bent=leg.heel.getWorldPosition(v()).sub(hip).normalize();
    turnWorld(leg.thigh,q().setFromUnitVectors(bent,target.sub(hip).normalize()));
    // Undo the shin's turn at the ankle (relative, so decomposition error cancels).
    leg.heel.quaternion.premultiply(leg.shin.getWorldQuaternion(q()).invert().multiply(shinBefore));leg.heel.updateWorldMatrix(false,true);
  }
  let current = null, clipName = null,lean=0,barkFit=0,swimShot=null,swimShotLeft=0,pitch=0,idleTime=0,pivotClip=null,pivotLeft=0,tailAction=null,tailName=null,tailCategory=null,tailTime=0,tailIndex=0,lastPose=null,landedTime=0,blinkTime=3.7,elapsed=0;
  for(const names of Object.values(config.tail_clips??{}))for(const name of names)if(!actions[name])throw new Error(`Ronin is missing tail clip ${name}`);
  for(const name of [config.landing?.heavy,config.landing?.roll,config.pivot?.left,config.pivot?.right,...(config.idle_sequence??[]).map(step=>step.clip),...Object.values(config.climb_clips??{}),...Object.values(config.fall_clips??{}),...Object.values(config.swim_clips??{})])
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
  // Drawn, a run swaps in the two-handed trailing stance; an attack chain plays
  // its clips once each and moves his whole body. Both own every bone they author
  // (attack_weight): a two-handed grip cannot share an arm with the body's swing.
  // The run stance and attacks are newer than some models (the original Cat
  // Ronin): a model without those clips keeps the four it has and cannot strike.
  const katana=config.katana&&{...config.katana,run:actions[config.katana.run]?config.katana.run:null,attacks:(config.katana.attacks??[]).filter(name=>actions[name])};
  let katanaState=null,katanaAction=null,cueIndex=0,attackIndex=-1,attackQueued=false,hitStop=0,shake=0;
  if(katana)for(const state of ['holstered','draw','drawn','sheathe'])if(!actions[katana[state]])throw new Error(`Ronin is missing katana clip ${katana[state]}`);
  const fx=katana?createKatanaFx(object,model,config.scale):null;
  const grounded=pose=>['idle','stroll','walk','run'].includes(pose);
  function playKatana(state,fade,clip=katana[state]){
    const next=actions[clip].reset().setEffectiveWeight(state==='holstered'?1:state==='attack'||state==='run'?katana.attack_weight??katana.arm_weight:katana.arm_weight);
    if(['draw','sheathe','attack'].includes(state)){next.setLoop(T.LoopOnce,1);next.clampWhenFinished=true;}
    if(fade)next.fadeIn(fade);next.play();
    if(katanaAction&&katanaAction!==next)fade?katanaAction.fadeOut(fade):katanaAction.stop();
    katanaAction=next;katanaState=state;cueIndex=0;
    if(state!=='attack'){attackIndex=-1;attackQueued=false;}
  }
  /** A clip cue: the effects and the hit-stop/shake it calls for, then the client's sound. */
  function cue(name){
    fx?.cue(name);
    if(name==='impact'){hitStop=.11;shake=.2;}
    else if(name==='swish_heavy')shake=Math.max(shake,.05);
    api.onCue?.(name);
  }
  if(katana)playKatana('holstered',0);
  function update(dt, pose, speed = 0, context = {}) {
    const jump=context.jump;
    // A big drop lands in a deep crouch over the (longer) shared landing phase.
    const heavy=jump?.jumpPhase==='landing'&&config.landing&&jump.landingSpeed>config.landing.heavy_mps;
    // Bounce and tumble after a high fall play their own clips when the contract names them.
    const fall=['bounce','tumble'].includes(jump?.jumpPhase)&&config.fall_clips?.[jump.jumpPhase];
    // Landing variants: a heavy landing at speed rolls forward out of it; an
    // ordinary one on the move runs straight out in the gait for his speed.
    const roll=heavy&&config.landing.roll&&speed>config.landing.roll_min_mps;
    const runOut=jump?.jumpPhase==='landing'&&!heavy&&speed>(config.walk.stroll_mps??1.6);
    const authoredJump=!jump||runOut?null:(fall||(heavy?(roll?config.landing.roll:config.landing.heavy):config.jump_clips?.[jump.jumpStyle]??config.jump_clips?.hop));
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
    const name = context.bodyClip??shot??authoredJump??(pivoting?pivotClip:null)??(pose==='idle'?idleExtra():null)??(pose==='climb'?climbClip(context.climb):null)??(pose==='swim'?swimClip(context.swim):null)??config.clips[runOut?gaitFor(speed,config.walk,config.clips):['jump','climb','swim'].includes(pose)?'idle':pose];
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
      if(lastJump!==jump.jumpCount&&!heavy&&!fall){action.reset().setLoop(T.LoopOnce,1).play();lastJump=jump.jumpCount;api.onCue?.(`grunt${jump.jumpTier??1}`);}
      const phase=jump.jumpProgress??0;
      const progress=heavy||fall?phase:jump.jumpPhase==='takeoff'?phase/6:jump.jumpPhase==='landing'?5/6+phase/6:1/6+phase*2/3;
      action.paused=true;action.time=action.getClip().duration*progress;action.clampWhenFinished=true;
    }else action.paused=false;
    // A gait clip names the speed at which its planted paws stay put.
    const ground=action.getClip().userData.ground_speed_mps;
    action.timeScale = ground ? Math.max(.25, speed / (ground * config.scale)) : pose === 'walk' ? Math.max(.25, speed / config.walk.walk_mps)
      : pose === 'run' ? Math.max(.25, speed / config.walk.run_mps) : 1;
    // Lean into turns like a runner: atan(lateral acceleration / g), eased.
    // A branch's knock shoves him the way it pushed (knockSide +1 is his left), up
    // to 0.25 rad, and he rights himself as the knock fades.
    const knocked=Math.min(.25,(context.knock??0)*.15)*(context.knockSide??0);
    const leanGoal=['stroll','walk','run'].includes(pose)?Math.max(-.3,Math.min(.3,Math.atan(speed*(context.turnRate??0)/9.81)+knocked)):0;
    lean+=(leanGoal-lean)*(1-Math.exp(-dt*8));model.rotation.z=-lean;
    // Starts and stops: pitch into acceleration (forward), back against braking.
    // Running with the blade drawn, he leans his whole body into it.
    const pitchGoal=['idle','stroll','walk','run'].includes(pose)?Math.max(-.18,Math.min(.22,.7*Math.atan((context.accel??0)/9.81)))+(pose==='run'&&katanaState==='run'?.14:0)
      // A dive points his (prone) body along its path: nose down going down.
      :pose==='swim'&&context.swim?.swimPhase==='dive'?Math.max(-1.2,Math.min(1.2,Math.atan2(-(context.swim.vz??0),Math.max(.1,context.swim.speed??0)))):0;
    // The chain's third jump somersaults forward, starting just before the apex
    // and upright again early in the drop (air progress FLIP_START..FLIP_END).
    // ponytail: progress is by vertical speed, so landing on a ledge above the
    // takeoff can cut the turn short and snap upright; drive it by height if seen.
    const t=Math.min(1,Math.max(0,((jump?.jumpProgress??0)-FLIP_START)/(FLIP_END-FLIP_START))),flip=jump?.jumpTier===3&&jump.jumpPhase==='airborne'?2*Math.PI*t*t*(3-2*t):0;
    // The roll turns him once forward about a low pivot over the landing phase.
    const r=Math.min(1,Math.max(0,((jump?.jumpProgress??0)-ROLL_START)/(ROLL_END-ROLL_START))),rollTurn=roll?2*Math.PI*r*r*(3-2*r):0;
    pitch+=(pitchGoal-pitch)*(1-Math.exp(-dt*10));model.rotation.x=pitch+flip+rollTurn;
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
    // An attack ends if he leaves the ground (a ledge, the water, a trunk).
    if(katana&&katanaState==='attack'&&!grounded(pose))playKatana('drawn',.1);
    if(katana?.run&&['drawn','run'].includes(katanaState)){const stance=pose==='run'?'run':'drawn';if(stance!==katanaState)playKatana(stance,.2);}
    for(const [bone,rotation] of legPose.reverse())bone.quaternion.copy(rotation);legPose.length=0;
    // Hit-stop: on a landed blow the animation all but freezes for a beat; physics does not.
    mixer.update(hitStop>0?dt*.06:dt);hitStop-=dt;shake*=Math.exp(-dt*9);
    if(katana){
      const events=katanaAction.getClip().userData?.events??[];
      while(cueIndex<events.length&&events[cueIndex].time<=katanaAction.time)cue(events[cueIndex++].name);
      const finished=katanaAction.time>=katanaAction.getClip().duration-1e-4;
      if(finished&&katanaState==='draw')playKatana('drawn',.1);
      else if(finished&&katanaState==='sheathe')playKatana('holstered',.1);
      else if(finished&&katanaState==='attack'){
        if(attackQueued&&attackIndex+1<katana.attacks.length){attackQueued=false;playKatana('attack',.05,katana.attacks[++attackIndex]);}
        else playKatana(pose==='run'&&katana.run?'run':'drawn',.15);
      }
    }
    // Keep the animated soles above the actual terrain, including slope under
    // either foot. This adjusts the rendered puppet only; physics owns its arc.
    model.position.y=-config.sole_y_m*config.scale;
    model.position.x=0;
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
    if(flip){model.position.y+=FLIP_PIVOT_M*config.scale*(1-Math.cos(flip));model.position.z-=FLIP_PIVOT_M*config.scale*Math.sin(flip);}
    if(rollTurn){model.position.y+=ROLL_PIVOT_M*config.scale*(1-Math.cos(rollTurn));model.position.z-=ROLL_PIVOT_M*config.scale*Math.sin(rollTurn);}
    // Flight attaches his animated hips, not his soles. The target is in world
    // space so banking about the harness and changing size keep the same pickup.
    if(pose==='flight'&&flightBone&&context.flightAnchor){
      model.updateWorldMatrix(true,true);
      object.worldToLocal(flightBone.getWorldPosition(attachmentPoint));
      object.worldToLocal(attachmentTarget.copy(context.flightAnchor));
      model.position.add(attachmentTarget.sub(attachmentPoint));
    }
    if(pose!=='flight'&&context.groundZ!==undefined){
      model.updateWorldMatrix(true,true);
      // Each foot: how far it must rise. A planted paw stands on its own floor;
      // a paw the clip has in the air only has to stay out of the ground.
      const base=object.position.y,needs=[],planted=[];let clear=0;
      for(const leg of legs){
        footBox.makeEmpty();for(const mesh of leg.meshes)footBox.union(meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
        const centre=footBox.getCenter(new T.Vector3()),floor=context.groundHeight?.(centre.x,-centre.z)??context.groundZ;
        const down=footBox.min.y-base<PLANTED_M;planted.push(down);
        needs.push(down?floor+Math.max(0,footBox.min.y-base)-footBox.min.y:floor-footBox.min.y);clear=Math.max(clear,floor-footBox.min.y);
      }
      const high=Math.max(clear,...needs);
      // Standing and walking: the body follows the lower planted paw and the
      // other leg bends to its higher floor (at most FOOT_REACH_M), so on a slope
      // the downhill paw no longer floats; a paw in the air is only ever lifted.
      // The body's height eases in the world, where a planted paw's floor holds
      // still: a raised tread is stepped onto leg first instead of popping. In
      // the air he keeps his height over his own centre. It rises slowly (the bent leg covers the
      // lag) and drops fast (a lag there would hang a paw in the air).
      if(legs.length===2&&!jump&&['idle','stroll','walk','run'].includes(pose)&&name===config.clips[pose]){
        const support=needs.filter((need,i)=>planted[i]);
        if(!support.length||bodyWorld===null)bodyWorld=base+(support.length?Math.min(...support):bodyLift);
        else{const target=base+Math.min(...support);bodyWorld+=(target-bodyWorld)*(1-Math.exp(-dt/(target>bodyWorld?BODY_RISE_S:BODY_DROP_S)));}
        bodyLift=Math.max(bodyWorld-base,high-FOOT_REACH_M);bodyWorld=base+bodyLift;
        model.position.y+=bodyLift;model.updateWorldMatrix(true,true);
        legs.forEach((leg,i)=>{if(needs[i]-bodyLift>1e-3)raiseFoot(leg,needs[i]-bodyLift);});
      }else{
        // Rolling, any part of him may lead into the ground, not only the soles:
        // his cloth too (sleeves, hakama), measured as the bones pose it. The
        // tail may sweep the ground as he turns over.
        if(rollTurn)for(const mesh of bodyMeshes){
          if(mesh.isSkinnedMesh)mesh.computeBoundingBox();
          meshBox.copy(mesh.isSkinnedMesh?mesh.boundingBox:mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          const centre=meshBox.getCenter(new T.Vector3());clear=Math.max(clear,(context.groundHeight?.(centre.x,-centre.z)??context.groundZ)-meshBox.min.y);
        }
        bodyLift=clear;bodyWorld=null;model.position.y+=clear;
      }
    }
    if(fx){object.updateWorldMatrix(true,true);fx.update(dt,katanaState==='attack',katanaState!=='holstered');}
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
  /** Draw when holstered, sheathe when drawn; ignored mid-transition or mid-attack. */
  function toggleKatana(){
    if(katanaState==='holstered')playKatana('draw',.08);
    else if(katanaState==='drawn'||katanaState==='run')playKatana('sheathe',.08);
    return katanaState;
  }
  /** Attack: draws first when holstered; drawn, starts the chain; mid-attack,
   * queues the next blow of the chain for when this one ends. On the ground only. */
  function attack(){
    if(!katana?.attacks.length||!grounded(lastPose))return katanaState;
    if(katanaState==='holstered')return toggleKatana();
    if(katanaState==='drawn'||katanaState==='run'){playKatana('attack',.06,katana.attacks[0]);attackIndex=0;}
    else if(katanaState==='attack')attackQueued=attackIndex+1<katana.attacks.length;
    return katanaState;
  }
  const api = { object, model, update, toggleKatana, attack, onCue:null, mixer, actions,
    /** True while an attack plays: the client holds his feet still. */
    get attacking(){return katanaState==='attack';},
    /** Camera shake amplitude (m) a landed blow asks for; decays by itself. */
    get shake(){return shake;},
    /** Paws the playing body clip has planted now: [{bone, target}] (from glTF extras.contacts). */
    get contacts(){const clip=current?.getClip(),t=current?.time??0;return (clip?.userData.contacts??[]).filter(c=>t>=c.start-1e-6&&t<=c.end+1e-6);}, get clip() { return clipName; },get bodyAction(){return current;},get tailAction(){return tailAction;},get katanaAction(){return katanaAction;},get tailClip(){return tailName;},get katana(){return katanaState;}, dispose() { mixer.stopAllAction(); mixer.uncacheRoot(model); surfaces.dispose();for(const s of skeletons)s.dispose();for(const t of textures)t.dispose();for(const g of geometries)g.dispose();plaid.dispose();shadeTexture.dispose();shadow.geometry.dispose();shadow.material.dispose();fx?.dispose(); } };
  return api;
}

import * as T from '../vendor/three.module.min.js';
import {createOrganoidEncounter, organoidDeparture, sampleOrganoidExpression} from '../../../shared/npc/organoid.js';
import {closeSampleBudget, detailAt, projectedDiameter} from './organoid-material.js';
import {createOrganoidWake} from './organoid-wake.js';

const up = new T.Vector3(0, 1, 0);
const localX = new T.Vector3(1, 0, 0);
const localZ = new T.Vector3(0, 0, 1);
const solidPoint = v => [v.x,-v.z,v.y];
const ease = t => { t=T.MathUtils.clamp(t,0,1); return t*t*(3-2*t); };
const exitLead = .72;

export function stageOrganoid({config, clips, actor, scene, camera, canvas, navigation, character,
  characterScale, height, hit, waterAt, playProps = [], sun, soundscape, panel}) {
  const rules = createOrganoidEncounter(config, {height, hit});
  const speaker = panel.querySelector('[data-speaker]');
  const words = panel.querySelector('[data-words]');
  const skip = panel.querySelector('button');
  const shell = actor.mesh;
  shell.name = 'Organoid';
  shell.scale.setScalar(config.radius_m / shell.geometry.boundingSphere.radius);
  shell.visible = false;
  scene.add(shell);
  const look = {sun, target:new T.Vector3(), sunStrength:.72, notice:0, withdraw:0, front:-2, pulse:0};
  const target = new T.Vector3();
  const right = new T.Vector3();
  const forward = new T.Vector3();
  const startTurn = new T.Quaternion();
  const awayTurn = new T.Quaternion();
  const lookTurn = new T.Quaternion();
  const head = character.model?.getObjectByName('head');
  const lid = character.model?.getObjectByName('lid.L');
  const lowerLid = character.model?.getObjectByName('lid_lower.L');
  const eye = character.model?.getObjectByName('eye.L');
  const ears = ['ear.L','ear.R'].map(name => character.model?.getObjectByName(name));
  const offsets = new Map();
  const headTurn = new T.Quaternion(), parentTurn = new T.Quaternion();
  const headAxis = new T.Vector3();
  const exitForward = new T.Vector3(), exitSide = new T.Vector3(), exitTurn = new T.Quaternion();
  const pose = new T.Vector3(), aim = new T.Vector3();
  const trial = new T.Vector3(), direction = new T.Vector3(), across = new T.Vector3();
  const sightTarget = new T.Vector3(), facePoint = new T.Vector3(), relative = new T.Vector3();
  const cameraRay = new T.Raycaster();
  const props = playProps.filter(p => ['hanging_bell','straw_target','scarecrow'].includes(p.live.kind));
  const intersections = [];
  const returningPose = new T.Vector3(), returningRotation = new T.Quaternion();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false, line = -1, lineTime = 0, introTime = 0, revealTime = 0, clock = 0;
  let hold = null, exit = null, route = null, wakeClip = null, walkDistance = 0, exitShoulder = 1;
  let shot = 'whisper', cameraAngle = 0, lastCue = '', voiceStarted = false;
  let savedFov = camera.fov, returnTime = 0, returnFov = camera.fov, returnHeading = 0;
  let closeReady = false, closePending = false, padSkip = false, disposed = false;
  let linesShown = 0;

  function axis() {
    const [x,y] = route === 'wake' ? rules.position : config.cover_tree_xy_m;
    forward.set(x-hold.x,0,-(y-hold.y)).normalize();
    right.crossVectors(up,forward).multiplyScalar(rules.side);
  }

  function start(entry, sleep) {
    hold = rules.target;
    route = entry;
    if(sleep){
      const doze = character.bodyAction;
      wakeClip = createOrganoidWake(character.model,doze.getClip(),doze.time,character.actions[character.idleClip].getClip(),sleep);
      character.actions[wakeClip.name] = character.mixer.clipAction(wakeClip);
    }
    active = true;
    line = -1;
    lineTime = introTime = revealTime = returnTime = 0;
    axis();
    savedFov = camera.fov;
    startTurn.copy(character.object.quaternion);
    const facing = Math.atan2(forward.x,forward.z);
    awayTurn.setFromAxisAngle(up,facing + Math.PI);
    lookTurn.setFromAxisAngle(up,facing);
    character.object.visible = true;
    navigation.cancelShot();
    navigation.suspend(true);
    soundscape.setDialogueActive(true);
    panel.hidden = false;
    skip.focus({preventScroll:true});
    document.body.dataset.organoidScene = 'true';
    panel.dataset.shot = shot = entry === 'wake' ? 'wake' : 'whisper';
    padSkip = !!gamepadBack();
    speaker.textContent = '';
    words.textContent = '';
  }

  function gamepadBack() {
    return [...(navigator.getGamepads?.()??[])].some(p => p?.connected && p.buttons[1]?.pressed);
  }

  const beatAt = index => route === 'wake' && index === 0 ? config.wake.opening : config.dialogue[index];

  function sayCurrent() {
    if(line < 0 || lineTime < 0 || line >= config.dialogue.length || document.hidden)return;
    const clip = clips[beatAt(line).id];
    if(lineTime >= clip.length_s)return;
    voiceStarted = soundscape.playDialogue(clip.offset_s + lineTime, clip.length_s - lineTime);
  }

  function speak(index) {
    line = index;
    lineTime = 0;
    const beat = beatAt(index);
    if(shot !== beat.shot)cameraAngle = 0;
    panel.dataset.shot = shot = beat.shot;
    speaker.textContent = index === 0 ? 'A voice inside' : beat.speaker;
    words.textContent = beat.text;
    lastCue = beat.cue ?? '';
    voiceStarted = false;
    if(shot === 'depart'){
      exit = organoidDeparture(hold,rules.position,{height,hit,waterAt});
      exitForward.set(Math.cos(exit.heading),0,-Math.sin(exit.heading));
      exitSide.crossVectors(up,exitForward);
      exitShoulder = exitSide.dot(right) < 0 ? -1 : 1;
      exitSide.multiplyScalar(exitShoulder);
      exitTurn.setFromAxisAngle(up,exit.heading+Math.PI/2);
      lineTime = -exitLead;
      speaker.textContent = words.textContent = '';
    }else{
      linesShown++;
      sayCurrent();
    }
  }

  function restoreOffsets() {
    for(const [bone,base] of offsets)bone.quaternion.copy(base);
    offsets.clear();
  }

  function turnBone(bone, axis, angle, world = false) {
    if(!bone)return;
    if(!offsets.has(bone))offsets.set(bone,bone.quaternion.clone());
    headTurn.setFromAxisAngle(axis,angle);
    if(world)bone.quaternion.premultiply(headTurn);
    else bone.quaternion.multiply(headTurn);
  }

  function stop({abrupt = false, keepFacing = false} = {}) {
    if(!active)return;
    rules.complete();
    restoreOffsets();
    soundscape.setDialogueActive(false);
    speaker.textContent = words.textContent = '';
    lastCue = '';
    if(!returnTime && exit && walkDistance > 0){
      const x = hold.x+exitForward.x*walkDistance, y = hold.y-exitForward.z*walkDistance;
      hold = {x,y,z:height(x,y),heading:exit.heading};
    }
    const heading = keepFacing && !exit ? Math.atan2(-forward.z,forward.x) : hold.heading;
    if(!abrupt){
      returningPose.copy(camera.position);
      returningRotation.copy(camera.quaternion);
      returnFov = camera.fov;
      returnHeading = heading;
      returnTime = .001;
      return;
    }
    active = false;
    returnTime = 0;
    panel.hidden = true;
    delete document.body.dataset.organoidScene;
    camera.fov = savedFov;
    camera.updateProjectionMatrix();
    navigation.suspend(false);
    if(navigation.mode === 'walk'){
      navigation.placeOnFoot(hold.x,hold.y,heading);
      canvas.focus();
    }
  }

  function end() {
    active = false;
    panel.hidden = true;
    delete document.body.dataset.organoidScene;
    navigation.suspend(false);
    canvas.focus();
  }

  function updateReturn(dt) {
    returnTime += dt;
    camera.fov = savedFov;
    navigation.placeOnFoot(hold.x,hold.y,returnHeading);
    character.update(dt,'idle',0,{groundZ:hold.z,groundHeight:height,bodyClip:character.idleClip});
    const t = reduced.matches ? 1 : ease(returnTime / .62);
    camera.position.lerpVectors(returningPose,camera.position,t);
    camera.quaternion.slerpQuaternions(returningRotation,camera.quaternion,t);
    camera.fov = T.MathUtils.lerp(returnFov,savedFov,t);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    if(t >= 1)end();
  }

  function skipNow() {
    if(active)stop({abrupt:true});
  }

  function key(event) {
    if(!active)return;
    if(event.key === 'Escape' || event.code === 'KeyM'){
      event.preventDefault();
      event.stopImmediatePropagation();
      if(!event.repeat)skipNow();
    }
  }

  function visibility() {
    if(!active)return;
    if(document.hidden){soundscape.stopDialogue();voiceStarted=false;}
    else sayCurrent();
  }

  skip.addEventListener('click',skipNow);
  window.addEventListener('keydown',key,true);
  document.addEventListener('visibilitychange',visibility);

  function propBlocksCamera(from, to, nearby) {
    direction.subVectors(to,from);
    cameraRay.far = direction.length();
    cameraRay.set(from,direction.normalize());
    intersections.length = 0;
    return cameraRay.intersectObjects(nearby,true,intersections).length > 0;
  }

  function placeCamera(fov) {
    const opening = shot === 'wake' || shot === 'whisper';
    const nearby = props.filter(({root})=>root.visible && root.parent.visible &&
      (root.position.distanceToSquared(aim)<64 || root.position.distanceToSquared(pose)<16)).map(({root})=>root);
    const closeRonin = head && (opening || shot === 'ronin' || shot === 'depart');
    const subject = closeRonin && nearby.length ? head.localToWorld(facePoint.set(0,.19,.27)) : aim;
    for(const root of nearby)root.updateWorldMatrix(true,true);
    for(const angle of [cameraAngle,0,.24,-.24,.48,-.48,.76,-.76,1.05,-1.05,1.32,-1.32]){
      trial.copy(pose).sub(aim).applyAxisAngle(up,angle).add(aim);
      trial.y = Math.max(trial.y,height(trial.x,-trial.z)+.36);
      if(hit(solidPoint(aim),solidPoint(trial),.14))continue;
      direction.subVectors(aim,trial).normalize();
      across.crossVectors(direction,up).normalize();
      if(opening){
        relative.subVectors(shell.position,trial);
        const depth = relative.dot(direction), radius = config.radius_m;
        const halfWidth = Math.max(0,depth+radius)*Math.tan(T.MathUtils.degToRad(fov/2))*camera.aspect;
        if(depth > -radius && Math.abs(relative.dot(across)) < halfWidth+radius)continue;
      }
      if(nearby.length && (propBlocksCamera(trial,aim,nearby) || [-.15,0,.15].some(offset =>
        propBlocksCamera(trial,sightTarget.copy(subject).addScaledVector(across,offset),nearby))))continue;
      pose.copy(trial);
      cameraAngle = angle;
      return;
    }
    // On tight ground keep the first composition and bring a terrain-blocked
    // camera in along its sightline.
    pose.y = Math.max(pose.y,height(pose.x,-pose.z)+.36);
    for(let i=0;i<6 && hit(solidPoint(aim),solidPoint(pose),.14);i++)pose.lerp(aim,.13);
  }

  function frame(dt) {
    const scale = characterScale();
    const feet = target.set(hold.x,hold.z,-hold.y);
    const departing = shot === 'depart';
    const exitAge = lineTime + exitLead;
    let speed = 0;
    if(departing){
      speed = Math.min(1.18*ease((exitAge-.27)/.48),Math.max(0,(exit.distance-walkDistance)/Math.max(dt,.001)));
      walkDistance += speed*dt;
      feet.addScaledVector(exitForward,walkDistance);
      feet.y = height(feet.x,-feet.z);
    }
    character.object.position.copy(feet);
    restoreOffsets();
    const waking = shot === 'wake' && lineTime < wakeClip.duration;
    character.update(dt,speed>.04?'stroll':'idle',speed,{groundZ:feet.y,groundHeight:height,
      bodyClip:waking?wakeClip.name:speed>.04?undefined:character.idleClip,
      bodyTime:waking?lineTime:undefined});
    const turn = line >= 1 ? ease(revealTime / .76) : 0;
    character.object.quaternion.slerpQuaternions(startTurn,awayTurn,route === 'wake' ? 0 : ease(introTime / .69));
    character.object.quaternion.slerp(lookTurn,turn);
    if(departing)character.object.quaternion.slerp(exitTurn,ease(exitAge/.59));
    character.object.visible = true;
    if(head && line === 0 && shot === 'whisper' && !reduced.matches){
      const turn = ease((lineTime - .16) / .65);
      head.parent.getWorldQuaternion(parentTurn).invert();
      headAxis.copy(up).applyQuaternion(parentTurn);
      turnBone(head,headAxis,-rules.side * turn * .91,true);
    }
    if(beatAt(line)?.id === 'understood'){
      const nod = ease((lineTime-.13)/.33)*(1-ease((lineTime-.58)/.40));
      turnBone(head,localX,.38*nod);
    }
    if(departing){
      // A look over one shoulder, a small shake and a half-lidded side-eye.
      const glance = ease((exitAge-.31)/.33)*(1-ease((lineTime-.77)/.39));
      const dismiss = ease((lineTime+.12)/.26)*(1-ease((lineTime-1.02)/.4));
      turnBone(head,up,exitShoulder*(.57*glance+.105*dismiss*Math.sin(lineTime*17)));
      turnBone(head,localZ,-exitShoulder*.14*dismiss);
      turnBone(eye,up,exitShoulder*.19*glance);
      turnBone(lid,localX,.35*dismiss);
      turnBone(lowerLid,localX,-.10*dismiss);
      turnBone(ears[0],localX,-.55*glance);
      turnBone(ears[1],localX,-.27*dismiss);
    }
    const orb = shell.position;
    let fov;
    switch(shot){
      case 'wake': {
        const rise = ease((lineTime-.6)/.7);
        pose.copy(feet).addScaledVector(forward,1.18).addScaledVector(right,1.18);
        pose.y += (1.14+.33*rise)*scale;
        aim.copy(feet);aim.y += (.78+.42*rise)*scale;fov=50;
        break;
      }
      case 'whisper':
        // Every approach waypoint is on the far side of this camera plane.
        pose.copy(feet).addScaledVector(forward,1.10).addScaledVector(right,.85);
        pose.y += 1.36*scale;
        aim.copy(feet);aim.y += 1.22*scale;fov=51;
        break;
      case 'reveal':
        pose.copy(feet).addScaledVector(forward,-1.18).addScaledVector(right,1.74);
        pose.y += 1.78*scale;
        aim.copy(feet).lerp(orb,.55);aim.y = (feet.y + 1.15*scale + orb.y) / 2;fov=49;
        break;
      case 'ronin':
        pose.copy(feet).addScaledVector(forward,1.73).addScaledVector(right,1.0);
        pose.y += 1.42*scale;
        aim.copy(feet);aim.y += 1.30*scale;fov=43;
        break;
      case 'together':
        pose.copy(feet).lerp(orb,.5).addScaledVector(right,4.17);
        pose.y = Math.max(feet.y,orb.y-.9)+1.28;
        aim.copy(feet).lerp(orb,.5);aim.y=(feet.y+1.03*scale+orb.y)/2;fov=51;
        break;
      case 'depart':
        pose.copy(feet).addScaledVector(exitForward,2.40-.46*ease(exitAge/2.2)).addScaledVector(exitSide,.93);
        pose.y += 1.38*scale;
        aim.copy(feet).addScaledVector(exitForward,.13);aim.y+=1.10*scale;fov=46;
        break;
      default:
        pose.copy(orb).addScaledVector(forward,-2.26).addScaledVector(right,1.03);
        pose.y += .13;
        aim.copy(orb);aim.y -= .06;fov=43;
    }
    const motion = reduced.matches ? 0 : Math.sin(Math.min(lineTime,5)*.53)*.042;
    pose.addScaledVector(right,motion);
    placeCamera(fov);
    camera.position.copy(pose);
    camera.lookAt(aim);
    camera.fov = fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function update(dt,onFoot) {
    clock += dt;
    if(active && returnTime){updateReturn(dt);return;}
    const steady = !navigation.suspended && !navigation.shotActive &&
      (!onFoot?.mode || onFoot.mode === 'ground') &&
      (!onFoot?.balance || onFoot.balance.phase === 'steady') &&
      (!onFoot?.jumpPhase || onFoot.jumpPhase === 'grounded') && !onFoot?.sliding;
    const sleep = steady && onFoot && onFoot.speed < .05 ? character.sleepPose : null;
    const transition = rules.update(Math.min(dt,.05),onFoot,steady,!!sleep);
    if(transition === 'start')start('hill');
    if(transition === 'wake'){start('wake',sleep);speak(0);}
    if(active){
      if(navigation.mode !== 'walk'){stop({abrupt:true});return;}
      const back = gamepadBack();
      if(back && !padSkip){skipNow();return;}
      padSkip = back;
      introTime += dt;
      if(line >= 1)revealTime += dt;
      if(transition === 'listen')speak(0);
      else if(line >= 0 && transition !== 'wake'){
        const previous = lineTime;
        lineTime += dt;
        const beat = beatAt(line);
        if(previous < 0 && lineTime >= 0){
          speaker.textContent = beat.speaker;
          words.textContent = beat.text;
          linesShown++;
        }
        if(!voiceStarted && lineTime >= 0 && lineTime < .3)sayCurrent();
        const pause = line === 0 ? .62 : beat.id === 'agreed' ? .73 : shot === 'depart' ? 1.07 : .44;
        if(lineTime >= clips[beat.id].length_s + pause){
          if(line+1 === config.dialogue.length){stop({keepFacing:true});return;}
          speak(line+1);
        }
      }
    }
    const [x,y,z] = rules.position;
    const nod = lastCue === 'acknowledge' ? .09*ease((lineTime-.12)/.34)*(1-ease((lineTime-.51)/.56)) : 0;
    shell.position.set(x,z+.025*Math.sin(clock*.56)-nod,-y);
    if(active)frame(dt);
    // Early distance rejection avoids per-frame material work far outside the hill.
    if(camera.position.distanceToSquared(shell.position) > 550*550){shell.visible=false;return;}
    const pixels = projectedDiameter(camera,shell.position,config.radius_m,canvas.height);
    const tier = detailAt(pixels);
    if(!closeReady && !closePending && pixels>100){
      closePending=true;
      actor.prepareClose().then(()=>{if(!disposed)closeReady=true;}).catch(console.error);
    }
    const player = hold && active ? hold : onFoot;
    if(exit && active)look.target.copy(character.object.position).addScaledVector(up,1.3);
    else if(player)look.target.set(player.x,player.z+1.3,-player.y);
    else look.target.copy(camera.position);
    sampleOrganoidExpression(lastCue,lineTime,look);
    if(!active && rules.phase === 'watch' && player){
      const near = Math.hypot(player.x-x,player.y-y);
      look.notice = (1-T.MathUtils.smoothstep(near,6,28))*.35;
    }
    actor.update(closeReady?tier:Math.max(1,tier),clock,closeSampleBudget(pixels),look);
  }

  return {
    update,
    skip: skipNow,
    get active() { return active; },
    get state() {
      return {phase:rules.phase,position:[...rules.position],active,route,line,shot,linesShown,voiceStarted,walkDistance,
        visible:shell.visible};
    },
    dispose() {
      disposed = true;
      if(active)stop({abrupt:true});
      skip.removeEventListener('click',skipNow);
      window.removeEventListener('keydown',key,true);
      document.removeEventListener('visibilitychange',visibility);
      scene.remove(shell);
      actor.dispose();
    },
  };
}

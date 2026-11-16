import * as T from '../vendor/three.module.min.js';
import {createParakiteFollow,followCue,parakiteTourLessons} from '../../../shared/activities/parakite-follow.js';
import {command,setController,stageFlightGuide} from '../../../shared/npc/folk.js';
import {safeWalkGround} from '../../../shared/activities/walk.js';

const KEY='tumbler.juno-parakite-tour.v1';
const INVITATION=[
  'Hey, Ronin. What a morning. The air up on the ridge is smooth, and you can see right down to the river.',
  'The kite’s tuned, the valley’s wide awake, and I’ve got a little trail through the trees. Want to learn to fly it with me?',
];
const CLOSING=[
  'There you are. That last gap always feels smaller from the air.',
  'You kept the wing with you all the way home. Next time, you pick the line.',
];
const ROUGH_LANDING='Bit of a bump there. You found the gap and brought the kite down. That’s a run worth keeping.';

export function createParakiteTour({panel,camera,canvas,navigation,practice,world,soundscape,onFootMode,isAvailable}){
  const cat=world.cats.find(c=>c.id==='juno'&&c.skills.includes('fly')&&c.flightPlan?.mode==='parakite');
  const talk=panel.querySelector('[data-tour-talk]');
  const scene=panel.querySelector('[data-tour-scene]');
  const text=panel.querySelector('[data-tour-text]');
  const accept=panel.querySelector('[data-tour-accept]');
  const back=panel.querySelector('[data-tour-back]');
  const hud=panel.querySelector('[data-tour-hud]');
  const readings=hud.querySelector('[data-tutorial-readings]');
  const cue=panel.querySelector('[data-tour-cue]');
  const marker=panel.querySelector('[data-tour-marker]');
  const quit=panel.querySelector('[data-tour-quit]');
  const aim=new T.Vector3(),projected=new T.Vector3(),front=new T.Vector3();
  let phase='idle',age=0,beat=0,callAt=0,waveAt=0,prior=null,returnPose=null,follow=null,heldA=false,heldX=false,heldB=false;
  let savedCamera=null,priorWeather=null,meetup=null,alarmPose=null,alarmAt=0,roughLanding=false,guideWarmTask=null;
  function remember(){try{localStorage.setItem(KEY,'seen');}catch{}}
  function firstVisit(){try{return !localStorage.getItem(KEY);}catch{return true;}}
  function change(next){phase=next;age=0;panel.dataset.phase=next;}
  function stand(x,y){return safeWalkGround(x,y,world.walk,world.height,world.hitTest);}
  function stageNear(player,heading,distances){
    for(const distance of distances)for(const offset of [.22,-.22,0,.44,-.44,.7,-.7]){
      const bearing=heading+offset,x=player.x+Math.cos(bearing)*distance,y=player.y+Math.sin(bearing)*distance,z=stand(x,y);
      if(z===null||Math.abs(z-player.z)>2.5||world.hitTest?.([player.x,player.y,player.z+1],[x,y,z+1],.36))continue;
      return {x,y,z,heading:bearing+Math.PI};
    }
    return null;
  }
  function offer({force=false}={}){
    const player=navigation.state;
    if(!cat||!isAvailable()||navigation.mode!=='walk'||phase!=='idle'||!force&&!firstVisit())return false;
    camera.getWorldDirection(front);
    const facing=Math.atan2(-front.z,front.x);
    const spot=stageNear(player,facing,[5.5,7,9,12]);
    if(!spot)return false;
    prior={body:cat.body,controller:cat.controller,step:cat.step,plan:cat.plan,activity:cat.activity};
    returnPose={...player};priorWeather=navigation.weather;
    setController(world,cat,'agent');
    stageFlightGuide(world,cat,spot);
    callAt=waveAt=0;
    change('offering');
    return true;
  }
  function release(restore){
    if(prior){
      if(restore){
        cat.body=prior.body;
        cat.step=prior.step;cat.plan=prior.plan;cat.activity=prior.activity;
      }else command(world,cat,{verb:'stop'});
      setController(world,cat,prior.controller);
    }
    prior=null;
  }
  function closeScene(){
    if(savedCamera){
      camera.position.copy(savedCamera.position);camera.quaternion.copy(savedCamera.rotation);
      camera.fov=savedCamera.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld();
      savedCamera=null;
    }
    scene.hidden=true;
    navigation.suspend(false);
    soundscape.setDialogueActive(false);
    canvas.focus();
  }
  function finish({complete=false,seen=true}={}){
    if(phase==='idle')return;
    const wasFlying=['lessons','brief','following','rewind','gather'].includes(phase);
    if(seen)remember();
    if(savedCamera)closeScene();
    else if(wasFlying)navigation.suspend(false);
    practice.stopSequence();
    if(wasFlying&&navigation.state?.guidedParakite&&returnPose){
      navigation.endGuidedFlight();
      onFootMode(returnPose);
    }
    if(priorWeather&&wasFlying)navigation.setWeather(priorWeather);
    release(!complete);
    cancelGuideWarm();
    follow=meetup=alarmPose=null;talk.hidden=hud.hidden=marker.hidden=true;
    change('idle');
    canvas.focus();
  }
  function say(message){
    text.textContent=message;
    soundscape.meow(cat.body.state);
  }
  function openScene(next){
    talk.hidden=hud.hidden=marker.hidden=true;
    savedCamera={position:camera.position.clone(),rotation:camera.quaternion.clone(),fov:camera.fov};
    navigation.suspend(true);
    soundscape.setDialogueActive(true);
    change(next);beat=0;
    scene.hidden=false;
    back.hidden=next==='closing';
    paintScene();
    placeCamera();
    accept.focus({preventScroll:true});
  }
  function paintScene(){
    const closing=roughLanding?[ROUGH_LANDING,CLOSING[1]]:CLOSING;
    const lines=phase==='closing'?closing:phase==='brief'?
      ['Stay a little behind me. We’ll loop out over the valley, spiral down, then thread past the trees. Copy my line if you can. Centre the wing if it starts to get away from you.']:INVITATION;
    say(lines[beat]);
    accept.textContent=beat<lines.length-1?'Continue':phase==='invite'?'Teach me to fly':phase==='brief'?'Follow Juno':'Back to the valley';
    back.textContent=phase==='invite'?'Maybe later':'Leave tutorial';
  }
  function advanceScene(){
    if(phase==='invite'&&beat===0||phase==='closing'&&beat===0){beat++;paintScene();return;}
    if(phase==='invite'){
      closeScene();change('lessons');
      prepareGuide();
      practice.startSequence(parakiteTourLessons,beginFollow,()=>finish());
    }else if(phase==='brief'){
      closeScene();change('following');hud.hidden=false;
    }else if(phase==='closing'){
      navigation.setWeather(priorWeather);
      finish({complete:true});
    }
  }
  const requestGuideWarm=window.requestIdleCallback?.bind(window)??(callback=>setTimeout(callback,16));
  const cancelWarm=window.cancelIdleCallback?.bind(window)??clearTimeout;
  function cancelGuideWarm(){
    if(guideWarmTask===null)return;
    cancelWarm(guideWarmTask);guideWarmTask=null;
  }
  function warmGuide(deadline){
    const stop=performance.now()+2.5;
    for(let steps=0;steps<32&&performance.now()<stop&&(deadline?.timeRemaining()??3)>.5;steps++){
      if(!follow.warmNext()){guideWarmTask=null;return;}
    }
    guideWarmTask=requestGuideWarm(warmGuide);
  }
  function prepareGuide(){
    follow=createParakiteFollow({config:world.flight,wind:world.worldmap.wind.direction_deg,height:navigation.sampleFloor,
      hitTest:world.hitTest,walkHeight:world.height});
    guideWarmTask=requestGuideWarm(warmGuide);
  }
  function beginFollow(){
    resetPair();
    openScene('brief');
  }
  function resetPair(){
    const start=follow.retry();
    navigation.placeGuidedFlight(start.player);
    stageFlightGuide(world,cat,start.guide,true);
  }
  function placeCamera(){
    const player=navigation.state,guide=cat.body.state;
    if(phase==='brief'){
      // Airborne introductions use the same direction of travel as the chase camera.
      const a=player.heading;
      camera.position.set(player.x-Math.cos(a)*9-Math.sin(a)*5,player.z+4,-player.y+Math.sin(a)*9-Math.cos(a)*5);
      aim.set((player.x+guide.x)/2,(player.z+guide.z)/2+1,-(player.y+guide.y)/2);
    }else{
      const dx=guide.x-player.x,dy=guide.y-player.y,d=Math.hypot(dx,dy)||1;
      const x=(player.x+guide.x)/2,y=(player.y+guide.y)/2;
      aim.set(x,(player.z+guide.z)/2+1,-y);
      const separate=d>5;
      if(separate)aim.set(guide.x,guide.z+1,-guide.y);
      const radius=separate?3.4:Math.max(3.9,d*1.4);
      const frameX=separate?guide.x:x,frameY=separate?guide.y:y;
      for(const side of [1,-1,.65,-.65]){
        const px=frameX-dy/d*radius*side-dx/d,py=frameY+dx/d*radius*side-dy/d;
        const z=Math.max(separate?guide.z+1.65:Math.max(player.z,guide.z)+1.65,navigation.sampleFloor(px,py)+1.35);
        camera.position.set(px,z,-py);
        if(!world.hitTest?.([px,py,z],[frameX,frameY,aim.y],.24))break;
      }
    }
    camera.lookAt(aim);camera.fov=phase==='brief'?62:51;
    camera.updateProjectionMatrix();camera.updateMatrixWorld();
  }
  function findMarker(height=5){
    const s=cat.body.state;
    projected.set(s.x,s.z+height,-s.y).project(camera);
    if(projected.z<1&&Math.abs(projected.x)<.95&&Math.abs(projected.y)<.87){
      marker.style.left=`${(projected.x*.5+.5)*100}%`;
      marker.style.top=`${(-projected.y*.5+.5)*100}%`;
      marker.hidden=false;
    }else marker.hidden=true;
  }
  function setCue(message){if(cue.textContent!==message)cue.textContent=message;}
  function update(dt,onFoot){
    if(phase==='idle')return;
    age+=dt;
    const pad=[...(navigator.getGamepads?.()??[])].find(gamepad=>gamepad?.connected);
    const a=!!pad?.buttons[0]?.pressed,x=!!pad?.buttons[2]?.pressed,b=!!pad?.buttons[1]?.pressed;
    const pressA=a&&!heldA,pressX=x&&!heldX,pressB=b&&!heldB;
    heldA=a;heldX=x;heldB=b;
    if(phase==='offering'){
      if(!onFoot||!isAvailable()){talk.hidden=true;if(!onFoot&&!navigation.suspended)finish({seen:false});return;}
      const s=cat.body.state,d=Math.hypot(onFoot.x-s.x,onFoot.y-s.y,onFoot.z-s.z);
      if(d>38){finish({seen:false});return;}
      talk.hidden=d>3.35||navigation.suspended;
      if(!talk.hidden&&pressX){openScene('invite');return;}
      if(!navigation.suspended&&d<20){
        if(age>=waveAt){
          command(world,cat,{verb:'do',activity:'wave'});
          command(world,cat,{verb:'look_at',at:'player',seconds:8});
          waveAt=age+7;
        }
        if(age>=callAt)callAt=age+(soundscape.meow(s)?7:.65);
      }
    }else if(savedCamera){
      placeCamera();
      if(pressA)advanceScene();
      else if(pressB&&!back.hidden)finish();
    }else if(phase==='lessons'){
      if(!navigation.flightLesson){finish();return;}
      if(!navigation.suspended&&pressA)practice.advance();
    }else if(phase==='following'){
      if(navigation.suspended)return;
      if(navigation.mode!=='parakite'||!navigation.state?.guidedParakite){finish();return;}
      const result=follow.advance(dt,navigation.state),s=follow.guide;
      stageFlightGuide(world,cat,s,!s.grounded);
      if(result==='lost'){
        alarmPose=navigation.state;
        alarmAt=.18;
        if(soundscape.meow(alarmPose,true))alarmPose=null;
        else soundscape.unlock().catch(error=>console.warn('Tumbler could not resume audio',error));
        setCue('Juno circles back. Catch your breath and rejoin the trail.');
        change('rewind');marker.hidden=true;navigation.suspend(true);
      }else if(result==='guide-contact'){
        // A changed world can invalidate an authored route. Leave the pilots on safe ground.
        finish();
      }else if(result==='landed'){
        const landing=navigation.state;
        roughLanding=landing.collapsed||landing.fallBounce||landing.landingQuality==='hard';
        navigation.endGuidedFlight();onFootMode(landing);
        meetup=stageNear(navigation.state,Math.atan2(s.y-landing.y,s.x-landing.x),[2.5,3,1.9]);
        if(meetup){
          if(Math.hypot(s.x-meetup.x,s.y-meetup.y)<4)stageFlightGuide(world,cat,meetup);
          else command(world,cat,{verb:'go_to',x:meetup.x,y:meetup.y,pace:'run'});
        }
        setCue('Both wings are down. Meet Juno by the landing.');
        change('gather');marker.hidden=true;
      }else{
        setCue(s.grounded?'Juno is down. Ease into the landing.':followCue(navigation.state.followStep*(1/120)));
        findMarker();
      }
    }else if(phase==='rewind'){
      if(alarmPose&&age>=alarmAt){
        if(soundscape.meow(alarmPose,true))alarmPose=null;
        alarmAt=age+.18;
      }
      if(age>1.15){
        alarmPose=null;resetPair();navigation.suspend(false);change('following');setCue('Back on the trail. Follow Juno.');
      }
    }else if(phase==='gather'){
      if(!onFoot){finish();return;}
      if(navigation.suspended)return;
      if(age>9&&meetup&&Math.hypot(meetup.x-onFoot.x,meetup.y-onFoot.y)<4.4){
        stageFlightGuide(world,cat,meetup);
      }
      const distance=Math.hypot(cat.body.state.x-onFoot.x,cat.body.state.y-onFoot.y);
      if(distance<4.4||age>16){
        command(world,cat,{verb:'stop'});
        command(world,cat,{verb:'look_at',at:'player',seconds:45});
        openScene('closing');
      }else findMarker(1.6);
    }
  }
  function key(event){
    if(event.repeat)return;
    if(savedCamera&&event.code==='Tab'){
      event.preventDefault();event.stopImmediatePropagation();
      (!back.hidden&&document.activeElement===accept?back:accept).focus();
    }else if(savedCamera&&event.code==='Escape'){
      event.preventDefault();event.stopImmediatePropagation();
      if(phase==='closing'){navigation.setWeather(priorWeather);finish({complete:true});}else finish();
    }else if(phase==='offering'&&!talk.hidden&&event.code==='KeyE'){
      event.preventDefault();event.stopImmediatePropagation();openScene('invite');
    }else if(phase==='lessons'&&!navigation.suspended&&event.code==='Enter'&&event.target===canvas&&practice.advance({allowIncomplete:true})){
      event.preventDefault();event.stopImmediatePropagation();
    }
  }
  talk.addEventListener('click',()=>{if(phase==='offering'&&!talk.hidden)openScene('invite');});
  accept.addEventListener('click',advanceScene);
  back.addEventListener('click',()=>finish());
  quit.addEventListener('click',()=>finish());
  window.addEventListener('keydown',key,true);
  return {offer,update,finish,get phase(){return phase;},get cinematic(){return !!savedCamera;},get statsDock(){return hud.hidden?null:readings;},get sceneryLead(){return phase==='following'&&follow&&!follow.guide.grounded?follow.guide:null;},get checkpointTime(){return follow?.checkpointTime;},
    dispose(){cancelGuideWarm();window.removeEventListener('keydown',key,true);}};
}

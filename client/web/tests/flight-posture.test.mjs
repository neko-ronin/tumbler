import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {createFlightPosture} from '../src3d/flight-posture.js';
import {createNavigation} from '../src3d/navigation.js';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const source=read('../../../shared/activities/flight.json'),player=read('../../../shared/characters/player.json');
const ride=read('../../../shared/activities/ride.json'),world=read('../../../shared/world/worldmap.json');
const rules={...source,world_limit_m:1e6,ceiling_m:1e6,thermals:[],wind:{speed_mps:0,gust_mps:0},
  launches:[{xy_m:[0,0],heading_deg:0,clearance_m:1600}],weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};

test('posture follows a held attitude without overshoot or modifying the physical target',()=>{
  const filter=createFlightPosture(),identity=new T.Quaternion(),target=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,0,1),.5),copy=target.clone();
  filter.update(identity,0);let before=.5;
  for(let frame=0;frame<120;frame++){
    const shown=filter.update(target,1/120),gap=shown.angleTo(target);
    assert.ok(gap<=before+1e-9,'the first-order posture follower must not add a spring overshoot');
    assert.ok(identity.angleTo(shown)<=.5+1e-9);before=gap;
  }
  assert.ok(before<.005,'a sustained attitude is retained after the brief visual transition');
  assert.ok(target.equals(copy),'presentation never modifies its physical target');
  filter.reset();assert.ok(filter.update(identity,0).equals(identity),'contact/retry can discard the previous posture');
});

test('posture softens one-hertz chatter while retaining slow intentional banking',()=>{
  const amplitude=frequency=>{
    const filter=createFlightPosture(),target=new T.Quaternion(),axis=new T.Vector3(0,0,1),dt=1/120;
    let lo=Infinity,hi=-Infinity,rawLo=Infinity,rawHi=-Infinity;
    const seconds=frequency===1?8:60;
    for(let frame=0;frame<seconds/dt;frame++){
      const time=frame*dt,angle=.12*Math.sin(time*2*Math.PI*frequency);
      target.setFromAxisAngle(axis,angle);const shown=filter.update(target,dt);
      if(time>seconds/2){const a=2*Math.atan2(shown.z,shown.w);lo=Math.min(lo,a);hi=Math.max(hi,a);rawLo=Math.min(rawLo,angle);rawHi=Math.max(rawHi,angle);}
    }
    return (hi-lo)/(rawHi-rawLo);
  };
  assert.ok(amplitude(1)<.8&&amplitude(1)>.4,'fast visual posture changes are softened rather than frozen');
  assert.ok(amplitude(.05)>.98,'slow banks still reach their intended attitude');
});

function replay(pilotMotion){
  const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  const pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
  for(const [key,value] of Object.entries({window:new EventTarget(),document:new EventTarget(),navigator:{getGamepads:()=>[pad]}}))Object.defineProperty(globalThis,key,{value,configurable:true});
  const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
  const rig=new T.Group(),character={object:new T.Group(),update(){}},states=[],rotations=[];
  let shownPose,presentation;
  rig.userData.flightUpdate=(dt,pose,view)=>{shownPose=pose;presentation=view;};
  const nav=createNavigation(new T.PerspectiveCamera(62,16/9),canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},rules,world,rig,()=>null,
    {config:ride,rig:new T.Group(),meshes:{}},character,player,{pilotMotion});
  try{
    nav.select('paramotor');nav.setChallenge('linked-turns');
    for(let frame=0;frame<720;frame++){
      pad.axes[0]=frame<150?1:frame<300?-1:0;
      pad.buttons[5].pressed=frame<180;pad.buttons[4].pressed=frame>=180&&frame<420;
      nav.update(1/60);states.push(structuredClone(nav.state));rotations.push(character.object.quaternion.clone());
      if(shownPose.coupled){
        rig.updateMatrixWorld(true);
        const fitted=rig.localToWorld(new T.Vector3(0,rules.coupled.harness_height_m,0).applyMatrix4(presentation.pilotTransform));
        const hip=shownPose.coupled.pilotPosition;
        assert.ok(fitted.distanceTo(new T.Vector3(hip[0],hip[2],-hip[1]))<1e-7,'visual posture keeps the authoritative hip and lower line anchor exact');
      }
    }
    nav.setPilotMotion(pilotMotion==='steady'?'physical':'steady');nav.update(0);
    assert.throws(()=>nav.setPilotMotion('unknown'),/Unknown pilot posture/);
    return {states,rotations};
  }finally{nav.dispose();for(const [key,descriptor] of saved)descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key];}
}

test('switchable posture animation leaves every force-driven state and physical hip unchanged',()=>{
  const steady=replay('steady'),raw=replay('physical');
  assert.deepEqual(steady.states,raw.states,'posture must never feed back into trajectory, tension, thrust, work or scoring');
  assert.ok(steady.states.some(s=>(s.challenge?.turns??0)>0),'the replay exercises actual linked-turn scoring');
  assert.ok(steady.rotations.some((q,i)=>q.angleTo(raw.rotations[i])>.02),'the choice actually changes displayed posture');
});

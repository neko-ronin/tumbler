import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import { parseGLB } from '../src3d/glb.js';
import { createCharacter } from '../src3d/character.js';
import { createNavigation } from '../src3d/navigation.js';
import { stepWalk } from '../../../shared/activities/walk.js';
const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const config = read('../../../shared/characters/player.json');
const flight = read('../../../shared/activities/flight.json');
const ride = read('../../../shared/activities/ride.json');
const worldmap = read('../../../shared/world/worldmap.json');
function character() { return createCharacter(parseGLB(readFileSync(new URL('../../../shared/geometry/'+config.asset, import.meta.url))), config); }

test('Ronin retains bone-parented meshes and playable clips animate actual geometry', () => {
  const cat = character();
  cat.update(.2, 'idle');cat.object.updateMatrixWorld(true);
  const box = new T.Box3().setFromObject(cat.object);
  assert.ok(Math.abs(box.min.y) < .07, 'idle soles remain on the ground');
  assert.ok(box.max.y > 1.5 && box.max.y < 2.2, 'metre-scale character (ear tips ~1.7 m), without doubled node transforms');
  let paw;
  cat.model.traverse(node => { if (node.isMesh && node.parent.name === 'paw.L') paw = node; });
  assert.ok(paw, 'test a rendered paw, not just an action name');
  cat.update(.3, 'walk', 3.5);cat.object.updateMatrixWorld(true);
  const before = paw.getWorldPosition(new T.Vector3());
  cat.update(.23, 'walk', 3.5);cat.object.updateMatrixWorld(true);
  assert.ok(before.distanceTo(paw.getWorldPosition(new T.Vector3())) > .03);
  for (const pose of ['run', 'flight', 'idle']) {
    cat.update(.3, pose, 9);cat.object.updateMatrixWorld(true);
    const b = new T.Box3().setFromObject(cat.object);
    assert.ok([...b.min.toArray(), ...b.max.toArray()].every(Number.isFinite));
    assert.equal(cat.clip, config.clips[pose]);
  }
  cat.dispose();
});

test('walking normalizes diagonals, respects analogue input, blocks contact and preserves prior state', () => {
  const origin = { x:0, y:0, z:0, heading:0, speed:0 }, flat=()=>0;
  // Traction ramps speed, so compare settled velocities rather than one step.
  const step = input => {let s=origin;for(let i=0;i<20;i++)s=stepWalk(s, input, .05, config.walk, flat);return s;};
  const straight=step({x:1,y:0}),diagonal=step({x:1,y:1});
  assert.ok(Math.abs(Math.hypot(diagonal.vx,diagonal.vy)-straight.vx)<1e-9);
  assert.ok(Math.abs(step({x:.5,y:0}).vx-straight.vx*.5)<1e-9);
  assert.ok(step({x:1,y:0,run:true}).speed > straight.speed);
  for (const height of [()=>null,()=>10]) assert.equal(stepWalk(origin,{x:1,y:0},.05,config.walk,height).speed,0);
  assert.equal(stepWalk(origin,{x:1,y:0},.05,config.walk,flat,()=>({kind:'tree'})).x,0);
  assert.deepEqual(origin,{x:0,y:0,z:0,heading:0,speed:0});
});

test('tail layers bend weighted geometry, vary at idle and follow flight context without resetting the body', () => {
  const cat=character();let tail;
  cat.model.traverse(node=>{if(node.isSkinnedMesh&&node.parent.name==='cat_tail')tail=node;});
  assert.ok(tail,'the tail is one continuously skinned surface');
  function tip(){cat.object.updateMatrixWorld(true);tail.skeleton.update();return tail.getVertexPosition(tail.geometry.attributes.position.count-1,new T.Vector3()).clone();}
  cat.update(.5,'idle');const before=tip(),idleClips=new Set([cat.tailClip]);
  for(let i=0;i<120;i++){cat.update(.1,'idle');idleClips.add(cat.tailClip);}
  assert.ok(idleClips.size>1,'idle selects different tail behaviors over time');
  assert.ok(before.distanceTo(tip())>.015,'the weighted tip actually moves');
  cat.update(.5,'flight',0,{mode:'parakite',bank:-.5});const left=tip();
  assert.equal(cat.tailClip,config.tail_clips.turn_left[0]);assert.equal(cat.clip,config.clips.flight);
  cat.update(.5,'flight',0,{mode:'paramotor',bank:.5});const right=tip();
  assert.equal(cat.tailClip,config.tail_clips.turn_right[0]);assert.ok(left.distanceTo(right)>.02);
  cat.update(.5,'idle',0,{grounded:true});assert.equal(cat.tailClip,config.tail_clips.landed[0]);
  for(let i=0;i<tail.geometry.attributes.skinWeight.count;i++){
    const w=tail.geometry.attributes.skinWeight;
    assert.ok(Math.abs(w.getX(i)+w.getY(i)+w.getZ(i)+w.getW(i)-1)<1e-5);
  }
  cat.dispose();
});

test('third-person navigation moves the cat, keeps the camera separate and hides it for both sports', () => {
  const previous = new Map(['window','document','navigator'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const window = new EventTarget(),document = new EventTarget();
  Object.defineProperty(globalThis,'window',{value:window,configurable:true});
  Object.defineProperty(globalThis,'document',{value:document,configurable:true});
  Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>[]},configurable:true});
  const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
  const camera=new T.PerspectiveCamera();camera.position.set(0,5,0);camera.lookAt(2,5,-4);
  const orbit={target:new T.Vector3(),setTarget(){},update(){}},cat=character(),rig=new T.Group(),rideRig=new T.Group();
  const nav=createNavigation(camera,canvas,orbit,{height:()=>0},flight,worldmap,rig,()=>null,{config:ride,snowAt:()=>1,height:()=>0,surfaceAt:()=> 'snow',rig:rideRig,meshes:{ski:new T.Mesh(),bike:new T.Mesh()}},cat,config);
  const key=(type,code)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:canvas}});window.dispatchEvent(e);};
  try {
    nav.select('walk');const before={...nav.state};
    const facing=new T.Vector3(0,0,1).applyQuaternion(cat.object.quaternion),viewDirection=camera.getWorldDirection(new T.Vector3());
    viewDirection.y=0;viewDirection.normalize();assert.ok(facing.dot(viewDirection)>.999,'entry faces the camera-relative forward direction');
    key('keydown','KeyW');
    for(let i=0;i<60;i++) nav.update(1/60);
    key('keyup','KeyW');
    const ramp=config.walk.walk_mps**2/(2*config.walk.accel_mps2);
    assert.ok(Math.abs(Math.hypot(nav.state.x-before.x,nav.state.y-before.y)-(3.5-ramp))<.03,'one second of walking, less the start-up ramp');
    assert.equal(cat.object.visible,true);assert.equal(cat.clip,'walk');
    assert.ok(camera.position.distanceTo(cat.object.position)>4);
    for(const mode of ['paraglider','parakite','paramotor']) {
      nav.select(mode);nav.update(1/60);
      assert.equal(cat.object.visible,true);assert.equal(rig.visible,true);
      if(nav.state.grounded){assert.equal(cat.clip,'idle','equipping on foot stays on the ground');nav.select(mode,0);nav.update(1/60);}
      assert.equal(cat.clip,'harness');
      assert.ok(camera.position.distanceTo(cat.object.position)>8);
    }
    for(const mode of ['bike','ski']) {
      nav.select(mode,ride.starts.find(start=>start.mode===mode).id);nav.update(1/60);
      assert.equal(cat.object.visible,false);assert.equal(rig.visible,false);assert.equal(rideRig.visible,true);
      key('keydown','KeyV');key('keyup','KeyV');assert.equal(rideRig.visible,false);
      key('keydown','KeyV');key('keyup','KeyV');assert.equal(rideRig.visible,true);
    }
    nav.select('orbit');assert.equal(cat.object.visible,false);assert.equal(rideRig.visible,false);
  } finally { nav.dispose();cat.dispose();for(const [name,descriptor] of previous) descriptor?Object.defineProperty(globalThis,name,descriptor):delete globalThis[name]; }
});

test('katana layer hands the chest handle to the paw, extends the blade with a chain of locks, and holsters for flight', () => {
  const cat=character(),cues=[];cat.onCue=name=>cues.push(name);
  const bone=name=>{let found;cat.model.traverse(n=>{if(n.isBone&&n.name===name)found=n;});assert.ok(found,`bone ${name}`);return found;};
  const shown=name=>{cat.object.updateMatrixWorld(true);return bone(name).getWorldScale(new T.Vector3()).x;};
  const reach=()=>{cat.object.updateMatrixWorld(true);return bone('katana').getWorldPosition(new T.Vector3()).distanceTo(bone('blade.4').getWorldPosition(new T.Vector3()));};
  const settle=state=>{for(let i=0;i<200&&cat.katana!==state;i++)cat.update(1/30,'walk',3.5);assert.equal(cat.katana,state);};
  cat.update(.1,'idle');
  assert.equal(cat.katana,'holstered');assert.ok(shown('katana')<.01&&shown('katana.sheathed')>.99,'only the chest handle shows');
  const collapsed=reach();
  assert.equal(cat.toggleKatana(),'draw');assert.equal(cat.toggleKatana(),'draw','a second press mid-draw is ignored');
  settle('drawn');
  assert.ok(shown('katana')>.99&&shown('katana.sheathed')<.01,'the paw holds the only handle');
  assert.ok(reach()-collapsed>.35,'four segments slid out of the handle');
  assert.deepEqual(cues.slice(0,3),['latch','eject','catch']);
  assert.deepEqual(cues.filter(c=>c==='lock').length,4);assert.ok(cues.indexOf('catch')<cues.indexOf('slide'));
  cues.length=0;cat.toggleKatana();settle('holstered');
  assert.equal(cues.at(-1),'seat');assert.ok(shown('katana')<.01&&shown('katana.sheathed')>.99);
  cat.toggleKatana();cat.update(.2,'idle');cat.update(.1,'flight',0,{mode:'paraglider'});
  assert.equal(cat.katana,'holstered','the blade is put away for the harness');
  cat.dispose();
});

test('drawn katana runs two-handed with the blade trailing, and strikes chain crescent → rising → cleave', () => {
  const cat=character(),cues=[];cat.onCue=name=>cues.push(name);
  const node=name=>{let found;cat.model.traverse(n=>{if(n.name===name&&!found)found=n;});assert.ok(found,name);return found;};
  const at=name=>{cat.object.updateMatrixWorld(true);return node(name).getWorldPosition(new T.Vector3());};
  const settle=(state,pose='idle',speed=0)=>{for(let i=0;i<300&&cat.katana!==state;i++)cat.update(1/30,pose,speed);assert.equal(cat.katana,state);};
  cat.update(.1,'idle');
  assert.equal(cat.attack(),'draw','a strike while holstered draws the blade first');settle('drawn');
  settle('run','run',9);for(let i=0;i<10;i++)cat.update(1/30,'run',9);
  // Both paws on the handle (the left one toward the pommel), the blade pointing behind him.
  const grip=at('katana'),tip=at('blade.4'),blade=tip.clone().sub(grip).normalize();
  const facing=new T.Vector3(0,0,1).applyQuaternion(cat.object.quaternion);
  assert.ok(blade.dot(facing)<-.5,'the blade trails behind the run');
  const left=at('paw.L'),along=left.clone().sub(grip).dot(blade);
  assert.ok(along<0&&left.distanceTo(grip.clone().addScaledVector(blade,along))<.08,'the left paw holds the handle behind the right');
  settle('drawn','idle');
  cues.length=0;
  assert.equal(cat.attack(),'attack');assert.ok(cat.attacking);
  assert.equal(cat.toggleKatana(),'attack','the blade is not sheathed mid-strike');
  const clips=new Set();
  for(let i=0;i<240&&cat.katana==='attack';i++){if(i%6===0)cat.attack();cat.update(1/30,'idle');clips.add(cat.katanaAction.getClip().name);}
  assert.deepEqual([...clips].filter(n=>n.startsWith('katana_slash')),config.katana.attacks,'held presses chain all three, in order');
  assert.equal(cat.katana,'drawn','the chain ends back on guard');assert.ok(!cat.attacking);
  for(const cue of ['swish','spin','charge','swish_heavy','impact','flick'])assert.ok(cues.includes(cue),`cue ${cue}`);
  assert.ok(cues.indexOf('impact')>cues.indexOf('swish_heavy'));
  // One press plays one blow; airborne he cannot start one.
  cat.attack();for(let i=0;i<120&&cat.katana==='attack';i++)cat.update(1/30,'idle');
  assert.equal(cat.katana,'drawn');
  cat.update(1/30,'jump');assert.equal(cat.attack(),'drawn','no strike from the air');
  cat.dispose();
});

test('a landed blow draws its trail, sparks and shake beside the character, not inside his bounds', () => {
  const cat=character(),scene=new T.Scene();scene.add(cat.object);
  cat.update(.1,'idle');cat.toggleKatana();for(let i=0;i<120&&cat.katana!=='drawn';i++)cat.update(1/30,'idle');
  const before=new T.Box3().setFromObject(cat.object);
  const fx=scene.getObjectByName('katana_fx');assert.ok(fx&&fx.parent===scene,'effects live beside him');
  const ribbon=fx.children.find(c=>c.isMesh&&c.geometry.index);let trail=false,sparks=false,shake=0;
  cat.attack();
  for(let i=0;i<240&&cat.katana==='attack';i++){
    if(i%6===0)cat.attack();cat.update(1/30,'idle');
    trail||=ribbon.visible&&ribbon.geometry.drawRange.count>12;shake=Math.max(shake,cat.shake);sparks||=fx.children.some(c=>c.isPoints&&c.visible);
  }
  assert.ok(trail,'the swing leaves a ribbon');assert.ok(sparks,'the cleave throws sparks');assert.ok(shake>.1,'and shakes the view');
  for(let i=0;i<60;i++)cat.update(1/30,'idle');
  assert.ok(cat.shake<.01,'the shake dies away');
  assert.ok(new T.Box3().setFromObject(cat.object).min.y>before.min.y-.05,'his bounds hold no effect geometry');
  cat.dispose();assert.equal(fx.parent,null,'disposed with him');
});

test('studio audition hooks put a named clip on one layer without stopping the others', () => {
  const cat=character();
  cat.update(.2,'walk',3.5);assert.equal(cat.clip,'walk');
  cat.update(.2,'walk',3.5,{bodyClip:'lookaround'});
  assert.equal(cat.clip,'lookaround');assert.equal(cat.bodyAction.getClip().name,'lookaround');assert.ok(cat.tailClip.startsWith('tail_walk'),'tail keeps the game choice');
  cat.update(.2,'idle',0,{tailClip:'tail_alert'});assert.equal(cat.tailClip,'tail_alert');assert.equal(cat.clip,'idle');
  cat.dispose();
});

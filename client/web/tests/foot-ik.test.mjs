import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {stepWalk,gaitFor} from '../../../shared/activities/walk.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url)));
const asset=()=>parseGLB(readFileSync(new URL('../../../shared/geometry/cat-ronin/ronin.glb',import.meta.url)));

/** Pose him as navigation does: physics at x/y/z, facing `heading`, one frame of `pose`. */
function place(cat,s,floor,dt=1/60){
  cat.object.position.set(s.x,s.z,-s.y);cat.object.quaternion.setFromAxisAngle(new T.Vector3(0,1,0),(s.heading??0)+Math.PI/2);
  const pose=s.speed>.05?gaitFor(s.speed,config.walk,config.clips):'idle';
  cat.update(dt,pose,s.speed??0,{groundZ:floor(s.x,s.y),groundHeight:floor});
  cat.object.updateMatrixWorld(true);
}
/** Each foot's bottom above the floor under its centre (negative: inside the ground). */
function gaps(cat,floor){
  return ['L','R'].map(side=>{
    const box=new T.Box3();cat.model.traverse(n=>{if(n.isMesh&&n.parent?.name==='foot.'+side)box.union(n.geometry.boundingBox.clone().applyMatrix4(n.matrixWorld));});
    const c=box.getCenter(new T.Vector3());return box.min.y-floor(c.x,-c.z);
  });
}
const hips=cat=>cat.model.getObjectByName('hips').getWorldPosition(new T.Vector3()).y;

test('standing across a slope, the downhill paw reaches its ground instead of floating',()=>{
  // He faces +x along the contour; the ground falls away to his right (-y).
  const cat=createCharacter(asset(),config),floor=(x,y)=>.4*y,s={x:0,y:0,z:0,heading:0,speed:0};
  for(let i=0;i<30;i++)place(cat,s,floor);
  const [l,r]=gaps(cat,floor);
  assert.ok(Math.min(l,r)>-.01,`no paw sinks: ${l.toFixed(3)}, ${r.toFixed(3)}`);
  assert.ok(Math.max(l,r)<.02,`both paws stand on their own ground: ${l.toFixed(3)}, ${r.toFixed(3)} m`);
  cat.dispose();
});

test('walking and running up and down a slope: every paw lands, none sinks, and he floats no more than on the flat',()=>{
  // The gaits have flight phases with both paws up, so compare the mean height
  // of the lower paw with the same gait on flat ground.
  const stride=(grade,input)=>{
    const cat=createCharacter(asset(),config),floor=x=>grade*x;let s={x:0,y:0,z:0,heading:0,speed:0};const all=[];
    for(let i=0;i<240;i++){s=stepWalk(s,input,1/60,config.walk,floor);place(cat,s,floor);if(i>=90)all.push(gaps(cat,floor));}
    cat.dispose();
    return {sink:Math.min(...all.flat()),landL:Math.min(...all.map(g=>g[0])),landR:Math.min(...all.map(g=>g[1])),support:all.reduce((a,g)=>a+Math.min(...g),0)/all.length};
  };
  for(const input of [{x:1,y:0},{x:1,y:0,run:true}]){
    const flat=stride(0,input);
    for(const grade of [.35,-.35]){
      const r=stride(grade,input),label=`${input.run?'run':'trot'} at grade ${grade}`;
      assert.ok(r.sink>-.015,`${label}: a paw sank ${r.sink.toFixed(3)} m`);
      assert.ok(r.landL<.005&&r.landR<.005,`${label}: each paw reaches the ground (${r.landL.toFixed(3)}, ${r.landR.toFixed(3)} m)`);
      assert.ok(r.support<flat.support+.01,`${label}: lower paw ${r.support.toFixed(3)} m up on average, ${flat.support.toFixed(3)} m on the flat`);
    }
  }
});

test('walking onto a raised tread steps up leg first, without the body popping',()=>{
  const cat=createCharacter(asset(),config),step=.15,floor=x=>x>1?step:0;
  let s={x:0,y:0,z:0,heading:0,speed:0},last=null,jolt=0,worst=0;
  for(let i=0;i<120;i++){
    s=stepWalk(s,{x:.45,y:0},1/60,config.walk,floor);place(cat,s,floor);
    const y=hips(cat);if(last!==null)jolt=Math.max(jolt,Math.abs(y-last));last=y;worst=Math.min(worst,...gaps(cat,floor));
  }
  assert.ok(s.x>1.5,'he got onto the tread');
  assert.ok(jolt<step*.4,`the body rose at most ${jolt.toFixed(3)} m in one frame, not the whole ${step} m`);
  assert.ok(worst>-.015,`no paw went into the tread: ${worst.toFixed(3)} m`);
  // And back down off it: no paw sinks, and the body comes down with him.
  for(let i=0;i<120;i++){s=stepWalk(s,{x:-.45,y:0},1/60,config.walk,floor);place(cat,s,floor);worst=Math.min(worst,...gaps(cat,floor));}
  assert.ok(s.x<.5&&worst>-.015,`stepping down, no paw sank: ${worst.toFixed(3)} m`);
  for(let i=0;i<40;i++){s=stepWalk(s,{x:0,y:0},1/60,config.walk,floor);place(cat,s,floor);}
  assert.ok(Math.max(...gaps(cat,floor))<.02,`and he stands on the lower ground again: ${gaps(cat,floor).map(g=>g.toFixed(3))}`);
  cat.dispose();
});

test('leaving a slope leaves no bend behind in the legs',()=>{
  const flat=()=>0,fresh=createCharacter(asset(),config),cat=createCharacter(asset(),config),s={x:0,y:0,z:0,heading:0,speed:0};
  // Same clip time for both; only the first half differs (slope versus flat).
  for(let i=0;i<20;i++){place(cat,s,(x,y)=>.4*y);place(fresh,s,flat);}
  for(let i=0;i<20;i++){place(cat,s,flat);place(fresh,s,flat);}
  const feet=c=>['thigh.L','shin.L','heel.L','thigh.R','shin.R','heel.R'].map(n=>c.model.getObjectByName(n).quaternion);
  feet(cat).forEach((q,i)=>assert.ok(q.angleTo(feet(fresh)[i])<2e-3,`bone ${i} kept ${q.angleTo(feet(fresh)[i])} rad of IK`));
  cat.dispose();fresh.dispose();
});

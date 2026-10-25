import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createCharacter} from '../src3d/character.js';
import {stepWalk} from '../../../shared/activities/walk.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url)));
const asset=()=>parseGLB(readFileSync(new URL('../../../shared/geometry/cat-ronin/ronin.glb',import.meta.url)));
test('authored jump poses move real hands/feet, read distinctly at apex, retain tail layering and terrain contact',()=>{
 const cat=createCharacter(asset(),config),nodes={};
 cat.model.traverse(n=>{if(n.isMesh&&/^(foot|paw)\./.test(n.parent?.name??''))nodes[n.parent.name]=n;});
 for(const name of ['foot.L','foot.R','paw.L','paw.R'])assert.ok(nodes[name],name);
 const flat=()=>0,apex=[];let s={x:0,y:0,z:0,heading:0,speed:0};
 for(let jump=0;jump<4;jump++){
  s=stepWalk(s,{x:0,y:0,jump:false},1/60,config.walk,flat);let highest=-1,sample;
  for(let frame=0;frame<120;frame++){
   s=stepWalk(s,{x:jump===3?1:0,y:0,jump:true},1/60,config.walk,flat);
   cat.object.position.set(s.x,s.z,-s.y);
   cat.update(1/60,s.jumpPhase==='grounded'?'idle':'jump',s.speed,{jump:s.jumpPhase==='grounded'?null:s,groundZ:0,groundHeight:flat});
   cat.object.updateMatrixWorld(true);
   for(const side of ['L','R']){
    const box=nodes['foot.'+side].geometry.boundingBox.clone().applyMatrix4(nodes['foot.'+side].matrixWorld);
    assert.ok(box.min.y>-.005,`foot ${side} penetrated flat terrain during ${s.jumpStyle}/${s.jumpPhase}: ${box.min.y}`);
   }
   if(s.z>highest){highest=s.z;sample={};for(const [name,n]of Object.entries(nodes))sample[name]=n.getWorldPosition(new T.Vector3()).sub(cat.object.position);}
  }
  apex.push(sample);assert.ok(cat.tailClip,'tail retains an independent action through the jump');
 }
 const hands=p=>(p['paw.L'].y+p['paw.R'].y)/2;
 assert.ok(hands(apex[0])>1.22,'yay raises both hands clearly above the 0.98 m shoulders');
 assert.ok(Math.abs(apex[0]['paw.L'].x)>.4&&Math.abs(apex[0]['paw.R'].x)>.4,'celebration hands clear the large head silhouette');
 const spread=p=>Math.abs(p['foot.L'].x-p['foot.R'].x);
 assert.ok(spread(apex[2])>spread(apex[1])+.15,'star spreads feet; heel click brings them together');
 assert.ok(spread(apex[1])>.13&&spread(apex[1])<.24,'heel click retains two distinct feet meeting near centre');
 assert.ok(Math.abs(apex[3]['foot.L'].z-apex[3]['foot.R'].z)>.12,'skip separates the leading and trailing foot');
 cat.dispose();
});

test('contact shadow stays at terrain while the puppet jumps, rather than floating under the root',()=>{
 const cat=createCharacter(asset(),config);let s={x:0,y:0,z:0,heading:0,speed:0};
 const flat=()=>0;
 for(let i=0;i<30;i++){
  s=stepWalk(s,{x:0,y:0,jump:true},1/60,config.walk,flat);cat.object.position.set(s.x,s.z,-s.y);
  cat.update(1/60,'jump',0,{jump:s,groundZ:0,groundHeight:flat});
 }
 const shadow=cat.object.children.find(n=>n.isMesh&&n.geometry.type==='PlaneGeometry');
 cat.object.updateMatrixWorld(true);assert.ok(s.z>.7);
 assert.ok(Math.abs(shadow.getWorldPosition(new T.Vector3()).y-.025)<1e-6);
 assert.ok(shadow.material.opacity<.6);cat.dispose();
});

test('optional jump presentation fields retain a supported body pose for older character contracts',()=>{
 const older={...config};delete older.jump_clips;
 const cat=createCharacter(asset(),older);
 cat.update(.1,'jump',0,{jump:{jumpStyle:'celebrate',jumpPhase:'takeoff',jumpCount:1,jumpProgress:.5}});
 assert.equal(cat.clip,config.clips.idle);cat.dispose();
});

test('planted paws hold still in the world at game speed, and the body leans into turns',()=>{
 for(const [pose,speed] of [['stroll',1.2],['walk',config.walk.walk_mps],['walk',config.walk.walk_mps/2],['run',config.walk.run_mps]]){
  const cat=createCharacter(asset(),config),feet={},box=new T.Box3(),last={};let planted=0,drift=0;
  cat.model.traverse(n=>{if(n.isMesh&&/^foot\./.test(n.parent?.name??''))feet[n.parent.name]=n;});
  for(let i=0;i<240;i++){
   cat.object.position.z+=speed/120;cat.update(1/120,pose,speed,{groundZ:0,groundHeight:()=>0});cat.object.updateMatrixWorld(true);
   if(i<60)continue;
   for(const k in feet){box.setFromObject(feet[k]);const z=(box.min.z+box.max.z)/2,down=box.min.y<.012;
    if(down&&last[k]?.down){drift+=Math.abs(z-last[k].z);planted+=speed/120;}last[k]={z,down};}
  }
  // The pre-gait clips slid ~96-100% of the distance covered while a paw was down.
  assert.ok(planted>1&&drift/planted<.25,`${pose} at ${speed} m/s: planted paws drift ${(drift/planted*100).toFixed(0)}%`);
  cat.dispose();
 }
 const cat=createCharacter(asset(),config);let head;cat.model.traverse(n=>{if(n.isBone&&n.name==='head')head=n;});
 for(let i=0;i<60;i++)cat.update(1/60,'run',config.walk.run_mps,{turnRate:1.2,groundZ:0});
 cat.object.updateMatrixWorld(true);
 assert.ok(head.getWorldPosition(new T.Vector3()).x>.1,'a left turn (positive rate) leans the head to his left, into the turn');
 cat.dispose();
});

test('big drops land heavy for longer, sharp turns pivot, long idles look around then sit, starts pitch forward',()=>{
 // A 4 m fall: the shared rules record touchdown speed and stretch the landing.
 let s={x:0,y:0,z:4,heading:0,speed:0,grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpCount:1,vz:0};
 while(s.jumpPhase!=='landing')s=stepWalk(s,{x:0,y:0},1/120,config.walk,()=>0);
 assert.ok(s.landingSpeed>config.landing.heavy_mps,`touchdown at ${s.landingSpeed.toFixed(1)} m/s`);
 let recovery=0;while(s.jumpPhase==='landing'){s=stepWalk(s,{x:0,y:0},1/120,config.walk,()=>0);recovery+=1/120;}
 assert.ok(recovery>config.walk.jump.landing_s*2,'a big drop recovers for longer than a hop');
 const cat=createCharacter(asset(),config);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'landing',jumpProgress:.3,landingSpeed:9,jumpStyle:'hop',jumpCount:1},groundZ:0});
 assert.equal(cat.clip,config.landing.heavy);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'landing',jumpProgress:.3,landingSpeed:4,jumpStyle:'hop',jumpCount:2},groundZ:0});
 assert.equal(cat.clip,config.jump_clips.hop,'an ordinary hop keeps its own landing');
 cat.update(.3,'idle',0);cat.update(1/60,'stroll',.4,{facing:2.5});assert.equal(cat.clip,config.pivot.left);
 cat.update(.5,'idle',0);cat.update(1/60,'stroll',.4,{facing:-2.5});assert.equal(cat.clip,config.pivot.right);
 cat.update(.5,'idle',0);cat.update(1/60,'stroll',.4,{facing:.3});assert.equal(cat.clip,'stroll','a gentle turn just walks');
 const seen=new Set();for(let t=0;t<60;t+=.25){cat.update(.25,'idle',0);seen.add(cat.clip);}
 for(const step of config.idle_sequence)assert.ok(seen.has(step.clip),`idle reaches ${step.clip}`);
 assert.equal(cat.clip,config.idle_sequence.at(-1).clip,'he stays dozing until he moves');
 cat.update(.2,'walk',3.5);assert.equal(cat.clip,'walk');
 for(let i=0;i<20;i++)cat.update(1/60,'walk',2,{accel:16});
 assert.ok(cat.model.rotation.x>.1,'speeding up pitches him forward');
 cat.dispose();
});

test('climbing clips keep the front paws on the bark across trunk sizes, and the fall clips play',()=>{
 assert.ok(config.climb_clips&&config.fall_clips,'the contract names climbing and falling clips');
 for(const r of [.3,.75,1.5,2.6]){
  const trunk={x:0,y:0,base_z:0,top_z:20,profile:[[0,r],[20,r]]},hold=r+config.walk.climb.hold_m;
  for(const [phase,vz] of [['grip',0],['climb',config.walk.climb.up_mps]]){
   const cat=createCharacter(asset(),config),paws={};
   cat.model.traverse(n=>{if(n.isMesh&&/^paw\./.test(n.parent?.name??''))paws[n.parent.name]=n;});
   // He sits south of the trunk facing north (+y), as the shared rules place him: heading = angle + π.
   cat.object.position.set(0,5,hold);cat.object.rotation.set(0,Math.PI,0);
   const climb={mode:'climb',trunk,angle:-Math.PI/2,climbPhase:phase,vz,around:0,z:5};
   let worst=0;
   for(let i=0;i<90;i++){
    cat.update(1/60,'climb',Math.abs(vz),{climb,groundZ:0,groundHeight:()=>0});cat.object.updateMatrixWorld(true);
    if(i<30)continue;
    for(const contact of cat.contacts??[]){
     if(contact.target!=='bark')continue;
     const p=paws[contact.bone].getWorldPosition(new T.Vector3());
     worst=Math.max(worst,Math.abs(Math.hypot(p.x,p.z)-r-.05));
    }
   }
   assert.ok(cat.contacts!==undefined,'the character reports which paws are planted');
   assert.ok(worst<.05,`r ${r} ${phase}: planted paws ${worst.toFixed(3)} m off the bark`);
   cat.dispose();
  }
 }
 const cat=createCharacter(asset(),config);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'bounce',jumpProgress:.4,jumpStyle:'hop',jumpCount:1}});assert.equal(cat.clip,config.fall_clips.bounce);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'tumble',jumpProgress:.4,jumpStyle:'hop',jumpCount:1}});assert.equal(cat.clip,config.fall_clips.tumble);
 cat.dispose();
});

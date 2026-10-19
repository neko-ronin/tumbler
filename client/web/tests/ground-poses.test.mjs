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

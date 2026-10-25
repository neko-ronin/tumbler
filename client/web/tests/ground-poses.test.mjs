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
 assert.ok(Math.abs(apex[3]['foot.L'].z-apex[3]['foot.R'].z)>.12,'the running leap separates the leading and trailing foot');
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
 // An 8 m fall: the shared rules record touchdown speed and stretch the landing.
 let s={x:0,y:0,z:8,heading:0,speed:0,grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpCount:1,vz:0};
 while(s.jumpPhase!=='landing')s=stepWalk(s,{x:0,y:0},1/120,config.walk,()=>0);
 assert.ok(s.landingSpeed>config.landing.heavy_mps,`touchdown at ${s.landingSpeed.toFixed(1)} m/s`);
 let recovery=0;while(s.jumpPhase==='landing'){s=stepWalk(s,{x:0,y:0},1/120,config.walk,()=>0);recovery+=1/120;}
 assert.ok(recovery>config.walk.jump.landing_s*2,'a big drop recovers for longer than a hop');
 const cat=createCharacter(asset(),config);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'landing',jumpProgress:.3,landingSpeed:config.landing.heavy_mps+3,jumpStyle:'hop',jumpCount:1},groundZ:0});
 assert.equal(cat.clip,config.landing.heavy);
 cat.update(1/60,'jump',0,{jump:{jumpPhase:'landing',jumpProgress:.3,landingSpeed:config.walk.jump.takeoff_mps,jumpStyle:'hop',jumpCount:2},groundZ:0});
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
test('the triple jump somersaults forward about his middle, from just before the apex into the drop',()=>{
 const cat=createCharacter(asset(),config),jump=(jumpTier,jumpProgress)=>({jumpPhase:'airborne',jumpStyle:'flip',jumpCount:3,jumpTier,jumpProgress});
 const middle=()=>{cat.object.updateMatrixWorld(true);return new T.Vector3(0,.85,0).applyMatrix4(cat.model.matrix);};
 cat.update(1/60,'jump',0,{jump:jump(2,.635)});const upright=middle();
 cat.update(1/60,'jump',0,{jump:jump(3,.3)});assert.ok(Math.abs(cat.model.rotation.x)<.05,'still upright on the way up');
 cat.update(1/60,'jump',0,{jump:jump(3,.5)});
 assert.ok(cat.model.rotation.x>.05&&cat.model.rotation.x<Math.PI/2,`turning, not yet inverted, at the apex: ${cat.model.rotation.x.toFixed(2)} rad`);
 cat.update(1/60,'jump',0,{jump:jump(3,.635)});
 assert.ok(Math.abs(cat.model.rotation.x-Math.PI)<.05,`upside down early in the drop: ${cat.model.rotation.x.toFixed(2)} rad`);
 assert.ok(middle().distanceTo(upright)<.02,'the somersault turns about his middle, not his soles');
 cat.update(1/60,'jump',0,{jump:jump(3,.85)});assert.ok(Math.abs(cat.model.rotation.x-2*Math.PI)<.05,'upright again before touchdown');
 cat.update(1/60,'jump',0,{jump:jump(2,.635)});assert.ok(Math.abs(cat.model.rotation.x)<.05,'a double jump does not flip');
 cat.dispose();
});
test('he stretches at launch, rounds out at the peak, squats on touchdown and keeps his volume',()=>{
 const cat=createCharacter(asset(),config),k=config.scale,shape=jump=>{cat.update(1/60,jump?'jump':'idle',0,{jump});const s=cat.model.scale;return {y:s.y/k,volume:s.x*s.y*s.z/k**3};};
 const air=vz=>({jumpPhase:'airborne',jumpStyle:'hop',jumpCount:1,jumpTier:1,jumpVz:13.4,vz,jumpProgress:.5-vz/26.8});
 const launch=shape(air(13.4)),peak=shape(air(0)),land=shape({jumpPhase:'landing',jumpStyle:'hop',jumpCount:1,jumpProgress:0}),stand=shape(null);
 assert.ok(launch.y>1.05&&Math.abs(peak.y-1)<1e-9&&land.y<.9&&stand.y===1,`launch ${launch.y.toFixed(2)}, peak ${peak.y.toFixed(2)}, touchdown ${land.y.toFixed(2)}`);
 for(const s of [launch,peak,land,stand])assert.ok(Math.abs(s.volume-1)<1e-9,'squash and stretch keep his volume');
 cat.dispose();
});
test('his ear glow, fur rim and whisker glints all apply the scene sun shadow, so none shows in shade',()=>{
 const cat=createCharacter(asset(),config),seen=new Set();
 cat.model.traverse(node=>{
  if(!node.isMesh||!node.material.onBeforeCompile)return;
  const m=node.material,shader={uniforms:{},vertexShader:m.isShaderMaterial?m.vertexShader:T.ShaderLib.standard.vertexShader,fragmentShader:m.isShaderMaterial?m.fragmentShader:T.ShaderLib.standard.fragmentShader};
  m.onBeforeCompile(shader);const f=shader.fragmentShader;
  if(m.isShaderMaterial){if(/glint/.test(f)){seen.add('halo');assert.match(f,/\*sun,1\.\)/);assert.match(f,/scenerySunLight\(vWorld/);}return;}
  assert.doesNotMatch(f,/\+=[^;]*\bsunlight\b/,`${m.name}: added light skips the scenery shadow`);
  // GLSL directives must start a line: injected code that eats the newline before
  // the next #include compiles in Node's eyes and fails on the GPU.
  assert.doesNotMatch(f,/;[ \t]*#/,`${m.name}: a directive follows code on one line`);
  const declared=f.indexOf('float directSun=');
  for(const [term,label] of [[/backlit\*directSun\*([0-9.]+)/,'ear'],[/furRim\*\.06\*directSun/,'rim'],[/glint\*3\.5\*directSun/,'whisker']]){
   const hit=term.exec(f);if(!hit)continue;seen.add(label);assert.ok(declared>=0&&hit.index>declared,`${m.name}: ${label} used before directSun`);
   if(label==='ear')assert.ok(Number(hit[1])<=.35,`ear glow ${hit[1]} is not reduced`);
  }
 });
 assert.deepEqual([...seen].sort(),['ear','halo','rim','whisker']);
 cat.dispose();
});

test('each new jump grunts once at push-off, by its tier in the chain',()=>{
 const cat=createCharacter(asset(),config),heard=[];cat.onCue=name=>heard.push(name);
 for(const [jumpCount,jumpTier,jumpStyle] of [[1,1,'leap'],[2,2,'tuck'],[3,3,'flip']])
  for(const jumpPhase of ['takeoff','airborne','landing'])cat.update(1/60,'jump',5,{jump:{jumpPhase,jumpProgress:.5,jumpStyle,jumpCount,jumpTier}});
 assert.deepEqual(heard.filter(n=>n.startsWith('grunt')),['grunt1','grunt2','grunt3']);
 cat.dispose();
});
test('moving jumps play their own athletic clips',()=>{
 const cat=createCharacter(asset(),config);
 for(const style of ['leap','tuck','flip','push']){cat.update(1/60,'jump',5,{jump:{jumpPhase:'airborne',jumpProgress:.5,jumpStyle:style,jumpCount:1,jumpTier:1}});assert.equal(cat.clip,config.jump_clips[style]);}
 cat.dispose();
});
test('landing on the move runs straight out in his gait; from a standstill he lands in the jump clip',()=>{
 const cat=createCharacter(asset(),config),landing={jumpPhase:'landing',jumpProgress:.3,landingSpeed:config.walk.jump.takeoff_mps,jumpStyle:'leap',jumpCount:1,jumpTier:1};
 cat.update(1/60,'jump',config.walk.run_mps,{jump:landing,groundZ:0});assert.equal(cat.clip,config.clips.run);
 cat.update(1/60,'jump',config.walk.walk_mps,{jump:landing,groundZ:0});assert.equal(cat.clip,config.clips.walk);
 cat.update(1/60,'jump',0,{jump:{...landing,jumpStyle:'celebrate'},groundZ:0});assert.equal(cat.clip,config.jump_clips.celebrate);
 cat.dispose();
});
test('a heavy landing at speed rolls forward once, low and clear of the ground; standing still it crouches',()=>{
 const cat=createCharacter(asset(),config),heavy=p=>({jumpPhase:'landing',jumpProgress:p,landingSpeed:config.landing.heavy_mps+2,jumpStyle:'leap',jumpCount:1,jumpTier:1});
 const flat=()=>0,fast=config.landing.roll_min_mps+3,turns=[];
 for(let i=0;i<=40;i++){
  const p=i/40;cat.update(1/60,'jump',fast,{jump:heavy(p),groundZ:0,groundHeight:flat});assert.equal(cat.clip,config.landing.roll);
  turns.push(cat.model.rotation.x);cat.object.updateMatrixWorld(true);
  // The tail tip may sweep the ground as he turns over; the body may not.
  const box=new T.Box3();cat.model.traverse(n=>{if(n.isMesh&&!/^cat_tail/.test(n.name))box.union(new T.Box3().setFromObject(n));});
  assert.ok(box.min.y>-.06,`at ${p} he dips ${box.min.y.toFixed(3)} m into the ground`);
  assert.ok(box.max.y<1.9,`at ${p} the roll stays low: top at ${box.max.y.toFixed(2)} m`);
 }
 assert.ok(Math.abs(turns[0])<.25&&Math.abs(turns.at(-1)-2*Math.PI)<.25,`one forward turn: ${turns[0].toFixed(2)} to ${turns.at(-1).toFixed(2)} rad`);
 assert.ok(turns.every((x,i)=>i===0||x>=turns[i-1]-1e-9),'always turning forward');
 cat.update(1/60,'jump',0,{jump:heavy(.3),groundZ:0});assert.equal(cat.clip,config.landing.heavy);
 cat.dispose();
});

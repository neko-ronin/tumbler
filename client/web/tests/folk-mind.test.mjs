import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{createFolkWorld,createFolk,stepFolk,observe,command,setController,setDecider,suggest,addThing,setThing,playerSay,FEATURES}from'../../../shared/npc/folk.js';
import{perceive,features,moodOf,describe}from'../../../shared/npc/mind.js';
const read=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const config=read('shared/npc/folk.json'),models=read('shared/geometry/cat-folk/models.json'),flight=read('shared/activities/flight.json');
const walk=read('shared/characters/player.json').walk,worldmap=read('shared/world/worldmap.json'),placement=read('shared/world/out/placement.json');
const height=(x,y)=>Math.abs(x)>2500||Math.abs(y)>2500?NaN:30+Math.max(0,y-700)*1.35;
function world(events=[],extra={}){const w=createFolkWorld({config,worldmap,placement,flight,walk,height,onEvent:e=>events.push(e),...extra});createFolk(w,models,{seed:7});return w;}
const run=(w,seconds,each)=>{for(let t=0;t<seconds;t+=.1){stepFolk(w,.1);each?.();}};
const cat=(w,id)=>w.cats.find(c=>c.id===id);
/** Stand a cat somewhere facing east, alone with its thoughts. */
function place(w,c,x,y,heading=0){c.body.state={...c.body.state,x,y,z:height(x,y),heading,speed:0};c.body.facing=heading;}
function clearOthers(w,keep){w.cats.forEach((c,i)=>{if(c!==keep){setController(w,c,'agent');c.plan=[];c.step=null;place(w,c,-2000+i*50,-2000);}});}
const bench=(extra={})=>({id:'bench',kind:'bench',name:'the bench',xy_m:[0,0],state:{warm:false},affords:{sit:{clip:'sit',seconds:[1,1],effects:{energy:.9,fun:.9,social:.9,purpose:.9},sets:{warm:true}}},...extra});

test('sight has a range, a field of view and a line of sight',()=>{
  const w=world(),c=cat(w,'tobu');clearOthers(w,c);place(w,c,0,0);
  w.player={x:20,y:0,z:30,speed:0};
  assert.equal(perceive(w,c).find(e=>e.kind==='player')?.distance_m,20,'ahead and in range');
  w.player={x:80,y:0,z:30,speed:0};assert.ok(!perceive(w,c).some(e=>e.kind==='player'),'beyond sight_m');
  w.player={x:-20,y:0,z:30,speed:0};assert.ok(!perceive(w,c).some(e=>e.kind==='player'),'behind it');
  w.player={x:-2,y:0,z:30,speed:0};assert.ok(perceive(w,c).some(e=>e.kind==='player'),'right behind it, it senses');
  w.hitTest=()=>true;w.player={x:20,y:0,z:30,speed:0};
  assert.ok(!perceive(w,c).some(e=>e.kind==='player'),'behind a wall');
  assert.ok(perceive(w,c,false).some(e=>e.kind==='player'),'a far cat skips the ray');
});

test('the brain chooses a thing only once the cat has seen it, walks over, uses it and changes its state',()=>{
  const events=[],w=world(events),c=cat(w,'tobu');clearOthers(w,c);addThing(w,bench());
  place(w,c,800,800);
  for(const k of Object.keys(c.needs))c.needs[k]=.05;
  assert.ok(!suggest(w,c).some(o=>o.activity==='use:bench:sit'),'never seen');
  let changed=null;w.onThingChanged=(t,by)=>{changed={state:{...t.state},by};};
  // Hold it still within sight of the bench until it has noticed; then its own brain takes over.
  place(w,c,10,0,Math.PI);command(w,c,{verb:'wait',seconds:.6});run(w,.5);
  assert.ok(c.mind.known.bench,'noticed in passing');
  assert.equal(suggest(w,c)[0].activity,'use:bench:sit','the bench answers every need, and it is new');
  run(w,40);
  assert.ok(events.some(e=>e.event==='decision'&&e.chosen==='use:bench:sit'&&e.source==='brain'),'its own choice');
  assert.ok(events.some(e=>e.cat==='tobu'&&e.event==='used'&&e.thing==='bench'),'used it');
  assert.deepEqual(changed,{state:{warm:true},by:'tobu'});
  assert.ok(c.used['use:bench:sit']>=1,'and knows it has tried it');
});

test('requires, capacity and skill gate a thing',()=>{
  const w=world(),a=cat(w,'tobu'),b=cat(w,'mabel');clearOthers(w,a);
  addThing(w,bench({landmark:true,affords:{sit:{clip:'sit',seconds:[50,50],effects:{},requires:{warm:false}},fish:{clip:'fish',seconds:[1,1],effects:{},skill:'fish'}}}));
  const can=(c,id)=>suggest(w,c).some(o=>o.activity===id);
  assert.ok(can(b,'use:bench:sit'),'a landmark needs no sighting');
  assert.ok(can(a,'use:bench:fish')&&!can(b,'use:bench:fish'),'skill');
  command(w,b,{verb:'use',thing:'bench',action:'sit'});
  assert.ok(!can(a,'use:bench:sit'),'taken: capacity 1 counts the cat on its way');
  command(w,b,{verb:'stop'});
  assert.ok(can(a,'use:bench:sit'));
  setThing(w,'bench',{warm:true});assert.ok(!can(a,'use:bench:sit'),'requires');
  assert.throws(()=>addThing(w,bench()),/taken/);
  assert.throws(()=>addThing(w,{id:'x',kind:'x',xy_m:['a']}),/needs/);
});

test('features are a fixed, named, bounded vector',()=>{
  const w=world();run(w,2);
  for(const c of w.cats){
    const v=features(w,c);assert.equal(v.length,FEATURES.length);
    v.forEach((x,i)=>assert.ok(Number.isFinite(x)&&x>=-1&&x<=1,`${FEATURES[i]}=${x}`));
  }
});

test('a decider chooses, and any failure falls back to the brain',async()=>{
  const fresh=decider=>{const events=[],w=world(events),c=cat(w,'tobu');clearOthers(w,c);setDecider(w,c,decider);return {events,w,c};};
  const seen=e=>e.event;
  let view=null,t=fresh(v=>{view=v;return 'fish';});stepFolk(t.w,.1);
  assert.equal(t.c.activity,'fish');assert.equal(view.features.length,view.feature_names.length);assert.ok(view.options.length&&view.observation.situation);
  const d=t.events.find(e=>e.event==='decision');assert.equal(d.source,'decider');assert.equal(d.features.length,FEATURES.length);
  t=fresh(()=>'hack the planet');stepFolk(t.w,.1);
  assert.ok(t.events.map(seen).includes('decider_refused')&&t.c.activity,'unknown choice');
  t=fresh(()=>'fly');stepFolk(t.w,.1);
  assert.ok(t.events.map(seen).includes('decider_refused')&&t.c.activity!=='fly','tobu has no licence: it must be on offer');
  t=fresh(()=>{throw new Error('model down');});stepFolk(t.w,.1);
  assert.ok(t.events.some(e=>e.event==='decider_failed'&&e.error==='model down')&&t.c.activity);
  t=fresh(()=>Promise.reject(new Error('503')));stepFolk(t.w,.1);await new Promise(setImmediate);
  assert.ok(t.events.some(e=>e.event==='decider_failed'&&e.error==='503')&&t.c.activity);
  t=fresh(()=>Promise.resolve('fish'));stepFolk(t.w,.1);
  assert.equal(t.c.activity,null,'thinking');await new Promise(setImmediate);assert.equal(t.c.activity,'fish');
  let answer;t=fresh(()=>new Promise(r=>{answer=r;}));run(t.w,config.mind.decider_timeout_s+1);
  assert.ok(t.events.some(e=>e.event==='decider_failed'&&e.error==='timed out'));
  const after=t.c.activity;assert.ok(after);setDecider(t.w,t.c,null);answer('nap');await new Promise(setImmediate);
  assert.equal(t.c.activity,after,'a late answer is dropped');
});

test('temperament shows: the warm wave, the shy back off, and the plan carries on',()=>{
  const greet=id=>{const events=[],w=world(events),c=cat(w,id);clearOthers(w,c);place(w,c,0,0);
    command(w,c,{verb:'wait',seconds:60});c.mind.random=()=>.01;w.player={x:5,y:0,z:30,speed:0};run(w,.6);return {events,w,c};};
  let t=greet('mabel');
  assert.ok(t.events.some(e=>e.event==='reflex'&&e.kind==='greet'&&e.to==='player'));
  assert.equal(t.c.step.clip,'wave');assert.equal(t.c.body.face,'player');
  assert.ok(Math.abs(t.c.body.facing)<.01,'it turns to the player');
  assert.ok(t.events.some(e=>e.event==='said'),'and says something of its own');
  run(t.w,3);assert.equal(t.c.step?.clip,'idle','back to what it was doing');
  assert.ok(t.c.mind.known.player.meetings>=1,'and remembers');
  t=greet('ash');t.w.player={x:1,y:0,z:30,speed:0};run(t.w,config.mind.reflex_gap_s+.5);
  assert.ok(t.events.some(e=>e.event==='reflex'&&e.kind==='back_off'),'shy ash backs off when crowded');
  const bold=greet('saffi');bold.w.player={x:1,y:0,z:30,speed:0};run(bold.w,config.mind.reflex_gap_s+.5);
  assert.ok(!bold.events.some(e=>e.event==='reflex'&&e.kind==='back_off'),'bold saffi stands firm');
  const events=[],w=world(events),c=cat(w,'mabel');clearOthers(w,c);setController(w,c,'agent');place(w,c,0,0);
  command(w,c,{verb:'wait',seconds:60});c.mind.random=()=>.01;w.player={x:5,y:0,z:30,speed:0};run(w,1);
  assert.ok(!events.some(e=>e.event==='reflex'),"an agent's cat is not interrupted");
  assert.ok(events.some(e=>e.event==='noticed'&&e.id==='player'),'but it still notices');
});

test('chats have lines, friendships grow, and a nap ends in a stretch',()=>{
  const events=[],w=world(events);run(w,900);
  const lines=events.filter(e=>e.event==='said').map(e=>e.text);
  assert.ok(lines.length>10,`${lines.length} lines`);assert.ok(new Set(lines).size>8,'varied');
  assert.ok(lines.every(l=>!l.includes('{name}')),'names filled in');
  assert.ok(w.cats.some(c=>Object.values(c.mind.known).some(k=>k.kind==='cat'&&k.affinity>=config.mind.bond.chat)),'bonds');
  const naps=events.filter(e=>e.event==='done'&&e.activity==='nap');
  assert.ok(naps.length,'somebody napped');
  for(const nap of naps){const next=events.slice(events.indexOf(nap)+1).find(e=>e.cat===nap.cat&&e.event==='done');if(next)assert.equal(next.activity,'stretch');}
});

test('an agent reads a plain-JSON mind and gets refusals as data',()=>{
  const w=world(),c=cat(w,'tobu');clearOthers(w,c);addThing(w,bench({landmark:true}));place(w,c,5,0,Math.PI);
  w.player={x:0,y:3,z:30,speed:0};run(w,1);
  const o=observe(w,c);assert.deepEqual(JSON.parse(JSON.stringify(o)),o);
  assert.ok(o.senses.some(e=>e.id==='bench')&&o.things[0].actions.includes('sit')&&o.eye.position.length===3);
  assert.ok(o.mood.label&&o.temperament.warmth>0&&o.situation.includes('Tobu'));
  assert.ok(!o.events.some(e=>'features' in e),'the vector stays out of the short history');
  assert.ok(describe(w,c).includes('the bench'));
  for(const bad of [{verb:'use'},{verb:'use',thing:'bench'},{verb:'use',thing:{},action:{}},{verb:'use',thing:'bench',action:'__proto__'},{verb:'look_at',at:'nobody'},{verb:'look_at',at:'__proto__'},{verb:'go_to',place:'__proto__'},{verb:'go_to',place:'constructor'},{verb:'do',activity:'__proto__'},{verb:'do',activity:'constructor'}])
    assert.equal(command(w,c,bad).ok,false,JSON.stringify(bad));
  assert.deepEqual(command(w,c,{verb:'look_at',at:'bench',seconds:9}),{ok:true});
  stepFolk(w,.1);assert.equal(c.body.look.x,0);assert.equal(observe(w,c).looking_at,'bench');
  assert.deepEqual(command(w,c,{verb:'look_at'}),{ok:true});
  command(w,c,{verb:'stop'});assert.equal(observe(w,c).doing,null,'stopping is not an activity');
  const {valence,arousal}=moodOf(c);assert.ok(Math.abs(valence)<=1&&arousal>=0&&arousal<=1);
});

test('the player can speak: cats in earshot hear, look, and the warm ones answer',()=>{
  const events=[],w=world(events),c=cat(w,'mabel');clearOthers(w,c);place(w,c,0,0);command(w,c,{verb:'wait',seconds:60});
  assert.equal(playerSay(w,'hello'),0,'no player on foot');
  w.player={x:10,y:0,z:30,speed:0};
  assert.equal(playerSay(w,'  hello  '),1);
  assert.ok(events.some(e=>e.event==='heard'&&e.from==='player'&&e.text==='hello'));
  assert.equal(c.mind.attend.id,'player');assert.ok(c.said,'answers');
});

test('thinking costs little',()=>{
  const w=world();w.player={x:0,y:0,z:30,speed:0};run(w,5);
  const start=performance.now();for(let i=0;i<600;i++)stepFolk(w,1/60);
  const ms=(performance.now()-start)/600;assert.ok(ms<2,`${ms.toFixed(2)} ms a frame for eight cats`);
});

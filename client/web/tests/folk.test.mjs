import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{createFolkWorld,createFolk,stepFolk,observe,command,setController,suggest,VERBS}from'../../../shared/npc/folk.js';
const read=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const config=read('shared/npc/folk.json'),models=read('shared/geometry/cat-folk/models.json'),flight=read('shared/activities/flight.json');
const walk=read('shared/characters/player.json').walk,worldmap=read('shared/world/worldmap.json'),placement=read('shared/world/out/placement.json');
// A synthetic valley: flat meadow at 30 m, rising to the northern ridge the launches stand on.
const height=(x,y)=>Math.abs(x)>2500||Math.abs(y)>2500?NaN:30+Math.max(0,y-700)*1.35;
function world(events=[]){const w=createFolkWorld({config,worldmap,placement,flight,walk,height,onEvent:e=>events.push(e)});createFolk(w,models,{seed:7});return w;}
const run=(w,seconds,focus=null)=>{for(let t=0;t<seconds;t+=.1)stepFolk(w,.1,focus);};

// models.json is the build's published record of each recipe; recipes.json stays with the authoring tools.
test('every cat has a model and no cat wears a tabby coat',()=>{
  const cats=models.models;
  assert.equal(new Set(cats.map(m=>m.coat)).size,cats.length,'each cat has its own coat pattern');
  assert.ok(cats.every(m=>m.coat&&!/tabby|mackerel/.test(m.coat)));
  assert.deepEqual(new Set(cats.map(m=>m.age)),new Set(['kitten','youth','adult','elder']));
  assert.deepEqual(cats.map(m=>m.id),config.folk.map(f=>f.id));
});

test('the brain keeps every cat busy with activities that satisfy its needs',()=>{
  const events=[],w=world(events);run(w,600);
  for(const cat of w.cats)assert.ok(events.some(e=>e.cat===cat.id&&e.event==='plan'),`${cat.id} planned`);
  const done=events.filter(e=>e.event==='done').map(e=>e.activity);
  assert.ok(new Set(done).size>=4,`varied activities: ${[...new Set(done)]}`);
  assert.ok(events.some(e=>e.event==='chatting'),'cats visit one another');
  for(const cat of w.cats)assert.ok(Number.isFinite(cat.body.state.x+cat.body.state.y+cat.body.state.z));
});

test('an agent can take a cat over, command it and get refusals as data',()=>{
  const events=[],w=world(events),tobu=w.cats.find(c=>c.id==='tobu');
  setController(w,tobu,'agent');
  assert.deepEqual(command(w,tobu,{verb:'dance'}).ok,false);
  assert.equal(command(w,tobu,{verb:'fly'}).ok,false,'tobu is not a pilot');
  assert.equal(command(w,tobu,{verb:'say',text:'Fish are biting.'}).ok,true);
  assert.equal(command(w,tobu,{verb:'go_to',place:'river',pace:'run'}).ok,true);
  run(w,900);
  assert.ok(events.some(e=>e.cat==='tobu'&&e.event==='arrived'),'reached the river');
  assert.ok(events.some(e=>e.cat==='tobu'&&e.event==='awaiting_command'),'waits for the agent, not the brain');
  const view=observe(w,tobu);
  assert.equal(view.controller,'agent');assert.ok(view.places.river.distance_m<5);
  assert.ok(JSON.parse(JSON.stringify(view)).events.length>0,'observation is plain JSON');
  assert.ok(Object.keys(VERBS).every(v=>view.can.verbs.includes(v)));
  assert.ok(suggest(w,tobu).some(s=>s.activity==='fish'));
});

for(const id of ['saffi','kiri','juno'])test(`${id} flies the shared flight rules and lands`,()=>{
  const events=[],w=world(events),cat=w.cats.find(c=>c.id===id);
  setController(w,cat,'agent');
  const [x,y]=cat.places.launch;cat.body.state={...cat.body.state,x,y,z:height(x,y)};
  assert.equal(command(w,cat,{verb:'fly'}).ok,true);
  run(w,1200);
  const launched=events.find(e=>e.cat===id&&e.event==='launched'),landed=events.find(e=>e.cat===id&&e.event==='landed');
  assert.ok(launched,'launched');assert.ok(landed,`landed (${JSON.stringify(events.filter(e=>e.cat===id).slice(-4))})`);
  assert.equal(landed.impact,null,`no collision: ${JSON.stringify(landed)}`);
  assert.ok(landed.air_s>20,`a real flight: ${landed.air_s}s`);
  assert.equal(cat.body.mode,'walk');
});

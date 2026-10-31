import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{createFolkWorld,createFolk,stepFolk,observe,command,setController,suggest,pilotInput,VERBS}from'../../../shared/npc/folk.js';
import{launchFlight,stepFlight}from'../../../shared/activities/flight.js';
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
  assert.notEqual(landed.quality,'hard',`a soft landing: ${JSON.stringify(landed)}`);
  assert.ok(landed.air_s>20,`a real flight: ${landed.air_s}s`);
  assert.equal(cat.body.mode,'walk');
});

test('gaits play near their natural pace, so paws do not slide',()=>{
  const w=world(),byId=Object.fromEntries(models.models.map(m=>[m.id,m]));let worst=1;
  for(let t=0;t<600;t+=.1){stepFolk(w,.1);for(const c of w.cats){const g=byId[c.id].ground_speed_mps[c.body.clip];
    if(g&&c.body.mode==='walk'&&c.body.clipSpeed>.15)worst=Math.max(worst,c.body.clipSpeed/g,g/c.body.clipSpeed);}}
  assert.ok(worst<=2.2,`playback ratio ${worst.toFixed(2)} exceeds the client's 2.2× cap`);
});

test('cats meeting head-on step around each other',()=>{
  const w=world(),[a,b]=w.cats.filter(c=>['saffi','tobu'].includes(c.id));
  for(const c of [a,b])setController(w,c,'agent');
  a.body.state={...a.body.state,x:0,y:0,z:height(0,0)};b.body.state={...b.body.state,x:40,y:0,z:height(40,0)};
  command(w,a,{verb:'go_to',x:40,y:0});command(w,b,{verb:'go_to',x:0,y:0});
  let closest=Infinity;
  for(let t=0;t<60;t+=.1){stepFolk(w,.1);closest=Math.min(closest,Math.hypot(a.body.state.x-b.body.state.x,a.body.state.y-b.body.state.y));}
  assert.ok(closest>.6,`passed within ${closest.toFixed(2)} m`);
  assert.ok(a.body.state.x>37&&b.body.state.x<3,'both still got where they were going');
});

test('a far cat that walked into a trunk steps out when the camera comes near',()=>{
  // One trunk, 3 m round (wider than arrive_m), at the green: a capsule-vs-cylinder hit test is enough here.
  const trunk=[0,0],hitTest=(p,q,r)=>{for(let f=0;f<=1;f+=.1)if(Math.hypot(p[0]+(q[0]-p[0])*f-trunk[0],p[1]+(q[1]-p[1])*f-trunk[1])<3+r)return true;return false;};
  const events=[],w=createFolkWorld({config,worldmap,placement,flight,walk,height,hitTest,onEvent:e=>events.push(e)});createFolk(w,models,{seed:7});
  const cat=w.cats.find(c=>c.id==='tobu');setController(w,cat,'agent');
  cat.body.state={...cat.body.state,x:30,y:0,z:height(30,0)};command(w,cat,{verb:'go_to',x:0,y:0});
  run(w,40,[2000,2000]);
  assert.ok(Math.hypot(cat.body.state.x,cat.body.state.y)<3,'the kinematic walk ended inside the trunk');
  run(w,.2,[5,5]);
  assert.ok(events.some(e=>e.cat==='tobu'&&e.event==='settled'));
  assert.ok(Math.hypot(cat.body.state.x,cat.body.state.y)>3.2,'stood clear of the trunk');
});

test('the round-out lands the fast parakite softly from any approach',()=>{
  // A height-only flare ballooned the 19.5 m/s kite and dropped it in at 5-8 m/s from most bearings.
  const w=world(),juno=w.cats.find(c=>c.id==='juno'),[fx,fy]=juno.places.landing,sinks=[];
  for(let k=0;k<8;k++){
    const b=k/8*Math.PI*2;
    let s=launchFlight(flight,'parakite',{xy_m:[fx+Math.cos(b)*300,fy+Math.sin(b)*300],heading_deg:(b+Math.PI)*180/Math.PI,clearance_m:200},height,'soaring');
    const air={t:config.flight.max_air_s+1};let input;
    for(let i=0;i<400*120&&!(s.grounded&&!s.launching);i++){
      if(i%12===0)input=pilotInput(w,juno,s,air);
      s=stepFlight(s,input,1/120,i/120,flight,worldmap.wind.direction_deg,height,null,height,height);air.t+=1/120;
    }
    sinks.push(s.landingSpeed);
  }
  assert.ok(sinks.every(v=>v<flight.landing.hard_mps),`touchdown sink m/s: ${sinks.map(v=>v.toFixed(1))}`);
});

test('a visit is called off when the friend leaves to fly',()=>{
  const events=[],w=world(events),[tobu,kiri]=['tobu','kiri'].map(id=>w.cats.find(c=>c.id===id));
  for(const c of [tobu,kiri])setController(w,c,'agent');
  command(w,tobu,{verb:'follow',id:'kiri',seconds:600});command(w,kiri,{verb:'fly'});
  run(w,5);
  assert.ok(events.some(e=>e.cat==='tobu'&&e.event==='plan_cancelled'&&/kiri went flying/.test(e.why)));
  assert.ok(!events.some(e=>e.cat==='tobu'&&e.event==='path_failed'));
});
test('with aloft, pilots spawn already flying and still land',()=>{
  const events=[],w=createFolkWorld({config,worldmap,placement,flight,walk,height,onEvent:e=>events.push(e)});createFolk(w,models,{seed:7,aloft:true});
  const pilots=w.cats.filter(c=>c.flightPlan);assert.ok(pilots.length);
  for(const c of pilots){assert.equal(c.body.mode,'flight');assert.ok(!c.body.state.grounded,`${c.id} airborne`);assert.ok(c.body.state.z-height(c.body.state.x,c.body.state.y)>10,`${c.id} above ground`);}
  run(w,1200);
  for(const c of pilots)assert.ok(events.find(e=>e.cat===c.id&&e.event==='landed'),`${c.id} landed`);
});

// The game plays the cinematic tier, meshopt-packed (tools/pack_meshopt.py): every clip and gait speed must survive.
test('each cat the game loads keeps its clips and gait speeds',async()=>{
  const{parseGLB}=await import('../src3d/glb.js');const packed=read('shared/geometry/packed.json').assets;
  for(const m of models.models){
    const asset=packed[m.cinematic.asset]?.packed??m.cinematic.asset;
    const clips=Object.fromEntries(parseGLB(readFileSync(new URL('../../../shared/geometry/'+asset,import.meta.url))).animations.map(c=>[c.name,c]));
    for(const name of m.clips)assert.ok(clips[name],`${m.id} lost clip ${name}`);
    for(const gait of ['stroll','walk','run'])assert.ok(clips[gait].userData.ground_speed_mps>0,`${m.id} ${gait} lost ground_speed_mps`);
  }
});

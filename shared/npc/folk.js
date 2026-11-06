/** Cat folk: needs-driven townsfolk on the player's own activity rules.
 *
 * Engine-neutral, X east, Y north, Z up, SI units. A cat is a brain and a body.
 * The brain keeps five needs, scores the activities in folk.json and turns the
 * best into a plan of steps (go, do, fly, say, wait). The body walks on
 * shared/activities/walk.js and flies on shared/activities/flight.js with the
 * same inputs a player gives; there is no NPC-only movement except a kinematic
 * walk far from the camera (`walk.near_m`), where collision cannot be seen.
 *
 * Agent control: observe(cat) returns a plain-JSON view of the cat and its
 * surroundings; command(cat, {verb, ...}) validates against VERBS and replaces
 * the plan. A gondola line (shared/activities/gondola.js), when given, carries
 * pilots up to its launch and takes cats up for the view. setController(cat, 'agent') stops the utility brain choosing, so an
 * outside agent (an LLM, a script, a network peer) drives the cat entirely;
 * 'auto' lets the brain resume when the agent's plan runs out. Every decision
 * and outcome is an event in cat.events and world.onEvent, the agent's memory.
 */
import {reharnessWalk,relaunchGround,relaunchRefusal,unharnessFlight,safeWalkGround} from '../activities/walk.js';
import {launchFlight,stepFlight,sampleAir,canopySegment,canopyTouches} from '../activities/flight.js';
import {boardGondola,rideAt} from '../activities/gondola.js';
import {stepGround} from '../activities/moves.js';
import {DOWN} from '../activities/balance.js';
import {createMind,perceive,moodOf,feel,remember,features,describe,lineFor,FEATURES} from './mind.js';

export {FEATURES};

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const NEEDS=['energy','social','fun','purpose','thrill'];
const PACES=['stroll','walk','run'];
const FLIGHT_STEP=1/120;
const EVENT_RING=64;

/** The verbs an agent may send. Arguments marked ? are optional. */
export const VERBS=Object.freeze({
  go_to:{args:{place:'home|garden|green|view|river|launch|player|<cat id>|<thing id>?',x:'number?',y:'number?',pace:'stroll|walk|run?'},about:'Walk to a named place, another cat, or a point.'},
  do:{args:{activity:'<activity id from folk.json>'},about:'Plan and carry out an activity: walk to its place, then do it.'},
  fly:{args:{mode:'paraglider|parakite|paramotor?',site:'home|<flight launch id>?'},about:'Walk to a launch, fly the shared flight rules, land and walk home.'},
  use:{args:{thing:'<thing id>',action:'<action the thing affords>'},about:'Walk to a placed thing and use it.'},
  look_at:{args:{at:'<cat id|thing id|player>?',seconds:'number?'},about:'Turn the head toward someone or something, without changing the plan. No at: look ahead.'},
  say:{args:{text:'string, 1-140 chars'},about:'Speak. Cats within 25 m receive a heard event.'},
  follow:{args:{id:'<cat id>',seconds:'number?'},about:'Walk beside another cat for a while.'},
  wait:{args:{seconds:'number'},about:'Stand where you are.'},
  stop:{args:{},about:'Drop the plan and stand.'},
});

function mulberry(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const hashSeed=text=>[...text].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619),2166136261);

/** Places every cat can name, derived from data the core already owns. */
export function createFolkWorld({config,worldmap,placement,flight,walk,height,ground=height,hitTest=null,gondola=null,balance=null,onEvent=null}){
  if(config.version!==1)throw new Error(`Unsupported folk version: ${config.version}`);
  const homes={};
  for(const i of placement.instances)for(const tag of i.tags??[])homes[tag]=i.position_m.slice(0,2);
  const used=config.folk.map(f=>homes[f.home]);
  if(used.some(h=>!h))throw new Error('folk.json names a home that placement.json does not have');
  const green=[used.reduce((s,h)=>s+h[0],0)/used.length,used.reduce((s,h)=>s+h[1],0)/used.length];
  const river=(worldmap.water?.bodies??[]).find(b=>b.kind==='river');
  // `player` is the client's player on foot ({x, y, speed}) or null: the one the cats play with.
  // `balance` (balance.js: {config, surfaceAt}) lets a cat slip and tumble on the same ground he does.
  return {config,worldmap,flight,walk,height,ground,hitTest,gondola,balance,onEvent,homes,green,river,time:0,focus:null,player:null,cats:[],things:Object.create(null),decider:null};
}

/** The nearest dry bank point of the river to p, standing back from the water's edge. */
function riverBank(world,p){
  const r=world.river;if(!r)return null;
  const line=r.polyline;let best=null;
  for(let i=0;i<line.length-1;i++){
    const [a,b]=[line[i],line[i+1]],ab=[b[0]-a[0],b[1]-a[1]],l=ab[0]**2+ab[1]**2;
    const t=clamp(((p[0]-a[0])*ab[0]+(p[1]-a[1])*ab[1])/l),q=[a[0]+ab[0]*t,a[1]+ab[1]*t],d=dist(p,q);
    if(!best||d<best.d)best={d,q,i,t,ab:ab.map(v=>v/Math.sqrt(l))};
  }
  const width=r.width_start_m+(r.width_end_m-r.width_start_m)*(best.i+best.t)/(line.length-1);
  let n=[-best.ab[1],best.ab[0]];if((p[0]-best.q[0])*n[0]+(p[1]-best.q[1])*n[1]<0)n=n.map(v=>-v);
  const back=width/2+(r.bank_m??0)+4;  // walk.js counts the bank as water
  return [best.q[0]+n[0]*back,best.q[1]+n[1]*back];
}

function emit(world,cat,event,data={}){
  const entry={t:Math.round(world.time*10)/10,cat:cat.id,event,...data};
  cat.events.push(entry);if(cat.events.length>EVENT_RING)cat.events.shift();
  world.onEvent?.(entry);
  // How it felt, and what the cat says about it: the same stream an agent reads.
  if(cat.mind){
    const felt=event==='landed'&&data.impact?world.config.mind.felt.impact:world.config.mind.felt[event];
    if(felt)feel(cat,felt);
    const situation={landed:'landed',path_failed:'blocked'}[event];
    if(situation&&!data.quiet)bark(world,cat,situation);
  }
  return entry;
}

/** Say one of the cat's own lines, unless it spoke a moment ago. */
function bark(world,cat,situation,name=''){
  const m=cat.mind;if(world.time-m.lastBark<world.config.mind.bark_gap_s)return false;
  const line=lineFor(cat,situation,name);if(!line)return false;
  m.lastBark=world.time;say(world,cat,line);return true;
}

/** Standable ground outside whatever stands at `centre`: the nearest point along
 * (or either side of) `angle` with room for a cat and an open 30 m line beyond it.
 * Homes are placements, and a dome is wider than a doorstep guess. */
function openSpot(world,centre,angle,from=8){
  for(let r=from;r<=60;r+=4)for(const turn of [0,.35,-.35,.7,-.7]){
    const a=angle+turn,x=centre[0]+Math.cos(a)*r,y=centre[1]+Math.sin(a)*r;
    const z=safeWalkGround(x,y,world.walk,world.height,world.hitTest);if(z===null)continue;
    const x2=x+Math.cos(a)*30,y2=y+Math.sin(a)*30,z2=world.height(x2,y2);
    if(Number.isFinite(z2)&&!world.hitTest?.([x,y,z+1],[x2,y2,z2+1],.5))return [x,y];
  }
  return [centre[0]+Math.cos(angle)*from*2,centre[1]+Math.sin(angle)*from*2];
}

/** Make the folk from folk.json. `models` is cat-folk/models.json (names, heights). */
export function createFolk(world,models,{seed=1,aloft=false}={}){
  const {config}=world,byId=Object.fromEntries(models.models.map(m=>[m.id,m]));
  world.cats=config.folk.map((f,index)=>{
    const model=byId[f.id];if(!model)throw new Error(`No model for folk ${f.id}`);
    const random=mulberry(seed+hashSeed(f.id));
    const home=world.homes[f.home],toGreen=Math.atan2(world.green[1]-home[1],world.green[0]-home[0]);
    const at=(angle,m)=>[home[0]+Math.cos(angle)*m,home[1]+Math.sin(angle)*m];
    const spot=openSpot(world,home,toGreen),z=world.height(...spot);
    // A lookout: the highest standable point a short walk uphill from home.
    let view=at(toGreen+Math.PI,40),viewZ=-Infinity;
    for(let k=0;k<12;k++){const p=at(k/12*Math.PI*2,90+60*random()),h=world.height(...p);if(Number.isFinite(h)&&h>viewZ){view=p;viewZ=h;}}
    const cat={id:f.id,name:model.name,bio:f.bio,model:model.asset,height_m:model.height_m,gaits:model.ground_speed_mps,traits:f.traits,skills:f.skills,pace:f.pace??1,flightPlan:f.flight??null,
      places:{home:spot,garden:openSpot(world,home,toGreen+Math.PI/2,14),view,river:riverBank(world,home),green:world.green,launch:null,
        gondola:world.gondola?.stations[0].xy_m.slice()??null},
      needs:Object.fromEntries(NEEDS.map(k=>[k,.45+.4*random()])),
      body:{mode:'walk',state:{x:spot[0],y:spot[1],z,heading:toGreen+Math.PI,speed:0,grounded:true,jumpPhase:'grounded'},clip:'idle',clipSpeed:0,face:null},
      controller:'auto',decider:null,deciding:null,plan:[],step:null,activity:null,last:null,events:[],random,index,said:null,lines:f.lines??{},used:{},
      // Its own stream, so a new line or reflex never disturbs the choices and flights that use `random`.
      mind:createMind(f.temperament,mulberry(seed+hashSeed(f.id)+1),index*world.config.mind.think_s/config.folk.length)};
    cat.places.launch=launchPlace(world,cat);
    if(cat.flightPlan)cat.places.landing=landingField(world,cat);
    return cat;
  });
  for(const cat of world.cats)emit(world,cat,'spawned',{at:cat.places.home.map(Math.round),controller:cat.controller});
  // Pilots start the session already aloft, so the sky is not empty on load.
  if(aloft)for(const cat of world.cats)if(cat.flightPlan&&cat.skills.includes('fly')&&world.flight.modes[cat.flightPlan.mode]){
    const {mode,site}=cat.flightPlan,effects=world.config.activities.fly.effects;
    begin(world,cat,[{kind:'go',to:'home',pace:'walk'}],'fly','spawn');
    cat.step={kind:'fly',mode,site,effects,activity:'fly',aloft:true};launch(world,cat,cat.step);
  }
  return world.cats;
}

function launchPlace(world,cat){
  const site=cat.flightPlan?.site;
  if(!site)return null;
  if(site==='home')return meadowLaunch(world,cat);
  const l=world.flight.launches.find(l=>l.id===site);if(!l)throw new Error(`Unknown launch ${site} for ${cat.id}`);
  return l.xy_m.slice();
}

/** Open ground near home that the shared rules accept for a ground launch into
 * the wind, with a clear, dry 60 m run ahead. Nearest such point wins. */
function meadowLaunch(world,cat){
  const home=cat.places.home,mode=cat.flightPlan.mode;
  const span=world.flight.modes[mode].span_m/2+2,canopy=world.flight.modes[mode].canopy_height_m;
  for(const ring of [40,70,100,140,190,250,320,400,500])for(let k=0;k<16;k++){
    const a=k/16*Math.PI*2,x=home[0]+Math.cos(a)*ring,y=home[1]+Math.sin(a)*ring,z=world.height(x,y);
    if(!Number.isFinite(z))continue;
    const heading=headingInto(world,[x,y],a);
    const hooked=reharnessWalk({x,y,z,heading,mode:'ground',harnessMode:mode,harnessWeather:'soaring',grounded:true,jumpPhase:'grounded'},world.walk,world.flight,world.height,world.hitTest);
    if(!hooked||relaunchRefusal(hooked,world.walk,world.flight,world.height,world.hitTest))continue;
    let clear=true;
    for(let d=5;d<=60&&clear;d+=5){
      const x2=x+Math.cos(heading)*d,y2=y+Math.sin(heading)*d,z2=world.height(x2,y2);
      clear=Number.isFinite(z2)&&Math.abs(z2-z)<6&&!world.hitTest?.([x,y,z+1.5],[x2,y2,z2+1.5],.6)
        &&!(world.hitTest&&canopyTouches(canopySegment({...hooked,bank:0,x:x2,y:y2,z:z2+world.flight.landing_clearance_m},world.flight),world.hitTest));
    }
    // Climb-out: a 1:6 climb for 400 m ahead, wing-span wide, must miss every crown and roof.
    for(let d=60;d<=400&&clear;d+=20){
      const p=[x+Math.cos(heading)*(d-20),y+Math.sin(heading)*(d-20),z+(d-20)/6+canopy],q=[x+Math.cos(heading)*d,y+Math.sin(heading)*d,z+d/6+canopy];
      clear=!world.hitTest?.(p,q,span)&&!(world.hitTest?.soft?.(q,span)?.length);
    }
    if(clear)return [x,y];
  }
  return [home[0]+(world.green[0]-home[0])*.5,home[1]+(world.green[1]-home[1])*.5];
}

/** Is the air around [x, y, z] free of crowns and solids within `radius`? Wings collapse on either. */
function openAir(world,p,radius){
  return !world.hitTest||!world.hitTest(p,[p[0]+.1,p[1],p[2]],radius)&&!world.hitTest.soft?.(p,radius)?.length;
}

/** A landing field near home: dry, level-ish ground with no crown or roof within
 * 110 m up to 90 m, so a pilot can spiral down over it and land into wind. Nearest such field wins. */
function landingField(world,cat){
  const home=cat.places.home;
  for(const ring of [0,60,110,170,240,320,420,540,680])for(let k=0;k<(ring?16:1);k++){
    const a=k/16*Math.PI*2,x=home[0]+Math.cos(a)*ring,y=home[1]+Math.sin(a)*ring,z=world.height(x,y);
    if(!Number.isFinite(z))continue;
    let ok=true;
    for(const r of [0,40,80,110])for(let j=0;j<(r?10:1)&&ok;j++){
      const b=j/8*Math.PI*2,px=x+Math.cos(b)*r,py=y+Math.sin(b)*r,pz=world.ground(px,py);
      ok=Number.isFinite(pz)&&Math.abs(pz-z)<10&&[6,25,50,90].every(h=>openAir(world,[px,py,pz+h],8));
    }
    if(ok)return [x,y];
  }
  return home;
}

/** Resolve a place name (or another cat's id) to a point now. */
function placePoint(world,cat,place){
  if(Array.isArray(place))return place;
  if(place==='here')return [cat.body.state.x,cat.body.state.y];
  if(place==='player')return world.player?[world.player.x,world.player.y]:null;
  const other=world.cats.find(c=>c.id===place);
  if(other)return [other.body.state.x,other.body.state.y];
  if(world.things[place])return world.things[place].xy_m;
  if(place==='green')return [world.green[0]+(cat.random()-.5)*40,world.green[1]+(cat.random()-.5)*40];
  return typeof place==='string'&&Object.hasOwn(cat.places,place)?cat.places[place]:null;  // Names come from agents.
}

// ── Things: placed items that say what they afford, and the cats work the rest out
/** Place an interactive item. `affords` maps an action to {clip, seconds, effects, requires?, sets?, skill?}:
 * the brain scores it like any activity, `requires` gates it on the thing's state and `sets` changes that
 * state when the use is done. A cat only chooses what it has seen, unless the thing is a `landmark`. */
export function addThing(world,{id,kind,name=kind,xy_m,z_m=null,reach_m=1.5,capacity=1,landmark=false,state={},affords={}}){
  if(typeof id!=='string'||!id||!Array.isArray(xy_m)||!xy_m.every(Number.isFinite))throw new Error('A thing needs an id and xy_m');
  if(world.things[id]||world.cats.some(c=>c.id===id)||world.config.activities[id])throw new Error(`The name ${id} is taken`);
  for(const [action,a] of Object.entries(affords))if(!a.clip||!a.seconds)throw new Error(`${id}.${action} needs a clip and seconds`);
  return world.things[id]={id,kind,name,xy_m,z_m:z_m??world.height(...xy_m),reach_m,capacity,landmark,state,affords};
}

/** Change a thing's state (from the game or a cat); every cat that can see it gets a thing_changed event. */
export function setThing(world,id,patch,by=null){
  const t=world.things[id];if(!t)throw new Error(`No thing ${id}`);
  Object.assign(t.state,patch);
  for(const cat of world.cats)if(cat.mind.seen.some(e=>e.id===id))emit(world,cat,'thing_changed',{thing:id,state:{...t.state},by});
  world.onThingChanged?.(t,by);
  return t;
}

const useId=(thing,action)=>`use:${thing}:${action}`;
const thingOf=(world,id)=>{const [,thing,action]=id.split(':'),t=world.things[thing];return t&&Object.hasOwn(t.affords,action)?{t,action,a:t.affords[action]}:null;};
const usersOf=(world,thing)=>world.cats.filter(c=>c.step?.thing===thing||c.plan.some(p=>p.thing===thing)).length;
/** What an activity id means: the catalogue's own, or one a thing affords. */
const activityOf=(world,id)=>id.startsWith('use:')?thingOf(world,id)?.a:world.config.activities[id];
function allIds(world){return [...Object.keys(world.config.activities),...Object.values(world.things).flatMap(t=>Object.keys(t.affords).map(a=>useId(t.id,a)))];}

// ── Choosing
function available(world,cat,id){
  if(id.startsWith('use:')){
    const u=thingOf(world,id);if(!u||cat.body.mode!=='walk')return false;
    if(u.a.skill&&!cat.skills.includes(u.a.skill))return false;
    if(!u.t.landmark&&!cat.mind.known[u.t.id])return false;
    if(Object.entries(u.a.requires??{}).some(([k,v])=>u.t.state[k]!==v))return false;
    return usersOf(world,u.t.id)<u.t.capacity;
  }
  const a=world.config.activities[id];
  if(!a||['wave','stretch'].includes(id))return false;
  if(a.skill&&!cat.skills.includes(a.skill))return false;
  if(id==='fly'&&(!cat.flightPlan||!world.flight.modes[cat.flightPlan.mode]))return false;
  if(id==='visit')return world.cats.length>1;
  if(id==='gondola')return !!world.gondola;
  // Play with the player only when they are on foot and near enough to reach.
  if(a.place==='player')return !!world.player&&cat.body.mode==='walk'&&dist([cat.body.state.x,cat.body.state.y],[world.player.x,world.player.y])<=world.config.play.near_m;
  return !!(a.place==='here'||a.place==='friend'||cat.places[a.place]||a.place==='green');
}
function score(world,cat,id){
  const a=activityOf(world,id);let s=0;
  for(const [need,gain] of Object.entries(a.effects))
    s+=gain>0?gain*(1-cat.needs[need])*(cat.traits[need]??1):gain*.5*(1-cat.needs[need]);
  if(cat.needs.energy<.2)s+=id==='nap'?1:-.3;
  const thing=id.startsWith('use:')?id.split(':')[1]:null;
  const p=thing?world.things[thing].xy_m:a.place==='friend'||a.place==='here'?null:placePoint(world,cat,a.place);
  if(p)s-=dist(p,[cat.body.state.x,cat.body.state.y])/2500*.2;
  if(cat.last===id)s-=.25;
  // A curious cat tries what it has not tried yet.
  if(thing&&!cat.used[id])s+=cat.mind.temperament.curiosity*world.config.mind.novelty;
  return s+cat.random()*.08;
}
/** Pick an activity and plan it. Exported for agents that want the brain's opinion. */
export function suggest(world,cat){
  return allIds(world).filter(id=>available(world,cat,id))
    .map(id=>({activity:id,score:Math.round(score(world,cat,id)*1000)/1000})).sort((a,b)=>b.score-a.score);
}

function friendFor(world,cat){
  const others=world.cats.filter(c=>c!==cat&&c.body.mode==='walk'&&c.activity!=='fly');
  if(!others.length)return null;
  const here=[cat.body.state.x,cat.body.state.y];
  // Near, and liked: a cat goes back to the friends it has got on with.
  return others.map(c=>({c,s:-dist(here,[c.body.state.x,c.body.state.y])/800+(cat.mind.known[c.id]?.affinity??0)*.5+cat.random()*.6})).sort((a,b)=>b.s-a.s)[0].c;
}

function planFor(world,cat,id,options={}){
  if(id.startsWith('use:')){
    const {t,action,a}=thingOf(world,id),[lo,hi]=a.seconds;
    return [{kind:'go',to:t.id,pace:'walk',within:t.reach_m},{kind:'use',thing:t.id,action,clip:a.clip,seconds:lo+(hi-lo)*cat.random(),effects:a.effects??{},sets:a.sets??null,face:t.id,activity:id}];
  }
  const a=world.config.activities[id],[lo,hi]=a.seconds,seconds=lo+(hi-lo)*cat.random();
  if(id==='fly'){
    const mode=options.mode??cat.flightPlan?.mode,site=options.site??cat.flightPlan?.site;
    const launch=site&&site!==cat.flightPlan?.site?launchPlace(world,{...cat,flightPlan:{site}}):cat.places.launch;
    return [...liftTo(world,cat,launch),{kind:'go',to:launch,pace:'run',label:'launch'},{kind:'fly',mode,site,effects:a.effects,activity:id},{kind:'go',to:'home',pace:'walk'}];
  }
  if(a.place==='player')return [{kind:'go',to:'player',pace:'sprint',within:world.config.play.start_m},{kind:'chase',seconds,effects:a.effects,activity:id}];
  if(id==='gondola'){
    const [low,high]=world.gondola.stations;
    return [{kind:'go',to:low.xy_m,pace:'walk',within:world.gondola.config.board_m*.6},{kind:'gondola',from:0,to:1},
      {kind:'do',clip:a.clip,seconds,effects:a.effects,activity:id},
      {kind:'go',to:high.xy_m,pace:'stroll',within:world.gondola.config.board_m*.6},{kind:'gondola',from:1,to:0},{kind:'go',to:'home',pace:'walk'}];
  }
  if(a.place==='friend'){
    const friend=options.friend??friendFor(world,cat);if(!friend)return null;
    return [{kind:'go',to:friend.id,pace:'walk',within:1.8},{kind:'do',clip:a.clip,seconds,effects:a.effects,face:friend.id,activity:id,with:friend.id}];
  }
  const steps=[];
  if(a.place!=='here')steps.push({kind:'go',to:a.place==='green'?placePoint(world,cat,'green'):a.place,pace:a.place==='home'&&cat.needs.energy<.25?'stroll':'walk'});
  steps.push({kind:'do',clip:a.clip,seconds,effects:a.effects,activity:id});
  // Nobody springs straight up from a nap.
  if(id==='nap')steps.push({kind:'do',clip:'stretch',seconds:world.config.activities.stretch.seconds[0],effects:world.config.activities.stretch.effects,activity:'stretch'});
  return steps;
}

/** Ride the gondola first when its top station is near `target` and the walk to its bottom is much shorter. */
function liftTo(world,cat,target){
  const line=world.gondola;if(!line||!target)return [];
  const [low,high]=line.stations,here=[cat.body.state.x,cat.body.state.y];
  if(dist(high.xy_m,target)>150||dist(here,low.xy_m)+dist(high.exit_xy_m,target)+300>dist(here,target))return [];
  return [{kind:'go',to:low.xy_m,pace:'walk',within:line.config.board_m*.6},{kind:'gondola',from:0,to:1}];
}

function begin(world,cat,plan,activity,source){
  cat.plan=plan;cat.step=null;cat.activity=activity;
  emit(world,cat,'plan',{activity,source,steps:plan.map(s=>s.kind+(s.to?':'+(Array.isArray(s.to)?s.to.map(Math.round).join(','):s.to):s.clip?':'+s.clip:''))});
}

/** Carry out a choice. Every decision is logged with what it was decided on, so the stream
 * doubles as labelled data for training a classifier to imitate (or improve on) the brain. */
function commit(world,cat,activity,source,options,vector){
  const plan=planFor(world,cat,activity);if(!plan)return false;
  emit(world,cat,'decision',{chosen:activity,source,options:options.slice(0,5),features:vector});
  begin(world,cat,plan,activity,source);cat.last=activity;
  return true;
}

function decideByBrain(world,cat,options=suggest(world,cat),vector=features(world,cat)){
  for(const {activity} of options)if(commit(world,cat,activity,'brain',options,vector))return;
}

function decide(world,cat){
  const decider=cat.decider??world.decider;
  if(!decider)return decideByBrain(world,cat);
  const options=suggest(world,cat),vector=features(world,cat);
  const accept=choice=>{
    const activity=typeof choice==='string'?choice:choice?.activity;
    if(options.some(o=>o.activity===activity)&&commit(world,cat,activity,'decider',options,vector))return;
    emit(world,cat,'decider_refused',{choice:typeof activity==='string'?activity.slice(0,64):null});
    decideByBrain(world,cat,options,vector);
  };
  const failed=error=>{emit(world,cat,'decider_failed',{error:String(error?.message??error).slice(0,200)});decideByBrain(world,cat,options,vector);};
  let answer;
  try{answer=decider({cat:cat.id,features:vector,feature_names:FEATURES,options,observation:observe(world,cat)});}catch(error){return failed(error);}
  if(typeof answer?.then!=='function')return accept(answer);
  // A model may take a while: the cat stands thinking, and a late answer is dropped once anything else has moved it on.
  const ticket=cat.deciding={until:world.time+world.config.mind.decider_timeout_s};
  const settled=handle=>value=>{if(cat.deciding!==ticket)return;cat.deciding=null;if(!cat.step&&!cat.plan.length&&cat.controller==='auto')handle(value);};
  answer.then(settled(accept),settled(failed));
}

/** A model chooses for this cat (or, with cat null, for all) when its plan runs out: `decider(view)`
 * returns an activity id from view.options, or a promise of one. Refusals, errors and timeouts fall
 * back to the brain, so a bad model call never leaves a cat stuck. Pass null to hand back. */
export function setDecider(world,cat,decider){
  if(decider!==null&&typeof decider!=='function')throw new Error('A decider is a function or null');
  if(cat){cat.decider=decider;cat.deciding=null;}else world.decider=decider;
}

// ── Agent surface
/** Hand the cat to an outside agent ('agent') or back to its own brain ('auto'). */
export function setController(world,cat,controller){
  if(!['auto','agent'].includes(controller))throw new Error(`Unknown controller ${controller}`);
  cat.controller=controller;emit(world,cat,'controller',{controller});
}

/** Validate and run one agent command. Returns {ok, error?}; never throws on bad input. */
export function command(world,cat,cmd){
  const fail=error=>{emit(world,cat,'command_refused',{verb:cmd?.verb,error});return {ok:false,error};};
  if(!cmd||typeof cmd!=='object'||!Object.hasOwn(VERBS,cmd.verb))return fail(`verb must be one of ${Object.keys(VERBS).join(', ')}`);
  const free=['say','look_at'].includes(cmd.verb);
  if(cat.body.mode==='flight'&&!free)return fail('cannot change plans while flying; wait for the landed event');
  if(cat.body.mode==='gondola'&&!free)return fail('cannot change plans in a gondola cabin; wait for the rode_gondola event');
  const pace=cmd.pace??'walk';if(!PACES.includes(pace))return fail('pace must be stroll, walk or run');
  let plan;
  switch(cmd.verb){
    case 'go_to':{
      const to=Number.isFinite(cmd.x)&&Number.isFinite(cmd.y)?[cmd.x,cmd.y]:cmd.place;
      if(!Array.isArray(to)&&!placePoint(world,cat,to))return fail(`unknown place ${cmd.place}`);
      if(Array.isArray(to)&&!Number.isFinite(world.height(...to)))return fail('that point is off the map');
      plan=[{kind:'go',to,pace}];break;
    }
    case 'do':
      if(typeof cmd.activity!=='string'||!Object.hasOwn(world.config.activities,cmd.activity))return fail(`unknown activity ${cmd.activity}`);
      if(!['wave','stretch'].includes(cmd.activity)&&!available(world,cat,cmd.activity))return fail(`${cat.id} cannot ${cmd.activity} (skill or place missing)`);
      plan=planFor(world,cat,cmd.activity);if(!plan)return fail('no one to visit');break;
    case 'fly':{
      const mode=cmd.mode??cat.flightPlan?.mode;
      if(!cat.skills.includes('fly'))return fail(`${cat.id} is not a pilot`);
      if(!world.flight.modes[mode])return fail(`unknown flight mode ${mode}`);
      if(cmd.site&&cmd.site!=='home'&&!world.flight.launches.some(l=>l.id===cmd.site))return fail(`unknown launch ${cmd.site}`);
      plan=planFor(world,cat,'fly',{mode,site:cmd.site});break;
    }
    case 'use':{
      const id=useId(cmd.thing,cmd.action);
      if(typeof cmd.thing!=='string'||!world.things[cmd.thing]||typeof cmd.action!=='string'||!thingOf(world,id))return fail(`no thing ${cmd.thing} affording ${cmd.action}`);
      // An agent may send a cat to something it has heard about but not yet seen.
      remember(cat,cmd.thing,'thing',world.time);
      if(!available(world,cat,id))return fail(`${cat.id} cannot use ${cmd.thing} now (busy, skill or state)`);
      begin(world,cat,planFor(world,cat,id),id,'agent');return {ok:true};
    }
    case 'look_at':
      if(cmd.at!==undefined&&!placePoint(world,cat,cmd.at))return fail(`nothing called ${cmd.at} to look at`);
      cat.mind.attend=cmd.at===undefined?null:{id:cmd.at,until:world.time+clamp(cmd.seconds??5,.5,60),told:true};
      return {ok:true};
    case 'say':
      if(typeof cmd.text!=='string'||!cmd.text.trim()||cmd.text.length>140)return fail('text must be 1-140 characters');
      say(world,cat,cmd.text.trim());return {ok:true};
    case 'follow':{
      const other=world.cats.find(c=>c.id===cmd.id&&c!==cat);if(!other)return fail(`no cat ${cmd.id}`);
      plan=[{kind:'go',to:other.id,pace,within:2.5,follow:clamp(cmd.seconds??30,1,600)}];break;
    }
    case 'wait':
      if(!(cmd.seconds>0))return fail('seconds must be positive');
      plan=[{kind:'do',clip:'idle',seconds:Math.min(600,cmd.seconds),effects:{}}];break;
    case 'stop':plan=[];break;
  }
  begin(world,cat,plan,cmd.verb==='do'?cmd.activity:cmd.verb==='stop'?null:cmd.verb,'agent');
  return {ok:true};
}

function say(world,cat,text){
  cat.said={text,until:world.time+5};
  emit(world,cat,'said',{text});
  const here=[cat.body.state.x,cat.body.state.y];
  for(const other of world.cats)if(other!==cat&&dist(here,[other.body.state.x,other.body.state.y])<world.config.mind.hearing_m)hear(world,other,cat.id,text);
}

function hear(world,cat,from,text){
  emit(world,cat,'heard',{from,text});
  // Whoever speaks gets a look, unless someone has told the cat where to look.
  if(!cat.mind.attend?.told)cat.mind.attend={id:from,until:world.time+world.config.mind.heard_look_s};
}

/** The player speaks: cats in earshot hear it, turn, and the ones who like company answer. */
export function playerSay(world,text){
  if(!world.player||typeof text!=='string'||!text.trim())return 0;
  const clean=text.trim().slice(0,140),here=[world.player.x,world.player.y];let heard=0;
  for(const cat of world.cats)if(dist(here,[cat.body.state.x,cat.body.state.y])<world.config.mind.hearing_m){
    heard++;hear(world,cat,'player',clean);
    remember(cat,'player','player',world.time,{meeting:true,affinity:world.config.mind.bond.greet});
    if(cat.controller==='auto'&&cat.body.mode==='walk'&&cat.mind.temperament.warmth>=world.config.mind.answer_warmth)bark(world,cat,'greet');
  }
  return heard;
}

/** A plain-JSON view of one cat for an agent: self, needs, plan, places, neighbours, recent events. */
export function observe(world,cat){
  const s=cat.body.state,here=[s.x,s.y],round=v=>Math.round(v*10)/10||0;
  const air=cat.body.mode==='flight'?{agl_m:round(s.z-world.ground(s.x,s.y)),speed_mps:round(s.speed),vario_mps:round(s.vario??0)}:null;
  return {
    id:cat.id,name:cat.name,bio:cat.bio,time_s:round(world.time),controller:cat.controller,
    position:[round(s.x),round(s.y),round(s.z)],heading_deg:Math.round(((s.heading??0)*180/Math.PI+360)%360),
    mode:cat.body.mode,doing:cat.activity,step:cat.step?{kind:cat.step.kind,clip:cat.step.clip??null,to:cat.step.to??null}:null,plan_left:cat.plan.length,
    flight:air,needs:Object.fromEntries(NEEDS.map(k=>[k,round(cat.needs[k]*100)/100])),skills:cat.skills,
    places:Object.fromEntries(Object.entries(cat.places).filter(([,p])=>p).map(([k,p])=>[k,{xy:p.map(Math.round),distance_m:Math.round(dist(here,p))}])),
    nearby:world.cats.filter(c=>c!==cat).map(c=>({id:c.id,name:c.name,distance_m:Math.round(dist(here,[c.body.state.x,c.body.state.y])),doing:c.activity,mode:c.body.mode}))
      .sort((a,b)=>a.distance_m-b.distance_m).slice(0,5),
    can:{verbs:Object.keys(VERBS),activities:allIds(world).filter(id=>available(world,cat,id))},
    mood:moodOf(cat),temperament:cat.mind.temperament,
    // What it senses (range, field of view, line of sight) and its eye, for a renderer or a vision model.
    senses:cat.mind.seen,eye:{position:[round(s.x),round(s.y),round(s.z+(cat.height_m??1.4)*.9)],heading_deg:Math.round(((cat.body.facing??s.heading??0)*180/Math.PI+360)%360),fov_deg:world.config.mind.fov_deg},
    looking_at:cat.mind.attend?.id??null,
    memory:cat.mind.known,
    things:Object.values(world.things).filter(t=>t.landmark||cat.mind.known[t.id]).map(t=>({id:t.id,kind:t.kind,name:t.name,xy:t.xy_m,state:t.state,actions:Object.keys(t.affords)})),
    situation:describe(world,cat),
    events:cat.events.slice(-12).map(({features:_,...e})=>e),
  };
}

// ── Body
function walkTo(world,cat,step,dt){
  const cfg=world.config.walk,s=cat.body.state;
  const target=placePoint(world,cat,step.to);
  if(!target){emit(world,cat,'path_failed',{reason:'unknown place',to:step.to,quiet:!!step.reflex});return true;}
  // A friend who has left to fly cannot be caught on foot; chasing reads as a blocked path after give_up_s.
  const other=world.cats.find(c=>c.id===step.to);
  if(other&&(other.activity==='fly'||other.body.mode==='flight')){cat.plan=[];emit(world,cat,'plan_cancelled',{why:`${other.id} went flying`});return true;}
  const here=[s.x,s.y],d=dist(here,target),within=step.within??cfg.arrive_m;
  step.t=(step.t??0)+dt;
  if(step.follow){if(step.t>=step.follow)return true;if(d<within){cat.body.state={...s,speed:0};cat.body.face=step.to;return false;}}
  else if(d<within){emit(world,cat,'arrived',{at:typeof step.to==='string'?step.to:target.map(Math.round)});cat.body.state={...s,speed:0,vx:0,vy:0};return true;}
  // Stuck: no 0.5 m of progress for stuck_s → try a detour either side; give up after give_up_s.
  if(step.best===undefined||d<step.best-.5){step.best=d;step.since=step.t;}
  const stuck=step.t-step.since;
  if(stuck>(step.patience??cfg.give_up_s)){
    emit(world,cat,'path_failed',{reason:'blocked',distance_m:Math.round(d),quiet:!!step.reflex});
    // Never take off from wherever the walk got stuck.
    if(cat.plan[0]?.kind==='fly'){cat.plan=[];emit(world,cat,'plan_cancelled',{why:'could not reach the launch'});}
    return true;
  }
  const detour=stuck>cfg.stuck_s?(Math.floor(stuck/3)%2?1:-1)*1.2:0;
  // Each cat walks at its own stride's ground speed, so the paws stay planted at any pace.
  // A sprint is the run gait played fast (play.sprint), for games only.
  const sprint=step.pace==='sprint',pace=sprint?'run':PACES.includes(step.pace)?step.pace:'walk',speed=cat.gaits[pace]*cfg.cadence*cat.pace*(sprint?world.config.play.sprint:1)*(cat.needs.energy<.15?.7:1)
    // Mood shows in the walk: keyed-up cats step out, low ones drag a little.
    *(1+world.config.mind.mood_pace*(moodOf(cat).arousal*2-1));
  const angle=Math.atan2(target[1]-s.y,target[0]-s.x)+detour;
  let ux=Math.cos(angle),uy=Math.sin(angle);
  // Personal space: lean away from any cat on foot within personal_m, and keep right, so two meeting head-on pass.
  for(const o of world.cats){
    if(o===cat||o.body.mode!=='walk')continue;
    const ox=s.x-o.body.state.x,oy=s.y-o.body.state.y,od=Math.hypot(ox,oy),push=(cfg.personal_m-od)/cfg.personal_m*2;
    if(od>1e-3&&push>0){ux+=(ox/od+Math.sin(angle)*.6)*push;uy+=(oy/od-Math.cos(angle)*.6)*push;}
  }
  const um=Math.hypot(ux,uy);if(um>1e-6){ux/=um;uy/=um;}
  if(isNear(world,here)){
    const run=speed>world.walk.walk_mps,mag=clamp(speed/(run?world.walk.run_mps:world.walk.walk_mps));
    cat.body.state=stepGround(s,{x:ux*mag,y:uy*mag,run},dt,world.walk,groundOf(world));
  }else{
    // ponytail: kinematic far walk ignores colliders; nobody can see it, and it keeps 8 cats cheap.
    const travel=Math.min(speed*dt,d),x=s.x+ux*travel,y=s.y+uy*travel,z=world.height(x,y);
    cat.body.state=Number.isFinite(z)?{...s,x,y,z,heading:Math.atan2(uy,ux),speed,vx:ux*speed,vy:uy*speed}:{...s,speed:0};
  }
  return false;
}

const groundOf=world=>({height:world.height,hitTest:world.hitTest,balance:world.balance});

/** Chase with the player: the cat is "it" first and runs them down; a tag (within tag_m)
 * swaps who is it, and the cat flees, jinking when they get close, and waits, taunting,
 * once it is flee_m clear. Its body is the player's own: stepGround, so it can slip and
 * tumble on the same slope. */
function chase(world,cat,step,dt){
  const p=world.player,cfg=world.config.play,s=cat.body.state;
  if(!p){cat.plan=[];emit(world,cat,'plan_cancelled',{why:'the player left'});return true;}
  step.t=(step.t??0)+dt;step.it??=true;step.swap=Math.max(0,(step.swap??0)-dt);
  for(const [k,v] of Object.entries(step.effects??{}))cat.needs[k]=clamp(cat.needs[k]+v*dt/Math.max(1,step.seconds));
  const dx=p.x-s.x,dy=p.y-s.y,d=Math.hypot(dx,dy);
  if(step.swap===0&&d<cfg.tag_m&&!DOWN.has(s.balance?.phase)){
    step.it=!step.it;step.swap=cfg.swap_s;step.tags=(step.tags??0)+1;
    emit(world,cat,'tag',{it:step.it?cat.id:'player'});remember(cat,'player','player',world.time,{affinity:world.config.mind.bond.tag});say(world,cat,step.it?'You got me! My turn!':'Tag! You\'re it!');
  }
  if(step.t>=step.seconds){emit(world,cat,'done',{activity:step.activity,tags:step.tags??0});return true;}
  let angle=Math.atan2(dy,dx),mag=0;
  if(step.it)mag=1;
  else if(d<cfg.flee_m){
    // Away, with a jink to one side when they are close: a cat turns faster than a runner.
    angle+=Math.PI;if(d<cfg.jink_m)angle+=(Math.sin(world.time*1.3+cat.index*2.1)>0?1:-1)*1.1;mag=1;
  }
  const speed=cat.gaits.run*world.config.walk.cadence*cat.pace*cfg.sprint;
  mag*=clamp(speed/world.walk.run_mps);
  cat.body.state=stepGround(s,{x:Math.cos(angle)*mag,y:Math.sin(angle)*mag,run:true},dt,world.walk,groundOf(world));
  // Waiting, it watches them.
  if(!mag&&!DOWN.has(cat.body.state.balance?.phase))cat.body.state={...cat.body.state,heading:Math.atan2(dy,dx)};
  return false;
}

const isNear=(world,p)=>!world.focus||dist(p,world.focus)<world.config.walk.near_m;

/** A far walk ignores colliders, so a cat coming into view may stand inside a trunk
 * or a wall: step it out to the nearest open ground before the full rules take over. */
function settle(world,cat){
  const s=cat.body.state,near=isNear(world,[s.x,s.y]),was=cat.far;cat.far=!near;
  if(!was||!near||cat.body.mode!=='walk'||safeWalkGround(s.x,s.y,world.walk,world.height,world.hitTest)!==null)return;
  const [x,y]=openSpot(world,[s.x,s.y],s.heading??0,2);
  cat.body.state={...s,x,y,z:world.height(x,y),speed:0,vx:0,vy:0};
  emit(world,cat,'settled',{from:[Math.round(s.x),Math.round(s.y)],to:[Math.round(x),Math.round(y)]});
}

function headingInto(world,at,fallback){
  const air=sampleAir(world.flight,world.worldmap.wind.direction_deg,{x:at[0],y:at[1],z:world.ground(...at)+5,weather:'soaring'},world.time,world.ground);
  return Math.hypot(air.wx,air.wy)>.8?Math.atan2(-air.wy,-air.wx):fallback;
}

function launch(world,cat,step){
  const s=cat.body.state,fc=world.flight,site=fc.launches.find(l=>l.id===step.site);
  const heading=site?site.heading_deg*Math.PI/180:headingInto(world,[s.x,s.y],s.heading??0);
  // A named site starts as the player's Launch button does. Open meadow takes the real inflate-and-run
  // only when the headwind can make up what the capped run cannot (ground_launch rules), as for a player.
  const gl=fc.ground_launch,air=sampleAir(fc,world.worldmap.wind.direction_deg,{x:s.x,y:s.y,z:s.z+2,weather:'soaring'},world.time,world.ground);
  const headwind=-(air.wx*Math.cos(heading)+air.wy*Math.sin(heading));
  const runnable=gl&&headwind>=fc.modes[step.mode].trim_mps*gl.takeoff_speed_fraction-(gl.max_run_mps??Infinity)+.3;
  const hooked=!site&&!step.aloft&&runnable&&reharnessWalk({...s,mode:'ground',heading,harnessMode:step.mode,harnessWeather:'soaring',grounded:true,jumpPhase:'grounded'},world.walk,fc,world.height,world.hitTest);
  const ground=hooked?relaunchGround(hooked,world.walk,fc,world.height,world.hitTest):null;
  const state=ground??launchFlight(fc,step.mode,site??{xy_m:[s.x,s.y],heading_deg:heading*180/Math.PI,clearance_m:45},world.ground,'soaring');
  step.air={t:0,acc:0,launch:ground?'ground':site?'site':'assisted',aborts:0,airborne:!ground};
  cat.body={...cat.body,mode:'flight',state};
  emit(world,cat,'launched',{mode:step.mode,site:step.site??'here',launch:step.air.launch});
}

/** Autopilot: hunt the core's thermals, keep a glide home, spiral down, flare. Returns player-shaped input. */
export function pilotInput(world,cat,s,air){
  const g=world.config.flight,home=cat.places.landing??cat.places.home,agl=s.z-world.ground(s.x,s.y),toHome=dist([s.x,s.y],home);
  const homeZ=world.ground(...home),glide=(s.z-homeZ-40)/Math.max(1,toHome);
  let target=home,circle=false,brake=0,maneuver=false;
  // Low and slow only means landing after the climb-out; a motor needs no glide home until it is throttled back.
  const powered=s.mode==='paramotor';
  // Faster wings need more room: spiral floor and flare scale with trim speed (11.5 m/s paraglider = 1).
  const pace=world.flight.modes[s.mode].trim_mps/11.5,flare=g.flare_agl_m*pace;
  const final=air.t>g.max_air_s||!powered&&(air.t>45&&agl<g.final_agl_m||air.t>10&&glide<1/4);
  if(!final){
    const thermal=world.flight.thermals.filter(t=>t.top_m>s.z+60).map(t=>({t,d:dist([s.x,s.y],t.xy_m)})).sort((a,b)=>a.d-b.d)[0];
    if(thermal&&thermal.d<thermal.t.radius_m*.8&&(s.vario??0)>-.2&&s.z<g.cruise_agl_m+homeZ)circle=true;
    else if(thermal&&thermal.d<2000&&(powered||(s.z-world.ground(...thermal.t.xy_m)-60)/thermal.d>1/7))target=thermal.t.xy_m;
  }else if(toHome<70&&agl>15*pace){circle=true;maneuver=agl>150;}
  air.launchHeading??=s.heading;
  // Climb out straight along the corridor the launch was chosen for.
  let desired=agl<120&&air.t<60&&!final?air.launchHeading:circle?s.heading+1.1:Math.atan2(target[1]-s.y,target[0]-s.x);
  // Below the spiral, turn and land into the wind as pilots do.
  if(final&&agl<20&&!circle){const w=sampleAir(world.flight,world.worldmap.wind.direction_deg,s,world.time,world.ground);if(Math.hypot(w.wx,w.wy)>.5)desired=Math.atan2(-w.wy,-w.wx);}
  // Look ahead a wing span wide; steer for the nearest clear heading to the one wanted.
  // Away from the field, rising ground counts too: a slope climbs faster than a wing, so ground rising to
  // within half the height (up to 30 m) of the wing's level blocks, and a turn must be clear all the way
  // round, since the short way back to a thermal can cross the hill the long way does not. On final both
  // stay off: rolling ground near the field reads as blocked, and avoiding (full throttle, hard turns) among
  // the trees there collapses more wings than it saves (real-map approaches, 2026-10-30).
  if(!maneuver){
    const reach=110,span=world.flight.modes[s.mode].span_m/2+1,lift=world.flight.modes[s.mode].canopy_height_m*.6;
    const climb=(s.vario??0)/Math.max(5,s.speed),margin=final?-Infinity:Math.min(30,agl*.5);
    const clear=h=>!world.hitTest?.([s.x,s.y,s.z+lift],[s.x+Math.cos(h)*reach,s.y+Math.sin(h)*reach,s.z+lift+climb*reach],span)
      &&[.35,.7,1].every(f=>{const x=s.x+Math.cos(h)*reach*f,y=s.y+Math.sin(h)*reach*f,z=s.z+climb*reach*f;
        return !(world.ground(x,y)+margin>Math.max(s.z,z))&&openAir(world,[x,y,z+lift],span);});
    const offsets=[.4,.8,1.2,1.8,2.6,Math.PI],want=wrap(desired-s.heading),side=want<0?-1:1;
    const reachable=side=>{const out=[];for(const d of offsets){if(!clear(s.heading+side*d))break;out.push(side*d);}return out;};
    const short=final?null:reachable(side);
    if(!clear(s.heading)||!clear(desired)||short&&Math.abs(want)>=(offsets[short.length]??Infinity)){
      if(final){
        const options=[0,.4,-.4,.8,-.8,1.2,-1.2,1.8,-1.8,2.6,-2.6].map(d=>s.heading+d).filter(clear);
        if(options.length)desired=options.sort((p,q)=>Math.abs(wrap(p-desired))-Math.abs(wrap(q-desired)))[0];
      }else{
        const options=[...(clear(s.heading)?[0]:[]),...short,...reachable(-side)];
        // Commit to a side: steering at a heading 180° away would leave the side to chance.
        const best=options.sort((p,q)=>Math.abs(wrap(s.heading+p-desired))-Math.abs(wrap(s.heading+q-desired)))[0];
        if(best!==undefined)desired=s.heading+Math.sign(best)*Math.min(Math.abs(best),1.2);
      }
      air.avoiding=true;
    }else air.avoiding=false;
  }
  let turn=maneuver?-1:clamp(-wrap(desired-s.heading)*(air.avoiding?3:1.3),air.avoiding?-1:-.7,air.avoiding?1:.7);
  // Low circles are gentle: a steep bank near the ground is a fast sink.
  if(circle&&!maneuver&&!air.avoiding)turn=agl<80*pace?-.3:-.6;
  // Near the ground only on the way down: the climb-out is near the ground too.
  const landing=final||air.t>15&&(s.vario??0)<-.3;
  if(landing&&agl<flare*4)turn*=.3;
  // Round out: from flare*3 down, work the brakes to sink no faster than agl/τ, easing off when the wing
  // balloons and adding when it drops, as a pilot does by feel. A height-only flare balloons fast wings.
  // Full brake (a stall) only in the last metre and a half.
  // Read the ground a moment ahead: at parakite speed, rising ground arrives faster than the sink does.
  const ahead=s.z-world.ground(s.x+(s.vx??0)*1.2,s.y+(s.vy??0)*1.2),clear=Number.isFinite(ahead)?Math.min(agl,ahead):agl;
  if(landing&&(clear<flare*3||air.flare!==undefined)){
    const want=-Math.max(g.touchdown_mps,clear/g.roundout_s);
    air.flare=clamp((air.flare??0)+(want-(s.vario??0))*g.flare_gain,0,clear<1.5?1:.8);brake=air.flare;
    if(agl<flare)turn=0;
  }
  const throttle=s.mode==='paramotor'?(air.avoiding?1:final?-1:agl<220?1:agl>320?-1:0):0;
  return {turn,brake,throttle,accelerator:0,maneuver};
}

function fly(world,cat,step,dt){
  if(!step.air)launch(world,cat,step);
  const a=step.air;a.t+=dt;a.acc+=Math.min(dt,.1);
  while(a.acc>=FLIGHT_STEP){
    a.acc-=FLIGHT_STEP;world.flightTime=(world.flightTime??0)+FLIGHT_STEP;
    // The pilot decides ten times a second, as a person would; the wing integrates at 120 Hz.
    const s=cat.body.state;if(!a.input||a.t-a.decided>=.1){a.input=pilotInput(world,cat,s,a);a.decided=a.t;}
    const input=a.input;
    const next=stepFlight(s,input,FLIGHT_STEP,world.time,world.flight,world.worldmap.wind.direction_deg,world.ground,world.hitTest,world.ground,world.height);
    if(s.launching&&next.launchAborted){
      a.aborts++;emit(world,cat,'launch_aborted',{why:next.figure});
      cat.body.state=launchFlight(world.flight,s.mode,{xy_m:[s.x,s.y],heading_deg:s.heading*180/Math.PI,clearance_m:45},world.ground,'soaring');
      a.launch='site';a.airborne=true;continue;
    }
    cat.body.state=next;
    if(!next.grounded)a.airborne=true;
    if(a.airborne&&next.grounded&&!next.launching){
      const foot=unharnessFlight(next,world.walk,world.flight,world.height,world.hitTest);
      const z=world.height(next.x,next.y)??world.ground(next.x,next.y);
      cat.body={...cat.body,mode:'walk',state:foot??{x:next.x,y:next.y,z,heading:next.heading,speed:0,grounded:true,jumpPhase:'grounded'}};
      for(const [k,v] of Object.entries(step.effects??{}))cat.needs[k]=clamp(cat.needs[k]+v);
      emit(world,cat,'landed',{quality:next.landingQuality??(next.impact?'impact':'unknown'),impact:next.impact??null,air_s:Math.round(a.t),
        at:[Math.round(next.x),Math.round(next.y)],from_home_m:Math.round(dist([next.x,next.y],cat.places.home))});
      return true;
    }
  }
  return false;
}

/** Wait at the station for a cabin, ride it, and step off at the far station's exit. */
function rideGondola(world,cat,step){
  const line=world.gondola,s=cat.body.state;
  if(!line){emit(world,cat,'path_failed',{reason:'no gondola'});return true;}
  if(!step.ride){step.ride=boardGondola(line,step.from,world.time);emit(world,cat,'gondola_waiting',{station:line.stations[step.from].id,wait_s:Math.round(step.ride.wait_s)});}
  const r=rideAt(line,step.ride,world.time);
  if(r.waiting){cat.body.state={...s,speed:0};return false;}
  if(!r.done){
    // Riders sharing a cabin stand at their own place in it.
    const sharing=world.cats.filter(c=>c.step?.ride?.cabin===step.ride.cabin&&c.body.mode==='gondola'),seat=Math.max(0,sharing.indexOf(cat));
    const along=(seat%3-1)*.7,across=seat>2?.5:-.3;
    if(cat.body.mode!=='gondola')emit(world,cat,'gondola_boarded',{station:line.stations[step.from].id,cabin:step.ride.cabin});
    cat.body={...cat.body,mode:'gondola',state:{x:r.x+Math.cos(r.heading)*along-Math.sin(r.heading)*across,y:r.y+Math.sin(r.heading)*along+Math.cos(r.heading)*across,
      z:r.floor_z,heading:r.heading+Math.PI/2,speed:0,grounded:true,jumpPhase:'grounded'}};
    return false;
  }
  const [x,y]=r.exit_xy_m,z=world.height(x,y)??world.ground(x,y);
  cat.body={...cat.body,mode:'walk',state:{x,y,z,heading:r.heading,speed:0,grounded:true,jumpPhase:'grounded'}};
  emit(world,cat,'rode_gondola',{to:r.to.id});
  return true;
}

function perform(world,cat,step,dt){
  step.t=(step.t??0)+dt;
  for(const [k,v] of Object.entries(step.effects??{}))cat.needs[k]=clamp(cat.needs[k]+v*dt/Math.max(1,step.seconds));
  cat.body.face=step.face??null;
  // Talk through a chat, taking turns: the visitor speaks first, and the one visited half a beat later.
  if(step.clip==='chat'&&step.face){
    const gap=world.config.mind.chat_line_s,partner=world.cats.find(c=>c.id===step.face);
    step.nextLine??=step.with?1:1+gap/2;
    if(step.t>=step.nextLine){step.nextLine+=gap;const line=lineFor(cat,'chat',partner?.name??'');if(line)say(world,cat,line);}
  }
  if(step.t>=step.seconds){
    if(step.clip==='chat'&&step.face)remember(cat,step.face,'cat',world.time,{meeting:true,affinity:world.config.mind.bond.chat});
    if(step.kind==='use'){
      cat.used[step.activity]=(cat.used[step.activity]??0)+1;
      emit(world,cat,'used',{thing:step.thing,action:step.action});
      if(step.sets&&world.things[step.thing])setThing(world,step.thing,step.sets,cat.id);
    }
    emit(world,cat,'done',{activity:step.activity??step.clip});return true;
  }
  return false;
}

function clipFor(world,cat){
  const b=cat.body,s=b.state;
  if(b.mode==='flight')return s.launching&&s.launchStage==='running'?'run':s.grounded?'idle':'harness';
  if(b.mode==='gondola')return 'gaze';
  const step=cat.step;
  // Down on a slope (balance.js) it plays its pounce-and-roll: the client turns it over.
  if(DOWN.has(s.balance?.phase))return 'play';
  if((step?.kind==='do'||step?.kind==='use')&&!(s.speed>.2))return step.clip;
  const speed=s.speed??0,cadence=world.config.walk.cadence;
  if(speed<.15)return 'idle';
  // The gait whose natural pace is nearest, by ratio: the client scales playback by what is left over.
  return PACES.reduce((a,b)=>Math.abs(Math.log(speed/(cat.gaits[b]*cadence)))<Math.abs(Math.log(speed/(cat.gaits[a]*cadence)))?b:a);
}

// ── Awareness and reflexes: personality with no model attached
/** Interrupt the plan for a moment; the step in hand carries on afterwards. */
function react(world,cat,step,kind){
  if(cat.step)cat.plan.unshift(cat.step);
  cat.step={...step,reflex:kind};cat.mind.lastReflex=world.time;
  emit(world,cat,'reflex',{kind,to:step.face??(typeof step.to==='string'?step.to:null)});
}

const waveAt=(world,id)=>{const a=world.config.activities.wave;return {kind:'do',clip:a.clip,seconds:a.seconds[0],effects:a.effects,face:id,activity:'wave'};};

/** May this cat be interrupted now? Not mid-chat, in the air, tumbling, or on its way to play. */
function interruptible(cat){
  const s=cat.step;
  return cat.controller==='auto'&&cat.body.mode==='walk'&&!DOWN.has(cat.body.state.balance?.phase)&&!s?.reflex&&!s?.face&&s?.kind!=='use'&&s?.kind!=='chase'&&s?.to!=='player'&&(s?.kind==='go'||s?.kind==='do');
}

/** Temperament decides what a cat does about who it notices: a warm one waves, a shy one
 * backs off when crowded, a curious one comes over; a cold or busy one just looks. */
function reflexes(world,cat){
  const cfg=world.config.mind,m=cat.mind,t=m.temperament,now=world.time;
  if(!interruptible(cat)||now-m.lastReflex<cfg.reflex_gap_s)return;
  const player=m.seen.find(e=>e.kind==='player'),s=cat.body.state;
  if(player){
    const again=now-(m.greeted.player??-Infinity)>cfg.greet_again_s;
    if(player.distance_m<cfg.shy_m&&t.boldness<cfg.shy_boldness){
      const away=Math.atan2(s.y-world.player.y,s.x-world.player.x);
      react(world,cat,{kind:'go',to:[s.x+Math.cos(away)*cfg.back_off_m,s.y+Math.sin(away)*cfg.back_off_m],pace:'walk',within:.8,patience:2},'back_off');
      bark(world,cat,'shy');return;
    }
    if(player.distance_m<cfg.greet_m&&again){
      m.greeted.player=now;remember(cat,'player','player',now,{meeting:true,affinity:cfg.bond.greet});
      if(m.random()<t.warmth*.6+t.boldness*.4){react(world,cat,waveAt(world,'player'),'greet');bark(world,cat,'greet');}
      return;
    }
    // Curiosity brings a cat over from further off, but only when nothing presses, and once per greeting.
    if(player.distance_m<cfg.approach_m&&again&&cat.step?.kind==='go'&&cat.activity!=='fly'&&m.random()<t.curiosity*cfg.approach_chance){
      m.greeted.player=now;
      cat.plan.unshift(waveAt(world,'player'));
      react(world,cat,{kind:'go',to:'player',pace:'walk',within:cfg.greet_m*.5,patience:5},'approach');
      return;
    }
  }
  // Passing someone it knows: a wave and a word, more often the warmer it is and the better they get on.
  const other=m.seen.find(e=>e.kind==='cat'&&e.mode==='walk'&&e.distance_m<cfg.pass_m&&now-(m.greeted[e.id]??-Infinity)>cfg.pass_again_s);
  if(other){
    m.greeted[other.id]=now;const bond=remember(cat,other.id,'cat',now,{affinity:cfg.bond.pass});
    if(m.random()<t.warmth*.7+bond.affinity*.3){react(world,cat,waveAt(world,other.id),'pass');bark(world,cat,'pass',other.name);}
  }
}

/** Who gets its attention: salience by nearness and what they are, shaded by temperament. A shy cat
 * looks away sooner, and a good share of the time a cat just looks where it is going. */
function attention(world,cat){
  const cfg=world.config.mind,m=cat.mind,t=m.temperament;
  if(m.attend&&world.time<m.attend.until)return;
  if(m.attend?.told||world.time>=m.nextAttention){
    const weight={player:1+t.curiosity+t.boldness,cat:.8+t.warmth,thing:.2+t.curiosity};
    const pool=m.seen.map(e=>({e,w:weight[e.kind]/(2+e.distance_m)}));
    const total=pool.reduce((a,b)=>a+b.w,0);
    let pick=m.random()*(total+cfg.look_ahead),chosen=null;
    for(const {e,w} of pool){pick-=w;if(pick<=0){chosen=e;break;}}
    const [lo,hi]=cfg.attention_s,hold=(lo+(hi-lo)*m.random())*(.5+t.boldness*.5);
    m.attend=chosen?{id:chosen.id,until:world.time+hold}:null;m.nextAttention=world.time+hold;
  }else if(m.attend)m.attend=null;
}

/** Four times a second or so: sense, remember, attend, react. */
function think(world,cat){
  const m=cat.mind,was=new Set(m.seen.map(e=>e.id));
  m.nextThink=world.time+world.config.mind.think_s;
  const near=isNear(world,[cat.body.state.x,cat.body.state.y]);
  m.seen=perceive(world,cat,near);
  const now=new Set(m.seen.map(e=>e.id));
  for(const e of m.seen){
    const first=!m.known[e.id];
    remember(cat,e.id,e.kind,world.time);
    if(!was.has(e.id)&&(e.kind!=='cat'||e.distance_m<world.config.mind.pass_m*2))emit(world,cat,'noticed',{id:e.id,kind:e.kind,distance_m:Math.round(e.distance_m),first});
  }
  for(const id of was)if(!now.has(id)&&id==='player')emit(world,cat,'lost_sight',{id});
  m.affect*=Math.exp(-world.config.mind.affect_decay_per_min*world.config.mind.think_s/60);
  attention(world,cat);
  reflexes(world,cat);
}

/** Where the head is turned, for any renderer: {x, y, z} of who it attends to, or null. */
function lookOf(world,cat){
  const id=cat.mind.attend?.id;if(!id||['flight','gondola'].includes(cat.body.mode)||id===cat.body.face)return null;
  const p=placePoint(world,cat,id);if(!p)return null;
  const other=world.cats.find(c=>c.id===id);
  const z=id==='player'?(world.player.z??world.height(...p))+1.3:other?other.body.state.z+(other.height_m??1.4)*.9:world.things[id]?.z_m+.6;
  return Number.isFinite(z)?{x:p[0],y:p[1],z}:null;
}

/** The way the cat's body points, for any renderer: at whoever it is attending to, else along its heading. */
function facingOf(world,cat){
  const s=cat.body.state,p=cat.body.face?placePoint(world,cat,cat.body.face):null;
  return p?Math.atan2(p[1]-s.y,p[0]-s.x):s.heading??0;
}

/** Advance every cat by dt seconds. `focus` is the camera's [x, y], for the far-walk shortcut. */
export function stepFolk(world,dt,focus=null){
  if(!(dt>0))return;
  dt=Math.min(dt,.1);world.time+=dt;world.focus=focus;
  const decay=world.config.needs;
  for(const cat of world.cats){
    for(const k of NEEDS)cat.needs[k]=clamp(cat.needs[k]-decay[k].decay_per_min*dt/60*(.5+.5*(cat.traits[k]??1)));
    settle(world,cat);
    if(world.time>=cat.mind.nextThink)think(world,cat);
    if(cat.deciding&&world.time>=cat.deciding.until){cat.deciding=null;emit(world,cat,'decider_failed',{error:'timed out'});decideByBrain(world,cat);}
    if(!cat.step&&!cat.plan.length&&cat.controller==='auto'&&!cat.deciding)decide(world,cat);
    if(!cat.step&&cat.plan.length){
      cat.step={...cat.plan.shift()};
      if(cat.step.with){const f=world.cats.find(c=>c.id===cat.step.with);
        if(f&&f.controller==='auto'&&f.body.mode==='walk'&&!['fly'].includes(f.activity)&&f.step?.kind!=='fly'){
          begin(world,f,[{kind:'do',clip:'chat',seconds:cat.step.seconds,effects:cat.step.effects,face:cat.id,activity:'visit'}],'visit','invited');
          emit(world,cat,'chatting',{with:f.id});
        }}
    }
    const step=cat.step;
    cat.body.face=null;  // Only a step still attending to someone keeps facing them; it says so again below.
    let done=false;
    if(step?.kind==='go')done=walkTo(world,cat,step,dt);
    else if(step?.kind==='fly')done=fly(world,cat,step,dt);
    else if(step?.kind==='gondola')done=rideGondola(world,cat,step);
    else if(step?.kind==='chase')done=chase(world,cat,step,dt);
    else if(step?.kind==='do'||step?.kind==='use'){cat.body.state={...cat.body.state,speed:0};done=perform(world,cat,step,dt);}
    else if(!step)cat.body.state={...cat.body.state,speed:0};
    if(done){
      cat.step=null;
      if(!cat.plan.length){emit(world,cat,cat.controller==='agent'?'awaiting_command':'plan_done',{activity:cat.activity});cat.activity=null;}
    }
    cat.body.facing=facingOf(world,cat);
    cat.body.look=lookOf(world,cat);
    cat.body.clip=clipFor(world,cat);
    cat.body.clipSpeed=cat.body.state.speed??0;
    if(cat.said&&world.time>cat.said.until)cat.said=null;
  }
}

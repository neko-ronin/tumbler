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
 * the plan. setController(cat, 'agent') stops the utility brain choosing, so an
 * outside agent (an LLM, a script, a network peer) drives the cat entirely;
 * 'auto' lets the brain resume when the agent's plan runs out. Every decision
 * and outcome is an event in cat.events and world.onEvent, the agent's memory.
 */
import {stepWalk,reharnessWalk,relaunchGround,relaunchRefusal,unharnessFlight,safeWalkGround} from '../activities/walk.js';
import {launchFlight,stepFlight,sampleAir,canopySegment,canopyTouches} from '../activities/flight.js';

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const NEEDS=['energy','social','fun','purpose','thrill'];
const PACES=['stroll','walk','run'];
const FLIGHT_STEP=1/120;
const EVENT_RING=64;

/** The verbs an agent may send. Arguments marked ? are optional. */
export const VERBS=Object.freeze({
  go_to:{args:{place:'home|garden|green|view|river|launch|<cat id>?',x:'number?',y:'number?',pace:'stroll|walk|run?'},about:'Walk to a named place, another cat, or a point.'},
  do:{args:{activity:'<activity id from folk.json>'},about:'Plan and carry out an activity: walk to its place, then do it.'},
  fly:{args:{mode:'paraglider|parakite|paramotor?',site:'home|<flight launch id>?'},about:'Walk to a launch, fly the shared flight rules, land and walk home.'},
  say:{args:{text:'string, 1-140 chars'},about:'Speak. Cats within 25 m receive a heard event.'},
  follow:{args:{id:'<cat id>',seconds:'number?'},about:'Walk beside another cat for a while.'},
  wait:{args:{seconds:'number'},about:'Stand where you are.'},
  stop:{args:{},about:'Drop the plan and stand.'},
});

function mulberry(seed){let a=seed>>>0;return()=>{a=a+0x6D2B79F5>>>0;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
const hashSeed=text=>[...text].reduce((h,c)=>Math.imul(h^c.charCodeAt(0),16777619),2166136261);

/** Places every cat can name, derived from data the core already owns. */
export function createFolkWorld({config,worldmap,placement,flight,walk,height,ground=height,hitTest=null,onEvent=null}){
  if(config.version!==1)throw new Error(`Unsupported folk version: ${config.version}`);
  const homes={};
  for(const i of placement.instances)for(const tag of i.tags??[])homes[tag]=i.position_m.slice(0,2);
  const used=config.folk.map(f=>homes[f.home]);
  if(used.some(h=>!h))throw new Error('folk.json names a home that placement.json does not have');
  const green=[used.reduce((s,h)=>s+h[0],0)/used.length,used.reduce((s,h)=>s+h[1],0)/used.length];
  const river=(worldmap.water?.bodies??[]).find(b=>b.kind==='river');
  return {config,worldmap,flight,walk,height,ground,hitTest,onEvent,homes,green,river,time:0,focus:null,cats:[]};
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
  return entry;
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
export function createFolk(world,models,{seed=1}={}){
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
    const cat={id:f.id,name:model.name,bio:f.bio,model:model.asset,height_m:model.height_m,traits:f.traits,skills:f.skills,pace:f.pace??1,flightPlan:f.flight??null,
      places:{home:spot,garden:openSpot(world,home,toGreen+Math.PI/2,14),view,river:riverBank(world,home),green:world.green,launch:null},
      needs:Object.fromEntries(NEEDS.map(k=>[k,.45+.4*random()])),
      body:{mode:'walk',state:{x:spot[0],y:spot[1],z,heading:toGreen+Math.PI,speed:0,grounded:true,jumpPhase:'grounded'},clip:'idle',clipSpeed:0,face:null},
      controller:'auto',plan:[],step:null,activity:null,last:null,events:[],random,index,said:null};
    cat.places.launch=launchPlace(world,cat);
    if(cat.flightPlan)cat.places.landing=landingField(world,cat);
    return cat;
  });
  for(const cat of world.cats)emit(world,cat,'spawned',{at:cat.places.home.map(Math.round),controller:cat.controller});
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
  const other=world.cats.find(c=>c.id===place);
  if(other)return [other.body.state.x,other.body.state.y];
  if(place==='green')return [world.green[0]+(cat.random()-.5)*40,world.green[1]+(cat.random()-.5)*40];
  return cat.places[place]??null;
}

// ── Choosing
function available(world,cat,id){
  const a=world.config.activities[id];
  if(!a||['wave','stretch'].includes(id))return false;
  if(a.skill&&!cat.skills.includes(a.skill))return false;
  if(id==='fly'&&(!cat.flightPlan||!world.flight.modes[cat.flightPlan.mode]))return false;
  if(id==='visit')return world.cats.length>1;
  return !!(a.place==='here'||a.place==='friend'||cat.places[a.place]||a.place==='green');
}
function score(world,cat,id){
  const a=world.config.activities[id];let s=0;
  for(const [need,gain] of Object.entries(a.effects))
    s+=gain>0?gain*(1-cat.needs[need])*(cat.traits[need]??1):gain*.5*(1-cat.needs[need]);
  if(cat.needs.energy<.2)s+=id==='nap'?1:-.3;
  const p=a.place==='friend'||a.place==='here'?null:placePoint(world,cat,a.place);
  if(p)s-=dist(p,[cat.body.state.x,cat.body.state.y])/2500*.2;
  if(cat.last===id)s-=.25;
  return s+cat.random()*.08;
}
/** Pick an activity and plan it. Exported for agents that want the brain's opinion. */
export function suggest(world,cat){
  return Object.keys(world.config.activities).filter(id=>available(world,cat,id))
    .map(id=>({activity:id,score:Math.round(score(world,cat,id)*1000)/1000})).sort((a,b)=>b.score-a.score);
}

function friendFor(world,cat){
  const others=world.cats.filter(c=>c!==cat&&c.body.mode==='walk'&&c.activity!=='fly');
  if(!others.length)return null;
  const here=[cat.body.state.x,cat.body.state.y];
  return others.map(c=>({c,s:-dist(here,[c.body.state.x,c.body.state.y])/800+cat.random()*.6})).sort((a,b)=>b.s-a.s)[0].c;
}

function planFor(world,cat,id,options={}){
  const a=world.config.activities[id],[lo,hi]=a.seconds,seconds=lo+(hi-lo)*cat.random();
  if(id==='fly'){
    const mode=options.mode??cat.flightPlan?.mode,site=options.site??cat.flightPlan?.site;
    const launch=site&&site!==cat.flightPlan?.site?launchPlace(world,{...cat,flightPlan:{site}}):cat.places.launch;
    return [{kind:'go',to:launch,pace:'run',label:'launch'},{kind:'fly',mode,site,effects:a.effects,activity:id},{kind:'go',to:'home',pace:'walk'}];
  }
  if(a.place==='friend'){
    const friend=options.friend??friendFor(world,cat);if(!friend)return null;
    return [{kind:'go',to:friend.id,pace:'walk',within:1.8},{kind:'do',clip:a.clip,seconds,effects:a.effects,face:friend.id,activity:id,with:friend.id}];
  }
  const steps=[];
  if(a.place!=='here')steps.push({kind:'go',to:a.place==='green'?placePoint(world,cat,'green'):a.place,pace:a.place==='home'&&cat.needs.energy<.25?'stroll':'walk'});
  steps.push({kind:'do',clip:a.clip,seconds,effects:a.effects,activity:id});
  return steps;
}

function begin(world,cat,plan,activity,source){
  cat.plan=plan;cat.step=null;cat.activity=activity;
  emit(world,cat,'plan',{activity,source,steps:plan.map(s=>s.kind+(s.to?':'+(Array.isArray(s.to)?s.to.map(Math.round).join(','):s.to):s.clip?':'+s.clip:''))});
}

function decide(world,cat){
  for(const {activity} of suggest(world,cat)){
    const plan=planFor(world,cat,activity);
    if(plan){begin(world,cat,plan,activity,'brain');cat.last=activity;return;}
  }
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
  if(cat.body.mode==='flight'&&cmd.verb!=='say')return fail('cannot change plans while flying; wait for the landed event');
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
      if(!world.config.activities[cmd.activity])return fail(`unknown activity ${cmd.activity}`);
      if(!['wave','stretch'].includes(cmd.activity)&&!available(world,cat,cmd.activity))return fail(`${cat.id} cannot ${cmd.activity} (skill or place missing)`);
      plan=planFor(world,cat,cmd.activity);if(!plan)return fail('no one to visit');break;
    case 'fly':{
      const mode=cmd.mode??cat.flightPlan?.mode;
      if(!cat.skills.includes('fly'))return fail(`${cat.id} is not a pilot`);
      if(!world.flight.modes[mode])return fail(`unknown flight mode ${mode}`);
      if(cmd.site&&cmd.site!=='home'&&!world.flight.launches.some(l=>l.id===cmd.site))return fail(`unknown launch ${cmd.site}`);
      plan=planFor(world,cat,'fly',{mode,site:cmd.site});break;
    }
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
  begin(world,cat,plan,cmd.verb==='do'?cmd.activity:cmd.verb,'agent');
  return {ok:true};
}

function say(world,cat,text){
  cat.said={text,until:world.time+5};
  emit(world,cat,'said',{text});
  const here=[cat.body.state.x,cat.body.state.y];
  for(const other of world.cats)if(other!==cat&&dist(here,[other.body.state.x,other.body.state.y])<25)emit(world,other,'heard',{from:cat.id,text});
}

/** A plain-JSON view of one cat for an agent: self, needs, plan, places, neighbours, recent events. */
export function observe(world,cat){
  const s=cat.body.state,here=[s.x,s.y],round=v=>Math.round(v*10)/10;
  const air=cat.body.mode==='flight'?{agl_m:round(s.z-world.ground(s.x,s.y)),speed_mps:round(s.speed),vario_mps:round(s.vario??0)}:null;
  return {
    id:cat.id,name:cat.name,bio:cat.bio,time_s:round(world.time),controller:cat.controller,
    position:[round(s.x),round(s.y),round(s.z)],heading_deg:Math.round(((s.heading??0)*180/Math.PI+360)%360),
    mode:cat.body.mode,doing:cat.activity,step:cat.step?{kind:cat.step.kind,clip:cat.step.clip??null,to:cat.step.to??null}:null,plan_left:cat.plan.length,
    flight:air,needs:Object.fromEntries(NEEDS.map(k=>[k,round(cat.needs[k]*100)/100])),skills:cat.skills,
    places:Object.fromEntries(Object.entries(cat.places).filter(([,p])=>p).map(([k,p])=>[k,{xy:p.map(Math.round),distance_m:Math.round(dist(here,p))}])),
    nearby:world.cats.filter(c=>c!==cat).map(c=>({id:c.id,name:c.name,distance_m:Math.round(dist(here,[c.body.state.x,c.body.state.y])),doing:c.activity,mode:c.body.mode}))
      .sort((a,b)=>a.distance_m-b.distance_m).slice(0,5),
    can:{verbs:Object.keys(VERBS),activities:Object.keys(world.config.activities).filter(id=>available(world,cat,id))},
    events:cat.events.slice(-12),
  };
}

// ── Body
function walkTo(world,cat,step,dt){
  const cfg=world.config.walk,s=cat.body.state;
  const target=placePoint(world,cat,step.to);
  if(!target){emit(world,cat,'path_failed',{reason:'unknown place',to:step.to});return true;}
  const here=[s.x,s.y],d=dist(here,target),within=step.within??cfg.arrive_m;
  step.t=(step.t??0)+dt;
  if(step.follow){if(step.t>=step.follow)return true;if(d<within){cat.body.state={...s,speed:0};cat.body.face=step.to;return false;}}
  else if(d<within){emit(world,cat,'arrived',{at:typeof step.to==='string'?step.to:target.map(Math.round)});cat.body.state={...s,speed:0,vx:0,vy:0};return true;}
  // Stuck: no 0.5 m of progress for stuck_s → try a detour either side; give up after give_up_s.
  if(step.best===undefined||d<step.best-.5){step.best=d;step.since=step.t;}
  const stuck=step.t-step.since;
  if(stuck>cfg.give_up_s){
    emit(world,cat,'path_failed',{reason:'blocked',distance_m:Math.round(d)});
    // Never take off from wherever the walk got stuck.
    if(cat.plan[0]?.kind==='fly'){cat.plan=[];emit(world,cat,'plan_cancelled',{why:'could not reach the launch'});}
    return true;
  }
  const detour=stuck>cfg.stuck_s?(Math.floor(stuck/3)%2?1:-1)*1.2:0;
  const pace=PACES.includes(step.pace)?step.pace:'walk',speed=cfg[pace+'_mps']*cat.pace*(cat.needs.energy<.15?.7:1);
  const angle=Math.atan2(target[1]-s.y,target[0]-s.x)+detour,ux=Math.cos(angle),uy=Math.sin(angle);
  const near=!world.focus||dist(here,world.focus)<cfg.near_m;
  if(near){
    const run=speed>world.walk.walk_mps,mag=clamp(speed/(run?world.walk.run_mps:world.walk.walk_mps));
    cat.body.state=stepWalk(s,{x:ux*mag,y:uy*mag,run},dt,world.walk,world.height,world.hitTest);
  }else{
    // ponytail: kinematic far walk ignores colliders; nobody can see it, and it keeps 8 cats cheap.
    const travel=Math.min(speed*dt,d),x=s.x+ux*travel,y=s.y+uy*travel,z=world.height(x,y);
    cat.body.state=Number.isFinite(z)?{...s,x,y,z,heading:angle,speed,vx:ux*speed,vy:uy*speed}:{...s,speed:0};
  }
  return false;
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
  const hooked=!site&&runnable&&reharnessWalk({...s,mode:'ground',heading,harnessMode:step.mode,harnessWeather:'soaring',grounded:true,jumpPhase:'grounded'},world.walk,fc,world.height,world.hitTest);
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
  if(world.hitTest&&!maneuver){
    const reach=110,span=world.flight.modes[s.mode].span_m/2+1,lift=world.flight.modes[s.mode].canopy_height_m*.6;
    const climb=(s.vario??0)/Math.max(5,s.speed);
    const clear=h=>!world.hitTest([s.x,s.y,s.z+lift],[s.x+Math.cos(h)*reach,s.y+Math.sin(h)*reach,s.z+lift+climb*reach],span)
      &&[.35,.7,1].every(f=>openAir(world,[s.x+Math.cos(h)*reach*f,s.y+Math.sin(h)*reach*f,s.z+lift+climb*reach*f],span));
    if(!clear(s.heading)||!clear(desired)){
      const options=[0,.4,-.4,.8,-.8,1.2,-1.2,1.8,-1.8,2.6,-2.6].map(d=>s.heading+d).filter(clear);
      if(options.length)desired=options.sort((p,q)=>Math.abs(wrap(p-desired))-Math.abs(wrap(q-desired)))[0];
      air.avoiding=true;
    }else air.avoiding=false;
  }
  let turn=maneuver?-1:clamp(-wrap(desired-s.heading)*(air.avoiding?3:1.3),air.avoiding?-1:-.7,air.avoiding?1:.7);
  // Low circles are gentle: a steep bank near the ground is a fast sink.
  if(circle&&!maneuver&&!air.avoiding)turn=agl<80*pace?-.3:-.6;
  // Near the ground only on the way down: the climb-out is near the ground too.
  const landing=final||air.t>15&&(s.vario??0)<-.3;
  if(landing&&agl<flare*4)turn*=.3;
  // A progressive flare: the last metres trade speed for a soft touchdown, without stalling high.
  if(landing&&agl<flare){brake=clamp((flare-agl)/(flare-1));turn=0;}
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

function perform(world,cat,step,dt){
  step.t=(step.t??0)+dt;
  for(const [k,v] of Object.entries(step.effects??{}))cat.needs[k]=clamp(cat.needs[k]+v*dt/Math.max(1,step.seconds));
  cat.body.face=step.face??null;
  if(step.t>=step.seconds){emit(world,cat,'done',{activity:step.activity??step.clip});return true;}
  return false;
}

function clipFor(world,cat){
  const b=cat.body,s=b.state;
  if(b.mode==='flight')return s.launching&&s.launchStage==='running'?'run':s.grounded?'idle':'harness';
  const step=cat.step;
  if(step?.kind==='do'&&!(s.speed>.2))return step.clip;
  const speed=s.speed??0,cfg=world.config.walk;
  return speed<.15?'idle':speed<cfg.stroll_mps*1.3?'stroll':speed<cfg.walk_mps*1.5?'walk':'run';
}

/** Advance every cat by dt seconds. `focus` is the camera's [x, y], for the far-walk shortcut. */
export function stepFolk(world,dt,focus=null){
  if(!(dt>0))return;
  dt=Math.min(dt,.1);world.time+=dt;world.focus=focus;
  const decay=world.config.needs;
  for(const cat of world.cats){
    for(const k of NEEDS)cat.needs[k]=clamp(cat.needs[k]-decay[k].decay_per_min*dt/60*(.5+.5*(cat.traits[k]??1)));
    if(!cat.step&&!cat.plan.length&&cat.controller==='auto')decide(world,cat);
    if(!cat.step&&cat.plan.length){
      cat.step={...cat.plan.shift()};
      if(cat.step.with){const f=world.cats.find(c=>c.id===cat.step.with);
        if(f&&f.controller==='auto'&&f.body.mode==='walk'&&!['fly'].includes(f.activity)&&f.step?.kind!=='fly'){
          begin(world,f,[{kind:'do',clip:'chat',seconds:cat.step.seconds,effects:cat.step.effects,face:cat.id,activity:'visit'}],'visit','invited');
          emit(world,cat,'chatting',{with:f.id});
        }}
    }
    const step=cat.step;
    let done=false;
    if(step?.kind==='go')done=walkTo(world,cat,step,dt);
    else if(step?.kind==='fly')done=fly(world,cat,step,dt);
    else if(step?.kind==='do'){cat.body.state={...cat.body.state,speed:0};done=perform(world,cat,step,dt);}
    else if(!step){cat.body.state={...cat.body.state,speed:0};cat.body.face=null;}
    if(done){
      cat.step=null;
      if(!cat.plan.length){emit(world,cat,cat.controller==='agent'?'awaiting_command':'plan_done',{activity:cat.activity});cat.activity=null;}
    }
    cat.body.clip=clipFor(world,cat);
    cat.body.clipSpeed=cat.body.state.speed??0;
    if(cat.said&&world.time>cat.said.until)cat.said=null;
  }
}

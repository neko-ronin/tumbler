/** What a cat notices, feels and remembers. Engine-neutral, X east, Y north, Z up.
 *
 * Pure bookkeeping beside folk.js, which owns plans and the body. Everything here
 * is plain JSON a model can read: `perceive` is what the cat can sense right now
 * (range, field of view, line of sight), `moodOf` is how it feels, `features` is
 * the fixed numeric vector for a classifier, and `describe` the same scene in
 * words for an LLM. No model is needed for any of it: temperament and mood drive
 * the cat by themselves (reflexes in folk.js).
 */
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const NEEDS=['energy','social','fun','purpose','thrill'];
const TEMPERAMENT=['warmth','boldness','curiosity','mischief'];
const EYE_M=1.2;

/** The names of features(), in order. A model trained on them breaks loudly if this changes. */
export const FEATURES=Object.freeze([
  ...NEEDS.map(k=>`need_${k}`),...TEMPERAMENT.map(k=>`temperament_${k}`),
  'mood_valence','mood_arousal','on_foot','flying','busy',
  'sees_player','player_closeness','player_familiarity','player_affinity',
  'nearest_cat_closeness','cats_in_sight','things_in_sight','nearest_thing_closeness',
]);

export function createMind(temperament={},random=Math.random,offset=0){
  return {temperament:Object.fromEntries(TEMPERAMENT.map(k=>[k,clamp(temperament[k]??.5)])),random,
    affect:0,seen:[],known:{},attend:null,nextThink:offset,nextAttention:offset,greeted:{},lastBark:-Infinity,lastLine:null,lastReflex:-Infinity};
}

/** Everything that could be sensed: other cats, the player on foot, placed things. */
function entities(world,cat){
  const out=[];
  for(const c of world.cats)if(c!==cat)out.push({kind:'cat',id:c.id,name:c.name,x:c.body.state.x,y:c.body.state.y,z:c.body.state.z,doing:c.activity,mode:c.body.mode});
  const p=world.player;if(p)out.push({kind:'player',id:'player',name:'the stranger',x:p.x,y:p.y,z:p.z,speed:p.speed});
  for(const t of Object.values(world.things))out.push({kind:'thing',id:t.id,name:t.name,thing:t.kind,x:t.xy_m[0],y:t.xy_m[1],z:t.z_m,state:t.state});
  return out;
}

/** What the cat senses now, nearest first. Sight needs range, the field of view and a clear
 * line; right beside it a cat notices without looking. A far cat (nobody watching) skips the
 * line-of-sight ray, as its far walk skips colliders. */
export function perceive(world,cat,near=true){
  const cfg=world.config.mind,s=cat.body.state,half=cfg.fov_deg*Math.PI/360,heading=cat.body.facing??s.heading??0,out=[];
  for(const e of entities(world,cat)){
    const dx=e.x-s.x,dy=e.y-s.y,d=Math.hypot(dx,dy);if(d>cfg.sight_m)continue;
    const off=Math.atan2(Math.sin(Math.atan2(dy,dx)-heading),Math.cos(Math.atan2(dy,dx)-heading));
    if(Math.abs(off)>half&&d>cfg.aware_m)continue;
    const ez=e.z??world.height(e.x,e.y),zHere=s.z+EYE_M;
    if(near&&d>cfg.aware_m&&world.hitTest?.([s.x,s.y,zHere],[e.x,e.y,ez+EYE_M],.05))continue;
    const {x,y,z,...rest}=e;
    out.push({...rest,xy:[Math.round(x*10)/10||0,Math.round(y*10)/10||0],distance_m:Math.round(d*10)/10,bearing_deg:Math.round(off*180/Math.PI)||0});
  }
  return out.sort((a,b)=>a.distance_m-b.distance_m);
}

/** Valence (-1 bad, 1 good) from met needs and recent events; arousal (0 calm, 1 keyed up). */
export function moodOf(cat){
  const n=cat.needs,m=cat.mind,met=NEEDS.reduce((sum,k)=>sum+n[k],0)/NEEDS.length;
  const valence=clamp((met-.5)*1.6+m.affect,-1,1),arousal=clamp(n.energy*.5+m.temperament.boldness*.2+Math.abs(m.affect)*.4+(1-n.thrill)*.1);
  const label=n.energy<.2?'tired':valence>.25?(arousal>.6?'excited':'content'):valence<-.25?(arousal>.6?'restless':'glum'):(arousal>.6?'alert':'calm');
  return {valence:Math.round(valence*100)/100,arousal:Math.round(arousal*100)/100,label};
}

export function feel(cat,amount){cat.mind.affect=clamp(cat.mind.affect+amount,-1,1);}

/** A cat's memory of someone or something: plain JSON, inspectable, and small enough to save. */
export function remember(cat,id,kind,time,{affinity=0,meeting=false}={}){
  const k=cat.mind.known[id]??={kind,first_seen_s:Math.round(time),last_seen_s:0,meetings:0,affinity:0};
  k.last_seen_s=Math.round(time);if(meeting)k.meetings++;k.affinity=clamp(k.affinity+affinity,-1,1);
  return k;
}

/** The fixed vector for classifier models, ordered as FEATURES, each in 0..1 (valence -1..1). */
export function features(world,cat){
  const m=cat.mind,mood=moodOf(cat),range=world.config.mind.sight_m,closeness=e=>e?clamp(1-e.distance_m/range):0;
  const player=m.seen.find(e=>e.kind==='player'),cats=m.seen.filter(e=>e.kind==='cat'),things=m.seen.filter(e=>e.kind==='thing'),known=m.known.player;
  return [...NEEDS.map(k=>cat.needs[k]),...TEMPERAMENT.map(k=>m.temperament[k]),mood.valence,mood.arousal,
    +(cat.body.mode==='walk'),+(cat.body.mode==='flight'),+!!(cat.step||cat.plan.length),
    +!!player,closeness(player),clamp((known?.meetings??0)/10),known?.affinity??0,
    closeness(cats[0]),clamp(cats.length/8),clamp(things.length/5),closeness(things[0])].map(v=>Math.round(v*1000)/1000);
}

const side=b=>Math.abs(b)<30?'ahead':Math.abs(b)>120?'behind':b>0?'to the left':'to the right';

/** The cat's situation in a few plain sentences, for an LLM's prompt. */
export function describe(world,cat){
  const m=cat.mind,mood=moodOf(cat),lowest=NEEDS.reduce((a,b)=>cat.needs[b]<cat.needs[a]?b:a);
  const seen=m.seen.slice(0,5).map(e=>`${e.name} ${Math.round(e.distance_m)} m ${side(e.bearing_deg)}${e.doing?` (${e.doing})`:''}`);
  const heard=cat.events.filter(e=>e.event==='heard').slice(-2).map(e=>`${e.from} said "${e.text}"`);
  return [`You are ${cat.name}. ${cat.bio}`,`You feel ${mood.label}; you most need ${lowest}.`,cat.activity?`You are busy with: ${cat.activity}.`:'You are not doing anything.',
    seen.length?`You can see ${seen.join(', ')}.`:'Nobody is in sight.',...(heard.length?[`You heard: ${heard.join('; ')}.`]:[])].join(' ');
}

/** One of the cat's own lines for a situation, not the one it just said. Null if it has none. */
export function lineFor(cat,situation,name=''){
  const lines=cat.lines?.[situation];if(!lines?.length)return null;
  const choices=lines.length>1?lines.filter(l=>l!==cat.mind.lastLine):lines;
  const line=choices[Math.floor(cat.mind.random()*choices.length)];
  cat.mind.lastLine=line;
  return line.replaceAll('{name}',name);
}

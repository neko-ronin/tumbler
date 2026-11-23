import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createOrganoidEncounter,createOrganoidTutor,organoidDeparture,sampleOrganoidExpression} from '../../../shared/npc/organoid.js';
import {createOrganoidWake} from '../src3d/organoid-wake.js';
import {closeSampleBudget,detailAt} from '../src3d/organoid-material.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {parseGLB} from '../src3d/glb.js';
import {pickCoverTree} from '../src3d/organoid-encounter.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';

const read = path => readFileSync(new URL(path,import.meta.url));
const json = path => JSON.parse(read('../../../'+path));
const authored = json('shared/npc/organoid.json');
const material = json('shared/geometry/organoid/material.json');
const placement = json('shared/world/out/placement.json');
const hill = json('shared/play/tumble-hill.json').fall_line_xy_m;
// The real ground and water the game walks on, as camera-traversal.test.mjs builds them.
const world = json('shared/world/worldmap.json'), manifest = json('client/web/data/viewer.json'), geology = json(world.mountains.geology);
const grid = key => {const d=manifest.height_grids[key];return new HeightGrid({...d,values:applyGeologyTerrain(new Float32Array(Uint8Array.from(read('../../../'+d.file)).buffer),d,geology.terrain[key])});};
const ground = new GroundSampler(grid('block'),grid('far_field'),createRiverGranite(json('shared/world/out/river_granite.json')).height,createGeologySampler(geology));
const walk = createWalkHeight(world,(x,y)=>ground.height(x,y));
// Collision for the redwoods the pick can reach, from their real meshes.
const anchor = authored.cover_anchor_xy_m;
const nearby = placement.instances.filter(i=>i.kind==='redwood'&&Math.hypot(i.position_m[0]-anchor[0],i.position_m[1]-anchor[1])<150);
const meshes = Object.fromEntries([...new Set(nearby.map(i=>i.asset))].map(a=>[a,parseGLB(read('../../../shared/geometry/'+a))]));
const forestHit = buildWorldCollision({instances:nearby},meshes);
const pick = instances => pickCoverTree(authored,instances,{height:walk,hit:forestHit,waterAt:walk.waterAt,hill});
const picked = pick(placement.instances);
const config = {...authored,...picked};
const tree = config.cover_tree_xy_m;
const [x,y] = config.approach_xy_m;
const player = {x,y,z:145,heading:-1};

test('the encounter picks the redwood nearest its anchor from the placement, and the next one when that tree is gone',()=>{
  assert.ok(picked,'a redwood near the anchor qualifies');
  assert.ok(picked.distance<60,'the pick stays near the anchor');
  assert.ok(!walk.waterAt(x,y) && hill.some(([hx,hy])=>Math.hypot(hx-x,hy-y)<=60),'approach dry and inside the tutor radius');
  assert.deepEqual(config.approach_xy_m,tree.map((v,i)=>v+authored.approach_offset_m[i]));
  const gone=pick(placement.instances.filter(i=>!(i.kind==='redwood'&&i.position_m[0]===tree[0]&&i.position_m[1]===tree[1])));
  assert.ok(gone&&gone.distance>=picked.distance);
  assert.notDeepEqual(gone.cover_tree_xy_m,tree);
  const wet=pickCoverTree(authored,placement.instances,{height:walk,hit:forestHit,waterAt:(px,py)=>px===x&&py===y,hill});
  assert.deepEqual(wet.cover_tree_xy_m,gone.cover_tree_xy_m,'an approach on water is passed over for the next tree');
});

test('the authored encounter uses a real valley tree and goes around it behind the first camera plane',()=>{
  const cover=placement.instances.find(i=>i.kind==='redwood'&&i.position_m[0]===tree[0]&&i.position_m[1]===tree[1]);
  assert.ok(cover);
  const asset=parseGLB(read('../../../shared/geometry/'+cover.asset));
  const treeHit=buildWorldCollision({instances:[cover]},{[cover.asset]:asset});
  let sweeps=0;
  const hit=(a,b,r)=>{sweeps++;return treeHit(a,b,r);};
  const rules=createOrganoidEncounter(config,{height:()=>145,hit});
  assert.equal(rules.update(.1,{...player,x:x-20}),null);
  assert.equal(rules.update(.1,player,false),null);
  assert.equal(rules.update(.1,player),'start');
  const length=Math.hypot(tree[0]-x,tree[1]-y);
  const toward=[(tree[0]-x)/length,(tree[1]-y)/length];
  let event;
  for(let t=0;t<10&&!event;t+=.025){
    event=rules.update(.025,player);
    const [ox,oy,oz]=rules.position;
    const projection=(ox-x)*toward[0]+(oy-y)*toward[1];
    assert.ok(projection>1.32+config.radius_m,'sphere crosses the reveal plane before the whisper');
    assert.equal(treeHit([ox,oy,oz],[ox,oy,oz],config.radius_m),null);
    assert.equal(oz,145+config.hover_m);
  }
  assert.ok(sweeps>20);
  assert.equal(event,'listen');
  assert.ok(Math.hypot(rules.position[0]-x,rules.position[1]-y)<2.5);
  rules.complete();
  assert.equal(rules.update(.1,player),null);
  assert.equal(rules.phase,'complete');
});

test('refuses to start when both routes are blocked',()=>{
  const rules=createOrganoidEncounter(config,{height:()=>145,hit:()=>true});
  assert.equal(rules.update(.1,player),null);
  assert.equal(rules.phase,'watch');
});

test('wake waits for actual uninterrupted sleep, works away from Tumble Hill, and consumes the same encounter',()=>{
  const rules=createOrganoidEncounter(config,{height:()=>145,hit:()=>false});
  const sleeper={...player,x:player.x+80};
  assert.equal(rules.update(1,sleeper,true,true),null);
  assert.equal(rules.update(2,sleeper,true,false),null);
  assert.equal(rules.update(1,sleeper,true,true),null);
  assert.equal(rules.update(.2,sleeper,true,true),'wake');
  assert.equal(rules.phase,'talk');
  assert.equal(rules.target.x,sleeper.x);
  assert.ok(Math.abs(Math.hypot(rules.position[0]-sleeper.x,rules.position[1]-sleeper.y)-2.8)<1e-6);
  rules.complete();
  assert.equal(rules.update(3,sleeper,true,true),null);
  assert.equal(rules.update(3,player),null);
  const blocked=createOrganoidEncounter(config,{height:()=>145,hit:()=>true});
  assert.equal(blocked.update(3,sleeper,true,true),null);
  assert.equal(blocked.phase,'watch');
});

test('departure selects a clear nearby flank or stops on enclosed ground',()=>{
  const feet={x:0,y:0,z:0};
  const actor=[-2.5,0,1.67];
  const clear=organoidDeparture(feet,actor,{height:()=>0,hit:()=>false});
  assert.deepEqual(clear,{heading:0,distance:4});
  const detour=organoidDeparture(feet,actor,{height:()=>0,hit:(_a,b)=>b[0]>.75&&Math.abs(b[1])<.6});
  assert.ok(Math.abs(detour.heading)>.4 && detour.distance>=3.25);
  const blocked=organoidDeparture(feet,actor,{height:()=>null,hit:()=>false});
  assert.equal(blocked.distance,0);
  const shore=organoidDeparture(feet,actor,{height:()=>0,hit:()=>false,waterAt:x=>x>=.5});
  assert.ok(shore.distance>0 && Math.cos(shore.heading)*shore.distance<.5);
});

test('the separate wake clip opens the eyes before it stands and ends in the idle pose',()=>{
  const asset=parseGLB(read('../../../shared/geometry/cat-ronin/ronin.glb'));
  const clip=name=>asset.animations.find(clip=>clip.name===name);
  const doze=clip('sit_doze'), idle=clip('idle'), blink=clip('blink');
  const eyes={clip:blink,time:1/6};
  const wake=createOrganoidWake(asset.root,doze,1.5,idle,eyes);
  const sample=(clip,track,time)=>Array.from(clip.tracks.find(t=>t.name===track).createInterpolant().evaluate(time));
  assert.equal(wake.name,'organoid_wake');
  const binding=(bone,property)=>asset.root.getObjectByName(bone).uuid+'.'+property;
  const lid=binding('lid.L','quaternion'), root=binding('root','position'), head=binding('head','quaternion');
  const standing=sample(idle,root,0)[1], seated=sample(doze,root,1.5)[1];
  assert.deepEqual(sample(wake,lid,0),sample(blink,lid,eyes.time));
  assert.deepEqual(sample(wake,lid,.37),sample(blink,lid,blink.duration));
  assert.ok(Math.abs(sample(wake,root,.37)[1]-seated)<Math.abs(standing-seated)*.15);
  assert.notDeepEqual(sample(wake,head,.36),sample(doze,head,1.5));
  assert.ok(Math.abs(sample(wake,root,wake.duration)[1]-standing)<1e-6);
});

test('the source hull, density levels and spoken cues match the encounter contract',()=>{
  const geometry=parseGLB(read('../../../shared/geometry/organoid/shell.glb')).primitives[0];
  assert.equal(geometry.triangles,60);
  assert.equal(gunzipSync(read('../../../shared/geometry/organoid/field-76.r8.gz')).length,material.textureSizes[0]**3);
  assert.equal(gunzipSync(read('../../../shared/geometry/organoid/density-38.r8.gz')).length,material.textureSizes[1]**3);
  assert.deepEqual([280,100,32,8,1].map(detailAt),[0,1,2,3,4]);
  assert.ok(closeSampleBudget(480)<closeSampleBudget(280));
  assert.equal(sampleOrganoidExpression('notice',.6,{}).notice,1);
  assert.equal(sampleOrganoidExpression('notice',4,{}).notice,0);
  const clips=JSON.parse(read('../assets/audio/organoid/cues.json'));
  assert.equal(config.dialogue[0].text,'Hey, listen.');
  assert.equal(config.wake.opening.text,'Wake up. Hey, listen.');
  const beats=[...config.dialogue,config.wake.opening];
  assert.ok(clips[config.tutor.call.clip],'the tutor reuses a whispered take');
  assert.deepEqual(beats.map(b=>b.id),Object.keys(clips));
  assert.ok(beats.every(b=>clips[b.id].length_s>.55));
  const ronin=config.dialogue.filter(b=>b.speaker==='Ronin');
  // Ronin only ever answers in cat: the closing line is a dismissive meow, not speech.
  assert.deepEqual(ronin.map(b=>b.vocal),['startled','question','chatter','dubious','understood','dismissive']);
  assert.ok(ronin.every(b=>/^\[[^\]]+\]$/.test(b.text) && !b.voice));
  assert.equal(ronin.at(-1).id,'depart');
  assert.equal(config.scene_enabled,false);
  assert.ok(beats.slice(1).every((b,i)=>{
    const prev=clips[beats[i].id];
    return clips[b.id].offset_s>prev.offset_s+prev.length_s;
  }));
});

test('the gondola tip fires only on a station deck, where a cabin can be boarded',()=>{
  const gondola=json('shared/activities/gondola.json');
  assert.equal(config.tutor.tips.find(t=>t.id==='gondola').radius_m,gondola.board_m);
});

test('the tutor calls only to a player settled on the ground, leaves when they fly or ride, and gives each tip once',()=>{
  const t=config.tutor, station=[0,0], far={x:500,y:0}, deck={x:3,y:0};
  const tutor=createOrganoidTutor(t,{gondola:[station]});
  const run=(seconds,grounded,onFoot=true)=>{let call=null;for(let s=0;s<seconds;s+=.05)call=tutor.update(.05,grounded,onFoot)??call;return call;};
  assert.equal(run(5,far),null,'nothing to explain far from every anchor');
  assert.equal(run(5,{x:20,y:0}),null,'walking up to a station is not enough: the tip waits for the deck');
  run(.1,null);  // a jump: no longer settled
  assert.equal(run(t.settle_s*.8,deck),null,'waits for the player to settle');
  assert.equal(run(5,null),null,'airborne, tumbling or in para-mode: never calls');
  assert.equal(run(t.settle_s+.1,deck),'call');
  assert.equal(tutor.tip.id,'gondola');
  run(t.warp_in_s+.05,deck);
  assert.equal(tutor.phase,'talk');
  run(.1,null,false);
  assert.equal(tutor.phase,'out','a launch or a ride sends it away at once');
  run(t.warp_out_s+.05,deck);
  assert.equal(tutor.phase,'idle');
  assert.equal(run(t.gap_s+t.settle_s+1,deck),null,'each tip once');
  assert.ok(tutor.seen.has('gondola'));
  const cut=createOrganoidTutor(t,{gondola:[station]});
  cut.update(t.settle_s+.1,deck,true);cut.update(.05,null,false);
  assert.equal(cut.seen.has('gondola'),false,'a tip cut off before it showed is offered again');
  const again=createOrganoidTutor(t,{'tumble-hill':[station]});
  assert.equal(again.update(t.settle_s+.1,deck,true),'call');
  assert.equal(again.tip.id,'tumble');
  again.dismiss();again.update(t.warp_out_s+.01,deck,true);again.update(.01,deck,true);
  assert.equal(again.phase,'idle');
  assert.equal(again.update(t.gap_s*.5,deck,true),null,'a gap between tips');
  assert.equal(again.update(t.gap_s,deck,true),'call');
  assert.equal(again.tip.id,'katana');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createOrganoidEncounter,organoidDeparture,sampleOrganoidExpression} from '../../../shared/npc/organoid.js';
import {createOrganoidWake} from '../src3d/organoid-wake.js';
import {closeSampleBudget,detailAt} from '../src3d/organoid-material.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {parseGLB} from '../src3d/glb.js';

const read = path => readFileSync(new URL(path,import.meta.url));
const config = JSON.parse(read('../../../shared/npc/organoid.json'));
const material = JSON.parse(read('../../../shared/geometry/organoid/material.json'));
const tree = config.cover_tree_xy_m;
const [x,y] = config.approach_xy_m;
const player = {x,y,z:145,heading:-1};

test('the authored encounter uses a real valley tree and goes around it behind the first camera plane',()=>{
  const placement=JSON.parse(read('../../../shared/world/out/placement.json'));
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
  assert.deepEqual(beats.map(b=>b.id),Object.keys(clips));
  assert.ok(beats.every(b=>clips[b.id].length_s>.55));
  const ronin=config.dialogue.filter(b=>b.speaker==='Ronin');
  assert.deepEqual(ronin.slice(0,-1).map(b=>b.vocal),['startled','question','chatter','dubious','understood']);
  assert.ok(ronin.slice(0,-1).every(b=>/^\[[^\]]+\]$/.test(b.text)));
  assert.deepEqual(ronin.at(-1),{id:'depart',speaker:'Ronin',shot:'depart',voice:'mutter',text:'Creepy chud.'});
  assert.ok(beats.slice(1).every((b,i)=>{
    const prev=clips[beats[i].id];
    return clips[b.id].offset_s>prev.offset_s+prev.length_s;
  }));
});

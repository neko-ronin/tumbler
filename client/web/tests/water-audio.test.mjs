import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nearestOnPolyline,riverVoice,createWaterVoices} from '../src3d/water-audio.js';
const read=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const worldmap=read('shared/world/worldmap.json'),habitats=read('shared/ecology/habitats.json'),aquatic=read('shared/ecology/aquatic.json');

/** A minimal Web Audio stand-in: nodes record their kind, connections, starts and parameter values. */
function fakeContext(){
 const param=()=>({value:0,setValueAtTime(v){this.value=v;},setTargetAtTime(v){this.value=v;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}});
 const c={nodes:[],sampleRate:100,currentTime:1,
  node(kind){const n={kind,outputs:[],frequency:param(),gain:param(),Q:param(),positionX:param(),positionY:param(),positionZ:param(),connect(to){this.outputs.push(to);return to;},disconnect(){},start(){this.started=true;},stop(){}};this.nodes.push(n);return n;}};
 for(const [m,k] of [['createGain','gain'],['createPanner','panner'],['createBiquadFilter','filter'],['createBufferSource','source'],['createOscillator','oscillator']])c[m]=()=>c.node(k);
 return c;
}

test('the nearest point on a line, and the river louder and brighter where it runs',()=>{
 const q=nearestOnPolyline([[0,0],[10,0],[10,10]],4,3);assert.deepEqual([q.x,q.y,q.d],[4,0,3]);
 const slow=riverVoice(.3),fast=riverVoice(2.6);
 assert.ok(fast.level>slow.level&&fast.cutoff>slow.cutoff);assert.equal(slow.rapid,0);assert.ok(fast.rapid>0,'a rapid babbles');
});

test('the water voices follow the listener: the river at its nearest point, the falls placed, lapping by the lake, a hum under',()=>{
 const c=fakeContext(),bus=c.createGain(),foley=c.createPanner(),river={level:c.createGain(),filter:c.createBiquadFilter(),panner:c.createPanner()};
 const v=createWaterVoices(c,{bus,foley,river,buffer:{}},{worldmap,habitats:habitats.habitats,rafts:aquatic.rafts});
 const line=worldmap.water.bodies.find(b=>b.kind==='river').polyline_xyz_m,p=line[60];
 v.update(1,.016,{x:p[0]+5,y:p[1],z:p[2]+2},null,0);
 assert.ok(Math.hypot(river.panner.positionX.value-p[0],-river.panner.positionZ.value-p[1])<40,'the river voice stands on the river near the listener');
 assert.ok(river.level.gain.value>.1);
 const lake=worldmap.water.bodies.find(b=>b.kind==='lake'),edge=lake.outline_xy_m[0];
 const lapLevel=()=>c.nodes.filter(n=>n.kind==='gain'&&n.outputs[0]?.kind==='panner'&&n.outputs[0].refDistance===6)[0].gain.value;
 v.update(2,.016,{x:edge[0],y:edge[1],z:31},null,0);assert.ok(lapLevel()>.05,'lapping at the shore');
 v.update(3,.016,{x:edge[0]+5000,y:edge[1],z:31},null,0);assert.equal(lapLevel(),0,'silent far from it');
 const hum=c.nodes.find(n=>n.kind==='gain'&&n.outputs.includes(bus));
 v.update(4,.016,{x:-372,y:0,z:22},null,8);assert.ok(hum.gain.value>.1,'a hum under the surface');
});

test('the swimmer splashes in, strokes, bubbles under and drips out',()=>{
 const c=fakeContext(),bus=c.createGain(),foley=c.createPanner(),river={level:c.createGain(),filter:c.createBiquadFilter(),panner:c.createPanner()};
 const v=createWaterVoices(c,{bus,foley,river,buffer:{}},{worldmap,habitats:[],rafts:[]});
 const into=kind=>c.nodes.filter(n=>n.kind===kind&&n.started).length;
 const at={x:5000,y:5000,z:0};
 v.update(1,.016,at,{mode:'ground',vz:-2},0);const before=into('source');
 v.update(1.1,.016,at,{mode:'swim',swimPhase:'wade',speed:0},0);assert.equal(into('source'),before+1,'a splash on entry');
 let n=into('source');for(let i=0;i<60;i++)v.update(1.2+i/60,1/60,at,{mode:'swim',swimPhase:'paddle',speed:1.2},0);
 assert.ok(into('source')>n,'strokes while paddling');
 n=into('oscillator');for(let i=0;i<60;i++)v.update(3+i/60,1/60,at,{mode:'swim',swimPhase:'dive',speed:3,under:true},0);
 assert.ok(into('oscillator')>n+1,'bubbles under');
 n=into('oscillator');v.update(5,.016,at,{mode:'ground'},0);assert.equal(into('oscillator'),n+5,'drips on the way out');
});

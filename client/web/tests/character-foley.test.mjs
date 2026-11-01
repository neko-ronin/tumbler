import test from 'node:test';
import assert from 'node:assert/strict';
import {createFoleyEvents,createFoleyPlayer,FOLEY_CUES} from '../src3d/character-foley.js';
import {createCuePlayer,createBladeResonance,createSoundscape} from '../src3d/audio.js';

const base={mode:'walk',activity:'ground',x:0,y:0,z:0,speed:1,grounded:true,feet:['L'],bark:[],surface:'grass',clip:'walk',cycle:0};
function observe(){const events=[],tracker=createFoleyEvents(n=>events.push(n));let state={...base};tracker.update(state,.05);return {events,step(patch){state={...state,x:state.x+.05,...patch};tracker.update(state,.05);},tracker};}
test('footsteps follow newly planted feet, remain quiet at idle/in air and do not replay on spawn or teleport',()=>{
 const a=observe();assert.deepEqual(a.events,[]);a.step({feet:[]});a.step({feet:['R']});a.step({});assert.deepEqual(a.events,['step_grass']);
 a.step({feet:[],grounded:false});a.step({feet:['L'],grounded:false});assert.deepEqual(a.events,['step_grass']);
 a.step({x:100,grounded:true,feet:['R']});assert.equal(a.events.length,1);
 a.step({speed:0,feet:[]});a.step({speed:0,feet:['L']});assert.equal(a.events.length,1);
});
test('landings are transitions, harness changes do not invent steps, and selecting another site is silent',()=>{
 const a=observe();a.step({grounded:false,feet:[]});a.step({grounded:true});a.step({});assert.deepEqual(a.events,['land']);
 a.step({mode:'paraglider',activity:undefined});assert.equal(a.events.at(-1),'harness');
 a.step({mode:'walk',activity:'ground',x:500});assert.equal(a.events.filter(n=>n==='harness').length,1);
});
test('climbing uses new bark holds, not elapsed time or an idle grip',()=>{
 const a=observe();a.step({activity:'climb',grounded:false,bark:['L']});a.step({bark:[]});a.step({bark:['R']});
 for(let i=0;i<30;i++)a.step({x:0.15,bark:['R']});assert.equal(a.events.filter(n=>n==='climb').length,1);
});
test('surface strokes track animation half-cycles, dives suppress airy splashes, water crossings debounce',()=>{
 const a=observe();a.step({activity:'swim',grounded:false,swimPhase:'paddle',clip:'swim_paddle'});assert.equal(a.events[0],'wade');
 a.step({cycle:1});a.step({cycle:1});assert.equal(a.events.filter(n=>n==='swim').length,1);
 a.step({swimPhase:'dive',cycle:2});assert.equal(a.events.filter(n=>n==='swim').length,1);
});
function audio(){
 const sources=[],params=[],nodes=[];
 const param=()=>({value:0,setValueAtTime(v,t){assert.ok(Number.isFinite(v)&&Number.isFinite(t));params.push(v);},linearRampToValueAtTime(v){assert.ok(Number.isFinite(v));},exponentialRampToValueAtTime(v){assert.ok(v>0);},setTargetAtTime(){}});
 const node=()=>{const n={gain:param(),frequency:param(),Q:param(),connections:[],disconnect(){this.connections=[];},connect(x){this.connections.push(x);return x;}};nodes.push(n);return n;};
 const source=()=>{const s=Object.assign(node(),{start(t=0){assert.ok(t>=0);},stop(t){assert.ok(t>0);this.stoppedAt=t;},onended:null});sources.push(s);return s;};
 return {sources,nodes,params,sampleRate:8000,currentTime:0,state:'running',listener:{},resume(){this.state='running';return Promise.resolve();},suspend(){this.state='suspended';return Promise.resolve();},close(){return Promise.resolve();},destination:node(),createGain:node,createConvolver:node,createPanner:()=>Object.assign(node(),{positionX:param(),positionY:param(),positionZ:param()}),createBiquadFilter:node,createBufferSource:()=>Object.assign(source(),{kind:'buffer'}),createOscillator:()=>Object.assign(source(),{kind:'oscillator'}),createBuffer:()=>({getChannelData:()=>new Float32Array(8000)})};
}
test('all approved cues schedule finite envelopes; completed sources release their output graphs',()=>{
 for(const name of FOLEY_CUES){const c=audio(),play=createFoleyPlayer(c);assert.equal(play(name),true,name);assert.ok(c.sources.length>0,name);for(const s of c.sources)s.onended();assert.ok(c.nodes.every(n=>!n.connections.length),name);}
});
test('cue groups are bounded, recover after completion and do not consume unknown names',()=>{
 const c=audio(),play=createFoleyPlayer(c);assert.equal(play('not-a-cue'),false);
 for(let i=0;i<100;i++)play('land');assert.equal(c.sources.length,12*4);
 for(const s of [...c.sources])s.onended();play('land');assert.equal(c.sources.length,13*4);
});
test('retained katana cues still schedule and release all connected nodes after their tails',()=>{
 for(const name of ['latch','eject','slide','lock','extend_complete','swish','swish_heavy','spin','charge']){
  const c=audio(),play=createCuePlayer(c);play(name);assert.ok(c.sources.length>0,name);for(const s of c.sources)s.onended();assert.ok(c.nodes.every(n=>!n.connections.length),name);
 }
});

test('only completed extension rings, at 20% level; old ring/flick/cleave hum are silent',()=>{
 const c=audio(),play=createBladeResonance(c);
 for(const cue of ['ring','flick','hum'])assert.equal(play(cue),true);assert.equal(c.sources.length,0);
 play('extend_complete');assert.equal(c.sources[0].frequency.value,2790);assert.ok(c.sources[0].stoppedAt>3.4);
 assert.equal(c.nodes.find(n=>n.connections.includes(c.destination)).gain.value,.2);
 for(let i=0;i<100;i++)play('extend_complete');assert.equal(c.sources.length,8*3);
 for(const source of [...c.sources])source.onended();play('extend_complete');assert.equal(c.sources.length,9*3);
 for(const source of c.sources.slice(24))source.onended();assert.ok(c.nodes.every(n=>!n.connections.length));
});
test('locomotion is halved while sword catch, seat and impact retain their level',()=>{
 for(const cue of FOLEY_CUES){const c=audio();createFoleyPlayer(c)(cue);const output=c.nodes.find(n=>n.connections.includes(c.destination));assert.equal(output.gain.value,['catch','seat','impact'].includes(cue)?1:.5,cue);}
});
test('sword latch, locks and light swish retain physical air/clicks without tonal bells',()=>{
 for(const cue of ['latch','lock','swish']){const c=audio();createCuePlayer(c)(cue);assert.ok(c.sources.some(n=>n.kind==='buffer'));assert.ok(c.sources.every(n=>n.kind!=='oscillator'),cue);}
 for(const cue of ['ring','flick','hum']){const c=audio();createCuePlayer(c)(cue);assert.equal(c.sources.length,0,cue);}
});

test('approved recorded charge uses the exact provided buffer and reviewed gain, with bounded overlap',()=>{
 const c=audio(),buffer={duration:.68},play=createCuePlayer(c,c.destination,buffer);
 for(let i=0;i<30;i++)play('charge');assert.equal(c.sources.length,4);
 for(const source of c.sources){assert.equal(source.buffer,buffer);assert.equal(source.connections[0].gain.value,.5);}
 for(const source of [...c.sources])source.onended();play('charge');assert.equal(c.sources.length,5);c.sources.at(-1).onended();assert.ok(c.nodes.every(n=>!n.connections.length));
});

test('charge decoding completes before cues are installed, honors a mute during load, and plays only when enabled',async()=>{
 const original=globalThis.AudioContext,c=audio(),buffer={duration:.68};let finishDecode;
 c.decodeAudioData=()=>new Promise(resolve=>{finishDecode=()=>resolve(buffer);});
 globalThis.AudioContext=class {constructor(){return c;}};
 try{
  const sound=createSoundscape({habitats:[]},new Float32Array(0),new ArrayBuffer(4)),loading=sound.toggle(true);
  assert.doesNotThrow(()=>sound.update(null,null));await sound.toggle(false);finishDecode();assert.equal(await loading,false);assert.equal(c.state,'suspended');
  sound.cue('charge');assert.equal(c.sources.filter(s=>s.buffer===buffer).length,0);
  await sound.toggle(true);sound.cue('charge');assert.equal(c.sources.filter(s=>s.buffer===buffer).length,1);sound.dispose();
 }finally{globalThis.AudioContext=original;}
});

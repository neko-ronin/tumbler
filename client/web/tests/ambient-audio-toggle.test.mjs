import test from 'node:test';
import assert from 'node:assert/strict';
import {createSoundscape} from '../src3d/audio.js';
function audioFixture(t){
 const saved=Object.getOwnPropertyDescriptor(globalThis,'AudioContext');let context;
 const param=()=>({value:0,setValueAtTime(v){this.value=v;},setTargetAtTime(v,time,ramp){this.value=v;this.ramp=ramp;},cancelScheduledValues(){},linearRampToValueAtTime(v){this.value=v;},exponentialRampToValueAtTime(v){this.value=v;}});
 class Context{
  constructor(){context=this;this.nodes=[];this.sampleRate=100;this.currentTime=1;this.listener={};this.state='suspended';this.destination=this.node('destination');}
  node(kind){const n={kind,outputs:[],frequency:param(),gain:param(),Q:param(),pan:param(),positionX:param(),positionY:param(),positionZ:param(),loop:false,connect(to){this.outputs.push(to);return to;},disconnect(){},start(){},stop(){}};this.nodes.push(n);return n;}
  createGain(){return this.node('gain');}createStereoPanner(){return this.node('stereo-panner');}createPanner(){return this.node('panner');}createBiquadFilter(){return this.node('filter');}createConvolver(){return this.node('convolver');}createBufferSource(){return this.node('source');}createOscillator(){return this.node('oscillator');}
  createBuffer(channels,length){const arrays=Array.from({length:channels},()=>new Float32Array(length));return {getChannelData:i=>arrays[i]};}
  async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}
 }
 Object.defineProperty(globalThis,'AudioContext',{value:Context,configurable:true});
 t.after(()=>saved?Object.defineProperty(globalThis,'AudioContext',saved):delete globalThis.AudioContext);
 const sound=createSoundscape({habitats:[{centre_m:[0,0,0]}]});t.after(()=>sound.dispose());
 return {sound,get context(){return context;}};
}
function reaches(from,target,seen=new Set()){
 if(from===target)return true;if(seen.has(from))return false;seen.add(from);return from.outputs.some(n=>reaches(n,target,seen));
}
test('wind and water wait for the first positioned update, then fade in together',async t=>{
 const f=audioFixture(t);await f.sound.toggle(true);const c=f.context;
 const water=c.nodes.find(n=>n.kind==='panner'&&n.refDistance===10),bus=water.outputs[0];
 const wind=c.nodes.find(n=>n.kind==='filter'&&n.frequency.value===550);
 assert.equal(wind.outputs[0].outputs[0],bus);
 assert.equal(bus.gain.value,0,'the loading screen must not play river and wind at the unpositioned origin');
 f.sound.update({position:{x:180,y:40,z:0}},{mode:'walk',state:{x:0,y:0,z:0}});
 assert.equal(bus.gain.value,1,'the first positioned scene update raises the ambience');
 assert.ok(bus.gain.ramp>.1,'the ambience fades in instead of popping');
});
test('wind and water alone share the mute bus; cues, birds, insects, motor and vario and para layers bypass it',async t=>{
 const f=audioFixture(t);await f.sound.toggle(true);const c=f.context;
 const water=c.nodes.find(n=>n.kind==='panner'&&n.refDistance===10),bus=water.outputs[0];
 const wind=c.nodes.find(n=>n.kind==='filter'&&n.frequency.value===550);
 assert.equal(wind.outputs[0].outputs[0],bus);
 const unaffected=[...c.nodes.filter(n=>n.kind==='panner'&&[1.5,5].includes(n.refDistance)),c.nodes.find(n=>n.kind==='oscillator'&&n.frequency.value===85),c.nodes.find(n=>n.kind==='oscillator'&&n.frequency.value===700),c.nodes.find(n=>n.kind==='convolver')];
 assert.equal(unaffected.length,7);
 const para=c.nodes.filter(n=>n.kind==='filter'&&((n.type==='bandpass'&&[1400,180].includes(n.frequency.value))||(n.type==='highpass'&&n.frequency.value===1800)));
 assert.equal(para.length,3);unaffected.push(...para);
 for(const n of unaffected){assert.ok(reaches(n,c.destination));assert.ok(!reaches(n,bus),`${n.kind} must bypass the wind/water mute`);}
 f.sound.update({position:{x:0,y:5,z:0}},{mode:'walk',state:{x:0,y:0,z:0}});assert.equal(bus.gain.value,1,'the first scene update starts the ambience');
 f.sound.setWindWaterEnabled(false);assert.equal(bus.gain.value,0);assert.equal(bus.gain.ramp,.03);assert.equal(c.state,'running');
 const start=c.nodes.length;f.sound.cue('step_grass');const cues=c.nodes.slice(start).filter(n=>n.kind==='source'||n.kind==='oscillator');assert.ok(cues.length);
 for(const cue of cues){assert.ok(reaches(cue,c.destination));assert.ok(!reaches(cue,bus));}
 f.sound.update({position:{x:0,y:5,z:0}},{mode:'walk',state:{x:0,y:0,z:0}});assert.equal(bus.gain.value,0,'scene updates cannot undo the mute');
 f.sound.setWindWaterEnabled(true);assert.equal(bus.gain.value,1);
});
test('muting before audio starts is retained through master sound off/on',async t=>{
 const f=audioFixture(t);f.sound.setWindWaterEnabled(false);await f.sound.toggle(true);
 const c=f.context,bus=c.nodes.find(n=>n.kind==='panner'&&n.refDistance===10).outputs[0];assert.equal(bus.gain.value,0);
 await f.sound.toggle(false);assert.equal(c.state,'suspended');await f.sound.toggle(true);assert.equal(c.state,'running');assert.equal(bus.gain.value,0);assert.equal(f.sound.windWaterEnabled,false);
 await f.sound.toggle(false);f.sound.setWindWaterEnabled(true);assert.equal(c.state,'suspended','the ambience control cannot override master mute');
 await f.sound.toggle(true);
 f.sound.update({position:{x:0,y:5,z:0}},{mode:'walk',state:{x:0,y:0,z:0}});assert.equal(bus.gain.value,1,'sound on reaches the scene, which then fades the ambience in');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePacer,WEB_FRAME_MS} from '../src3d/frame-pacing.js';
import {createResolutionGovernor} from '../src3d/flight-quality.js';

test('render cap holds across common refresh rates without catch-up bursts',()=>{
 for(const hz of [30,60,90,120,144,165,240]){
  const p=createFramePacer(),draws=[];
  for(let i=0;i<hz*6;i++){const time=Math.round(i*1000/hz*10)/10;if(p.due(time))draws.push(time);}
  assert.ok(draws.length<=181,`${hz} Hz exceeds 30 rendered frames/second`);
  assert.ok(draws.length>=179,`${hz} Hz unnecessarily starves the renderer`);
  const quantizedMinimum=Math.floor(WEB_FRAME_MS*hz/1000+1e-9)*1000/hz;
  for(let i=1;i<draws.length;i++)assert.ok(draws[i]-draws[i-1]>=quantizedMinimum-.2,'healthy frames follow whole display refreshes');
 }
 const p=createFramePacer();assert.ok(p.due(0));assert.ok(p.due(100));assert.equal(p.due(116.7),false);assert.ok(p.due(133.3));
 p.reset();assert.ok(p.due(1000),'visibility/context resume must render immediately');
});

test('a healthy capped renderer remains sharp instead of repeatedly trying lower resolution',()=>{
 const q=createResolutionGovernor({frameBudgetMs:WEB_FRAME_MS});
 for(let time=3000;time<180000;time+=3000)assert.equal(q.sample(33.8,time),1);
 const overloaded=createResolutionGovernor({frameBudgetMs:WEB_FRAME_MS});
 assert.equal(overloaded.sample(55,3000),.9);assert.equal(overloaded.sample(55,9000),1,'unchanged pacing rejects a pointless blur trial');
});

test('small display timestamp jitter does not turn a 30 FPS target into 26 FPS',()=>{
 const p=createFramePacer();let frames=0;
 for(let i=0;i<360;i++)if(p.due(i*1000/60+Math.sin(i*1.7)*.8))frames++;
 assert.ok(frames>=175,`healthy 60 Hz display only rendered ${frames}/180 target frames`);
 assert.ok(frames<=181);
});

test('the target phase survives display jitter and non-integer refresh ratios',()=>{
 for(const [hz,jitter]of [[60,1.2],[120,1.2],[144,0],[165,0]]){
  const p=createFramePacer(),draws=[];
  for(let i=0;i<hz*10;i++){const time=i*1000/hz+Math.sin(i*1.7)*jitter;if(p.due(time))draws.push(time);}
  assert.ok(draws.length>=298,`${hz} Hz with ${jitter} ms jitter renders ${draws.length}/300 target frames`);
  assert.ok(draws.length<=301,`${hz} Hz exceeds the existing 30 FPS target`);
 }
});

test('a missed refresh drops the delayed slot without a short catch-up frame',()=>{
 const p=createFramePacer();assert.ok(p.due(0));assert.equal(p.due(16.7),false);
 assert.ok(p.due(50));assert.equal(p.due(66.7),false);assert.ok(p.due(83.3));
});

test('phase correction never exceeds 31 draws in a closed one-second window',()=>{
 for(const hz of [30,60,90,120,144,165,240]){
  const p=createFramePacer(),draws=[];
  for(let i=0;i<hz*12;i++){const time=i*1000/hz+Math.sin(i*1.7)*1.2;if(p.due(time))draws.push(time);}
  let first=0;
  for(let i=0;i<draws.length;i++){
   while(draws[i]-draws[first]>1000)first++;
   assert.ok(i-first+1<=31,`${hz} Hz exceeds the capped rate`);
  }
 }
});

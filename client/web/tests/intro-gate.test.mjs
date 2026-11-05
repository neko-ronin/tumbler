import test from 'node:test';
import assert from 'node:assert/strict';
import {createFramePacer,WEB_FRAME_MS} from '../src3d/frame-pacing.js';
import {createIntroGate,introCalm,INTRO_WINDOW,INTRO_MIN_DWELL_S,INTRO_MAX_WAIT_S} from '../src3d/intro-gate.js';

// Callback times as a display delivers them: whole refreshes, with an optional
// per-callback cost that pushes the next one out by as many refreshes as the
// work takes. That is what makes a late draw a *dropped pacer slot* rather than
// a long delta, and it is the shape the gate has to survive.
function callbacks({hz=60,seconds=10,cost=()=>0,signal=()=>0}){
 const refresh=1000/hz,times=[];
 for(let i=0,t=0;t<=seconds*1000&&i<20000;i++){
  times.push(Math.round((t+signal(i))*1000)/1000);
  t=Math.max(t+refresh,Math.ceil((t+cost(i,t))/refresh-1e-9)*refresh);
 }
 return times;
}

// The half of animate() that matters here: the pacer picks the drawn callbacks,
// `samples` records their intervals, and the gate judges that array.
function run(times,gate){
 const pacer=createFramePacer(),samples=[],steps=[];
 let last=0,release=null;
 for(const time of times){
  if(!pacer.due(time))continue;
  const delta=last?time-last:0;last=time;
  if(delta>0&&delta<500){samples.push(delta);if(samples.length>240)samples.shift();}
  const verdict=gate.step(time,samples);
  steps.push({time,verdict,calm:gate.last.calm,median:gate.last.median,window:gate.last.window,inside:gate.last.inside});
  if(verdict==='go'){release=time;break;}
 }
 return {release,steps,samples,state:gate.last};
}

test('waits while the interval window is still noisy and releases once it is calm',()=>{
 // 20 / 90 / 45 / 120 ms of work per callback for six seconds, then a clean
 // cadence: exactly the first-use work that used to land inside the shot.
 const gate=createIntroGate({startMs:0,minDwellS:INTRO_MIN_DWELL_S,maxWaitS:20});
 const {release,steps}=run(callbacks({seconds:12,cost:(i,t)=>t<6000?[20,90,45,120][i%4]:0}),gate);
 assert.ok(release!==null,'a cadence that settles must eventually start the shot');
 assert.equal(steps.filter(s=>s.verdict==='go'&&s.time<6000).length,0,`released at ${release} ms while the cadence was still shifting`);
 assert.ok(steps.some(s=>s.time>INTRO_MIN_DWELL_S*1000&&s.verdict==='wait'),'it must hold past the minimum dwell while noisy');
 assert.ok(release>=6000&&release<9000,`released at ${release} ms`);
});

test('never releases before the minimum dwell even when the cadence is calm at once',()=>{
 const gate=createIntroGate({startMs:0,minDwellS:INTRO_MIN_DWELL_S,maxWaitS:20});
 const {release,steps,state}=run(callbacks({seconds:4}),gate);
 assert.equal(steps.filter(s=>s.verdict==='go'&&s.time<INTRO_MIN_DWELL_S*1000).length,0,'the establishing beat is a floor, not a target');
 assert.ok(release>=INTRO_MIN_DWELL_S*1000,`released at ${release} ms`);
 assert.ok(release<INTRO_MIN_DWELL_S*1000+150,`released at ${release} ms, far past the dwell on a healthy cadence`);
 assert.equal(state.calm,true);
 assert.equal(gate.releasedAtMs,release);
});

test('a healthy client opens the shot at the dwell on every common refresh rate',()=>{
 // The pacer emits 40.0 / 26.7 ms alternately at 75 Hz, 36.4 / 30.3 at 165 Hz
 // and 34.7 with a 27.8 catch frame at 144 Hz. Uneven one at a time, even in
 // total, and no frame dropped: each must read as calm, or a healthy display
 // waits out the whole ceiling for a jitter that is not there.
 for(const hz of [30,60,75,90,120,144,165,240]){
  const gate=createIntroGate({startMs:0});
  const {release,state}=run(callbacks({hz,seconds:5}),gate);
  assert.equal(state.calm,true,`${hz} Hz read as unsettled: median ${state.median}, mean ${state.mean}, ${state.inside}/${state.window} in band`);
  assert.ok(release>=INTRO_MIN_DWELL_S*1000&&release<INTRO_MIN_DWELL_S*1000+250,`${hz} Hz released at ${release} ms`);
 }
});

test('display timestamp jitter does not read as an unsettled cadence',()=>{
 for(const hz of [60,120,144,165]){
  const gate=createIntroGate({startMs:0});
  const {release,state}=run(callbacks({hz,seconds:5,signal:i=>Math.sin(i*1.7)*.8}),gate);
  assert.equal(state.calm,true,`${hz} Hz with timestamp jitter`);
  assert.ok(release<INTRO_MIN_DWELL_S*1000+300,`${hz} Hz released at ${release} ms`);
 }
});

test('the ceiling releases the shot even when the cadence never calms',()=>{
 const gate=createIntroGate({startMs:0,minDwellS:INTRO_MIN_DWELL_S,maxWaitS:INTRO_MAX_WAIT_S});
 const {release,state}=run(callbacks({seconds:12,cost:(i,t)=>t<12000?[20,90,45,120][i%4]:0}),gate);
 assert.ok(release!==null,'a shifting machine must still reach the walk view');
 assert.ok(release>=INTRO_MAX_WAIT_S*1000&&release<INTRO_MAX_WAIT_S*1000+250,`released at ${release} ms`);
 assert.equal(state.calm,false);
});

test('a throttled 133 ms cadence settles instead of hanging',()=>{
 // This shared host draws at about 133 ms: three dropped slots every frame. A
 // steady slow rate is calm, because waiting for 30 FPS it will never reach
 // would only hold the player in a still frame.
 const gate=createIntroGate({startMs:0});
 const {release,state}=run(callbacks({hz:60,seconds:10,cost:()=>133}),gate);
 assert.ok(release!==null,'a steady 7.5 FPS machine must still get the shot');
 assert.ok(release>=INTRO_MIN_DWELL_S*1000&&release<4000,`released at ${release} ms`);
 assert.ok(Math.abs(state.median-1000/7.5)<1,`median ${state.median}`);
 assert.equal(state.calm,true);
});

test('a dropped pacer slot does not stall the gate',()=>{
 // One 60 ms draw every fifty callbacks: the pacer drops the missed slot, so it
 // arrives as a 66.7 ms interval. Two of those in a window are tolerated, or no
 // real machine would ever open the gate.
 const gate=createIntroGate({startMs:0,maxWaitS:20});
 const {release,state}=run(callbacks({seconds:8,cost:i=>i%50===25?60:0}),gate);
 assert.ok(release!==null,'one skipped slot must not keep the gate shut');
 assert.ok(release<INTRO_MAX_WAIT_S*1000,`released at ${release} ms, so the skip pushed it to the ceiling`);
 assert.equal(state.calm,true);
 assert.ok(state.inside>=INTRO_WINDOW-2,`${state.inside}/${INTRO_WINDOW} inside the band`);
});

test('three skipped slots in the window are still an unsettled cadence',()=>{
 // The allowance is two, not "any number": a third skipped slot in 24 means an
 // eighth of the shot's opening second was dropped.
 const gate=createIntroGate({startMs:0,maxWaitS:INTRO_MAX_WAIT_S});
 const {release,state}=run(callbacks({seconds:10,cost:i=>i%8===4?60:0}),gate);
 assert.ok(release!==null);
 assert.equal(state.calm,false);
 assert.ok(release>=INTRO_MAX_WAIT_S*1000,`released at ${release} ms, so three skips were read as calm`);
});

test('a short window is not evidence of calm',()=>{
 const steady=Array.from({length:INTRO_WINDOW-1},()=>WEB_FRAME_MS);
 const gate=createIntroGate({startMs:0,minDwellS:INTRO_MIN_DWELL_S,maxWaitS:20});
 assert.equal(introCalm(steady).calm,false);
 assert.equal(gate.step(5000,steady),'wait','the dwell is met but the window is not full');
 assert.equal(gate.step(5000,[...steady,WEB_FRAME_MS]),'go');
});

test('only the recent window counts, so old noise cannot keep the shot shut',()=>{
 const noisy=Array.from({length:240},(_,i)=>i%2?20:90);
 const gate=createIntroGate({startMs:0,minDwellS:INTRO_MIN_DWELL_S,maxWaitS:20});
 assert.equal(gate.step(3500,noisy),'wait');
 const calm=[...noisy,...Array.from({length:INTRO_WINDOW},()=>WEB_FRAME_MS+0.05)];
 assert.equal(gate.step(3500,calm),'go');
});

test('the gate reports the numbers it judged on',()=>{
 const gate=createIntroGate({startMs:0});
 const window=[...Array.from({length:INTRO_WINDOW-1},()=>WEB_FRAME_MS),66.7];
 assert.equal(gate.step(4000,window),'go');
 assert.equal(gate.last.window,INTRO_WINDOW);
 assert.ok(Math.abs(gate.last.median-WEB_FRAME_MS)<.01,`median ${gate.last.median}`);
 assert.ok(Math.abs(gate.last.band-WEB_FRAME_MS*.18)<.01,`band ${gate.last.band}`);
 assert.equal(gate.last.inside,INTRO_WINDOW-1);
 assert.equal(gate.last.steady,true);
 assert.equal(gate.last.elapsedS,4);
 assert.equal(gate.releasedAtMs,4000);
});

test('a wild alternation the mean cannot see is still not calm',()=>{
 // The target-rate half is not a loophole: a 5 / 61 ms alternation averages to
 // 30 FPS while no two frames are alike, so the longest-interval bound refuses it.
 const wild=Array.from({length:INTRO_WINDOW},(_,i)=>i%2?5:61);
 assert.deepEqual([introCalm(wild).calm,introCalm(wild).onRate,introCalm(wild).steady],[false,false,false]);
 const gate=createIntroGate({startMs:0,maxWaitS:INTRO_MAX_WAIT_S});
 assert.equal(gate.step(4000,wild),'wait');
 assert.equal(gate.step(INTRO_MAX_WAIT_S*1000,wild),'go');
});

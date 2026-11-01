/** Browser sound presentation, approved in round 01. Physical state and contact
 * data come from the core/animated puppet; this module never changes movement.
 * See docs/design/CHARACTER-AUDIO.md before changing its style.
 */
export const FOLEY_CUES=new Set(['grunt1','grunt2','grunt3','catch','seat','land','impact','step_grass','step_gravel','step_stone','step_wood','step_snow','cloth','climb','swim','wade','harness']);

const MOVEMENT_CUES=new Set([...FOLEY_CUES].filter(name=>!['catch','seat','impact'].includes(name)));

/** Reviewed B textures, sharing one noise buffer. All sources stop and disconnect;
 * a bounded set of cue groups prevents long-session accumulation. */
export function createFoleyPlayer(context,destination=context.destination){
  const noise=context.createBuffer(1,context.sampleRate,context.sampleRate),d=noise.getChannelData(0);
  for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const groups=new Set();
  return function play(name){
    if(!FOLEY_CUES.has(name))return false;
    if(groups.size>=12)return true;
    const t=context.currentTime,out=context.createGain(),sources=new Set(),nodes=[out];out.gain.value=MOVEMENT_CUES.has(name)?.5:1;out.connect(destination);groups.add(out);
    function track(source){sources.add(source);source.onended=()=>{sources.delete(source);source.disconnect();if(!sources.size){for(const n of nodes)n.disconnect();groups.delete(out);}};}
    function air(dur,hz,gain,delay=0,type='bandpass',q=.7){
      const source=context.createBufferSource(),f=context.createBiquadFilter(),g=context.createGain(),at=t+delay;nodes.push(f,g);track(source);
      source.buffer=noise;f.type=type;f.frequency.value=hz;f.Q.value=q;
      g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+Math.min(.025,dur/4));g.gain.exponentialRampToValueAtTime(.0001,at+dur);
      source.connect(f).connect(g).connect(out);source.start(at);source.stop(at+dur+.01);
    }
    function body(dur,hz,gain,delay=0){
      const source=context.createOscillator(),g=context.createGain(),at=t+delay;nodes.push(g);track(source);source.type='sine';source.frequency.value=hz;
      g.gain.setValueAtTime(0,at);g.gain.linearRampToValueAtTime(gain,at+.003);g.gain.exponentialRampToValueAtTime(.0001,at+dur);
      source.connect(g).connect(out);source.start(at);source.stop(at+dur+.01);
    }
    const cloth=(g=.018)=>{air(.18,1000,g);air(.12,2700,g*.35,.035);};
    const tick=(g=.04,metal=true)=>{air(.028,2200,g);if(metal)body(.045,920,g*.22);};
    if(name.startsWith('grunt')){const k=Number(name.at(-1));air(.13+k*.025,730,.025+k*.011);air(.09+k*.02,1450,.009+k*.004,.012);cloth(.008);}
    else if(name==='catch'){air(.06,450,.07);body(.055,180,.022);cloth(.012);}
    else if(name==='seat'){tick(.03,false);body(.075,240,.025);cloth(.014);}
    else if(name==='impact'){air(.09,1100,.085);air(.13,340,.075);body(.15,125,.04);}
    else if(name==='land'){air(.12,380,.065);body(.085,130,.025);cloth(.025);}
    else if(name==='step_grass'){air(.09,650,.042);air(.13,2100,.014,.01);body(.05,160,.01);}
    else if(name==='step_gravel'){air(.08,900,.032);for(let i=0;i<5;i++)air(.018,1800+i*340,.012,Math.random()*.075);body(.045,180,.009);}
    else if(name==='step_stone'){air(.04,950,.04);body(.047,230,.02);air(.08,2300,.006,.01);}
    else if(name==='step_wood'){body(.065,320,.022);body(.04,710,.006);air(.04,900,.022);}
    else if(name==='step_snow'){air(.18,1300,.035);air(.10,2900,.012,.02);body(.065,170,.008);}
    else if(name==='cloth')cloth(.025);
    else if(name==='climb'){air(.09,1200,.03);air(.12,2400,.01,.035);cloth(.014);}
    else if(name==='swim'){air(.23,650,.04);for(let i=0;i<4;i++)body(.025,280+Math.random()*500,.007,.025+i*.035);}
    else if(name==='wade'){air(.35,550,.06);air(.18,1700,.016,.025);for(let i=0;i<6;i++)body(.028,220+Math.random()*650,.006,.04+i*.035);}
    else if(name==='harness'){air(.12,800,.024);tick(.017);air(.15,1500,.012,.06);}
    return true;
  };
}

/** Contact/transition observer. No timer-driven footsteps or climbing scratches.
 * `feet` and `bark` are currently planted animated contacts; swim phase follows
 * the actual paddle clip. Mode changes/spawn/teleport establish a fresh baseline.
 */
export function createFoleyEvents(emit){
  let before=null,clock=0,lastCloth=-Infinity,lastWater=-Infinity,lastLand=-Infinity;
  return {reset(){before=null;},update(s,dt){
    clock+=Math.max(0,Math.min(.05,dt||0));
    const previous=before;before={...s,feet:[...(s.feet??[])],bark:[...(s.bark??[])]};
    if(!previous||Math.hypot(s.x-previous.x,s.y-previous.y,s.z-previous.z)>6)return;
    const flight=mode=>['paraglider','parakite','paramotor'].includes(mode);
    const harnessTransition=s.mode!==previous.mode&&((s.mode==='walk'&&flight(previous.mode))||(flight(s.mode)&&previous.mode==='walk'));
    if(harnessTransition)emit('harness');
    const walking=s.mode==='walk',wasWalking=previous.mode==='walk';
    const water=walking&&s.activity==='swim',wasWater=wasWalking&&previous.activity==='swim';
    if(walking&&wasWalking&&water!==wasWater&&clock-lastWater>.5){emit('wade');lastWater=clock;}
    const landed=s.grounded&&!previous.grounded&&(walking&&wasWalking||flight(s.mode)&&s.mode===previous.mode);
    if(landed&&!water&&!wasWater&&s.activity!=='climb'&&clock-lastLand>.25){emit('land');lastLand=clock;}
    // A resumed mode has no inherited planted-foot edges.
    if(!walking||!wasWalking||s.activity!==previous.activity)return;
    const distance=Math.hypot(s.x-previous.x,s.y-previous.y,s.z-previous.z),moving=distance>.0001;
    if(moving&&s.speed>.05&&s.grounded&&!water){
      for(const foot of s.feet??[])if(!(previous.feet??[]).includes(foot))emit('step_'+s.surface);
    }
    if(moving&&s.activity==='climb'&&(s.bark??[]).some(paw=>!(previous.bark??[]).includes(paw)))emit('climb');
    if(moving&&water&&s.swimPhase==='paddle'&&previous.swimPhase==='paddle'&&s.clip===previous.clip&&s.cycle!==previous.cycle)emit('swim');
    if(moving&&water&&s.swimPhase==='wade'&&s.cycle!==previous.cycle&&clock-lastWater>.35){emit('wade');lastWater=clock;}
    if(moving&&clock-lastCloth>.6&&(Math.abs(s.turnRate??0)>.65||Math.abs(s.accel??0)>2)){emit('cloth');lastCloth=clock;}
  }};
}

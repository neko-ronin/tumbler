import {createParaVoice} from './para-audio.js';
import {createFoleyPlayer} from './character-foley.js';

/** Browser presentation of the existing habitats, wind and flight motor.
 * Original procedural sound, enabled by default and resumed after the first user gesture if autoplay is blocked.
 */
export function createSoundscape(habitats,trees=new Float32Array(0),chargeBytes=null){
  let context=null,birds=null,beeVoices=[],water=null,motor=null,wind=null,vario=null,cues=null,characterBus=null,paraVoice=null,windWaterBus=null,windWaterEnabled=true,enabled=true;
  async function toggle(next=!enabled){
    enabled=next;
    if(!context){
      context=new AudioContext();
      let chargeBuffer=null;
      try{if(chargeBytes)chargeBuffer=await context.decodeAudioData(chargeBytes.slice(0));}
      catch(error){const failed=context;context=null;await failed.close();throw error;}
      const length=context.sampleRate*3;
      const buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);
      let last=0;for(let i=0;i<length;i++){last=(last+(Math.random()*2-1)*.02)/1.02;data[i]=last*3.5;}
      characterBus=context.createPanner();characterBus.panningModel='HRTF';characterBus.distanceModel='inverse';characterBus.refDistance=5;characterBus.rolloffFactor=1;characterBus.maxDistance=100;characterBus.connect(context.destination);
      cues=createCuePlayer(context,characterBus,chargeBuffer);birds=createBirds(context,createTreeIndex(trees));beeVoices=Array.from({length:3},()=>createBeeVoice(context));
      windWaterBus=context.createGain();windWaterBus.gain.value=windWaterEnabled?1:0;windWaterBus.connect(context.destination);
      function noise(frequency,gain,spatial=false){const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
        const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=frequency;
        const level=context.createGain();level.gain.value=gain;source.connect(filter).connect(level);
        let panner=null;if(spatial){panner=context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=10;panner.maxDistance=260;level.connect(panner).connect(windWaterBus);}else level.connect(windWaterBus);
        source.start();return {source,filter,level,panner};}
      const tone=context.createOscillator(),toneLevel=context.createGain();tone.type='sine';tone.frequency.value=700;toneLevel.gain.value=0;tone.connect(toneLevel).connect(context.destination);tone.start();vario={tone,level:toneLevel};
      wind=noise(550,.08);water=noise(1400,.3,true);paraVoice=createParaVoice(context);
      const oscillator=context.createOscillator();oscillator.type='sawtooth';oscillator.frequency.value=85;const level=context.createGain();level.gain.value=0;const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=350;oscillator.connect(filter).connect(level).connect(context.destination);oscillator.start();motor={oscillator,level};
    }
    await (enabled?context.resume():context.suspend());return enabled;
  }
  function setWindWaterEnabled(value){
    windWaterEnabled=!!value;
    if(windWaterBus){const t=context.currentTime;windWaterBus.gain.cancelScheduledValues(t);windWaterBus.gain.setTargetAtTime(windWaterEnabled?1:0,t,.03);}
  }
  async function unlock(){if(enabled&&context?.state==='suspended')await context.resume();}
  function update(camera,navigation,nearby,presentation=null){
    if(!enabled||!context||!birds)return;
    const listener=context.listener,t=context.currentTime,position=camera.position;
    if(listener.positionX){listener.positionX.setValueAtTime(position.x,t);listener.positionY.setValueAtTime(position.y,t);listener.positionZ.setValueAtTime(position.z,t);
      const e=camera.matrixWorld.elements;listener.forwardX.setValueAtTime(-e[8],t);listener.forwardY.setValueAtTime(-e[9],t);listener.forwardZ.setValueAtTime(-e[10],t);listener.upX.setValueAtTime(e[4],t);listener.upY.setValueAtTime(e[5],t);listener.upZ.setValueAtTime(e[6],t);}
    const actor=navigation.state;if(actor&&characterBus){characterBus.positionX.setValueAtTime(actor.x,t);characterBus.positionY.setValueAtTime(actor.z+.9,t);characterBus.positionZ.setValueAtTime(-actor.y,t);}
    birds.update(position);
    let nearest=null,distance=Infinity;for(const h of habitats.habitats){const [x,y,z]=h.centre_m;const d=(x-position.x)**2+(-y-position.z)**2+(z-position.y)**2;if(d<distance){distance=d;nearest=h;}}
    if(nearest){const [x,y,z]=nearest.centre_m;water.panner.positionX.setValueAtTime(x,t);water.panner.positionY.setValueAtTime(z,t);water.panner.positionZ.setValueAtTime(-y,t);}
    const flying=['paraglider','parakite','paramotor'].includes(navigation.mode)&&!navigation.state?.grounded;
    const speed=flying?(presentation?.active?presentation.airSpeed:navigation.state.speed):0,turbulence=flying?Math.abs(navigation.state.turbulence??0):0;
    wind.level.gain.setTargetAtTime(flying?Math.min(.28,.055+speed*.005+turbulence*.012):.055,t,.2);
    wind.filter.frequency.setTargetAtTime(400+speed*35+turbulence*80,t,.2);
    const climb=flying?navigation.state.vario:0,pulse=climb>.25&&Math.sin(t*(5+Math.min(6,climb)*2))>.15;
    vario.tone.frequency.setTargetAtTime(climb>0?620+Math.min(6,climb)*85:310,t,.08);
    vario.level.gain.setTargetAtTime(pulse?.014:climb<-3?.008:0,t,.025);
    let passPan=0;
    if(presentation?.feature){const p=presentation.feature.point,e=camera.matrixWorld.elements,dx=p[0]-position.x,dy=p[2]-position.y,dz=-p[1]-position.z;passPan=(dx*e[0]+dy*e[1]+dz*e[2])/Math.max(1,Math.hypot(dx,dy,dz));}
    paraVoice.update(presentation,t,passPan);
    const throttle=navigation.mode==='paramotor'&&!navigation.state?.grounded?(navigation.state.engine??navigation.state.throttle):0;
    // Up to three of the closest bumblebees, each its own HRTF-placed voice; the rest of the meadow is silent.
    const bees=nearby?nearby('bee',26,beeVoices.length):[];
    beeVoices.forEach((voice,k)=>{
      const bee=bees[k];
      if(!bee){voice.level.gain.setTargetAtTime(0,t,.25);return;}
      voice.panner.positionX.setTargetAtTime(bee.x,t,.04);voice.panner.positionY.setTargetAtTime(bee.y,t,.04);voice.panner.positionZ.setTargetAtTime(bee.z,t,.04);
      voice.setPitch(150+(bee.id%7)*12,t);
      const fade=Math.max(0,Math.min(1,(26-bee.d)/10));voice.level.gain.setTargetAtTime(.075*fade,t,.15);
    });
    motor.level.gain.setTargetAtTime(throttle*.032,t,.1);motor.oscillator.frequency.setTargetAtTime(65+throttle*65,t,.1);
  }
  return {toggle,unlock,update,setWindWaterEnabled,get windWaterEnabled(){return windWaterEnabled;},cue:name=>{if(enabled&&context?.state==='running')cues?.(name);},get paraTargets(){return paraVoice?.targets;},dispose(){paraVoice?.dispose();context?.close();}};
}
/** One bumblebee: a soft low buzz (saw plus an octave-down triangle, low-passed) that wanders in pitch and pulses
 * lazily, with a breath of wing air, placed in space by an HRTF panner. Silent until its gain is raised. */
export function createBeeVoice(context,out=context.destination){
  const panner=context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=1.5;panner.rolloffFactor=1.7;panner.maxDistance=30;
  const level=context.createGain();level.gain.value=0;
  const saw=context.createOscillator(),sub=context.createOscillator(),body=context.createBiquadFilter(),swell=context.createGain();
  saw.type='sawtooth';sub.type='triangle';saw.frequency.value=180;sub.frequency.value=90;body.type='lowpass';body.frequency.value=950;body.Q.value=1.2;swell.gain.value=.7;
  const mix=context.createGain();mix.gain.value=.5;saw.connect(mix);sub.connect(mix);mix.connect(body).connect(swell);
  const lfo=(rate,depth,target)=>{const o=context.createOscillator(),g=context.createGain();o.frequency.value=rate;g.gain.value=depth;o.connect(g).connect(target);o.start();return o;};
  lfo(.7+Math.random()*.5,9,saw.frequency);lfo(.7,4.5,sub.frequency);lfo(4+Math.random()*1.5,.22,swell.gain);
  const air=context.createBuffer(1,context.sampleRate,context.sampleRate),d=air.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1;
  const hiss=context.createBufferSource(),band=context.createBiquadFilter(),hissLevel=context.createGain();hiss.buffer=air;hiss.loop=true;band.type='bandpass';band.frequency.value=2600;band.Q.value=1.5;hissLevel.gain.value=.05;
  hiss.connect(band).connect(hissLevel).connect(swell);
  swell.connect(level).connect(panner).connect(out);saw.start();sub.start();hiss.start();
  return {panner,level,setPitch(hz,t){saw.frequency.setTargetAtTime(hz,t,.3);sub.frequency.setTargetAtTime(hz/2,t,.3);}};
}
/** One-shot character cues (the katana's latch, slides, locks and its fighting) on an existing AudioContext. */
export function createCuePlayer(context,destination=context.destination,chargeBuffer=null){
  const foley=createFoleyPlayer(context,destination),blade=createBladeResonance(context,destination);
  const hiss=context.createBuffer(1,context.sampleRate,context.sampleRate),white=hiss.getChannelData(0);
  for(let i=0;i<white.length;i++)white[i]=Math.random()*2-1;
  const retained=new Set(['latch','eject','slide','lock','hum','swish','swish_heavy','spin','ring','flick','charge']);
  let charges=0;
  return function cue(name){
    if(name==='charge'&&chargeBuffer){
      // Round-03 accepted Meow Cat #2 — Joseph SARDIN, exact compact edit.
      if(charges>=4)return;charges++;
      const source=context.createBufferSource(),gain=context.createGain();source.buffer=chargeBuffer;gain.gain.value=.5;
      source.connect(gain).connect(destination);source.onended=()=>{source.disconnect();gain.disconnect();charges--;};source.start(context.currentTime);return;
    }
    if(foley(name)||blade(name)||!retained.has(name))return;
    const t=context.currentTime,out=context.createGain();out.gain.value=['swish','swish_heavy','lock'].includes(name)?.4:.5;out.connect(destination);
    const sources=new Set(),nodes=[out];
    const track=source=>{sources.add(source);source.onended=()=>{source.disconnect();sources.delete(source);if(!sources.size)for(const node of nodes)node.disconnect();};};
    // attack: seconds to the peak (a swish swells, a click does not); at: delay from now.
    const burst=(dur,type,frequency,q,gain,sweep,attack=.004,at=0)=>{
      const s=t+at,source=context.createBufferSource();source.buffer=hiss;
      const filter=context.createBiquadFilter();filter.type=type;filter.Q.value=q;filter.frequency.setValueAtTime(frequency,s);
      if(sweep)filter.frequency.exponentialRampToValueAtTime(sweep,s+dur);
      const level=context.createGain();level.gain.setValueAtTime(0,s);level.gain.linearRampToValueAtTime(gain,s+attack);level.gain.exponentialRampToValueAtTime(.0001,s+dur);
      track(source);nodes.push(filter,level);source.connect(filter).connect(level).connect(out);source.start(s,Math.random()*.8);source.stop(s+dur+.02);
    };
    const ring=(dur,frequency,gain,type='sine',glide)=>{
      const tone=context.createOscillator();tone.type=type;tone.frequency.setValueAtTime(frequency,t);
      if(glide)tone.frequency.exponentialRampToValueAtTime(glide,t+dur);
      const level=context.createGain();level.gain.setValueAtTime(gain,t);level.gain.exponentialRampToValueAtTime(.0001,t+dur);
      track(tone);nodes.push(level);tone.connect(level).connect(out);tone.start(t);tone.stop(t+dur+.02);
    };
    if(name==='latch'){burst(.03,'highpass',4200,.7,.45);}
    else if(name==='eject'){
      // Preserve the human-approved spring: the same rising triangle and 31 Hz
      // twang. Keep its rounded attack and tightened air, without a bell accent.
      burst(.10,'bandpass',900,2,.19,3200);
      const tone=context.createOscillator(),wobble=context.createOscillator(),depth=context.createGain(),level=context.createGain();
      tone.type='triangle';tone.frequency.setValueAtTime(170,t);tone.frequency.exponentialRampToValueAtTime(460,t+.1);
      wobble.frequency.value=31;depth.gain.setValueAtTime(70,t);depth.gain.exponentialRampToValueAtTime(4,t+.32);
      level.gain.setValueAtTime(0,t);level.gain.linearRampToValueAtTime(.13,t+.006);level.gain.exponentialRampToValueAtTime(.0001,t+.31);
      wobble.connect(depth).connect(tone.frequency);tone.connect(level).connect(out);
      track(tone);track(wobble);nodes.push(depth,level);tone.start(t);wobble.start(t);tone.stop(t+.34);wobble.stop(t+.34);
    }
    else if(name==='slide')burst(.11,'bandpass',2600,6,.32,5200);
    else if(name==='lock'){
      // Retain the mechanical detent, without the former rising bell partials.
      burst(.02,'highpass',5000,.7,.6);
    }
    // The fight: a blade through air is band-passed noise falling in pitch as it
    // passes; heavier cuts are lower and longer with a felt thump under them.
    else if(name==='swish'){burst(.24,'bandpass',2400,1.6,.55,520,.05);}
    else if(name==='swish_heavy'){burst(.38,'bandpass',1500,1.2,.8,180,.07);burst(.3,'highpass',5200,.7,.12,2500,.05);ring(.28,95,.35,'sine',40);}
    else if(name==='spin')for(let i=0;i<3;i++)burst(.16,'bandpass',2000-i*350,2,.35-.08*i,600,.03,.06+i*.09);
    else if(name==='charge'){
      // Gathering power: a buzzing tone and its shimmer rising together.
      const tone=context.createOscillator(),filter=context.createBiquadFilter(),level=context.createGain();
      tone.type='sawtooth';tone.frequency.setValueAtTime(90,t);tone.frequency.exponentialRampToValueAtTime(360,t+.5);
      filter.type='lowpass';filter.Q.value=6;filter.frequency.setValueAtTime(300,t);filter.frequency.exponentialRampToValueAtTime(3200,t+.5);
      level.gain.setValueAtTime(0,t);level.gain.linearRampToValueAtTime(.11,t+.35);level.gain.exponentialRampToValueAtTime(.0001,t+.62);
      track(tone);nodes.push(filter,level);tone.connect(filter).connect(level).connect(out);tone.start(t);tone.stop(t+.65);
    }
    // Things answering a blow (shared/play/reactions.json names the sound).
    else if(name==='rustle'){burst(.35,'bandpass',3200,1.2,.35,1800,.05);burst(.22,'highpass',6500,.7,.12,4000,.02,.06);}
    else if(name==='puff')burst(.32,'lowpass',1300,.7,.45,250,.02);
    else if(name==='splat'){burst(.12,'lowpass',900,.7,.7,200);ring(.15,140,.3,'sine',60);}
    else if(name==='thunk'){burst(.06,'lowpass',700,.7,.6);ring(.18,110,.5,'sine',70);}
    else if(name==='tok'){burst(.03,'bandpass',2500,3,.4);ring(.09,900,.35,'triangle',600);}
    else if(name==='chime'){ring(2.4,660,.14);ring(2,660*2.76,.06);ring(1.4,660*5.4,.03);ring(2.6,661.5,.08);}
    else if(name==='boing'){ring(.45,170,.32,'triangle',430);ring(.3,85,.2,'sine',60);}
    else if(name==='pop'){burst(.04,'highpass',3000,.7,.3);ring(.08,600,.4,'sine',1500);}

  }
}

/** Follow-up mix: only the completed draw rings, at 20% of its prior level.
 * Consume old ring/flick/hum events silently, including the cleave's hum. */
export function createBladeResonance(context,destination=context.destination){
  let active=0;
  return name=>{
    if(['hum','ring','flick'].includes(name))return true;
    if(name!=='extend_complete')return false;
    if(active>=8)return true;
    active++;const t=context.currentTime,sources=new Set(),output=context.createGain();output.gain.value=.2;output.connect(destination);
    function partial(hz,dur,level){
      const tone=context.createOscillator(),gain=context.createGain();tone.frequency.value=hz;
      gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(level,t+.008);gain.gain.exponentialRampToValueAtTime(.00001,t+dur);
      tone.connect(gain).connect(output);sources.add(tone);
      tone.onended=()=>{tone.disconnect();gain.disconnect();sources.delete(tone);if(!sources.size){output.disconnect();active--;}};
      tone.start(t);tone.stop(t+dur+.02);
    }
    partial(3100*.9,3.4,.014);partial(4870*.9,2.7,.006);partial(6520*.9,1.8,.0025);
    return true;
  };
}

/** Approximate crown heights (m, before scale) of the placed tree kinds; birds sing from the upper-middle canopy. */
const CROWN_M={'redwood/mountain_pine.glb':26,'redwood/silver_fir.glb':34,'redwood/redwood_canopy.glb':55,'redwood/giant_redwood.glb':90};
/** The placed trees as flat scene-space records [x, groundY, z, crownM], so birds can be put where trees really stand. */
export function treeSpots(instances){
  const trees=instances.filter(i=>i.asset?.startsWith('redwood/')&&i.position_m),out=new Float32Array(trees.length*4);
  trees.forEach((t,n)=>{const [x,y,z]=t.position_m;out.set([x,z,-y,(CROWN_M[t.asset]??30)*(t.scale?.[0]??1)],n*4);});
  return out;
}
/** A hash grid over `treeSpots`: `near(x,z,radius)` returns record offsets of the trees within radius, touching a handful of cells. */
export function createTreeIndex(spots,cell=32){
  const cells=new Map(),key=(i,j)=>i*100003+j;
  for(let n=0;n<spots.length;n+=4){const k=key(Math.floor(spots[n]/cell),Math.floor(spots[n+2]/cell));if(!cells.has(k))cells.set(k,[]);cells.get(k).push(n);}
  return {spots,near(x,z,radius){
    const out=[],r2=radius*radius;
    for(let i=Math.floor((x-radius)/cell);i<=Math.floor((x+radius)/cell);i++)for(let j=Math.floor((z-radius)/cell);j<=Math.floor((z+radius)/cell);j++)
      for(const n of cells.get(key(i,j))??[]){const dx=spots[n]-x,dz=spots[n+2]-z;if(dx*dx+dz*dz<=r2)out.push(n);}
    return out;}};
}
// Three small songs: chips, a trill that sags in pitch, and a two-note whistle that drops a step ("fee-bee").
// n: notes, len/gap: seconds, hz: base range, glide: pitch ratio across one note, step: ratio between notes.
const SONGS=[
  {n:[2,4],len:.07,gap:.1,hz:[4800,6200],glide:.8,step:1,vib:0},
  {n:[6,10],len:.04,gap:.075,hz:[3400,4600],glide:1.08,step:.97,vib:0},
  {n:[2,3],len:.24,gap:.12,hz:[2200,3200],glide:1.12,step:.82,vib:1},
];
/** Schedules one phrase of sine notes into `dest` starting at `t0`; returns its length in seconds. */
export function birdPhrase(context,dest,song,t0,random=Math.random){
  const n=song.n[0]+Math.floor(random()*(song.n[1]-song.n[0]+1)),base=song.hz[0]+random()*(song.hz[1]-song.hz[0]);
  for(let k=0;k<n;k++){
    const t=t0+k*(song.len+song.gap),f=base*song.step**k*(1+(random()-.5)*.06),osc=context.createOscillator(),env=context.createGain();
    osc.type='sine';osc.frequency.setValueAtTime(f,t);osc.frequency.exponentialRampToValueAtTime(f*song.glide,t+song.len);
    env.gain.setValueAtTime(0,t);env.gain.linearRampToValueAtTime(1-.5*k/n,t+Math.min(.015,song.len/4));
    env.gain.setValueAtTime(1-.5*k/n,t+song.len*.6);env.gain.exponentialRampToValueAtTime(.0001,t+song.len);
    osc.connect(env).connect(dest);osc.start(t);osc.stop(t+song.len+.02);
    if(song.vib){const lfo=context.createOscillator(),depth=context.createGain();lfo.frequency.value=24;depth.gain.value=f*.012;lfo.connect(depth).connect(osc.frequency);lfo.start(t);lfo.stop(t+song.len+.02);}
  }
  return n*(song.len+song.gap);
}
/** Birds that live in the real trees. A few singers (never more than three) each perch in a tree near the listener and
 * repeat a phrase from that exact spot through an HRTF panner, so the sound comes from the tree's direction and height.
 * Recruiting is chance-weighted by how many trees are near, so a lone tree is almost silent, a forest is lively and
 * open meadow is quiet. Singers stay put, and are released when the listener leaves them behind. Distance also darkens
 * the voice (air absorbs highs) and a short forest-tail reverb sits behind it. */
export function createBirds(context,index,{random=Math.random,reach=75,level=.05}={}){
  const singers=[],voices=[];let recruitAt=0;
  const tail=context.createBuffer(2,context.sampleRate*1.8,context.sampleRate);
  for(let c=0;c<2;c++){const d=tail.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=(random()*2-1)*Math.exp(-i/context.sampleRate*3.2);}
  const verb=context.createConvolver(),wet=context.createGain(),soften=context.createBiquadFilter();verb.buffer=tail;wet.gain.value=.5;soften.type='lowpass';soften.frequency.value=3500;
  const bus=context.createGain();bus.connect(soften).connect(verb).connect(wet).connect(context.destination);
  function sing(s,d,t){
    const song=SONGS[s.song],panner=context.createPanner(),air=context.createBiquadFilter(),gain=context.createGain();
    panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=8;panner.rolloffFactor=1.2;panner.maxDistance=reach+20;
    panner.positionX.value=s.x;panner.positionY.value=s.y;panner.positionZ.value=s.z;
    air.type='lowpass';air.frequency.value=Math.max(2800,12000-d*110);
    gain.gain.value=level*Math.max(0,Math.min(1,(reach-d)/25));
    gain.connect(air).connect(panner);panner.connect(context.destination);panner.connect(bus);
    voices.push({panner,end:t+birdPhrase(context,gain,song,t+.02,random)+.1});
  }
  return {singers,update(position){
    const t=context.currentTime,{x:px,y:py,z:pz}=position;
    for(let k=voices.length;k--;)if(voices[k].end<t){voices[k].panner.disconnect();voices.splice(k,1);}
    for(let k=singers.length;k--;)if(Math.hypot(singers[k].x-px,singers[k].y-py,singers[k].z-pz)>reach+15)singers.splice(k,1);
    if(t>=recruitAt&&singers.length<3){
      recruitAt=t+3+random()*7;
      const near=index.near(px,pz,reach);
      if(near.length&&random()<Math.min(1,near.length/40)){
        const n=near[Math.floor(random()*near.length)],s=index.spots,y=s[n+1]+s[n+3]*(.3+.5*random());
        if(Math.abs(y-py)<reach&&!singers.some(o=>Math.hypot(o.x-s[n],o.z-s[n+2])<6))singers.push({x:s[n],y,z:s[n+2],song:Math.floor(random()*SONGS.length),next:t+random()*2});
      }
    }
    for(const s of singers)if(t>=s.next&&voices.length<6){sing(s,Math.hypot(s.x-px,s.y-py,s.z-pz),t);s.next=t+2.5+random()*6;}
  }};
}

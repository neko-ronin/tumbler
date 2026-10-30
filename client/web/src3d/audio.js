/** Browser presentation of the existing habitats, wind and flight motor.
 * Original procedural sound, started only by the user's sound button.
 */
export function createSoundscape(habitats){
  let context=null,water=null,motor=null,wind=null,vario=null,cues=null,enabled=false;
  async function toggle(){
    if(!context){
      context=new AudioContext();const length=context.sampleRate*3;
      const buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);
      let last=0;for(let i=0;i<length;i++){last=(last+(Math.random()*2-1)*.02)/1.02;data[i]=last*3.5;}
      cues=createCuePlayer(context);
      function noise(frequency,gain,spatial=false){const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
        const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=frequency;
        const level=context.createGain();level.gain.value=gain;source.connect(filter).connect(level);
        let panner=null;if(spatial){panner=context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=10;panner.maxDistance=260;level.connect(panner).connect(context.destination);}else level.connect(context.destination);
        source.start();return {source,filter,level,panner};}
      const tone=context.createOscillator(),toneLevel=context.createGain();tone.type='sine';tone.frequency.value=700;toneLevel.gain.value=0;tone.connect(toneLevel).connect(context.destination);tone.start();vario={tone,level:toneLevel};
      wind=noise(550,.08);water=noise(1400,.3,true);
      const oscillator=context.createOscillator();oscillator.type='sawtooth';oscillator.frequency.value=85;const level=context.createGain();level.gain.value=0;const filter=context.createBiquadFilter();filter.type='lowpass';filter.frequency.value=350;oscillator.connect(filter).connect(level).connect(context.destination);oscillator.start();motor={oscillator,level};
    }
    enabled=!enabled;await (enabled?context.resume():context.suspend());return enabled;
  }
  function update(camera,navigation){
    if(!enabled||!context)return;
    const listener=context.listener,t=context.currentTime,position=camera.position;
    if(listener.positionX){listener.positionX.setValueAtTime(position.x,t);listener.positionY.setValueAtTime(position.y,t);listener.positionZ.setValueAtTime(position.z,t);
      const e=camera.matrixWorld.elements;listener.forwardX.setValueAtTime(-e[8],t);listener.forwardY.setValueAtTime(-e[9],t);listener.forwardZ.setValueAtTime(-e[10],t);listener.upX.setValueAtTime(e[4],t);listener.upY.setValueAtTime(e[5],t);listener.upZ.setValueAtTime(e[6],t);}
    let nearest=null,distance=Infinity;for(const h of habitats.habitats){const [x,y,z]=h.centre_m;const d=(x-position.x)**2+(-y-position.z)**2+(z-position.y)**2;if(d<distance){distance=d;nearest=h;}}
    if(nearest){const [x,y,z]=nearest.centre_m;water.panner.positionX.setValueAtTime(x,t);water.panner.positionY.setValueAtTime(z,t);water.panner.positionZ.setValueAtTime(-y,t);}
    const flying=['paraglider','parakite','paramotor'].includes(navigation.mode)&&!navigation.state?.grounded;
    const speed=flying?navigation.state.speed:0,turbulence=flying?Math.abs(navigation.state.turbulence??0):0;
    wind.level.gain.setTargetAtTime(flying?Math.min(.28,.055+speed*.005+turbulence*.012):.055,t,.2);
    wind.filter.frequency.setTargetAtTime(400+speed*35+turbulence*80,t,.2);
    const climb=flying?navigation.state.vario:0,pulse=climb>.25&&Math.sin(t*(5+Math.min(6,climb)*2))>.15;
    vario.tone.frequency.setTargetAtTime(climb>0?620+Math.min(6,climb)*85:310,t,.08);
    vario.level.gain.setTargetAtTime(pulse?.014:climb<-3?.008:0,t,.025);
    const throttle=navigation.mode==='paramotor'&&!navigation.state?.grounded?navigation.state.throttle:0;
    motor.level.gain.setTargetAtTime(throttle*.032,t,.1);motor.oscillator.frequency.setTargetAtTime(65+throttle*65,t,.1);
  }
  return {toggle,update,cue:name=>{if(enabled)cues?.(name);},dispose(){context?.close();}};
}
/** One-shot character cues (the katana's latch, slides, locks and its fighting) on an existing AudioContext. */
export function createCuePlayer(context){
  const hiss=context.createBuffer(1,context.sampleRate,context.sampleRate),white=hiss.getChannelData(0);
  for(let i=0;i<white.length;i++)white[i]=Math.random()*2-1;
  let lockRun=0,lastLock=-1;
  return function cue(name){
    const t=context.currentTime,out=context.createGain();out.gain.value=.5;out.connect(context.destination);
    // attack: seconds to the peak (a swish swells, a click does not); at: delay from now.
    const burst=(dur,type,frequency,q,gain,sweep,attack=.004,at=0)=>{
      const s=t+at,source=context.createBufferSource();source.buffer=hiss;
      const filter=context.createBiquadFilter();filter.type=type;filter.Q.value=q;filter.frequency.setValueAtTime(frequency,s);
      if(sweep)filter.frequency.exponentialRampToValueAtTime(sweep,s+dur);
      const level=context.createGain();level.gain.setValueAtTime(0,s);level.gain.linearRampToValueAtTime(gain,s+attack);level.gain.exponentialRampToValueAtTime(.0001,s+dur);
      source.connect(filter).connect(level).connect(out);source.start(s,Math.random()*.8);source.stop(s+dur+.02);
    };
    const ring=(dur,frequency,gain,type='sine',glide)=>{
      const tone=context.createOscillator();tone.type=type;tone.frequency.setValueAtTime(frequency,t);
      if(glide)tone.frequency.exponentialRampToValueAtTime(glide,t+dur);
      const level=context.createGain();level.gain.setValueAtTime(gain,t);level.gain.exponentialRampToValueAtTime(.0001,t+dur);
      tone.connect(level).connect(out);tone.start(t);tone.stop(t+dur+.02);
    };
    if(name==='latch'){burst(.03,'highpass',4200,.7,.45);ring(.05,2400,.06);}
    else if(name==='eject'){
      // The spring letting go: a short airy push and a wobbling twang that rises as it unloads.
      burst(.12,'bandpass',900,2,.22,3200);
      const tone=context.createOscillator(),wobble=context.createOscillator(),depth=context.createGain(),level=context.createGain();
      tone.type='triangle';tone.frequency.setValueAtTime(170,t);tone.frequency.exponentialRampToValueAtTime(460,t+.1);
      wobble.frequency.value=31;depth.gain.setValueAtTime(70,t);depth.gain.exponentialRampToValueAtTime(4,t+.32);
      level.gain.setValueAtTime(.13,t);level.gain.exponentialRampToValueAtTime(.0001,t+.34);
      wobble.connect(depth).connect(tone.frequency);tone.connect(level).connect(out);
      tone.start(t);wobble.start(t);tone.stop(t+.36);wobble.stop(t+.36);
    }
    else if(name==='catch'){burst(.06,'lowpass',600,.7,.5);ring(.09,160,.22);}
    else if(name==='slide')burst(.11,'bandpass',2600,6,.32,5200);
    else if(name==='lock'||name==='seat'){
      // Consecutive locks climb a little in pitch, so the chain reads as one mechanism.
      lockRun=t-lastLock<.5?lockRun+1:0;lastLock=t;const k=name==='seat'?.6:1.06**lockRun;
      burst(.02,'highpass',5000,.7,.6);ring(.18,2100*k,.1);ring(.12,3350*k,.06);ring(.06,5200*k,.035);
      if(name==='seat')ring(.1,150,.2);
    }
    else if(name==='hum'){ring(.9,110,.05,'sawtooth');ring(.9,220,.04);}
    // The fight: a blade through air is band-passed noise falling in pitch as it
    // passes; heavier cuts are lower and longer with a felt thump under them.
    else if(name==='swish'){burst(.24,'bandpass',2400,1.6,.55,520,.05);ring(.2,1250,.03,'sine',600);}
    else if(name==='swish_heavy'){burst(.38,'bandpass',1500,1.2,.8,180,.07);burst(.3,'highpass',5200,.7,.12,2500,.05);ring(.28,95,.35,'sine',40);}
    else if(name==='spin')for(let i=0;i<3;i++)burst(.16,'bandpass',2000-i*350,2,.35-.08*i,600,.03,.06+i*.09);
    else if(name==='ring'||name==='flick'){
      // Steel ringing after the cut: inharmonic partials, like a struck bar.
      const k=name==='flick'?1.25:1;if(name==='flick')burst(.1,'bandpass',3400,3,.4,1300,.02);
      ring(1.1,1830*k,.05);ring(.9,2950*k,.035);ring(.6,4410*k,.02);
    }
    else if(name==='charge'){
      // Gathering power: a buzzing tone and its shimmer rising together.
      const tone=context.createOscillator(),filter=context.createBiquadFilter(),level=context.createGain();
      tone.type='sawtooth';tone.frequency.setValueAtTime(90,t);tone.frequency.exponentialRampToValueAtTime(360,t+.5);
      filter.type='lowpass';filter.Q.value=6;filter.frequency.setValueAtTime(300,t);filter.frequency.exponentialRampToValueAtTime(3200,t+.5);
      level.gain.setValueAtTime(0,t);level.gain.linearRampToValueAtTime(.11,t+.35);level.gain.exponentialRampToValueAtTime(.0001,t+.62);
      tone.connect(filter).connect(level).connect(out);tone.start(t);tone.stop(t+.65);
      ring(.6,880,.025,'sine',2600);
    }
    else if(name==='impact'){
      // The blow lands: a sharp crack, a falling boom, rumble and the blade's ring.
      burst(.07,'highpass',3000,.7,.9);burst(.7,'lowpass',420,.8,.7,90,.01);
      ring(.75,130,.9,'sine',34);ring(.35,62,.6,'triangle',30);ring(1.3,1620,.04);ring(1,2470,.03);
    }
    else if(name==='land'){burst(.14,'lowpass',500,.7,.5,150);ring(.16,88,.3,'sine',45);}
    else if(/^grunt[123]$/.test(name)){
      // A gruff cat effort grunt: a low voice through two mouth formants, roughened
      // by a fast flutter (the growl), over a breathy push. The chain's later jumps
      // grunt harder and longer; the triple's rises into a short shout.
      const tier=+name[5],k=1+(Math.random()-.5)*.1,dur=[.2,.24,.36][tier-1],peak=[.7,.8,.9][tier-1];
      const voice=context.createOscillator(),flutter=context.createOscillator(),rough=context.createGain(),level=context.createGain();
      voice.type='sawtooth';const f=[118,132,124][tier-1]*k;
      voice.frequency.setValueAtTime(f*1.12,t);
      if(tier===3){voice.frequency.linearRampToValueAtTime(f*1.45,t+dur*.45);voice.frequency.exponentialRampToValueAtTime(f*.85,t+dur);}
      else voice.frequency.exponentialRampToValueAtTime(f*.78,t+dur);
      // The flutter swings the rough stage's gain between 0.4 and 1, inside the envelope.
      const depth=context.createGain();flutter.frequency.value=34*k;depth.gain.value=.3;rough.gain.value=.7;
      flutter.connect(depth).connect(rough.gain);
      level.gain.setValueAtTime(0,t);level.gain.linearRampToValueAtTime(peak,t+.012);level.gain.setValueAtTime(peak,t+dur*.5);level.gain.exponentialRampToValueAtTime(.0001,t+dur);
      for(const [frequency,q,gain] of [[640,4,1],[1350,6,.45]]){
        const formant=context.createBiquadFilter(),mix=context.createGain();formant.type='bandpass';formant.frequency.value=frequency*(tier===3?1.15:1);formant.Q.value=q;mix.gain.value=gain;
        voice.connect(formant).connect(mix).connect(rough);
      }
      rough.connect(level).connect(out);voice.start(t);flutter.start(t);voice.stop(t+dur+.02);flutter.stop(t+dur+.02);
      burst(dur*.7,'lowpass',900,.7,.12);
    }
  }
}

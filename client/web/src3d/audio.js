/** Browser presentation of the existing habitats, wind and flight motor.
 * Original procedural sound, started only by the user's sound button.
 */
export function createSoundscape(habitats){
  let context=null,water=null,motor=null,wind=null,vario=null,enabled=false;
  async function toggle(){
    if(!context){
      context=new AudioContext();const length=context.sampleRate*3;
      const buffer=context.createBuffer(1,length,context.sampleRate),data=buffer.getChannelData(0);
      let last=0;for(let i=0;i<length;i++){last=(last+(Math.random()*2-1)*.02)/1.02;data[i]=last*3.5;}
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
  return {toggle,update,dispose(){context?.close();}};
}

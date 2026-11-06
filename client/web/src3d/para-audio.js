/** Procedural flight voices. Near-pass, fabric and harness sit with the optics;
 * helmet wind, buffet, sail flutter and line hum are what the air sounds like from
 * inside the harness and drop back in chase. They read physical state only and do
 * not simulate aerodynamic or cable forces. */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
// Line diameters, metres: Aeolian tones sit near f = 0.2 V / d.
const LINES=[.0026,.0019,.0014];
export function paraAudioTargets(sample,pan=0,{view='first',windPan=0,facing=1}={}){
 if(!sample?.active)return {pass:0,fabric:0,harness:0,frequency:900,pan:0,helmet:0,helmetHz:900,buffet:0,buffetHz:110,buffetRate:3,flutter:0,flutterHz:900,flutterRate:8,hum:0,humHz:LINES.map(()=>1000),windPan:0};
 const speed=Number.isFinite(sample.airSpeed)?Math.max(0,sample.airSpeed):0;
 const air=clamp(speed/35),rush=clamp(sample.rush),load=clamp(sample.loadChange/3),pressure=clamp(sample.pressure??1),q=clamp(speed/45)**2,close=view==='first'?1:.35;
 const loaded=clamp((sample.load??1)/2);
 return {pass:Math.min(.055,rush*rush*.055),fabric:Math.min(.018,air*(.003+.008*(1-pressure)+.004*clamp(sample.load-1,0,2))),
  harness:Math.min(.012,load*.012),frequency:sample.feature?.kind==='ropeway'?2100:650+1400*air,pan:clamp(pan,-1,1),
  helmet:Math.min(.15,q*.2*close),helmetHz:(520+speed*52)*(.7+.3*clamp(facing)),
  buffet:Math.min(.16,q*.24*close),buffetHz:85+speed*2.4,buffetRate:2.5+speed*.17,
  flutter:Math.min(.09,q*(.028+.13*(1-pressure))*close),flutterHz:650+speed*16,flutterRate:7+speed*.42,
  hum:speed>14?Math.min(.018,(speed-14)/30*.014*(.5+.5*loaded)*close):0,humHz:LINES.map(d=>Math.min(9000,Math.max(300,.2*speed/d))),
  windPan:clamp(windPan,-1,1)};
}
export function createParaVoice(context,destination=context.destination,windDestination=destination){
 const mono=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=mono.getChannelData(0);let seed=6721;
 const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
 for(let i=0;i<data.length;i++)data[i]=random();
 // Decorrelated ears, so wind is around the head rather than at one point in it.
 const stereo=context.createBuffer(2,context.sampleRate*3,context.sampleRate);
 for(let c=0;c<2;c++){const d=stereo.getChannelData(c);for(let i=0;i<d.length;i++)d[i]=random();}
 const sources=[],nodes=[];
 function voice(type,frequency,q=.55,buffer=mono){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.value=0;source.connect(filter).connect(gain);sources.push(source);nodes.push(filter,gain);source.start();return {filter,gain};
 }
 // Amplitude motion: a base level plus a low oscillator on a gain's own param.
 function tremor(input,base,rate,depth,type='triangle'){
  const am=context.createGain(),lfo=context.createOscillator(),amount=context.createGain();am.gain.value=base;lfo.type=type;lfo.frequency.value=rate;amount.gain.value=depth;lfo.connect(amount).connect(am.gain);input.connect(am);sources.push(lfo);nodes.push(am,amount);lfo.start();return {am,lfo};
 }
 const pass=voice('bandpass',1400),fabric=voice('highpass',1800),harness=voice('bandpass',180),pan=context.createStereoPanner();
 pass.gain.connect(pan).connect(destination);fabric.gain.connect(destination);harness.gain.connect(destination);nodes.push(pan);
 const windPan=context.createStereoPanner();windPan.connect(windDestination);nodes.push(windPan);
 const helmet=voice('bandpass',1500,.7,stereo),buffet=voice('lowpass',140,.8,stereo),flutter=voice('bandpass',1000,1.1);
 helmet.gain.connect(windPan);
 const slow=tremor(buffet.gain,.62,3,.28),slower=tremor(slow.am,.8,1.3,.2,'sine');slower.am.connect(windPan);
 const flap=tremor(flutter.gain,.5,9,.48);flap.am.connect(windDestination);
 const hums=LINES.map((_,i)=>{const v=voice('bandpass',2000,22);const shimmer=tremor(v.gain,.75,2.1+i*1.37,.25,'sine');shimmer.am.connect(destination);return v;});
 // One-shots: cloth crump when cells lose pressure, crack when they refill, webbing creak on a load step.
 let previousPressure=1,tuckedAt=-9,creakAt=-9,tucked=false;
 function burst(at,type,frequency,q,level,duration,attack=.004){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=mono;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
  gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(level,at+attack);gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
  source.connect(filter).connect(gain).connect(destination);source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};source.start(at,Math.random()*1.5,duration+.02);
 }
 let latest=paraAudioTargets(null);
 return {update(sample,t=context.currentTime,side=0,listener={}){
  latest=paraAudioTargets(sample,side,listener);
  pass.gain.gain.setTargetAtTime(latest.pass,t,.09);pass.filter.frequency.setTargetAtTime(latest.frequency,t,.1);pan.pan.setTargetAtTime(latest.pan,t,.08);
  fabric.gain.gain.setTargetAtTime(latest.fabric,t,.12);harness.gain.gain.setTargetAtTime(latest.harness,t,.07);
  helmet.gain.gain.setTargetAtTime(latest.helmet,t,.14);helmet.filter.frequency.setTargetAtTime(latest.helmetHz,t,.14);windPan.pan.setTargetAtTime(latest.windPan,t,.1);
  buffet.gain.gain.setTargetAtTime(latest.buffet,t,.16);buffet.filter.frequency.setTargetAtTime(latest.buffetHz,t,.16);slow.lfo.frequency.setTargetAtTime(latest.buffetRate,t,.3);
  flutter.gain.gain.setTargetAtTime(latest.flutter,t,.1);flutter.filter.frequency.setTargetAtTime(latest.flutterHz,t,.1);flap.lfo.frequency.setTargetAtTime(latest.flutterRate,t,.2);
  hums.forEach((v,i)=>{v.gain.gain.setTargetAtTime(latest.hum,t,.18);v.filter.frequency.setTargetAtTime(latest.humHz[i],t,.12);});
  if(sample?.active){
   const p=clamp(sample.pressure??1),near=listener.view==='chase'?.35:1;
   if(!tucked&&p<.7&&p<previousPressure&&t-tuckedAt>.8){tucked=true;tuckedAt=t;burst(t,'lowpass',260,.7,.34*near,.32,.012);burst(t+.015,'bandpass',1500,.9,.07*near,.22);}
   else if(tucked&&p>.86){tucked=false;burst(t,'bandpass',1050,1.2,.2*near,.1,.002);burst(t,'lowpass',190,.7,.26*near,.16,.004);}
   previousPressure=p;
   if((sample.loadChange??0)>.9&&t-creakAt>1.3){creakAt=t;for(let i=0;i<3;i++)burst(t+i*.042+Math.random()*.012,'bandpass',1500+Math.random()*1100,7,.05*near,.03,.002);}
  }else{previousPressure=1;tucked=false;}
 },get targets(){return latest;},dispose(){for(const s of sources){try{s.stop();}catch{}s.disconnect();}for(const n of nodes)n.disconnect();}};
}

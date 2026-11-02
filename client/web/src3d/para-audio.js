/** Procedural near-pass, fabric and harness layers; control signals are shared
 * with para optics. These voices do not simulate aerodynamic or cable forces. */
const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,Number.isFinite(x)?x:0));
export function paraAudioTargets(sample,pan=0){
 if(!sample?.active)return {pass:0,fabric:0,harness:0,frequency:900,pan:0};
 const air=clamp(sample.airSpeed/35),rush=clamp(sample.rush),load=clamp(sample.loadChange/3);
 return {pass:Math.min(.055,rush*rush*.055),fabric:Math.min(.018,air*(.003+.008*(1-clamp(sample.pressure??1))+.004*clamp(sample.load-1,0,2))),
  harness:Math.min(.012,load*.012),frequency:sample.feature?.kind==='ropeway'?2100:650+1400*air,pan:clamp(pan,-1,1)};
}
export function createParaVoice(context,destination=context.destination){
 const buffer=context.createBuffer(1,context.sampleRate*2,context.sampleRate),data=buffer.getChannelData(0);let seed=6721;
 for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed/2147483648-1;}
 const sources=[],nodes=[];
 function voice(type,frequency){
  const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();source.buffer=buffer;source.loop=true;filter.type=type;filter.frequency.value=frequency;filter.Q.value=.55;gain.gain.value=0;source.connect(filter).connect(gain);sources.push(source);nodes.push(filter,gain);source.start();return {filter,gain};
 }
 const pass=voice('bandpass',1400),fabric=voice('highpass',1800),harness=voice('bandpass',180),pan=context.createStereoPanner();
 pass.gain.connect(pan).connect(destination);fabric.gain.connect(destination);harness.gain.connect(destination);nodes.push(pan);
 let latest=paraAudioTargets(null);
 return {update(sample,t=context.currentTime,side=0){
  latest=paraAudioTargets(sample,side);
  pass.gain.gain.setTargetAtTime(latest.pass,t,.09);pass.filter.frequency.setTargetAtTime(latest.frequency,t,.1);pan.pan.setTargetAtTime(latest.pan,t,.08);
  fabric.gain.gain.setTargetAtTime(latest.fabric,t,.12);harness.gain.gain.setTargetAtTime(latest.harness,t,.07);
 },get targets(){return latest;},dispose(){for(const s of sources){try{s.stop();}catch{}s.disconnect();}for(const n of nodes)n.disconnect();}};
}

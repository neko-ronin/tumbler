/** The water's voices (phase 13), all procedural Web Audio: no samples, no dependency.
 *
 *  - the river: the soundscape's own water noise, moved to the nearest point of the river and voiced by the
 *    current there (surfaceSpeeds: louder and brighter where it runs), with a babbling rapid layer over 1.4 m/s;
 *  - the falls: a low roar placed at the curtain, heard across the valley;
 *  - the lake: lapping at the nearest shore point, a slow irregular swell;
 *  - under the surface: everything in the air bus is low-passed (the soundscape's `muffle`) and a soft pressure
 *    hum rises with depth;
 *  - the swimmer: a splash on entry, strokes while paddling, whooshes and bubbles under, drips on the way out;
 *  - life: frogs croak at their roosts, ducks quack at their rafts, dragonflies rattle past at the shore.
 * Ambience goes to `bus` (the wind-and-water toggle); the swimmer's sounds go to `foley`, placed at the player.
 * Positions are scene metres (x, up, -north).
 */
import {surfaceSpeeds} from './style.js';

const RAPID_MPS=1.4;      // the river babbles over this surface speed
const LAP_M=60;           // lake lapping fades out this far from the shore
const FROG_M=35,DUCK_M=70,DRAGON_M=10;

/** The nearest point of a polyline [[x, y, z?]...] to (x, y): {x, y, i, t, d}. */
export function nearestOnPolyline(line,x,y){
  let best={d:Infinity};
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],vx=b[0]-a[0],vy=b[1]-a[1],l=vx*vx+vy*vy||1;
    const t=Math.max(0,Math.min(1,((x-a[0])*vx+(y-a[1])*vy)/l)),px=a[0]+vx*t,py=a[1]+vy*t,d=Math.hypot(x-px,y-py);
    if(d<best.d)best={x:px,y:py,i,t,d};
  }
  return best;
}

/** How the river sounds at a surface speed (m/s): its level, low-pass cutoff (Hz) and rapid layer level. */
export function riverVoice(speed){
  const s=Math.max(0,Math.min(3,speed));
  return {level:.12+.2*s/3,cutoff:700+1500*s/3,rapid:Math.max(0,Math.min(1,(s-RAPID_MPS)/1.2))*.22};
}

export function createWaterVoices(context,{bus,foley,river,buffer},{worldmap,habitats=[],rafts=[]}){
  const t0=context.currentTime;
  const body=kind=>(worldmap.water?.bodies??[]).find(b=>b.kind===kind);
  const riverBody=body('river'),lake=body('lake');
  const line=riverBody?.polyline_xyz_m??riverBody?.polyline??[],speeds=surfaceSpeeds(line,riverBody?.half_widths_m);
  const lip=worldmap.water?.form?.stream_xy_m?.at(-1)??null,lakeLevel=lake?.surface_z_m??30;
  const loop=(frequency,type='lowpass',q=.7)=>{
    const source=context.createBufferSource();source.buffer=buffer;source.loop=true;
    const filter=context.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
    const level=context.createGain();level.gain.value=0;source.connect(filter).connect(level);source.start();
    return {source,filter,level};
  };
  const place=(voice,ref,max,rolloff=1)=>{
    const panner=context.createPanner();panner.panningModel='HRTF';panner.distanceModel='inverse';panner.refDistance=ref;panner.maxDistance=max;panner.rolloffFactor=rolloff;
    voice.level.connect(panner).connect(bus);voice.panner=panner;return voice;
  };
  const at=(panner,x,y,z,t)=>{panner.positionX.setValueAtTime(x,t);panner.positionY.setValueAtTime(z,t);panner.positionZ.setValueAtTime(-y,t);};
  // The rapid: brighter water with a slow babble (an LFO on its level), sharing the river's place.
  const rapid=loop(2600,'bandpass',.6);rapid.level.connect(river.panner);
  const babble=context.createOscillator(),babbleDepth=context.createGain();babble.frequency.value=3.1;babbleDepth.gain.value=0;babble.connect(babbleDepth).connect(rapid.level.gain);babble.start();
  // The falls: a broad low roar audible from far off (inverse law, gentle rolloff).
  const falls=lip?place(loop(520,'lowpass',.5),60,3000,.7):null;
  const fallsHiss=falls?loop(1700,'bandpass',.4):null;if(fallsHiss)fallsHiss.level.connect(falls.panner);
  if(falls){at(falls.panner,lip[0],lip[1],lakeLevel+25,t0);falls.level.gain.value=.5;fallsHiss.level.gain.value=.12;}
  // The lake's lap: a band of noise whose level two slow LFOs swell and drop, out of step.
  const lap=lake?.outline_xy_m?place(loop(620,'bandpass',.9),6,120):null;
  if(lap){for(const [f,depth] of [[.23,.05],[.37,.035]]){const o=context.createOscillator(),g=context.createGain();o.frequency.value=f;g.gain.value=depth;o.connect(g).connect(lap.level.gain);o.start();}}
  // Under the surface: a soft pressure hum, louder with depth.
  const hum=loop(110,'lowpass',.5);hum.level.connect(bus);
  const dragon=place(loop(260,'bandpass',4),2,25);
  const dragonBeat=context.createOscillator(),dragonDepth=context.createGain();dragonBeat.frequency.value=34;dragonDepth.gain.value=0;dragonBeat.connect(dragonDepth).connect(dragon.level.gain);dragonBeat.start();

  // One-shots: a noise burst through a filter, or a tone with a pitch glide, each with a quick envelope.
  function burst(dest,{frequency,q=.8,type='bandpass',duration=.3,level=.2,when=context.currentTime,attack=.01}){
    const source=context.createBufferSource();source.buffer=buffer;
    const filter=context.createBiquadFilter();filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;
    const gain=context.createGain();gain.gain.value=0;
    gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(level,when+attack);gain.gain.exponentialRampToValueAtTime(.0005,when+duration);
    source.connect(filter).connect(gain).connect(dest);source.start(when,Math.random()*2,duration+.05);
    source.onended=()=>{source.disconnect();filter.disconnect();gain.disconnect();};
  }
  function chirp(dest,{from,to,duration=.08,level=.06,when=context.currentTime,type='sine'}){
    const o=context.createOscillator(),gain=context.createGain();o.type=type;
    o.frequency.setValueAtTime(from,when);o.frequency.exponentialRampToValueAtTime(to,when+duration);
    gain.gain.setValueAtTime(0,when);gain.gain.linearRampToValueAtTime(level,when+.005);gain.gain.exponentialRampToValueAtTime(.0005,when+duration);
    o.connect(gain).connect(dest);o.start(when);o.stop(when+duration+.02);o.onended=()=>{o.disconnect();gain.disconnect();};
  }
  function placed(x,y,z,ref=6){
    const p=context.createPanner();p.panningModel='HRTF';p.distanceModel='inverse';p.refDistance=ref;p.maxDistance=150;at(p,x,y,z,context.currentTime);p.connect(bus);
    setTimeout(()=>p.disconnect(),2500);return p;
  }
  const croak=(x,y,z)=>{const p=placed(x,y,z,4),t=context.currentTime,pitch=95+Math.random()*35;
    for(let k=0;k<2+Math.floor(Math.random()*3);k++){const when=t+k*.14;chirp(p,{from:pitch*1.15,to:pitch,duration:.11,level:.09,when,type:'square'});burst(p,{frequency:420,q:3,duration:.1,level:.04,when});}};
  const quack=(x,y,z)=>{const p=placed(x,y,z,5),t=context.currentTime;
    for(let k=0;k<1+Math.floor(Math.random()*3);k++){const when=t+k*.22+Math.random()*.05,f=420+Math.random()*90;chirp(p,{from:f*1.2,to:f*.8,duration:.15,level:.07,when,type:'sawtooth'});burst(p,{frequency:1100,q:4,duration:.13,level:.05,when});}};

  let nextFrog=0,nextDuck=0,stroke=0,lastState=null,under=0;
  return {
    /** `listener` in world metres {x, y, z}; `swimmer` the player's state on foot or swimming; `depth` the eye's
     * depth under the surface (0 when above). */
    update(t,dt,listener,swimmer,depth){
      const {x,y,z}=listener;
      if(line.length>1){
        const q=nearestOnPolyline(line,x,y),speed=speeds[q.i-1]*(1-q.t)+speeds[q.i]*q.t,surface=line[q.i-1][2]??lakeLevel,v=riverVoice(speed);
        at(river.panner,q.x,q.y,surface,t);
        river.level.gain.setTargetAtTime(v.level,t,.4);river.filter.frequency.setTargetAtTime(v.cutoff,t,.4);
        rapid.level.gain.setTargetAtTime(v.rapid,t,.4);babbleDepth.gain.setTargetAtTime(v.rapid*.6,t,.4);
      }
      if(lap){
        const q=nearestOnPolyline([...lake.outline_xy_m,lake.outline_xy_m[0]],x,y);at(lap.panner,q.x,q.y,lakeLevel,t);
        lap.level.gain.setTargetAtTime(q.d<LAP_M?.09*(1-q.d/LAP_M):0,t,.5);
      }
      hum.level.gain.setTargetAtTime(depth>0?Math.min(.22,.06+depth*.012):0,t,.3);
      // Life near the listener, on its own clock.
      let near=null,nd=Infinity;for(const h of habitats){const d=Math.hypot(h.shore_m?.[0]-x,h.shore_m?.[1]-y);if(d<nd){nd=d;near=h;}}
      const dragonLevel=near&&nd<DRAGON_M&&depth<=0?.03*(1-nd/DRAGON_M):0;
      if(near)at(dragon.panner,near.shore_m[0]+Math.sin(t*.7)*3,near.shore_m[1]+Math.cos(t*.5)*2,near.shore_m[2]+1,t);
      dragon.level.gain.setTargetAtTime(dragonLevel,t,.3);dragonDepth.gain.setTargetAtTime(dragonLevel*.8,t,.3);
      if(near&&nd<FROG_M&&t>=nextFrog){nextFrog=t+2+Math.random()*5;const r=near.frog_roosts_m?.[Math.floor(Math.random()*(near.frog_roosts_m.length||1))];if(r)croak(...r);}
      let raft=null,rd=Infinity;for(const r of rafts){const d=Math.hypot(r.centre_m[0]-x,r.centre_m[1]-y);if(d<rd){rd=d;raft=r;}}
      if(raft&&rd<DUCK_M&&t>=nextDuck){nextDuck=t+3+Math.random()*6;quack(raft.centre_m[0]+(Math.random()-.5)*12,raft.centre_m[1]+(Math.random()-.5)*12,raft.centre_m[2]);}
      // The swimmer.
      const s=swimmer,was=lastState;lastState=s?{mode:s.mode,under:!!s.under,vz:s.vz??0}:null;
      if(!s)return;
      const swimming=s.mode==='swim',wasSwimming=was?.mode==='swim';
      if(swimming&&!wasSwimming&&was)burst(foley,{frequency:900,q:.7,duration:.7,level:Math.min(.45,.18+Math.abs(was.vz)*.05),attack:.005});
      if(!swimming&&wasSwimming)for(let k=0;k<5;k++)chirp(foley,{from:1600+Math.random()*1400,to:900,duration:.05,level:.025,when:t+.1+k*.16+Math.random()*.08});
      if(swimming&&was?.under&&!s.under)burst(foley,{frequency:1200,q:.9,duration:.35,level:.15});
      if(swimming&&s.speed>.2&&['paddle','dive'].includes(s.swimPhase)){
        stroke+=dt;  // a stroke every 0.85 s at the paddle, every 0.7 s under
        const period=s.under?.7:.85;
        if(stroke>=period){stroke=0;
          if(s.under){burst(foley,{frequency:420,q:.6,duration:.45,level:.12,attack:.06});for(let k=0;k<2+Math.floor(Math.random()*3);k++)chirp(foley,{from:300+Math.random()*200,to:900+Math.random()*500,duration:.06,level:.04,when:t+.05+k*.07});}
          else burst(foley,{frequency:750,q:.8,duration:.32,level:.1,attack:.03});
        }
      }else stroke=0;
      under=depth;
    },
    get depth(){return under;},
  };
}

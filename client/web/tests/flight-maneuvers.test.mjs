import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {flightInput} from '../src3d/flight-input.js';
import {createAirCues} from '../src3d/air-cues.js';
import {style} from '../src3d/style.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const flat=()=>0,site={xy_m:[0,0],heading_deg:0};
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const start=mode=>({...launchFlight(still,mode,site,flat),z:1200,engine:0,throttle:0});
const head=s=>s.z+s.speed*s.speed/(2*9.81);
function run(s,input,seconds,rules=still,height=flat){for(let i=0;i<Math.round(seconds*120);i++)s=stepFlight(s,typeof input==='function'?input(i/120):input,1/120,i/120,rules,270,height);return s;}

test('a dive stores speed, neutral retains it, and progressive flare visibly climbs in every wing',()=>{
 for(const name of Object.keys(config.modes)){
  const initial=start(name),dive=run(initial,{brake:-1},3);
  assert.ok(dive.speed>initial.speed*1.17,name);assert.ok(dive.z<initial.z-5,name);
  const carry=run(dive,{},.5);assert.ok(carry.speed>initial.speed*1.1,'momentum survives hands neutral');
  const flare=run(carry,{brake:.65},1.2);
  assert.ok(flare.z>carry.z+1,name);assert.ok(flare.speed<carry.speed,name);assert.ok(flare.pitch>0,name);
  assert.ok(head(flare)<head(initial),name);
 }
});

test('linked rolls and spirals respond to analogue authority, pay height and damp on release',()=>{
 for(const name of Object.keys(config.modes)){
  const ordinary=run(start(name),{turn:1},2.5),spiral=run(start(name),{turn:1,maneuver:true},2.5);
  assert.ok(spiral.bank>ordinary.bank+.12,name);assert.ok(spiral.load>ordinary.load,name);
  assert.ok(head(spiral)<head(ordinary),name);
  const reversed=run(spiral,{turn:-1,maneuver:true},3);
  assert.ok(reversed.bank<-.5);assert.equal(reversed.reversals,1);assert.match(reversed.figure,/Wingover/);
  const recovered=run(reversed,{},4);
  assert.ok(Math.abs(recovered.bank)<.035,name);assert.ok(Math.abs(recovered.rollRate)<.04,name);
  assert.ok(Math.abs(spiral.bank)<Math.PI/2);assert.ok(recovered.pressure>.9);
 }
 assert.ok(config.modes.paramotor.maneuver_bank_rad<config.modes.parakite.maneuver_bank_rad);
});

test('every unpowered step loses energy through mixed maneuvers, pumping and low skims',()=>{
 for(const name of Object.keys(config.modes))for(const z of [1200,4]){
  let s={...start(name),z};
  for(let i=0;i<3600&&!s.grounded;i++){
   const before=head(s),next=stepFlight(s,{brake:Math.sin(i*.009),turn:Math.sin(i*.007),maneuver:true},1/120,i/120,still,270,flat);
   if(!next.grounded)assert.ok(head(next)<=before+1e-9,`${name} gains energy at ${i}`);
   s=next;
  }
 }
});

test('ground proximity reduces loss but never adds lift; canopy clearance, slope and bank gate it',()=>{
 for(const name of Object.keys(config.modes)){
  const s={...start(name),z:2.1},near=run(s,{},.05),high=run({...s,z:100}, {},.05);
  assert.ok(near.groundEffect>0&&near.groundEffect<1,name);assert.equal(high.groundEffect,0);
  assert.ok(near.vertical>high.vertical);assert.ok(near.vertical<0);
  const off={...still,modes:{...still.modes,[name]:{...still.modes[name],ground_drag_relief:0}}};
  const control=run(s,{},.05,off);assert.ok(near.z>control.z);
  const banked=run({...s,bank:.9}, {},.0083);assert.equal(banked.groundEffect,0);
  const slope=run(s,{},.0083,still,x=>x*.6);assert.equal(slope.groundEffect,0);
  assert.equal(run({...s,z:2.5},{},20).grounded,true,'no altitude hold');
 }
});

test('wind cue texels are actual shared air vectors at surface height, including reversal and calm',()=>{
 const ground={height:(x,y)=>20+x*.01+y*.02},camera={position:{x:40,z:-60}};
 for(const bearing of [90,270]){
  const sample=(x,y,z)=>sampleAir(config,bearing,{x,y,z,weather:'alpine'},18,ground.height);
  const cue=createAirCues(sample,ground,{size:4,span:80});cue.update(camera,.2);
  const grid=style.airGrid.value,data=cue.texture.image.data;
  for(let row=0;row<4;row++)for(let col=0;col<4;col++){
   const x=grid.x+(col+.5)*20,y=-(grid.y+(row+.5)*20),a=sample(x,y,ground.height(x,y)+2),i=(row*4+col)*4;
   assert.ok(Math.abs(data[i]-a.wx)<1e-5);assert.ok(Math.abs(data[i+1]+a.wy)<1e-5);
   assert.ok(Math.abs(data[i+2]-a.lift)<1e-5);
  }
  assert.equal(Math.sign(data[0]),bearing===270?1:-1);cue.dispose();
 }
 const zero=createAirCues((x,y,z)=>sampleAir(still,270,{x,y,z},0,flat),{height:flat});zero.update(camera,.2);
 assert.ok(zero.texture.image.data.every(v=>Math.abs(v)<1e-9));zero.dispose();
});

test('maneuver control is held B or Shift and leaves normal analogue controls available',()=>{
 const pad={axes:[.6,-.7,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 assert.equal(flightInput(pad).maneuver,false);pad.buttons[1].pressed=true;
 const input=flightInput(pad);assert.equal(input.maneuver,true);assert.ok(input.turn>0);assert.ok(input.brake<0);
 assert.equal(flightInput(null,new Set(['ShiftLeft'])).maneuver,true);
 pad.buttons[1].pressed=false;assert.equal(flightInput(pad).maneuver,false);
});

test('shared wing skins have forward volume, taper to a thin tail and expose a recessed intake',async()=>{
 const {parseGLB}=await import('../src3d/glb.js');
 for(const asset of ['parafoil','parakite']){
  const data=parseGLB(readFileSync(new URL('../../../shared/geometry/flight/'+asset+'.glb',import.meta.url)));
  const points=pattern=>data.primitives.filter(p=>pattern.test(p.materialName)).flatMap(p=>{
   const a=p.geometry.attributes.position;return Array.from({length:a.count},(_,i)=>[a.getX(i),a.getY(i),a.getZ(i)]);
  });
  const mode=config.modes[asset==='parafoil'?'paraglider':'parakite'];
  const upper=points(/^upper/).filter(p=>Math.abs(p[0])<.4),lower=points(/^lower/).filter(p=>Math.abs(p[0])<.4);
  const section=(list,t)=>list.filter(p=>Math.abs((.52-p[2]/mode.chord_m)-t)<.025).map(p=>p[1]);
  const max=a=>Math.max(...a),min=a=>Math.min(...a);
  const front=max(section(upper,.23))-min(section(lower,.23));
  const tail=max(section(upper,1))-min(section(lower,1));
  assert.ok(front>mode.chord_m*.12,'inflated section has actual depth');
  assert.ok(tail<front*.15,'trailing edge tapers instead of remaining a slab');
  const mouth=points(/^intake/).filter(p=>Math.abs(p[0])<.4);
  assert.ok(max(mouth.map(p=>p[2]))<max(upper.map(p=>p[2]))-.05,'opening is below and behind the nose');
  const harness=points(/^harness/),risers=points(/^webbing/),lines=points(/^suspension/),brakes=points(/^brake/);
  assert.ok(min(risers.map(p=>p[1]))<max(harness.map(p=>p[1])),'risers overlap harness connection');
  assert.ok(min(lines.map(p=>p[1]))<max(risers.map(p=>p[1])),'suspension starts at risers');
  assert.ok(max(brakes.map(p=>p[1]))>3,'independent control fans reach the wing');
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight,sampleAir} from '../../../shared/activities/flight.js';
import {flightInput,flightDeadzone} from '../src3d/flight-input.js';
import {parseGLB} from '../src3d/glb.js';
import {createResolutionGovernor} from '../src3d/flight-quality.js';
import {createFlightRig} from '../src3d/flight-rig.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const flat=()=>0,site={xy_m:[0,0],heading_deg:0};
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const legacy={...still,coupled:undefined};
function fly(mode,input,seconds=8,rules=still,state=null){let s=state??{...launchFlight(rules,mode,site,flat),z:1500};for(let i=0;i<seconds*120;i++)s=stepFlight(s,typeof input==='function'?input(i/120):input,1/120,i/120,rules,270,flat);return s;}

test('air field is repeatable, continuous, height-sheared and rougher in alpine weather',()=>{
 const s={x:21,y:53,z:80,weather:'soaring'};
 assert.deepEqual(sampleAir(config,270,s,12,flat),sampleAir(config,270,s,12,flat));
 const a=sampleAir(config,270,s,12,flat),b=sampleAir(config,270,{...s,x:s.x+.01},12.001,flat);
 assert.ok(Math.abs(a.lift-b.lift)<.03);assert.ok(Math.abs(a.wx-b.wx)<.03);
 const alpine=sampleAir(config,270,{...s,weather:'alpine'},12,flat);
 assert.ok(alpine.intensity>a.intensity);assert.ok(alpine.windSpeed>a.windSpeed);
 const noGust={...config,thermals:[],wind:{speed_mps:5,gust_mps:0}};
 assert.ok(sampleAir(noGust,270,{...s,z:400},0,flat).windSpeed>sampleAir(noGust,270,{...s,z:5},0,flat).windSpeed);
});

test('windward lift changes to lee sink and rotor when the terrain falls away',()=>{
 const rules={...config,thermals:[],wind:{speed_mps:7,gust_mps:0},weather:{soaring:{wind_scale:1,gust_scale:1,thermal_scale:0,turbulence_mps:0}}};
 const s={x:0,y:0,z:120,weather:'soaring'},up=(x)=>100+x*.5,down=(x)=>100-x*.5;
 const windward=sampleAir(rules,270,s,0,up),lee=sampleAir(rules,270,s,0,down);
 assert.ok(windward.ridge>0);assert.ok(lee.ridge<0);assert.ok(lee.lee>0);assert.ok(lee.lift<0);assert.ok(lee.intensity>windward.intensity);
 assert.ok(Math.abs(sampleAir(rules,270,{...s,z:1500},0,down).ridge)<Math.abs(lee.ridge));
});

test('thermals tilt downwind, have surrounding sink and stop at their core top',()=>{
 const rules={...config,wind:{speed_mps:5,gust_mps:0},thermals:[{xy_m:[0,0],radius_m:180,lift_mps:5,top_m:1200}]};
 const thermal=(x,z)=>sampleAir(rules,270,{x,y:0,z,weather:'soaring'},0,flat).thermal;
 assert.ok(thermal(80,500)>thermal(0,500));assert.ok(thermal(400,500)<0);assert.equal(thermal(80,1300),0);
});

test('legacy polar offers minimum sink below trim; acceleration and banking cost height',()=>{
 // This is the fallback polar's fixed response, not a demand that the force
 // model reach the same phugoid phase at this exact eight-second sample.
 const trim=fly('paraglider',{},8,legacy),slow=fly('paraglider',{brake:.3},8,legacy),fast=fly('paraglider',{brake:-1},8,legacy),bank=fly('paraglider',{turn:.8},8,legacy);
 assert.ok(slow.speed<trim.speed);assert.ok(slow.vertical>trim.vertical);
 assert.ok(fast.speed>trim.speed);assert.ok(fast.z<trim.z);assert.ok(bank.load>1.1);assert.ok(bank.z<trim.z);
 const left=fly('paraglider',{brakeLeft:.65}),right=fly('paraglider',{brakeRight:.65});
 assert.ok(left.heading>0);assert.ok(right.heading<0);assert.ok(Math.abs(left.heading+right.heading)<1e-8);
});

test('legacy no-power dive/flare pumping cannot create reduced mechanical energy',()=>{
 for(const mode of Object.keys(config.modes)){
  const initial={...launchFlight(legacy,mode,site,flat),z:1500,throttle:0,engine:0};
  const final=fly(mode,t=>({brake:Math.floor(t/2)%2?1:-1}),20,legacy,initial);
  assert.ok(final.z+final.speed**2/(2*9.81)<initial.z+initial.speed**2/(2*9.81)-5,mode);
 }
});

test('headwind alters ground track without changing still-air airspeed or granting climb',()=>{
 const rules={...still,wind:{speed_mps:5,gust_mps:0},weather:{soaring:{wind_scale:1,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
 const initial={...launchFlight(rules,'paraglider',site,flat),z:1500};let head={...initial},tail={...initial};
 for(let i=0;i<600;i++){head=stepFlight(head,{},1/120,i/120,rules,90,flat);tail=stepFlight(tail,{},1/120,i/120,rules,270,flat);}
 assert.ok(Math.abs(head.speed-tail.speed)<1e-10);assert.ok(Math.abs(head.z-tail.z)<1e-10);assert.ok(head.groundSpeed<tail.groundSpeed);assert.ok(head.z<initial.z);
});

test('parakite neutral is best-glide travel; a right turn releases the outside left handle',()=>{
 const s=launchFlight(still,'parakite',site,flat);
 const neutral=stepFlight(s,{},1/120,0,still,270,flat),right=stepFlight(s,{turn:1},1/120,0,still,270,flat);
 assert.equal(neutral.handleLeft,.45);assert.equal(neutral.handleRight,.45);
 assert.ok(right.handleLeft<right.handleRight);assert.ok(right.bank>0);
 const deep=fly('parakite',{brake:1},8);assert.ok(deep.stall>0);assert.ok(deep.pressure<1);
 const recovered=fly('parakite',{},4,still,deep);assert.ok(recovered.speed>deep.speed);assert.ok(recovered.stall<deep.stall);
});

test('motor power spools rather than jumping, and zero power returns to a glide',()=>{
 const s={...launchFlight(still,'paramotor',site,flat),z:1500,throttle:0,engine:0};
 const one=stepFlight(s,{throttle:1},1/120,0,still,270,flat);
 assert.ok(one.engine>0&&one.engine<one.throttle);
 const powered=fly('paramotor',{throttle:1},8,still,s);assert.ok(powered.z>s.z);assert.equal(powered.figure,'Powered climb');
 const off=fly('paramotor',{throttle:-1},12,still,powered);assert.equal(off.throttle,0);assert.ok(off.vertical<0);
});

test('controller mapping keeps analogue brakes, power and speed independent',()=>{
 const pad={axes:[.5,-.8,.4,0],buttons:Array.from({length:16},()=>({value:0,pressed:false}))};
 pad.buttons[6]={value:.25,pressed:true};pad.buttons[7]={value:.8,pressed:true};
 const input=flightInput(pad);assert.equal(input.brakeLeft,.25);assert.equal(input.brakeRight,.8);assert.equal(input.throttle,0);assert.ok(input.turn>0&&input.turn<.5);assert.ok(input.brake<0);
 pad.buttons[5].pressed=true;assert.equal(flightInput(pad).throttle,1);
 assert.equal(flightDeadzone(.1),0);assert.equal(flightDeadzone(-1),-1);assert.equal(flightDeadzone(1),1);
 assert.equal(flightInput(null).turn,0);
});

test('canopy deforms actual sail vertices with fixed harness and bounded cloth work',()=>{
 const assets={};for(const path of [config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset])assets[path]=parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)));
 const rig=createFlightRig(assets,config),s={...launchFlight(config,'paraglider',site,flat),brakeLeft:.8,bank:.5,rollRate:.2,turbulence:1};
 const {mesh,rest}=rig.wings.paraglider;rig.update(.1,s);const p=mesh.geometry.attributes.position;
 let sailMoved=false;
 for(let i=0;i<p.count;i++){const n=i*3;assert.ok([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));if(rest[n+1]<1.3)assert.equal(p.getY(i),rest[n+1]);if(rest[n+1]>3&&Math.abs(p.getY(i)-rest[n+1])>.02)sailMoved=true;}
 assert.ok(sailMoved);const before=p.array.slice();rig.update(.001,{...s,brakeLeft:0});assert.deepEqual(p.array,before,'skip cloth work before next 30 Hz tick');
 rig.update(.1,{...s,mode:'paramotor',engine:1});assert.equal(rig.motor.visible,true);assert.ok(rig.prop.rotation.z>0);rig.dispose();
});

test('a controller alone can launch, steer, change wing/ridge/weather, look and retry',async()=>{
 const T=await import('../vendor/three.module.min.js');const {createNavigation}=await import('../src3d/navigation.js');
 const previous=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget();let pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 Object.defineProperty(globalThis,'window',{value:win,configurable:true});Object.defineProperty(globalThis,'document',{value:doc,configurable:true});Object.defineProperty(globalThis,'navigator',{value:{getGamepads:()=>[pad]},configurable:true});
 const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url))),ride=read('../../../shared/activities/ride.json'),world=read('../../../shared/world/worldmap.json'),characterConfig=read('../../../shared/characters/player.json');
 const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const camera=new T.PerspectiveCamera(62),cat={object:new T.Group(),update(){}},rig=new T.Group(),rideRig=new T.Group();let changes=0;
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),update(){},setTarget(){}},{height:flat},{...config,launch_clearance_m:500},world,rig,()=>null,{config:ride,rig:rideRig,meshes:{},height:flat,snowAt:()=>1},cat,characterConfig,{onFlightChange:()=>changes++});
 const press=i=>{pad.buttons[i].pressed=true;nav.update(1/60);pad.buttons[i].pressed=false;nav.update(1/60);};
 try{
  nav.update(0); // Observe released input before accepting the first deliberate A.
  press(0);assert.equal(nav.mode,'paraglider');assert.ok(nav.state.distance>0);
  pad.buttons[0].pressed=true;nav.update(1/60);const first=nav.state.distance;for(let i=0;i<20;i++)nav.update(1/60);assert.ok(nav.state.distance>first+1,'a held retry must not relaunch every frame');pad.buttons[0].pressed=false;nav.update(1/60);
  press(15);assert.equal(nav.mode,'parakite');pad.axes[0]=.65;for(let i=0;i<60;i++)nav.update(1/60);assert.ok(nav.state.bank>.1);pad.axes[0]=1;pad.buttons[1].pressed=true;for(let i=0;i<150;i++)nav.update(1/60);assert.ok(nav.state.bank>config.modes.parakite.max_bank_rad+.1,'B grants maneuver authority');pad.buttons[1].pressed=false;pad.axes[0]=0;for(let i=0;i<240;i++)nav.update(1/60);assert.ok(Math.abs(nav.state.bank)<.05,'releasing B recovers');
  press(15);assert.equal(nav.mode,'paramotor');const throttle=nav.state.throttle;pad.buttons[5].pressed=true;for(let i=0;i<60;i++)nav.update(1/60);assert.ok(nav.state.throttle>throttle);pad.buttons[5].pressed=false;
  press(13);assert.equal(nav.siteIndex,1);press(9);assert.equal(nav.weather,'alpine');assert.equal(nav.state.weather,'alpine');
  press(3);assert.equal(nav.view,'first');assert.equal(cat.object.visible,false);
  const view=camera.quaternion.clone();pad.axes[2]=.7;for(let i=0;i<10;i++)nav.update(1/60);assert.ok(camera.quaternion.angleTo(view)>.01);
  press(0);assert.equal(nav.state.grounded,false);assert.ok(changes>0);
 }finally{nav.dispose();for(const [key,value]of previous)value?Object.defineProperty(globalThis,key,value):delete globalThis[key];}
});


test('adaptive resolution restores sharpness if a trial fails to improve pacing',()=>{
 const cpu=createResolutionGovernor();assert.equal(cpu.sample(33.3,3000),.9);assert.equal(cpu.sample(33.3,9000),1);assert.equal(cpu.sample(33.3,12000),1);
 const gpu=createResolutionGovernor();assert.equal(gpu.sample(40,3000),.9);assert.equal(gpu.sample(32,9000),.9);assert.ok(gpu.sample(32,15000)<.9);assert.equal(gpu.sample(32,18000,false),1);
 const capped=createResolutionGovernor();for(let t=3000;t<90000;t+=6000)assert.ok(capped.sample(33.3,t)>=.9);
});

test('the T5 launch belongs to the core trailhead and clears actual rising terrain',async()=>{
 const {GroundSampler,HeightGrid}=await import('../src3d/heights.js');
 const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url))),manifest=read('../data/viewer.json'),world=read('../../../shared/world/worldmap.json');
 const grid=(path,metadata)=>{const b=readFileSync(new URL(path,import.meta.url));return new HeightGrid({...metadata,values:new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength))});};
 const ground=new GroundSampler(grid('../data/heightmap.f32',manifest.height_grids.block),grid('../data/farfield.f32',manifest.height_grids.far_field));
 const height=(x,y)=>ground.height(x,y)??0,launch=config.launches.find(l=>l.id==='trail-t5');
 assert.deepEqual(launch.xy_m,world.tracks.find(t=>t.id==='T5').polyline[0]);
 let s=launchFlight(config,'parakite',launch,height,'calm');
 for(let i=0;i<1200;i++){
  s=stepFlight(s,{brake:i<180?-1:0},1/120,i/120,config,world.wind.direction_deg,height);
  assert.equal(s.grounded,false,'the initial dive must not face a rising wall');
 }
 assert.ok(s.distance>150);
});

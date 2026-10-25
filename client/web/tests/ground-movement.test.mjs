import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import * as walk from '../../../shared/activities/walk.js';
import {launchFlight,stepFlight} from '../../../shared/activities/flight.js';
import {createNavigation} from '../src3d/navigation.js';
import {GroundSampler,HeightGrid} from '../src3d/heights.js';
import {createTrailSampler} from '../../../shared/activities/ride.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const character=read('../../../shared/characters/player.json'),flight=read('../../../shared/activities/flight.json');
const ride=read('../../../shared/activities/ride.json'),world=read('../../../shared/world/worldmap.json');
const flat=()=>0,origin=()=>({x:0,y:0,z:0,heading:0,speed:0});
function fixture(t){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget(),pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[pad]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const rules={...flight,thermals:[],wind:{speed_mps:0,gust_mps:0},launches:[{...flight.launches[0],xy_m:[0,0],heading_deg:225,clearance_m:2}]};
 const rig=new T.Group(),cat={object:new T.Group(),update(){}};
 const camera=new T.PerspectiveCamera();
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:flat},rules,world,rig,()=>null,{config:ride,rig:new T.Group(),meshes:{ski:new T.Group(),bike:new T.Group()},height:flat,snowAt:()=>1,surfaceAt:()=> 'snow'},cat,character);
 const key=(type,code)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:canvas}});win.dispatchEvent(e);};
 t.after(()=>{nav.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 return {nav,pad,key,win,rig,camera,cat};
}
test('controller A jumps on foot without restarting at a ridge, and holding it cannot jump again',t=>{
 const {nav,pad}=fixture(t);nav.select('walk');nav.update(1/60);const before={...nav.state};
 pad.buttons[0].pressed=true;for(let i=0;i<180;i++)nav.update(1/60);
 assert.equal(nav.mode,'walk','A on foot must not launch/restart a flight');
 assert.equal(nav.state.jumpCount,1);assert.equal(nav.state.grounded,true);
 assert.equal(nav.state.x,before.x);assert.equal(nav.state.y,before.y);
 pad.buttons[0].pressed=false;nav.update(1/60);pad.buttons[0].pressed=true;nav.update(1/60);assert.equal(nav.state.jumpCount,2);
});
test('shared jump has ballistic air and landing phases; idle variants stay stable per jump',()=>{
 let s=origin();const seen=new Set(),variants=[],j=character.walk.jump;
 // Ballistic to the hang band, then the eased gravity of the hang.
 const apex=(j.takeoff_mps**2-j.apex_mps**2)/(2*j.gravity_mps2)+j.apex_mps**2/(2*j.gravity_mps2*j.apex_gravity);
 for(let jump=0;jump<3;jump++){
  s=walk.stepWalk(s,{x:0,y:0,jump:false},1/60,character.walk,flat);
  let peak=0,variant;
  for(let i=0;i<180;i++){
   const before=s;s=walk.stepWalk(s,{x:0,y:0,jump:true},1/60,character.walk,flat);
   if(i===0){variant=s.jumpStyle;variants.push(variant);}
   if(s.jumpPhase!=='grounded')assert.equal(s.jumpStyle,variant);
   seen.add(s.jumpPhase);peak=Math.max(peak,s.z);assert.ok(s.z>=0);assert.notEqual(s,before);
  }
  assert.ok(peak>apex*.95&&peak<=apex+1e-9,`peak ${peak.toFixed(2)} m`);assert.equal(s.z,0);assert.equal(s.jumpCount,jump+1);
 }
 assert.deepEqual(variants,['celebrate','heel_click','star']);
 for(const phase of ['airborne','landing','grounded'])assert.ok(seen.has(phase),phase);
});
test('he leaves the ground on the frame that sees the press; a tap hops, holding jumps full height',()=>{
 const w=character.walk,apex=w.jump.takeoff_mps**2/(2*w.jump.gravity_mps2);
 const frames=input=>{const out=[];let s=walk.stepWalk(origin(),{x:0,y:0,jump:true},1/30,w,flat);
  for(let i=1;s.jumpPhase==='airborne';i++){const vz=s.vz;s=walk.stepWalk(s,{x:0,y:0,jump:input(i)},1/30,w,flat);out.push({z:s.z,dv:vz-s.vz});}return out;};
 // Letting go never stops him dead (the old clamp did, like a ceiling): no frame
 // slows him by more than the raised gravity can, and holding hangs at the top.
 for(const {dv}of frames(i=>i<4))assert.ok(dv<=w.jump.gravity_mps2*w.jump.release_gravity/30+1e-9,`slowed ${dv.toFixed(1)} m/s in one frame`);
 const near=arc=>arc.filter(f=>f.z>Math.max(...arc.map(a=>a.z))-.3).length;
 assert.ok(near(frames(()=>true))>=2*near(frames(()=>false)),'holding hangs at the peak longer than a hop');
 const jump=frames=>{
  let s=walk.stepWalk(origin(),{x:0,y:0,jump:true},1/30,w,flat),peak=s.z;
  assert.ok(s.jumpPhase==='airborne'&&s.z>0,'no anticipation crouch on the ground');
  for(let i=1;s.jumpPhase==='airborne';i++){s=walk.stepWalk(s,{x:0,y:0,jump:i<frames},1/30,w,flat);peak=Math.max(peak,s.z);}
  return peak;
 };
 const full=jump(60),tap=jump(1);
 assert.ok(full>apex*.95,`held: ${full.toFixed(2)} m`);
 assert.ok(tap<full*.4,`tapped: ${tap.toFixed(2)} m of ${full.toFixed(2)} m`);
});
test('a press just before touchdown, or during the landing crouch, still jumps',()=>{
 const step=(s,jump)=>walk.stepWalk(s,{x:0,y:0,jump},1/30,character.walk,flat);
 let s=step(origin(),true);while(!(s.vz<0&&s.z<1.6))s=step(s,true);
 s=step(s,false);s=step(s,true);assert.equal(s.jumpPhase,'airborne');assert.equal(s.jumpCount,1);
 for(let i=0;i<6;i++)s=step(s,false);
 assert.equal(s.jumpCount,2,'the press made in the air jumps on touchdown');
 while(s.jumpPhase!=='landing')s=step(s,true);
 s=step(s,false);s=step(s,true);assert.equal(s.jumpCount,3,'a press in the landing crouch is not dropped');
});
test('jumping again at touchdown climbs to a double, then a triple that needs him moving',()=>{
 const w=character.walk;
 const chain=input=>{
  let s=origin();const tiers=[],peaks=[],styles=[];
  for(let i=0;i<30;i++)s=walk.stepWalk(s,input,1/30,w,flat);
  for(let n=0;n<3;n++){
   s=walk.stepWalk(s,{...input,jump:false},1/30,w,flat);s=walk.stepWalk(s,{...input,jump:true},1/30,w,flat);
   tiers.push(s.jumpTier);styles.push(s.jumpStyle);let peak=s.z;
   while(s.jumpPhase!=='landing'){s=walk.stepWalk(s,{...input,jump:true},1/30,w,flat);peak=Math.max(peak,s.z);}
   peaks.push(peak);
  }
  return {s,tiers,peaks,styles};
 };
 const run=chain({x:1,y:0,run:true});
 assert.deepEqual(run.tiers,[1,2,3]);assert.deepEqual(run.styles.slice(1),['star','hop']);
 assert.ok(run.peaks[0]<run.peaks[1]&&run.peaks[1]<run.peaks[2],`peaks ${run.peaks.map(p=>p.toFixed(1))}`);
 assert.deepEqual(chain({x:1,y:0}).tiers,[1,2,3],'a full-stick walk is enough: no run button needed');
 assert.deepEqual(chain({x:.4,y:0}).tiers,[1,2,1],'a creep is too slow for the triple');
 // The window outlasts the landing crouch: a press just after he stands up still chains.
 let stood=walk.stepWalk(origin(),{x:0,y:0,jump:true},1/30,w,flat);while(stood.jumpPhase!=='landing')stood=walk.stepWalk(stood,{x:0,y:0,jump:true},1/30,w,flat);
 for(let i=0;i<Math.ceil(w.jump.landing_s*30);i++)stood=walk.stepWalk(stood,{x:0,y:0,jump:false},1/30,w,flat);
 assert.equal(stood.jumpPhase,'grounded');assert.equal(walk.stepWalk(stood,{x:0,y:0,jump:true},1/30,w,flat).jumpTier,2);
 let late=run.s;for(let i=0;i<12;i++)late=walk.stepWalk(late,{x:0,y:0,jump:false},1/30,w,flat);
 assert.equal(walk.stepWalk(late,{x:0,y:0,jump:true},1/30,w,flat).jumpTier,1,'waiting out the landing restarts the chain');
});
test('a jump never carries him over a structure to land inside its box',()=>{
 const w=character.walk,r=w.radius_m,box=createCollisionIndex([{min:[2,-2,0],max:[4,2,3],kind:'structure'}]);
 let s={x:1,y:0,z:3.5,heading:0,speed:9,vx:9,vy:0,vz:0,grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpCount:1};
 while(s.jumpPhase==='airborne')s=walk.stepWalk(s,{x:1,y:0,run:true,jump:true},1/30,w,flat,box);
 assert.ok(s.x<=2-r+1e-9,`landed at x ${s.x.toFixed(2)}, outside the box`);
 for(let i=0;i<30;i++)s=walk.stepWalk(s,{x:-1,y:0},1/30,w,flat,box);
 assert.ok(s.x<1,'and can still walk away');
});
test('moving hop preserves launch momentum, blocks swept contact, cliffs and unsupported landing surfaces',()=>{
 let s=origin();for(let i=0;i<14;i++)s=walk.stepWalk(s,{x:1,y:0,run:true},.05,character.walk,flat);
 const runUp=s.x;assert.equal(s.speed,character.walk.run_mps);
 s=walk.stepWalk(s,{x:1,y:0,run:true,jump:true},.05,character.walk,flat);assert.equal(s.jumpStyle,'hop');
 for(let i=0;i<15;i++)s=walk.stepWalk(s,{x:0,y:0,jump:true},1/60,character.walk,flat);
 assert.ok(s.x-runUp>1.8,'released direction retains forward air momentum');assert.ok(s.z>.3);
 const blocked=walk.stepWalk(s,{x:1,y:0},.05,character.walk,flat,()=>({kind:'tree'}));assert.equal(blocked.x,s.x);
 const boundary=walk.stepWalk(s,{x:1,y:0},.05,character.walk,()=>null);assert.equal(boundary.x,s.x);
 const cliff=walk.stepWalk(origin(),{x:1,y:0,jump:true},.05,character.walk,x=>x>0?8:0);assert.equal(cliff.x,0);
});
test('traction ramps starts and stops, contact slides along box faces, and turns publish a signed rate',()=>{
 const w=character.walk,walkFor=(s,input,seconds)=>{for(let t=0;t<seconds-1e-9;t+=1/60)s=walk.stepWalk(s,input,1/60,w,flat);return s;};
 let s=walkFor(origin(),{x:1,y:0},.1);
 assert.ok(Math.abs(s.speed-w.accel_mps2*.1)<.05,'a tenth of a second in, the cat is still speeding up');
 s=walkFor(s,{x:1,y:0},.3);assert.equal(s.speed,w.walk_mps);
 s=walkFor(s,{x:0,y:0},w.walk_mps/w.decel_mps2+1/60);assert.equal(s.speed,0,'releasing brakes to a stop within walk/decel');
 const {accel_mps2,decel_mps2,...older}=w;
 assert.equal(walk.stepWalk(origin(),{x:1,y:0},1/60,older,flat).speed,w.walk_mps,'contracts without traction keep instant response');
 // A wall face at x = 1 (box), approached diagonally: x stops at the face, y keeps going.
 const wall=(from,to,r)=>Math.max(from[0],to[0])+r>1?{kind:'structure'}:null;
 let d=origin();for(let i=0;i<120;i++)d=walk.stepWalk(d,{x:1,y:1},1/60,w,flat,wall);
 assert.ok(d.x+w.radius_m<=1+1e-9&&d.y>3,'slides along the face instead of sticking');
 let h=origin();for(let i=0;i<60;i++)h=walk.stepWalk(h,{x:1,y:0},1/60,w,flat,wall);
 assert.ok(h.speed===0&&h.x+w.radius_m<=1+1e-9,'head-on contact still stops');
 let turn=walkFor(origin(),{x:1,y:0},.5);turn=walk.stepWalk(turn,{x:0,y:1},1/60,w,flat);
 assert.ok(turn.turnRate>0,'turning toward +y (anticlockwise) is a positive rate');
});
test('the gait follows ground speed: stroll, then walk, then run; contracts without a stroll walk',()=>{
 const w=character.walk,slots=character.clips;
 assert.deepEqual([.5,w.stroll_mps-.01,w.stroll_mps,w.walk_mps,w.walk_mps*1.2,w.run_mps].map(v=>walk.gaitFor(v,w,slots)),['stroll','stroll','walk','walk','run','run']);
 assert.equal(walk.gaitFor(.5,w,{...slots,stroll:undefined}),'walk');
});
const fall=(z,config)=>{
 let s={x:0,y:0,z,heading:0,speed:0,grounded:false,jumpPhase:'airborne',jumpCount:1,jumpStyle:'hop',vz:0};
 const phases=[],trace=[];
 for(let i=0;i<120*8;i++){
  const before=s;s=walk.stepWalk(s,{x:1,y:0},1/120,config,flat);trace.push({before,after:s});
  if(phases.at(-1)!==s.jumpPhase)phases.push(s.jumpPhase);
  if(s.jumpPhase==='grounded')break;
 }
 return {s,phases,trace};
};
test('a high fall bounces once, tumbles without control, then stands',()=>{
 const {s,phases,trace}=fall(12,character.walk),j=character.walk.jump;
 assert.deepEqual(phases,['airborne','bounce','tumble','grounded']);
 const apex=Math.max(...trace.filter(t=>t.after.jumpPhase==='bounce').map(t=>t.after.z));
 assert.ok(apex>.2&&apex<1.5,`bounce apex ${apex.toFixed(2)} m`);
 const tumbling=trace.filter(t=>t.after.jumpPhase==='tumble');
 for(const t of tumbling)assert.ok(t.after.speed<=t.before.speed+1e-9,'input cannot speed him up mid-tumble');
 assert.ok(Math.abs(tumbling.length/120-j.tumble_s)<.02,`tumble lasted ${(tumbling.length/120).toFixed(3)} s`);
 assert.equal(s.z,0);assert.ok(s.landingSpeed>j.tumble_mps);
});
test('he can jump off a ledge edge, where the drop beside him is not a slope, and still not up against a wall',()=>{
 const ledge=(x,y)=>Math.abs(x)<2&&Math.abs(y)<2?12:0;
 let s={x:0,y:1.9,z:12,heading:Math.PI/2,speed:0};
 s=walk.stepWalk(s,{x:0,y:0,jump:true},1/60,character.walk,ledge);
 assert.equal(s.jumpPhase,'airborne','a jump at the edge of a 12 m platform is allowed');
 const wall=(x,y)=>y>2?12:0;let w={x:0,y:1.9,z:0,heading:Math.PI/2,speed:0};
 w=walk.stepWalk(w,{x:0,y:0,jump:true},1/60,character.walk,wall);
 assert.equal(w.jumpPhase,'grounded','a wall face beside him still counts as steep ground');
});
test('ordinary drops and older contracts never bounce',()=>{
 assert.deepEqual(fall(4,character.walk).phases,['airborne','landing','grounded']);
 const {tumble_mps,rebound,tumble_s,...jump}=character.walk.jump;
 assert.deepEqual(fall(12,{...character.walk,jump}).phases,['airborne','landing','grounded']);
});
test('safe unharness preserves location, rejects midair/impact/slope/obstacle, and local re-entry clears motor and stale poses',()=>{
 for(const mode of Object.keys(flight.modes)){
  const landed={...launchFlight(flight,mode,flight.launches[0],flat),x:13,y:-7,z:flight.landing_clearance_m,grounded:true,speed:0};
  const foot=walk.unharnessFlight(landed,character.walk,flight,flat);
  assert.equal(foot.x,13);assert.equal(foot.y,-7);assert.equal(foot.z,0);assert.equal(foot.harnessMode,mode);
  assert.equal(walk.unharnessFlight({...landed,grounded:false},character.walk,flight,flat),null);
  assert.equal(walk.unharnessFlight({...landed,impact:'tree'},character.walk,flight,flat),null);
  assert.equal(walk.unharnessFlight(landed,character.walk,flight,x=>x*2),null);
  assert.equal(walk.unharnessFlight(landed,character.walk,flight,flat,()=>({kind:'structure'})),null);
  const harness=walk.reharnessWalk(foot,character.walk,flight,flat);
  assert.equal(harness.x,foot.x);assert.equal(harness.y,foot.y);assert.equal(harness.z,landed.z);
  assert.equal(harness.mode,mode);assert.equal(harness.grounded,true);assert.equal(harness.engine,0);
  const launch=walk.relaunchGround(harness,character.walk,flight,flat);
  assert.equal(launch.z,harness.z,'relaunch starts at current contact height');assert.equal(launch.grounded,false);
  assert.ok(stepFlight(launch,{},1/120,0,flight,world.wind.direction_deg,flat).z>launch.z);
 }
});
test('normal pad sequence lands, unhooks, walks, rehooks and launches locally; held/blur input cannot leak',t=>{
 const {nav,pad,win}=fixture(t);
 for(const mode of Object.keys(flight.modes)){
  nav.select(mode);pad.buttons[4].pressed=true;for(let i=0;i<2000&&!nav.state.grounded;i++)nav.update(1/60);pad.buttons[4].pressed=false;
  assert.equal(nav.state.grounded,true);const landed={...nav.state};
  pad.buttons[2].pressed=true;nav.update(1/60);assert.equal(nav.mode,'walk');assert.equal(nav.state.x,landed.x);assert.equal(nav.state.y,landed.y);
  pad.buttons[0].pressed=true;for(let i=0;i<20;i++)nav.update(1/60);assert.equal(nav.mode,'walk');
  pad.buttons[0].pressed=false;pad.buttons[2].pressed=false;nav.update(1/60);
  pad.axes[1]=-1;for(let i=0;i<60;i++)nav.update(1/60);pad.axes[1]=0;nav.update(1/60);const foot={...nav.state};
  assert.ok(Math.hypot(foot.x-landed.x,foot.y-landed.y)>3);
  const forward=(foot.x-landed.x)*Math.cos(landed.heading)+(foot.y-landed.y)*Math.sin(landed.heading);
  assert.ok(forward>3,'forward after unhook follows the landed character heading');
  nav.setWeather('calm');
  pad.buttons[2].pressed=true;nav.update(1/60);assert.equal(nav.mode,mode);assert.equal(nav.state.x,foot.x);assert.equal(nav.state.y,foot.y);assert.equal(nav.state.grounded,true);
  assert.equal(nav.state.weather,'calm','weather selected on foot survives re-entry');
  pad.buttons[0].pressed=true;nav.update(1/60);assert.equal(nav.state.grounded,true,'simultaneously held A is blocked across rehook');
  pad.buttons[0].pressed=false;pad.buttons[2].pressed=false;nav.update(1/60);
  pad.buttons[0].pressed=true;nav.update(1/60);assert.equal(nav.state.grounded,false);assert.ok(Math.hypot(nav.state.x-foot.x,nav.state.y-foot.y)<1);
  pad.buttons[0].pressed=false;nav.update(1/60);
 }
 nav.select('orbit');nav.select('walk');nav.update(1/60);pad.buttons[0].pressed=true;win.dispatchEvent(new Event('blur'));nav.update(1/60);assert.equal(nav.mode,'walk');assert.equal(nav.state.jumpCount??0,0);
});

test('pressing A while airborne never queues a launch on later landing',t=>{
 const {nav,pad}=fixture(t);nav.select('paraglider');nav.update(1/60);pad.buttons[0].pressed=true;
 for(let i=0;i<600;i++)nav.update(1/60);
 assert.equal(nav.state.grounded,true);const end={...nav.state};
 for(let i=0;i<120;i++)nav.update(1/60);assert.equal(nav.state.x,end.x);assert.equal(nav.state.y,end.y);
});

test('keyboard repeats after retry or blur cannot synthesize another interaction edge',t=>{
 const {nav,key,win}=fixture(t);nav.select('paraglider');nav.update(1/60);
 key('keydown','Space');nav.update(1/60);
 for(let i=0;i<600;i++)nav.update(1/60);
 assert.equal(nav.state.grounded,true);
 // Browsers send repeated keydown for a physically held key after clear/retry.
 const e=new Event('keydown');Object.defineProperties(e,{code:{value:'Space'},repeat:{value:true},target:{value:{tagName:'CANVAS'}}});win.dispatchEvent(e);
 nav.update(1/60);assert.equal(nav.state.grounded,true);
 key('keyup','Space');nav.update(1/60);key('keydown','KeyE');nav.update(1/60);assert.equal(nav.mode,'walk');
 key('keyup','KeyE');nav.update(1/60);key('keydown','Space');nav.update(1/60);win.dispatchEvent(new Event('blur'));
 const count=nav.state.jumpCount;win.dispatchEvent(e);for(let i=0;i<180;i++)nav.update(1/60);assert.equal(nav.state.jumpCount,count);
});

test('a short keyboard tap between render frames still accepts exactly one jump',t=>{
 const {nav,key}=fixture(t);nav.select('walk');nav.update(1/60);
 key('keydown','Space');key('keyup','Space');nav.update(1/60);
 assert.equal(nav.state.jumpCount,1);
 for(let i=0;i<120;i++)nav.update(1/60);assert.equal(nav.state.jumpCount,1);assert.equal(nav.state.grounded,true);
});

test('through a jump the view never jolts, and he rises in the frame without leaving it',t=>{
 const {nav,pad,camera,cat}=fixture(t);nav.select('walk');for(let i=0;i<30;i++)nav.update(1/30);
 const screen=[],pitch=[],euler=new T.Euler();
 pad.buttons[0].pressed=true;
 for(let i=0;i<40;i++){
  nav.update(1/30);camera.updateMatrixWorld();pitch.push(euler.setFromQuaternion(camera.quaternion,'YXZ').x);
  screen.push(cat.object.position.clone().setY(cat.object.position.y+.85).project(camera).y);
 }
 // A camera riding him 1:1 turned at up to 29 rad/s² at touchdown; a jolt reads as hitting something.
 const jolt=Math.max(...pitch.slice(1,-1).map((p,i)=>Math.abs(pitch[i+2]-2*p+pitch[i])*900));
 assert.ok(jolt<8,`view turned at up to ${jolt.toFixed(1)} rad/s²`);
 assert.ok(Math.max(...screen)-Math.min(...screen)>.4,'he visibly rises and falls on screen');
 assert.ok(screen.every(y=>Math.abs(y)<.8),'and stays in view');
});

test('a controller A tap that ends between render frames still jumps once',t=>{
 const {nav,pad}=fixture(t);nav.select('walk');nav.update(1/30);
 pad.buttons[0].pressed=true;nav.poll();pad.buttons[0].pressed=false;nav.update(1/30);
 assert.equal(nav.state.jumpCount,1);
 for(let i=0;i<60;i++)nav.update(1/30);assert.equal(nav.state.jumpCount,1);
});

test('Space in flight retains position and never queues a takeoff on landing',t=>{
 const {nav,key}=fixture(t);nav.select('paraglider');for(let i=0;i<6;i++)nav.update(1/60);const before=nav.state.distance;
 key('keydown','Space');key('keyup','Space');nav.update(1/60);assert.ok(nav.state.distance>before,'Space must not reset the flying activity');
 for(let i=0;i<600;i++)nav.update(1/60);assert.equal(nav.state.grounded,true);
});

test('shared dry-ground sampler rejects actual water footprints but retains distant low dry land',()=>{
 const ground=walk.createWalkHeight(world,()=>14);
 assert.equal(ground(...world.water.bodies.find(b=>b.kind==='lake').centre_xy_m),null);
 assert.equal(ground(...world.water.bodies.find(b=>b.kind==='river').polyline[10]),null);
 assert.equal(ground(1500,1500),14);
});

test('walking stands on the authored trail tread where the coarse terrain falls below it',()=>{
 const manifest=read('../data/viewer.json');
 const grid=(name,file)=>{const b=readFileSync(new URL(file,import.meta.url));return new HeightGrid({values:new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)),...manifest.height_grids[name]});};
 const ground=new GroundSampler(grid('block','../data/heightmap.f32'),grid('far_field','../data/farfield.f32'));
 const floor=walk.createWalkHeight(world,(x,y)=>ground.height(x,y)),x=-419.2988,y=1560,tread=createTrailSampler(world)(x,y);
 assert.equal(tread.beyond,0);assert.ok(tread.z-ground.height(x,y)>.2,'fixture crosses the measured coarse-grid/tread mismatch');
 assert.ok(floor(x,y)>=tread.z,'the character may not stand inside the trail');
 assert.equal(floor.floorHeight(x,y),floor(x,y),'flight landing and ground movement share the same dry floor');
});

test('local launch checks the takeoff corridor, including a raised tread before a lower endpoint',()=>{
 const state={...launchFlight(flight,'paraglider',{xy_m:[0,0],heading_deg:0,clearance_m:flight.landing_clearance_m},flat),grounded:true,speed:0};
 const raised=x=>x>.15&&x<1?.3:0;
 assert.equal(walk.relaunchGround(state,character.walk,flight,raised),null,'a low endpoint must not conceal a takeoff curb');
});

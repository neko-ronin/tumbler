import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stepMoves} from '../../../shared/activities/moves.js';
import {stepWalk,createWalkHeight} from '../../../shared/activities/walk.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const player=read('../../../shared/characters/player.json'),w=player.walk,c=w.swim,worldmap=read('../../../shared/world/worldmap.json');

/** Surface at z 0 over x 2..12, |y| < 5; the bed shelves to `depth` by x 5. Optional island, river flow and boxes.
 * Shores shelve gently, as the world's banks do, so the 5 cm-per-frame check below measures pops, not slope speed. */
function pool({depth=1.6,island=false,flow=[0,0],boxes=[]}={}){
 const inside=(x,y)=>x>2&&x<12&&Math.abs(y)<5;
 // The island's shore shelves like the pool's: 0.3 m dry top, down to the bed 2 m out.
 const bed=(x,y)=>inside(x,y)?-depth*Math.min(1,(x-2)/3):0,rise=(x,y)=>.3-(depth+.3)*Math.max(0,Math.min(1,(Math.hypot(x-9.5,y)-.5)/4));
 const floorHeight=(x,y)=>island?Math.max(bed(x,y),rise(x,y)):bed(x,y);
 const waterAt=(x,y)=>{const z=floorHeight(x,y);return inside(x,y)&&z<.05?{surface_z:0,depth:Math.max(0,-z),flow}:null;};
 return {floorHeight,waterAt,height:(x,y)=>waterAt(x,y)?null:floorHeight(x,y),hitTest:createCollisionIndex(boxes)};
}
const run=(s,input,seconds,world,config=w,each)=>{for(let t=0;t<seconds-1e-9;t+=1/60){s=stepMoves(s,input,1/60,config,world);each?.(s);}return s;};
const ashore=()=>({x:0,y:0,z:0,heading:0,speed:0});
const afloat=world=>{const s=run(ashore(),{x:1,y:0},4,world);return run(s,{x:0,y:0},3,world);};

test('the shared sampler reports depth and river flow exactly where walking stops',()=>{
 const sampler=createWalkHeight(worldmap,()=>14),lake=worldmap.water.bodies.find(b=>b.kind==='lake'),river=worldmap.water.bodies.find(b=>b.kind==='river');
 assert.deepEqual(sampler.waterAt(...lake.centre_xy_m),{surface_z:20,depth:6,flow:[0,0]});
 const water=sampler.waterAt(...river.polyline[10]);assert.equal(water.depth,6);
 assert.ok(Math.abs(Math.hypot(...water.flow)-1)<1e-9,'river flow is a unit direction along the polyline');
 for(let x=-2100;x<0;x+=37)for(let y=-1300;y<300;y+=41)assert.equal(sampler(x,y)===null,sampler.waterAt(x,y)!==null);
});

test('walking into the pool wades the shallows, then floats at the surface',()=>{
 const world=pool();let waded=false;
 const s=run(ashore(),{x:1,y:0},4,world,w,s=>{if(s.swimPhase==='wade'){waded=true;assert.ok(Math.abs(s.z-world.floorHeight(s.x,s.y))<.05,'wading walks on the bed');}});
 assert.ok(waded);assert.equal(s.mode,'swim');assert.equal(s.swimPhase,'paddle');
 const still=run(s,{x:0,y:0},3,world);
 assert.equal(still.swimPhase,'tread');assert.ok(Math.abs(still.z-(0-c.float_draft_m))<.01,`floats with his feet ${-still.z} m down`);
});

test('the stick paddles at 1.2 m/s; Shift dives along the camera at 4 m/s, never below the bed clearance, and he bobs back up',()=>{
 const world=pool({depth:4});let s=afloat(world);  // deep enough to rise for a full half second
 s=run(s,{x:0,y:1},2,world);assert.ok(Math.abs(s.speed-c.paddle_mps)<.01,`paddles at ${s.speed}`);
 s=run(s,{x:1,y:0,run:true,pitch:-.6},1.5,world);
 assert.equal(s.swimPhase,'dive');assert.ok(Math.abs(Math.hypot(s.speed,s.vz)-c.dive_mps)<.05,`dives at ${Math.hypot(s.speed,s.vz)}`);
 assert.ok(s.vz<0,'looking down dives down');
 s=run(s,{x:0,y:0,run:true,pitch:-1.2},3,world,w,s=>assert.ok(s.z>=world.floorHeight(s.x,s.y)+c.floor_clear_m-1e-9,'clear of the bed'));
 const deep=s.z;s=run(s,{x:0,y:0},.5,world);assert.ok(Math.abs(s.z-deep-c.rise_mps*.5)<.05,`rises ${s.z-deep} m in 0.5 s`);
 s=run(s,{x:0,y:0},3,world);assert.ok(Math.abs(s.z+c.float_draft_m)<.01);
});

test('a river carries him gently along its flow',()=>{
 const world=pool({flow:[0,1]});let s=afloat(world);const y0=s.y;s=run(s,{x:0,y:0},2,world);
 assert.ok(Math.abs(s.y-y0-c.flow_mps*2)<.05,`drifted ${s.y-y0} m in 2 s`);
});

test('swimming back to shore walks out at the floor height',()=>{
 const world=pool();let s=afloat(world);s=run(s,{x:-1,y:0},8,world);
 assert.equal(s.mode,'ground');assert.equal(s.grounded,true);assert.ok(Math.abs(s.z-world.floorHeight(s.x,s.y))<1e-9);
});

test('jumping off a trunk at the water lands in the water, swimming',()=>{
 const r=.75,trunk={min:[-r,-r,0],max:[r,r,20],kind:'tree',trunk:{x:0,y:0,base_z:0,top_z:20,profile:[[0,r],[20,r]]}},world=pool({boxes:[trunk]});
 let s=run({x:r+w.radius_m,y:0,z:0,heading:Math.PI,speed:0},{x:-1,y:0},.4,world);assert.equal(s.mode,'climb');
 s=run(s,{x:0,y:0,stick:[0,1]},1.2,world);
 s=stepMoves(s,{x:0,y:0,stick:[0,0],jump:true},1/60,w,world);
 s=run(s,{x:0,y:0},3,world);assert.equal(s.mode,'swim');
});

test('an island mid-pool hands over to walking and back without popping height',()=>{
 const world=pool({island:true});let s=afloat(world),modes=new Set();
 // Across the island and back into the water; the pool's far wall at x 12 is a plain ledge step, as walking allows.
 run(s,{x:1,y:0},6,world,w,next=>{if(next.x>11.5)return;assert.ok(Math.abs(next.z-s.z)<=.05,`height jumped ${Math.abs(next.z-s.z).toFixed(3)} m at x ${next.x.toFixed(2)}`);modes.add(next.mode);s=next;});
 assert.ok(modes.has('ground')&&modes.has('swim'),'walked across the island');
});

test('contracts without walk.swim stop at the shore exactly as before',()=>{
 const {swim,...older}=w,world=pool();let a=ashore(),b=ashore();
 const moved=s=>[s.x,s.y,s.z,s.speed,s.mode??'ground'];
 for(let i=0;i<180;i++){a=stepMoves(a,{x:1,y:0},1/60,older,world);b=stepWalk(b,{x:1,y:0},1/60,older,world.height,world.hitTest);assert.deepEqual(moved(a),moved(b));}
 assert.ok(a.x<2.05,'stopped at the water');
});

// ── Swimming in the browser game: real navigation and puppet over the pool.
import * as T from '../vendor/three.module.min.js';
import {createNavigation} from '../src3d/navigation.js';
import {createCharacter} from '../src3d/character.js';
import {parseGLB} from '../src3d/glb.js';
function swimGame(t){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget();
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 // Camera at the shore looking east along +x, into the pool.
 const camera=new T.PerspectiveCamera();camera.position.set(0,2,0);camera.lookAt(4,2,0);
 const bytes=readFileSync(new URL('../../../shared/geometry/'+player.asset,import.meta.url)),cat=createCharacter(parseGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),player);
 const world=pool({depth:4}),walkHeight=Object.assign((x,y)=>world.height(x,y),{floorHeight:world.floorHeight,waterAt:world.waterAt});
 const flight=read('../../../shared/activities/flight.json'),ride=read('../../../shared/activities/ride.json');
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:world.floorHeight},flight,worldmap,new T.Group(),world.hitTest,
  {config:ride,rig:new T.Group(),meshes:{ski:new T.Group(),bike:new T.Group()},height:()=>0,snowAt:()=>1,surfaceAt:()=>'snow'},cat,player,{walkHeight,floorHeight:world.floorHeight});
 const key=(type,code)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:canvas}});win.dispatchEvent(e);};
 t.after(()=>{nav.dispose();cat.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 return {nav,cat,key,camera};
}
test('in the game, walking into the pool swims: the clip follows tread, paddle and dive, the harness is refused, and diving goes underwater',t=>{
 const {nav,cat,key}=swimGame(t),clips=player.swim_clips;nav.select('walk');nav.update(1/60);
 const tick=n=>{for(let i=0;i<n;i++)nav.update(1/60);};
 const forward=['KeyW','KeyA','KeyS','KeyD'].find(code=>{const x=nav.state.x;key('keydown',code);tick(10);key('keyup',code);const moved=nav.state.x-x;nav.state.x=x;return moved>.05;});
 assert.ok(forward,'one key walks toward the pool');
 key('keydown',forward);tick(60*5);
 assert.equal(nav.state.mode,'swim');assert.equal(nav.state.swimPhase,'paddle');assert.equal(cat.clip,clips.paddle);
 key('keyup',forward);tick(60*3);assert.equal(nav.state.swimPhase,'tread');assert.equal(cat.clip,clips.tread);
 key('keydown','KeyE');tick(1);key('keyup','KeyE');assert.equal(nav.state.mode,'swim');assert.match(nav.message,/clear, stable ground/);
 assert.equal(nav.underwater,false,'treading keeps the camera above the surface');
 key('keydown',forward);key('keydown','ShiftLeft');tick(60*2);
 assert.equal(nav.state.swimPhase,'dive');assert.equal(cat.clip,clips.dive);
 tick(60*2);assert.equal(nav.underwater,true,'a deep dive takes the camera under');
 key('keyup','ShiftLeft');key('keyup',forward);tick(60*6);assert.equal(nav.underwater,false,'surfacing restores the view');
});

test('a high fall into deep water goes in, whatever the frame rate',()=>{
 for(const fps of [30,60,90,120,144]){
  const world=pool({depth:4});let s={x:8,y:0,z:12,heading:0,speed:0,grounded:false,jumpPhase:'airborne',jumpStyle:'hop',jumpCount:1,vz:0},bounced=false;
  for(let i=0;i<fps*4&&s.mode!=='swim';i++){s=stepMoves(s,{x:0,y:0},1/fps,w,world);bounced||=s.jumpPhase==='bounce';}
  assert.equal(s.mode,'swim',`${fps} fps`);assert.ok(!bounced,`${fps} fps bounced off the water`);
 }
});

test('diving steers with the camera: looking up while diving brings him up, no higher than his float',()=>{
 const world=pool({depth:4});let s=afloat(world);
 s=run(s,{x:1,y:0,run:true,pitch:-.8},1,world);const deep=s.z;
 // Water drag has to turn his downward dive around first.
 s=run(s,{x:1,y:0,run:true,pitch:.5},.5,world);assert.ok(s.vz>0,'looking up turns the dive upward');
 s=run(s,{x:1,y:0,run:true,pitch:.5},1,world);assert.ok(s.z>deep+.5,`looking up rose ${(s.z-deep).toFixed(2)} m in 1.5 s`);
 s=run(s,{x:1,y:0,run:true,pitch:.8},2,world);assert.ok(s.z<=-c.float_draft_m+1e-9,'a rising dive stops at the float level');
});

test('a wavy shoreline does not flip him between walking and swimming at every crossing',()=>{
 // Walking along a shore whose waterline weaves across his path every couple of metres.
 const inside=(x,y)=>y>.4*Math.sin(x*1.6),floorHeight=(x,y)=>inside(x,y)?-Math.min(.6,(y-.4*Math.sin(x*1.6))*.8):.05;
 const waterAt=(x,y)=>inside(x,y)?{surface_z:0,depth:-Math.min(0,floorHeight(x,y)),flow:[0,0]}:null;
 const world={floorHeight,waterAt,height:(x,y)=>waterAt(x,y)?null:floorHeight(x,y),hitTest:createCollisionIndex([])};
 let s={x:0,y:0,z:.05,heading:0,speed:0},flips=0,mode='ground';
 for(let i=0;i<600;i++){s=stepMoves(s,{x:1,y:0},1/60,w,world);const m=s.mode??'ground';if(m!==mode){flips++;mode=m;}}
 assert.ok(flips<=2,`flipped ${flips} times in 10 s along the shore`);
});

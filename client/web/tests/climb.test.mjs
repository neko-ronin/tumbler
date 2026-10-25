import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {trunkRadiusAt} from '../../../shared/activities/climb.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const glb=p=>{const b=readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url));return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};

test('collision index finds boxes near a point',()=>{
 const box={min:[0,0,0],max:[1,1,1],kind:'structure'},index=createCollisionIndex([box]);
 assert.deepEqual(index.near([1.2,.5,.5],.3),[box]);
 assert.deepEqual(index.near([1.6,.5,.5],.3),[]);
});

test('trunk records describe the real taper and agree with their unchanged boxes',()=>{
 const placement=read('../../../shared/world/out/placement.json');
 const species=['giant_redwood','mountain_pine','silver_fir','redwood_canopy'].map(n=>`redwood/${n}.glb`);
 const instances=species.map(asset=>placement.instances.find(i=>i.asset===asset)).filter(Boolean);
 const assets=Object.fromEntries(instances.map(i=>[i.asset,glb(i.asset)]));
 const index=buildWorldCollision({instances},assets);
 const giant=instances.find(i=>i.asset.endsWith('giant_redwood.glb'));
 const trunks=index.near([giant.position_m[0],giant.position_m[1],giant.position_m[2]+1],4).filter(b=>b.trunk);
 assert.equal(trunks.length,1,'one trunk at the giant redwood');
 const [box]=trunks,t=box.trunk;
 assert.ok(trunkRadiusAt(t,t.base_z+30)<trunkRadiusAt(t,t.base_z+1),'the bole tapers');
 for(const instance of instances){
  const b=index.near([instance.position_m[0],instance.position_m[1],instance.position_m[2]+1],1).find(b=>b.trunk);
  assert.ok(b,`${instance.asset} has a trunk record`);
  assert.equal(b.trunk.top_z,b.max[2]);
  assert.ok(b.trunk.profile.length>=2&&b.trunk.profile.every(([z],i,a)=>i===0||z>a[i-1][0]),'profile rows ascend');
  assert.ok(b.trunk.x>=b.min[0]&&b.trunk.x<=b.max[0]&&b.trunk.y>=b.min[1]&&b.trunk.y<=b.max[1],'centre inside its box');
  assert.ok(Math.abs(trunkRadiusAt(b.trunk,b.trunk.base_z)-(b.max[0]-b.min[0])/2)<.02,'base radius matches the box');
 }
});

// ── Climb rules on a synthetic world: flat floor, one tapering trunk (r 0.75 → 0.5 over 20 m), its crown above.
import {stepMoves} from '../../../shared/activities/moves.js';
import {stepWalk} from '../../../shared/activities/walk.js';
const walkConfig=read('../../../shared/characters/player.json').walk;
const trunkBox=(r=.75,x=0,y=0)=>({min:[x-r,y-r,0],max:[x+r,y+r,20],kind:'tree',trunk:{x,y,base_z:0,top_z:20,profile:[[0,r],[20,r*2/3]]}});
const crownBox={min:[-4,-4,20],max:[4,4,30],kind:'tree'};
const world=(boxes=[trunkBox(),crownBox])=>({height:()=>0,hitTest:createCollisionIndex(boxes)});
const run=(s,input,seconds,w,config=walkConfig,each)=>{for(let t=0;t<seconds-1e-9;t+=1/60){s=stepMoves(s,input,1/60,config,w);each?.(s,t+1/60);}return s;};
const touching=(r=.75)=>({x:-(r+walkConfig.radius_m),y:0,z:0,heading:0,speed:0});
const climbed=(w=world())=>{let s=run(touching(),{x:1,y:0},.3,w);assert.equal(s.mode,'climb');return run(s,{x:0,y:0,stick:[0,0]},walkConfig.climb.mount_s+.02,w);};

test('pushing into a climbable trunk for 0.2 s attaches; brushing past does not',()=>{
 let attachedAt=null;run(touching(),{x:1,y:0},.5,world(),walkConfig,(s,t)=>{if(s.mode==='climb'&&attachedAt===null)attachedAt=t;});
 assert.ok(attachedAt>=.2-1e-9&&attachedAt<=.25,`attached after ${attachedAt} s`);
 let past={x:-(.75+walkConfig.radius_m+.1),y:-3,z:0,heading:Math.PI/2,speed:0}; // 10 cm clear of the box: a brush, not a collision
 run(past,{x:0,y:1},3,world(),walkConfig,s=>assert.notEqual(s.mode,'climb','walking past a trunk does not grab it'));
 run(touching(.25),{x:1,y:0},2,world([trunkBox(.25)]),walkConfig,s=>assert.notEqual(s.mode,'climb','a 0.5 m trunk is too thin'));
});

test('a diagonal approach stops at the square collider corner and still climbs, sliding onto the bark without a pop',()=>{
 // Walk in along the diagonal until the box corner stops him, then keep pushing.
 const w=world(),d=Math.SQRT1_2;let s={x:-3*d,y:-3*d,z:0,heading:Math.PI/4,speed:0},prev=s,maxStep=0,mounted=false;
 for(let i=0;i<180;i++){
  s=stepMoves(s,{x:d,y:d},1/60,walkConfig,w);
  if(s.mode==='climb'&&prev.mode!=='climb')mounted=true;
  if(prev.mode==='climb'||s.mode==='climb')maxStep=Math.max(maxStep,Math.hypot(s.x-prev.x,s.y-prev.y));
  prev=s;
 }
 assert.ok(mounted,'pushing at the corner grabs the trunk');
 assert.ok(maxStep<.1,`slides onto the bark (largest step ${maxStep.toFixed(3)} m)`);
 assert.ok(Math.abs(Math.hypot(s.x,s.y)-(trunkRadiusAt(s.trunk,s.z)+walkConfig.climb.hold_m))<.001,'ends holding the bark');
});
test('an off-centre push slides along the trunk and still grabs it',()=>{
 // Aimed 22 degrees off the trunk's centre, as a player rarely aims true.
 const a=22*Math.PI/180;let at=null;
 run({x:-2.47,y:0,z:0,heading:a,speed:0},{x:Math.cos(a),y:Math.sin(a)},1.2,world(),walkConfig,(s,t)=>{if(s.mode==='climb'&&at===null)at=t;});
 assert.ok(at!==null&&at<1.2,`grabbed after ${at} s`);
});
test('airborne contact attaches from any direction',()=>{
 const s=run({x:-1.05,y:0,z:1.5,heading:Math.PI/2,speed:0,grounded:false,jumpPhase:'airborne',jumpCount:1,jumpStyle:'hop',vz:0},{x:0,y:1},.3,world());
 assert.equal(s.mode,'climb');
});

test('climbing speeds and limits',()=>{
 const c=walkConfig.climb,w=world();let s=climbed(w);
 const z0=s.z;s=run(s,{x:0,y:0,stick:[0,1]},1,w);assert.ok(Math.abs(s.z-z0-c.up_mps)<.1,`up ${s.z-z0}`);
 const z1=s.z;s=run(s,{x:0,y:0,stick:[0,1],run:true},1,w);assert.ok(Math.abs(s.z-z1-c.up_mps*c.fast_factor)<.15,`fast ${s.z-z1}`);
 const z2=s.z;s=run(s,{x:0,y:0,stick:[0,-1]},.5,w);assert.ok(Math.abs(z2-s.z-c.down_mps*.5)<.1,`down ${z2-s.z}`);
 const a0=s.angle;s=run(s,{x:0,y:0,stick:[1,0]},1,w,walkConfig,s=>{
  const d=Math.hypot(s.x-s.trunk.x,s.y-s.trunk.y);assert.ok(Math.abs(d-(trunkRadiusAt(s.trunk,s.z)+c.hold_m))<.001,'paws stay on the bark');});
 assert.ok(Math.abs((s.angle-a0)*(trunkRadiusAt(s.trunk,s.z)+c.hold_m)-c.around_mps)<.1,'around at 2.5 m/s');
 s=run(s,{x:0,y:0,stick:[0,1]},8,w);assert.ok(Math.abs(s.z-(20-c.top_clearance_m))<1e-9);assert.equal(s.climbPhase,'perch');
 s=run(s,{x:0,y:0,stick:[0,-1]},6,w);assert.equal(s.mode,'ground');assert.equal(s.grounded,true);assert.equal(s.z,0);
 const base=Math.hypot(s.x,s.y);s=run(s,{x:s.x/base,y:s.y/base},.6,w);assert.ok(Math.hypot(s.x,s.y)-base>.5,'he can walk away from the trunk he climbed down');
});

test('jumping off pushes away from the bark and falls as ground',()=>{
 const w=world();let s=climbed(w);s=run(s,{x:0,y:0,stick:[0,1]},1,w);
 const out=[s.x-s.trunk.x,s.y-s.trunk.y].map(v=>v/Math.hypot(s.x-s.trunk.x,s.y-s.trunk.y));
 s=stepMoves(s,{x:0,y:0,stick:[0,0],jump:true},1/60,walkConfig,w);
 assert.equal(s.mode,'ground');assert.equal(s.grounded,false);
 assert.equal(s.jumpStyle,'push','a jump off the bark has its own push-off, not the playful skip');
 assert.ok(s.vx*out[0]+s.vy*out[1]>=walkConfig.climb.jump_out_mps-1e-6,'pushed away from the trunk');
 const from=Math.hypot(s.x-s.trunk.x,s.y-s.trunk.y);
 s=run(s,{x:0,y:0,jump:false},.3,w);assert.ok(Math.hypot(s.x-s.trunk.x,s.y-s.trunk.y)-from>.5,'actually leaves the bark');
 s=run(s,{x:0,y:0,jump:false},1,w);assert.notEqual(s.mode,'climb','does not grab the same trunk again on the way down');
});

test('circling into a neighbouring collider stops there',()=>{
 // He starts at angle π (west of the trunk); stick right circles anticlockwise toward 3π/2 (south), where the wall stands.
 const wall={min:[-.3,-2,0],max:[.3,-1,6],kind:'structure'},w=world([trunkBox(),crownBox,wall]);
 let s=climbed(w),max=-Infinity;
 run(s,{x:0,y:0,stick:[1,0]},3,w,walkConfig,s=>{max=Math.max(max,s.angle);});
 assert.ok(max>Math.PI+.3&&max<1.5*Math.PI,`stopped at ${max.toFixed(2)} rad, short of the wall at ${(1.5*Math.PI).toFixed(2)}`);
});

test('contracts without walk.climb never climb',()=>{
 const {climb,...older}=walkConfig,w=world();let a=touching(),b=touching();
 for(let i=0;i<120;i++){a=stepMoves(a,{x:1,y:0},1/60,older,w);b=stepWalk(b,{x:1,y:0},1/60,older,w.height,w.hitTest);assert.deepEqual(a,b);}
});

// ── Climbing in the browser game: real navigation, real puppet, one trunk ahead of the cat.
import * as T from '../vendor/three.module.min.js';
import {createNavigation} from '../src3d/navigation.js';
import {createCharacter} from '../src3d/character.js';
import {reharnessWalk} from '../../../shared/activities/walk.js';
const playerConfig=read('../../../shared/characters/player.json');
function gameFixture(t){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget();
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const camera=new T.PerspectiveCamera();camera.position.set(0,5,0);camera.lookAt(0,5,-4);
 const cat=createCharacter(glb(playerConfig.asset),playerConfig),r=.75,ahead=r+playerConfig.walk.radius_m;
 const hitTest=createCollisionIndex([trunkBox(r,0,ahead),{...crownBox,min:[-4,ahead-4,20],max:[4,ahead+4,30]}]);
 const flight=read('../../../shared/activities/flight.json'),ride=read('../../../shared/activities/ride.json'),worldmap=read('../../../shared/world/worldmap.json');
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},flight,worldmap,new T.Group(),hitTest,
  {config:ride,rig:new T.Group(),meshes:{ski:new T.Group(),bike:new T.Group()},height:()=>0,snowAt:()=>1,surfaceAt:()=>'snow'},cat,playerConfig);
 const key=(type,code)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:canvas}});win.dispatchEvent(e);};
 t.after(()=>{nav.dispose();cat.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 nav.cameraPosition=camera.position;
 return {nav,cat,key,trunk:{x:0,y:ahead}};
}
test('in the game, holding forward into a trunk climbs it facing the bark; Space jumps off; the harness button is refused',t=>{
 const {nav,cat,key,trunk}=gameFixture(t);nav.select('walk');nav.update(1/60);
 key('keydown','KeyW');for(let i=0;i<18;i++)nav.update(1/60);
 assert.equal(nav.state.mode,'climb','0.3 s of pushing climbs');
 for(let i=0;i<30;i++)nav.update(1/60);
 const facing=new T.Vector3(0,0,1).applyQuaternion(cat.object.quaternion),toward=new T.Vector3(trunk.x-nav.state.x,0,-(trunk.y-nav.state.y)).normalize();
 assert.ok(facing.dot(toward)>.99,'he faces the bark');
 assert.ok(nav.state.z>.5,'forward climbs');
 assert.equal(cat.clip,playerConfig.climb_clips?.up??playerConfig.clips.idle);
 key('keyup','KeyW');key('keydown','KeyE');nav.update(1/60);key('keyup','KeyE');
 assert.equal(nav.state.mode,'climb');assert.match(nav.message,/clear, stable ground/);
 key('keydown','Space');nav.update(1/60);key('keyup','Space');
 assert.equal(nav.state.mode,'ground');assert.equal(nav.state.grounded,false);
});
test('the tree he is climbing does not pull the chase camera into him',t=>{
 const {nav,cat,key}=gameFixture(t);nav.select('walk');nav.update(1/60);
 key('keydown','KeyW');for(let i=0;i<60*6;i++)nav.update(1/60);key('keyup','KeyW');nav.update(1/60);
 assert.equal(nav.state.climbPhase,'perch');
 assert.ok(cat.object.position.distanceTo(nav.cameraPosition)>4,`camera ${cat.object.position.distanceTo(nav.cameraPosition).toFixed(2)} m from him at the perch`);
});
test('harness re-entry is refused while climbing',()=>{
 const flight=read('../../../shared/activities/flight.json'),w=world();let s=climbed(w);
 // Nothing else refuses here (no colliders, level ground at his feet): only the mode can.
 assert.equal(reharnessWalk({...s,harnessMode:'paraglider',grounded:true},walkConfig,flight,()=>0,()=>null),null);
 assert.ok(reharnessWalk({...s,mode:'ground',harnessMode:'paraglider',grounded:true},walkConfig,flight,()=>0,()=>null),'the same spot on foot may rehook');
});

test('walking uphill into a trunk on a slope grabs it, though he stands below its base',()=>{
 // Ground rising 0.3 per metre toward +x; the trunk's base sits at its centre's height.
 const r=.75,slope=(x,y)=>.3*x,box={min:[2-r,-r,slope(2)],max:[2+r,r,20],kind:'tree',trunk:{x:2,y:0,base_z:slope(2),top_z:20,profile:[[slope(2),r],[20,r]]}};
 const w2={height:slope,hitTest:createCollisionIndex([box])};let s={x:-1,y:0,z:slope(-1),heading:0,speed:0},grabbed=false;
 for(let i=0;i<120&&!grabbed;i++){s=stepMoves(s,{x:1,y:0},1/60,walkConfig,w2);grabbed=s.mode==='climb';}
 assert.ok(grabbed,`stuck ${(box.trunk.base_z-s.z).toFixed(2)} m below the base, touching the trunk`);
});

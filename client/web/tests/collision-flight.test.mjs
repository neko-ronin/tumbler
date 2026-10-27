import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight,canopySegment} from '../../../shared/activities/flight.js';
import {unharnessFlight,relaunchGround,relaunchRefusal} from '../../../shared/activities/walk.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {trunkShape,crownShape} from '../../../shared/activities/colliders.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const shipped=read('../../../shared/activities/flight.json'),walk=read('../../../shared/characters/player.json').walk;
// Calm, thermal-free air over flat ground at 0, so only the obstacles act.
const config={...shipped,thermals:[],wind:{...shipped.wind,speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}},
  collapse:{terminal_mps:15,restitution:.2,knock:.15,foliage_drag_per_s:1.5}};
const {collapse:_,...older}=config,flat=()=>0,lc=config.landing_clearance_m;
const site={xy_m:[0,0],heading_deg:0,clearance_m:60};
const fly=(cfg,hit,dt,seconds,each=()=>{},s=launchFlight(cfg,'paraglider',site,flat))=>{
 for(let t=0;t<seconds-1e-9&&!s.grounded;t+=dt){const prev=s;s=stepFlight(s,{},dt,t,cfg,245,flat,hit);each(s,prev);}
 return s;
};
const touches=(seg,hit)=>{const n=Math.ceil(Math.hypot(...seg.b.map((v,i)=>v-seg.a[i])));
 return Array.from({length:n+1},(_,k)=>seg.a.map((v,i)=>v+(seg.b[i]-v)*k/n)).some(p=>hit.soft(p,seg.radius).length||hit(p,p,seg.radius));};
// A crown whose base sits 4 m above the pilot's track 25 m ahead.
const crownAhead=z=>crownShape({id:'c',x:25,y:0,base_z:0,scale:1,profile:[[z+4,6],[z+14,6]]});

test('canopySegment spans the wing above the feet',()=>{
 const s={...launchFlight(config,'paraglider',site,flat),z:50,heading:0,bank:0},seg=canopySegment(s,config),m=config.modes.paraglider;
 assert.ok(Math.abs(Math.hypot(...seg.b.map((v,i)=>v-seg.a[i]))-m.span_m)<1e-9);
 assert.ok(Math.abs((seg.a[2]+seg.b[2])/2-(50-lc+m.canopy_height_m))<1e-9);
 assert.equal(seg.radius,m.chord_m/2);
 assert.ok(Math.abs(seg.a[0]-seg.b[0])<1e-9,'spans across the heading');
});

test('the wing collapses on touching a crown',()=>{
 const start=launchFlight(config,'paraglider',site,flat),hit=createCollisionIndex([crownAhead(start.z-2)]);
 let collapsedAt=null,overlapAt=null,step=0;
 fly(config,hit,1/120,6,(s,prev)=>{step++;
  if(overlapAt===null&&touches(canopySegment(s,config),hit))overlapAt=step;
  if(collapsedAt===null&&s.collapsed)collapsedAt=step;
  if(!prev.collapsed)assert.equal(hit.soft([prev.x,prev.y,prev.z],.45).length,0,'the pilot himself never reached the crown');
 });
 assert.ok(overlapAt!==null,'the canopy reached the crown');
 assert.equal(collapsedAt,overlapAt,'it collapsed on that very step');
});

test('a collapsed wing falls and lands',()=>{
 let s={...launchFlight(config,'paraglider',site,flat),z:40+lc,collapsed:true,vx:8,vy:0,vertical:-1};
 let t=0;
 for(;t<6&&!s.grounded;t+=1/120){const p=s;s=stepFlight(s,{},1/120,t,config,245,flat,null);assert.ok(s.grounded||Math.hypot(s.x-p.x,s.y-p.y,s.z-p.z)>1e-6,'never held in the air');}
 assert.ok(s.grounded,`landed within 6 s (${t.toFixed(2)} s)`);
 assert.ok(s.landingSpeed>=10&&s.landingSpeed<=15.5,`landing speed ${s.landingSpeed}`);
 assert.equal(s.collapsed,true);
});

for(const mode of ['paraglider','parakite','paramotor'])test(`${mode}: collapsed flight accelerates under gravity, with increasing actual drops`,()=>{
 const start={...launchFlight(config,mode,site,flat),z:1000,collapsed:true,vx:0,vy:0,vertical:0};
 let s=start;const speeds=[],drops=[];
 for(let i=0;i<360;i++){
  const before=s;s=stepFlight(s,{},1/120,i/120,config,245,flat,null);
  assert.ok(s.vertical<before.vertical,'downward speed increases each step before terminal speed');
  assert.ok(s.z<before.z,'the position falls as well as the reported speed');
  if(i===0)assert.ok(Math.abs(-s.vertical*120-9.81)<.05,'gravity starts at approximately 9.81 m/s²');
  if((i+1)%60===0){speeds.push(-s.vertical);drops.push(before.z-s.z);}
 }
 for(let i=1;i<speeds.length;i++){
  assert.ok(speeds[i]>speeds[i-1]);
  assert.ok(drops[i]>drops[i-1],'later frames cover more vertical distance');
 }
 assert.ok(speeds[0]>4&&speeds[0]<4.4,'0.5 s of acceleration, not an immediate fixed sink speed');
 assert.ok(speeds[1]>7&&speeds[1]<7.5,'one second of acceleration');
 assert.ok(speeds.at(-1)>12&&speeds.at(-1)<config.collapse.terminal_mps,'drag approaches terminal speed');
 assert.equal(start.vertical,0,'the input state is not mutated');
});

test('collapsed gravity gives the same fall at 30, 60 and 120 Hz and ignores flight controls',()=>{
 const start={...launchFlight(config,'paramotor',site,flat),z:1000,collapsed:true,vx:8,vy:-3,vertical:0};
 const results=[30,60,120].map(hz=>{
  let s=start;
  for(let i=0;i<hz*4;i++)s=stepFlight(s,{turn:1,brake:1,throttle:1,maneuver:1},1/hz,i/hz,config,245,flat,null);
  return s;
 });
 let neutral=start;for(let i=0;i<480;i++)neutral=stepFlight(neutral,{},1/120,i/120,config,245,flat,null);
 for(const s of results)for(const key of ['x','y','z','vertical'])assert.ok(Math.abs(s[key]-neutral[key])<1e-9,`${key} depends on frame rate or controls`);
});

test('a canopy collision enters accelerating gravity on the next physics step',()=>{
 const start=launchFlight(config,'paraglider',site,flat),hit=createCollisionIndex([crownAhead(start.z-2)]);
 let collapsed=start,t=0;
 for(;t<5&&!collapsed.collapsed;t+=1/120)collapsed=stepFlight(collapsed,{},1/120,t,config,245,flat,hit);
 assert.equal(collapsed.collapsed,true,'exercise a real canopy collision');
 assert.equal(collapsed.grounded,false,'there is still room to fall');
 assert.equal(hit.soft([collapsed.x,collapsed.y,collapsed.z],.45).length,0,'the body is outside foliage drag');
 const after=stepFlight(collapsed,{},1/120,t,config,245,flat,hit);
 assert.ok(after.vertical<collapsed.vertical,'the collision switches directly to accelerating gravity');
 assert.ok(after.z<collapsed.z,'he actually drops farther');
});

// A collapsed fall must move every step until it lands: published speeds alone can hide a
// pilot held in place (the vertical stays at its fall speed while he sits still).
const fallsThrough=(shapes,s0,seconds=10)=>{
 const hit=createCollisionIndex(shapes);let s={...launchFlight(config,'paraglider',site,flat),...s0,collapsed:true},t=0;
 for(;t<seconds&&!s.grounded;t+=1/120){const p=s;s=stepFlight(s,{},1/120,t,config,245,flat,hit);
  if(!s.grounded)assert.ok(Math.hypot(s.x-p.x,s.y-p.y,s.z-p.z)>1e-6,`held in the air at z ${s.z.toFixed(2)} after ${t.toFixed(2)} s`);}
 assert.ok(s.grounded,'he reaches the ground');
};

test('a collapsed fall beside a flared trunk keeps moving',()=>{
 const flared=trunkShape({id:'t',x:0,y:0,base_z:0,scale:1,profile:[[0,1.4],[2,.9],[10,.6],[20,.5]],top_h:20});
 fallsThrough([flared],{x:.6+.46,y:0,z:15+lc,vx:0,vy:0,vertical:-5});
 fallsThrough([flared],{x:.6+.6,y:0,z:15+lc,vx:-1,vy:0,vertical:-5});
});

test('a collapsed fall onto a trunk top inside its crown keeps moving',()=>{
 const t=trunkShape({id:'t2',x:0,y:0,base_z:0,scale:1,profile:[[0,1],[8,.5]],top_h:8});
 const c=crownShape({id:'c2',x:0,y:0,base_z:0,scale:1,profile:[[8,4],[20,1]]});
 fallsThrough([t,c],{x:.3,y:0,z:25+lc,vx:0,vy:0,vertical:-5});
 fallsThrough([t,c],{x:-2,y:0,z:25+lc,vx:3,vy:0,vertical:-5});
});

test('the body bounces off a trunk instead of freezing',()=>{
 const hit=createCollisionIndex([trunkShape({id:'t',x:20,y:0,base_z:0,scale:1,profile:[[0,1],[200,1]],top_h:200})]);
 let before=null,after=null;
 fly(config,hit,1/120,8,(s,prev)=>{if(!after&&prev.collapsed&&s.collapsed&&(prev.vx??0)>0&&(s.vx??0)<=0){before=prev;after=s;}
  assert.ok(s.grounded||Math.hypot(s.x-prev.x,s.y-prev.y,s.z-prev.z)>1e-6,'never held in the air');});
 assert.ok(after,'he met the trunk');
 assert.ok(-after.vx<=.2*before.vx+1e-6,`rebound ${after.vx} from ${before.vx}`);
 assert.equal(after.collapsed,true);assert.equal(after.impact,undefined);
});

test('frame rate does not change the outcome',()=>{
 const start=launchFlight(config,'paraglider',site,flat),hit=createCollisionIndex([crownAhead(start.z-2)]);
 const [a,b]=[1/30,1/120].map(dt=>fly(config,hit,dt,20));
 assert.ok(a.collapsed&&b.collapsed,'both collapse');
 assert.ok(a.grounded&&b.grounded,'both land');
 assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1,`landing points ${Math.hypot(a.x-b.x,a.y-b.y).toFixed(2)} m apart`);
});

test('unhook works after a collapsed landing beside a trunk',()=>{
 const shape=trunkShape({id:'t',x:20,y:0,base_z:0,scale:1,profile:[[0,1],[200,1]],top_h:200}),hit=createCollisionIndex([shape]);
 let bounced=false;const s=fly(config,hit,1/120,12,(s,prev)=>{if(prev.collapsed&&(prev.vx??0)>0&&(s.vx??0)<=0)bounced=true;});
 assert.ok(bounced&&s.grounded,'bounced, then landed');
 const gap=Math.hypot(s.x-20,s.y)-1;
 assert.ok(gap>walk.radius_m+.05,`landed ${gap.toFixed(2)} m from the bark`);
 assert.ok(unharnessFlight(s,walk,config,flat,hit),'and can unhook there');
});

test('relaunch under a crown is refused',()=>{
 const hit=createCollisionIndex([crownShape({id:'c',x:0,y:0,base_z:0,scale:1,profile:[[3,5],[12,5]]})]);
 const ready=(x)=>({...launchFlight(config,'paraglider',{xy_m:[x,0],heading_deg:0,clearance_m:lc},flat),grounded:true,speed:0,vertical:0,vario:0});
 assert.equal(relaunchGround(ready(0),walk,config,flat,hit),null);
 assert.equal(relaunchRefusal(ready(0),walk,config,flat,hit),'canopy');
 assert.ok(relaunchGround(ready(20),walk,config,flat,hit));
 assert.equal(relaunchRefusal(ready(20),walk,config,flat,hit),null);
});

test('relaunch facing a crown just ahead is refused',()=>{
 // Clear where he stands, but the crown's edge is 6 m along his run.
 const hit=createCollisionIndex([crownShape({id:'c',x:9,y:0,base_z:0,scale:1,profile:[[3,3],[12,3]]})]);
 const ready=x=>({...launchFlight(config,'paraglider',{xy_m:[x,0],heading_deg:0,clearance_m:lc},flat),grounded:true,speed:0,vertical:0,vario:0});
 assert.equal(relaunchRefusal(ready(0),walk,config,flat,hit),'canopy');
 assert.equal(relaunchGround(ready(0),walk,config,flat,hit),null);
 assert.equal(relaunchRefusal(ready(-20),walk,config,flat,hit),null,'from 20 m back the run is clear');
});

test('older flight rules are unchanged',()=>{
 const box=createCollisionIndex([{min:[5,-1,0],max:[5.1,1,10],kind:'tree'}]),plain=(f,t,r)=>box(f,t,r);
 const s={...launchFlight(older,'paraglider',site,flat),z:5,x:4.6};
 const stopped=stepFlight(s,{},.1,0,older,245,flat,box);
 assert.equal(stopped.impact,'tree');assert.equal(stopped.grounded,true);assert.ok(!('collapsed' in stopped));
 let a=launchFlight(older,'paraglider',site,flat),b=a;
 for(let i=0;i<240;i++){a=stepFlight(a,{turn:.3},1/120,i/120,older,245,flat,box);b=stepFlight(b,{turn:.3},1/120,i/120,older,245,flat,plain);assert.deepEqual(a,b);}
});

test('the shipped rules carry the collapse tuning',()=>{
 assert.deepEqual(shipped.collapse,{terminal_mps:15,restitution:.2,knock:.15,foliage_drag_per_s:1.5});
});

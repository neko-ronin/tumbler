import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{rideStart,startRide,stepRide,createSnowSampler,createTrailSampler,createSurfaceSampler,createRideHeight}from'../../../shared/activities/ride.js';
import{createCollisionIndex}from'../../../shared/activities/collision.js';
const read=p=>JSON.parse(readFileSync(new URL(`../../../${p}`,import.meta.url)));
const config=read('shared/activities/ride.json'),worldmap=read('shared/world/worldmap.json'),snowStamp=read(config.snow_cover);
const g=config.gravity_mps2,dt=1/120;
const slope=grade=>(x,y)=>-grade*x;                 // falls toward +x (east)
const on=surface=>()=>surface;
function ride(mode,height,surface,input,seconds,{heading=0,speed=0,hit=null}={}){
  let s=startRide(config,{mode,xy_m:[0,0],heading},height);s.vx=Math.cos(heading)*speed;s.vy=Math.sin(heading)*speed;
  for(let i=0;i<seconds*120;i++)s=stepRide(s,input,dt,config,height,surface,hit);
  return s;
}
const speed=s=>Math.hypot(s.vx,s.vy);

test('a skier on snow accelerates toward the drag-limited speed, and tucking goes faster',()=>{
  const ski=config.modes.ski,grade=.5,theta=Math.atan(grade);
  const terminal=Math.sqrt((Math.sin(theta)-ski.surfaces.snow.rolling)*g*Math.cos(theta)*ski.mass_kg/(.5*config.air_density_kgpm3*ski.cda_m2));
  const upright=ride('ski',slope(grade),on('snow'),{},60),tucked=ride('ski',slope(grade),on('snow'),{tuck:1},60);
  assert.ok(upright.x>500&&upright.grounded);
  assert.ok(Math.abs(Math.hypot(upright.vx,upright.vz)-terminal)/terminal<.12,`upright ${Math.hypot(upright.vx,upright.vz)} vs ${terminal}`);
  assert.ok(speed(tucked)>speed(upright)*1.2);
});

test('skis stop on bare ground and the snowplough brakes on snow',()=>{
  const bare=ride('ski',()=>0,on('ground'),{},2,{speed:8});assert.ok(speed(bare)<.01);
  const braking=ride('ski',()=>0,on('snow'),{brake:1},1.5,{speed:10}),gliding=ride('ski',()=>0,on('snow'),{},1.5,{speed:10});
  assert.ok(speed(braking)<speed(gliding)-4);
});

test('pedal power balances rolling and air resistance on flat trail',()=>{
  const bike=config.modes.bike,k=bike.surfaces.trail;
  let lo=0,hi=40;for(let i=0;i<60;i++){const v=(lo+hi)/2;(k.rolling*bike.mass_kg*g+.5*config.air_density_kgpm3*bike.cda_m2*v*v)*v>bike.power_w?hi=v:lo=v;}
  const v=(lo+hi)/2;
  const s=ride('bike',()=>0,on('trail'),{push:1},90);
  assert.ok(Math.abs(speed(s)-v)/v<.05,`${speed(s)} vs ${v}`);
});

test('the bike climbs the graded 12% limit at walking pace but not a granite wall',()=>{
  const bike=config.modes.bike,k=bike.surfaces.trail,grade=.12,theta=Math.atan(grade);
  const expected=bike.power_w/(bike.mass_kg*g*(Math.sin(theta)+k.rolling));
  const climb=ride('bike',slope(-grade),on('trail'),{push:1},60);
  assert.ok(Math.abs(Math.hypot(climb.vx,climb.vz)-expected)/expected<.12,`${Math.hypot(climb.vx,climb.vz)} vs ${expected}`);
  const wall=ride('bike',slope(-1.2),on('trail'),{push:1},6,{speed:4});
  assert.ok(wall.vx<0,'rolls back down');
});

test('braking from speed stops within the friction distance',()=>{
  const bike=config.modes.bike,k=bike.surfaces.trail;
  const s=ride('bike',()=>0,on('trail'),{brake:1},5,{speed:10});
  assert.ok(speed(s)<.01);assert.ok(s.x<=100/(2*(k.brake_g+k.rolling)*g)+.2,`${s.x}`);
});

test('turning is limited by lean at speed',()=>{
  const bike=config.modes.bike,u=12,limit=u*u/(g*Math.tan(bike.max_lean_deg*Math.PI/180));
  let s=startRide(config,{mode:'bike',xy_m:[0,0],heading:0},()=>0);s.vx=u;
  for(let i=0;i<120;i++)s=stepRide(s,{steer:1},dt,config,()=>0,on('trail'));
  const r=s.distance/Math.abs(s.heading),fast=u*u/(g*Math.tan(bike.max_lean_deg*Math.PI/180));
  assert.ok(r>=fast*.85,`radius ${r} vs lean limit ${limit}`);assert.ok(s.y<0,'positive steer turns right');
});

test('a lip throws the rider airborne; a soft landing keeps speed, a drop onto flat crashes',()=>{
  const lip=(x,y)=>x<20?0:-(x-20)*.3;
  let s=startRide(config,{mode:'ski',xy_m:[0,0],heading:0},lip);s.vx=12;let flew=false;
  for(let i=0;i<600&&!s.crashed;i++){s=stepRide(s,{},dt,config,lip,on('snow'));flew||=!s.grounded&&s.z>lip(s.x,s.y)+.3;}
  assert.ok(flew);assert.equal(s.crashed,null);assert.ok(s.grounded&&speed(s)>10);
  const cliff=(x,y)=>x<5?40:0;
  s=startRide(config,{mode:'bike',xy_m:[0,0],heading:0},cliff);s.vx=6;
  for(let i=0;i<600&&!s.crashed;i++)s=stepRide(s,{},dt,config,cliff,on('trail'));
  assert.equal(s.crashed,'landing');
});

test('a hop leaves the ground and comes back down',()=>{
  let s=startRide(config,{mode:'bike',xy_m:[0,0],heading:0},()=>0);
  s=stepRide(s,{hop:true},dt,config,()=>0,on('trail'));assert.equal(s.grounded,false);
  for(let i=0;i<120;i++)s=stepRide(s,{},dt,config,()=>0,on('trail'));
  assert.equal(s.grounded,true);assert.equal(s.crashed,null);
});

test('a tree on the line stops the ride without mutating the prior state',()=>{
  const hit=createCollisionIndex([{min:[5,-1,0],max:[6,1,30],kind:'tree'}]);
  const s=ride('bike',()=>0,on('trail'),{push:1},5,{speed:6,hit});
  assert.equal(s.crashed,'tree');assert.ok(s.x<5);
  const before=startRide(config,{mode:'bike',xy_m:[0,0],heading:0},()=>0);const copy={...before};
  stepRide(before,{push:1},dt,config,()=>0,on('trail'));assert.deepEqual(before,copy);
  assert.throws(()=>startRide({...config,version:2},{mode:'ski',xy_m:[0,0],heading:0},()=>0),/Unsupported/);
});

test('starts, snow and trails come from core data: the cirque is snowy and both trails are rideable',()=>{
  const snowAt=createSnowSampler(snowStamp),trail=createTrailSampler(worldmap),surfaceAt=createSurfaceSampler(config,snowAt,trail);
  const onTrail=(x,y)=>trail(x,y)?.beyond===0;
  const cirque=rideStart(config,'granite-cirque',worldmap);
  assert.equal(surfaceAt(...cirque.xy_m),'snow',`snow ${snowAt(...cirque.xy_m)} m at the cirque start`);
  for(const id of ['granite-trail','east-bowl-trail']){
    const start=rideStart(config,id,worldmap,snowAt),track=worldmap.tracks.find(t=>t.id===start.track),P=track.polyline,k=P.findIndex(p=>p===start.xy_m);
    assert.ok(k>=0&&k<P.length-1);assert.deepEqual(rideStart(config,id,worldmap).xy_m,P[0],'without snow it starts at the top');
    for(let i=k;i<P.length-1;i++)for(let d=0;d<=1;d+=.1)assert.notEqual(surfaceAt(P[i][0]+(P[i+1][0]-P[i][0])*d,P[i][1]+(P[i+1][1]-P[i][1])*d),'snow',`snow below the ${id} melt-out`);
    assert.equal(onTrail(...track.polyline[40]),true);
    const [a,b]=track.polyline.slice(40,42),nx=-(b[1]-a[1]),ny=b[0]-a[0],n=Math.hypot(nx,ny);
    assert.equal(onTrail(a[0]+nx/n*4,a[1]+ny/n*4),false,'4 m off the centreline is off the tread');
  }
  assert.equal(snowAt(-1500,-1500),0,'no snow in the valley');
  assert.throws(()=>createSnowSampler({...snowStamp,version:2}),/Unsupported/);
});

test('a graded bench is ridden at its profile and joins the terrain over its shoulder',()=>{
  const trail=createTrailSampler(worldmap),track=worldmap.tracks.find(t=>t.id==='T5'),{bench_m:bench,shoulder_m:shoulder}=track.grading,ride=createRideHeight(()=>-50,trail);
  // A segment with open ground to one side: only its own bench within reach.
  const P=track.polyline,reach=bench+shoulder;let found=null;
  for(let i=0;i<P.length-1&&!found;i++)for(const side of [1,-1]){
    const [a,b]=[P[i],P[i+1]],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],n=Math.hypot(b[0]-a[0],b[1]-a[1]),nx=-(b[1]-a[1])/n*side,ny=(b[0]-a[0])/n*side;
    if(n>30&&[...Array(Math.ceil(reach)+1).keys()].every(k=>Math.abs((trail(mid[0]+nx*k,mid[1]+ny*k)?.d??k)-k)<1e-6)&&trail(mid[0]+nx*(reach+1),mid[1]+ny*(reach+1))===null){found={i,mid,nx,ny};break;}}
  assert.ok(found,'some segment has open ground beside it');
  const {i,mid,nx,ny}=found,z=(track.profile_z_m[i]+track.profile_z_m[i+1])/2,n=1,out=k=>ride(mid[0]+nx*k,mid[1]+ny*k);
  assert.ok(Math.abs(out(0)-z)<1e-9&&Math.abs(out(bench*.9)-z)<1e-9,'flat across the bench');
  assert.ok(out(bench+shoulder/2)<z&&out(bench+shoulder/2)>-50,'blends over the shoulder');
  assert.equal(trail(...mid).beyond,0);assert.ok(trail(mid[0]+nx*4,mid[1]+ny*4).beyond>0,'the tread is narrower than the bench');
});

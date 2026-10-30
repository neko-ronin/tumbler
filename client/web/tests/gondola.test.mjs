import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{HeightGrid,GroundSampler}from'../src3d/heights.js';
import{parseGLB}from'../src3d/glb.js';
import{buildWorldCollision}from'../src3d/collision.js';
import{createGeologySampler,applyGeologyTerrain}from'../../../shared/geometry/granite/surface.js';
import{createRiverGranite}from'../../../shared/activities/river-surface.js';
import{buildGondola,cabinAt,cabinsAt,boardGondola,rideAt,stationNear}from'../../../shared/activities/gondola.js';
import{createFolkWorld,createFolk,stepFolk,command,setController}from'../../../shared/npc/folk.js';
const bytes=p=>readFileSync(new URL('../../../'+p,import.meta.url)),read=p=>JSON.parse(bytes(p));
const grid=f=>new Float32Array(new Uint8Array(bytes('client/web/data/'+f)).buffer);
const manifest=read('client/web/data/viewer.json'),config=read('shared/activities/gondola.json'),placement=read('shared/world/out/placement.json');
// The browser's own ground (main.js): the core grids with the granite and river surfaces composed on.
const worldmap=read('shared/world/worldmap.json'),geology=read(worldmap.mountains.geology);
const gridOf=(file,spec,patch)=>new HeightGrid({values:applyGeologyTerrain(grid(file),manifest.height_grids[spec],patch),...manifest.height_grids[spec],kind:spec});
const ground=new GroundSampler(gridOf('heightmap.f32','block',geology.terrain.block),gridOf('farfield.f32','far_field',geology.terrain.far_field),
  createRiverGranite(read('shared/world/out/river_granite.json')).height,createGeologySampler(geology));
const height=(x,y)=>ground.height(x,y);
// Everything standing within 200 m of the line: the real trees, village and homes.
const [a,b]=config.stations.map(s=>s.xy_m),L=Math.hypot(b[0]-a[0],b[1]-a[1]);
const off=([x,y])=>{const t=Math.max(0,Math.min(L,((x-a[0])*(b[0]-a[0])+(y-a[1])*(b[1]-a[1]))/L));return Math.hypot(x-a[0]-(b[0]-a[0])*t/L,y-a[1]-(b[1]-a[1])*t/L);};
const near=placement.instances.filter(i=>!['river','lake'].includes(i.kind)&&off(i.position_m)<200);
const parsed=new Map(),glb=p=>{if(!parsed.has(p)){const b=bytes('shared/geometry/'+p);parsed.set(p,parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}return parsed.get(p);};
const hitTest=buildWorldCollision({instances:near},Object.fromEntries(near.map(i=>[i.asset,glb(i.asset)])));
const line=buildGondola(config,height,hitTest);

test('the line runs from the tree village to the Granite Ridge launch',()=>{
  const village=placement.instances.filter(i=>i.kind==='arboreal_tree').map(i=>i.position_m);
  assert.ok(Math.min(...village.map(p=>Math.hypot(p[0]-a[0],p[1]-a[1])))<80,'bottom station stands by the village trees');
  const launch=read('shared/activities/flight.json').launches.find(l=>l.id===config.stations[1].launch);
  assert.ok(Math.hypot(launch.xy_m[0]-b[0],launch.xy_m[1]-b[1])<60,'top station is a short walk from the launch');
  assert.ok(line.stations[1].deck_z-line.stations[0].deck_z>800,`climbs ${Math.round(line.stations[1].deck_z-line.stations[0].deck_z)} m`);
  assert.ok(line.towers.length>=2&&line.towers.every(t=>t.height_m<=config.tower.max_m));
});

test('the forest is cut for the ropeway: no stem or crown in its corridor',()=>{
  for(const i of placement.instances.filter(i=>/tree|redwood/.test(i.kind)&&i.kind!=='arboreal_tree'))
    assert.ok(off(i.position_m)>=config.corridor_m,`${i.asset} at ${i.position_m.map(Math.round)} stands in the cut`);
});

test('every cabin rides clear of the ground, solids and crowns, on both tracks',()=>{
  for(let t=0;t<line.period_s;t+=1.5)for(const c of cabinsAt(line,t)){
    const p=[c.x,c.y,c.z-config.hanger_m/2];
    assert.equal(hitTest(p,p,config.hanger_m/2+.5),null,`cabin ${c.index} hits something at ${p.map(Math.round)}`);
    assert.equal(hitTest.soft(p,config.hanger_m/2+.5).length,0,`cabin ${c.index} brushes a crown at ${p.map(Math.round)}`);
    assert.ok(c.floor_z>=height(c.x,c.y)-.01,`cabin ${c.index} below the ground at ${p.map(Math.round)}`);
  }
});

test('cabins keep one clock: steady speed on the cable, dwell at each bullwheel',()=>{
  const c0=cabinAt(line,0,0),c1=cabinAt(line,0,1);
  assert.equal(c0.phase,0);
  const mid=cabinAt(line,0,config.dwell_s+line.travel_s/2),next=cabinAt(line,0,config.dwell_s+line.travel_s/2+1);
  assert.equal(mid.phase,'up');
  assert.ok(Math.abs(Math.hypot(next.x-mid.x,next.y-mid.y,next.z-mid.z)-config.speed_mps)<.2,'constant speed along the cable');
  assert.ok(Math.hypot(c1.x-c0.x,c1.y-c0.y)<1.5,'creeps round the bullwheel');
  assert.equal(cabinAt(line,0,line.period_s).tau,0);
  assert.ok(line.headway_s<30,`a cabin every ${line.headway_s.toFixed(1)} s`);
});

test('a rider boards the next cabin, rides it to the far station and can fast-travel',()=>{
  assert.equal(stationNear(line,...a)?.id,'village');assert.equal(stationNear(line,a[0]+50,a[1]),null);
  for(const t0 of [0,7,13,100]){
    const ride=boardGondola(line,"village",t0);
    assert.ok(ride.wait_s<=line.headway_s+1e-6,`waits ${ride.wait_s}`);
    const start=rideAt(line,ride,ride.board_t),end=rideAt(line,ride,ride.arrive_t);
    assert.equal(start.phase,0,'boards at the village bullwheel');
    assert.equal(end.phase,1,'steps off at the ridge');assert.ok(end.done);
    assert.ok(!rideAt(line,ride,(ride.board_t+ride.arrive_t)/2).done);
  }
  const ride={...boardGondola(line,'ridge',50),fast:true};
  const r=rideAt(line,ride,51);assert.ok(r.done);assert.deepEqual(r.exit_xy_m,config.stations[0].exit_xy_m);
  for(const s of config.stations)assert.ok(Number.isFinite(height(...s.exit_xy_m))&&!hitTest([...s.exit_xy_m,height(...s.exit_xy_m)+1],[...s.exit_xy_m,height(...s.exit_xy_m)+1],.4),`${s.id} exit is open ground`);
});

test('the folk ride the gondola for the view and pilots take it to the ridge',()=>{
  const folk=read('shared/npc/folk.json'),models=read('shared/geometry/cat-folk/models.json'),flight=read('shared/activities/flight.json');
  const walk=read('shared/characters/player.json').walk;
  const events=[],w=createFolkWorld({config:folk,worldmap,placement,flight,walk,height,hitTest,gondola:line,onEvent:e=>events.push(e)});
  createFolk(w,models,{seed:3});
  const ume=w.cats.find(c=>c.id==='ume'),saffi=w.cats.find(c=>c.id==='saffi');
  for(const cat of [ume,saffi]){setController(w,cat,'agent');cat.body.state={...cat.body.state,x:a[0]-20,y:a[1]-20,z:height(a[0]-20,a[1]-20)};}
  assert.equal(command(w,ume,{verb:'do',activity:'gondola'}).ok,true);
  assert.equal(command(w,saffi,{verb:'fly'}).ok,true);
  assert.deepEqual(saffi.plan.slice(0,2).map(s=>s.kind),['go','gondola'],'the pilot plans the lift');
  let rode=false;
  for(let t=0;t<900;t+=.1){stepFolk(w,.1);if(ume.body.mode==='gondola'){rode=true;assert.equal(command(w,ume,{verb:'stop'}).ok,false);}}
  assert.ok(rode);
  assert.ok(events.filter(e=>e.cat==='ume'&&e.event==='rode_gondola').length===2,'up and back down');
  assert.ok(events.some(e=>e.cat==='saffi'&&e.event==='rode_gondola'),'saffi rode up');
  assert.ok(events.some(e=>e.cat==='saffi'&&e.event==='launched'&&e.site==='granite-ridge'),'and launched from the ridge');
});

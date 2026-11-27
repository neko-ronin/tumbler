// Trail T6 crosses the cascade's gorge on a footbridge (shared/geometry/footbridge/build.py): a level deck from rim to
// rim and a benched tread off each end. The verifier for "done": a walker following the trail, with a player's
// walking, collision and balance (footing), crosses both ways without losing footing or dropping into the gorge.
// Headless and conservative (every ground counts as granite, the surface that holds least); the in-game puppet
// (client/web/tools/puppet.cjs) walks the same route with the real surfaces and the renderer.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {DOWN} from '../../../shared/activities/balance.js';

const bytes=p=>{const b=readFileSync(new URL('../../../'+p,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const json=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const placement=json('shared/world/out/placement.json'),worldmap=json('shared/world/worldmap.json'),manifest=json('client/web/data/viewer.json');
const walk=json('shared/characters/player.json').walk,record=json('shared/world/out/footbridges.json');
const bridges=placement.instances.filter(i=>i.kind==='footbridge');
const assets=Object.fromEntries(bridges.map(b=>[b.asset,parseGLB(bytes('shared/geometry/'+b.asset))]));
const hitTest=buildWorldCollision({instances:bridges},assets);
const river=createRiverGranite(json('shared/world/out/river_granite.json')),gorge=createRiverGranite(json('shared/world/out/gorge_granite.json'));
const block=new HeightGrid({...manifest.height_grids.block,values:new Float32Array(bytes('client/web/data/heightmap.f32'))});
const far=new HeightGrid({...manifest.height_grids.far_field,values:new Float32Array(bytes('client/web/data/farfield.f32'))});
const ground=new GroundSampler(block,far,(x,y)=>river.height(x,y)??gorge.height(x,y));
const balance={config:json('shared/activities/balance.json'),surfaceAt:()=>'granite'};
const height=createWalkHeight(worldmap,(x,y)=>ground.height(x,y)),world={height,floorHeight:height.floorHeight,waterAt:height.waterAt,hitTest,balance},dt=1/60;

test('trail T6 has its footbridge, placed where the builder derived it',()=>{
  assert.equal(bridges.length,record.bridges.length);
  const b=bridges.find(i=>i.tags.includes('T6'));assert.ok(b,'no footbridge on T6');
  const r=record.bridges.find(x=>x.track==='T6');
  assert.deepEqual([b.position_m[0],b.position_m[1],b.position_m[2]],[...r.centre_xy_m,r.deck_z_m]);
  assert.ok(r.span_m>15&&r.span_m<40,`span ${r.span_m} m`);
});

test('a walker follows the trail across, both ways, keeping footing and never dropping into the gorge',()=>{
  for(const r of record.bridges){
    const [west,east]=r.approach_treads_xyz_m,route=[...west.slice().reverse(),...east];
    const yaw=r.yaw_deg*Math.PI/180,ux=Math.sin(yaw),uy=-Math.cos(yaw),half=r.length_m/2,[cx,cy]=r.centre_xy_m;
    for(const path of [route,route.slice().reverse()]){
      const [sx,sy]=path[0];
      let s={x:sx,y:sy,z:height(sx,sy),heading:Math.atan2(path[1][1]-sy,path[1][0]-sx),speed:0,grounded:true},i=1,lowest=Infinity,fell=null,t=0;
      for(;t<60&&i<path.length;t+=dt){
        const [wx,wy]=path[i],d=Math.hypot(wx-s.x,wy-s.y);
        if(d<.8){i++;continue;}
        s=stepMoves(s,{x:(wx-s.x)/d,y:(wy-s.y)/d,stick:[0,1]},dt,walk,world);
        if(!fell&&s.balance&&DOWN.has(s.balance.phase))fell={phase:s.balance.phase,at:[s.x,s.y,s.z].map(v=>+v.toFixed(2)),waypoint:i};
        const along=(s.x-cx)*ux+(s.y-cy)*uy,across=Math.abs((s.x-cx)*uy-(s.y-cy)*ux);
        if(Math.abs(along)<half-1&&across<1)lowest=Math.min(lowest,s.z-r.deck_z_m);
      }
      const way=path===route?'west to east':'east to west';
      assert.equal(i,path.length,`${r.id} ${way}: stopped at waypoint ${i}/${path.length} at ${[s.x,s.y,s.z].map(v=>v.toFixed(1))} after ${t.toFixed(1)} s`);
      assert.equal(fell,null,`${r.id} ${way}: lost footing ${JSON.stringify(fell)}`);
      assert.ok(lowest>-.3,`${r.id} ${way}: ${(-lowest).toFixed(1)} m below the deck mid-span`);
    }
  }
});

test('the deck is set at the rim, clear of the stream, and meets the treads without a step',()=>{
  for(const r of record.bridges){
    assert.ok(r.above_bed_m>=8,`${r.id}: deck only ${r.above_bed_m} m over the bed`);
    assert.ok(r.clearance_m>=.6,`${r.id}: girders clear the gorge by ${r.clearance_m} m`);
    for(const tread of r.approach_treads_xyz_m){
      assert.ok(Math.abs(tread[0][2]+.08-r.deck_z_m)<.02,`${r.id}: a tread starts ${(tread[0][2]+.08-r.deck_z_m).toFixed(2)} m off the deck`);
      for(const [a,b] of tread.slice(1).map((p,k)=>[tread[k],p]))assert.ok(Math.abs(b[2]-a[2])/Math.hypot(b[0]-a[0],b[1]-a[1])<=.56,`${r.id}: a tread pitches over 0.55`);
    }
  }
});

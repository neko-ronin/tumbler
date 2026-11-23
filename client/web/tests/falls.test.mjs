import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {GroundSampler,HeightGrid} from '../src3d/heights.js';
import {createGeologySampler,applyGeologyTerrain} from '../../../shared/geometry/granite/surface.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {fallsPath,cascadePath,clearance,mistPuffs} from '../src3d/falls.js';

// The ground exactly as main.js builds it from the published files.
const read=p=>fs.readFileSync(new URL(`../../../${p}`,import.meta.url));
const json=p=>JSON.parse(read(p));
const f32=p=>{const b=read(p);return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4).slice();};
const manifest=json('client/web/data/viewer.json'),worldmap=json('shared/world/worldmap.json');
const geology=worldmap.mountains.geology?json(worldmap.mountains.geology):null;
const ground=new GroundSampler(
  new HeightGrid({values:applyGeologyTerrain(f32('client/web/data/heightmap.f32'),manifest.height_grids.block,geology?.terrain?.block),...manifest.height_grids.block}),
  new HeightGrid({values:f32('client/web/data/farfield.f32'),...manifest.height_grids.far_field}),
  createRiverGranite(json('shared/world/out/river_granite.json')).height,geology?createGeologySampler(geology):null);
const height=(x,y)=>ground.height(x,y),path=fallsPath(worldmap,height);
const form=worldmap.water.form,lake=worldmap.water.bodies.find(b=>b.kind==='lake');

test('the sheet leaves the lip the map names',()=>{
  const [lx,ly]=form.stream_xy_m.at(-1),lz=lake.surface_z_m+form.lip_above_water_m;
  const top=path.sheet[0][path.columns>>1];
  assert.ok(Math.hypot(top.x-lx,top.y-ly,top.z-lz)<=2,`top ${top.x},${top.y},${top.z} vs lip ${lx},${ly},${lz}`);
});

test('the sheet falls the way the stream runs, at the shipped 4x width',()=>{
  const [px,py]=form.stream_xy_m.at(-2),[lx,ly]=form.stream_xy_m.at(-1),n=Math.hypot(lx-px,ly-py);
  assert.equal(path.width,4);
  assert.ok(Math.abs(path.direction[0]-(lx-px)/n)<1e-9&&Math.abs(path.direction[1]-(ly-py)/n)<1e-9,`direction ${path.direction}`);
  assert.ok(height(path.plunge[0],path.plunge[1])<lake.surface_z_m,'plunge over water');
});

test('the sheet comes down onto the lake surface, over water',()=>{
  for(const v of path.sheet.at(-1)){
    assert.ok(Math.abs(v.z-lake.surface_z_m)<=.5,`bottom at ${v.z}`);
    assert.ok(height(v.x,v.y)<lake.surface_z_m,`bottom over ground at ${v.x},${v.y}`);
  }
});

test('every sheet vertex is off the rock by 0.3 to 6 m',()=>{
  assert.deepEqual([path.pushed.length,path.buried.length],[0,0]);
  for(const v of path.sheet.flat()){
    const gap=clearance(height,v.x,v.y,v.z,8,.2);
    assert.ok(gap>=.3&&gap<=6,`gap ${gap.toFixed(2)} at ${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`);
  }
});

test('mist puffs keep the rock outside their visible core',()=>{
  const puffs=mistPuffs(path,height);
  assert.ok(puffs.length>=30,`${puffs.length} puffs`);
  const above=(x,y)=>{const h=height(x,y);return h<lake.surface_z_m?null:h;};
  for(const p of puffs)for(const f of [0,.5,1])assert.ok(clearance(above,p.x,p.y,p.z+p.climb*f,p.size,.5)>=p.size*.75);
});

test('the cascade sits on the stream bed from cascade_run_m above the lip down to the sheet',()=>{
  const cascade=cascadePath(worldmap,height,path),line=form.stream_xy_m;
  // Least distance from (x, y) to the stream's line.
  const off=(x,y)=>Math.min(...line.slice(1).map(([bx,by],i)=>{const [ax,ay]=line[i],vx=bx-ax,vy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*vx+(y-ay)*vy)/(vx*vx+vy*vy)));return Math.hypot(x-ax-vx*t,y-ay-vy*t);}));
  assert.equal(cascade.grid[0][0].d,form.cascade_run_m);
  for(const v of cascade.grid.flat()){
    const over=v.z-height(v.x,v.y);
    assert.ok(over>=.1&&over<=1.5,`${over.toFixed(2)} m over the ground at ${v.x.toFixed(1)},${v.y.toFixed(1)}`);
    assert.ok(off(v.x,v.y)<=12.5,`${off(v.x,v.y).toFixed(1)} m off the stream line at ${v.x.toFixed(1)},${v.y.toFixed(1)}`);
  }
  // Its last row is the lip, and meets the sheet's top within a metre and a half.
  const [lx,ly]=line.at(-1),foot=cascade.grid.at(-1)[cascade.columns>>1],top=path.sheet[0][path.columns>>1];
  assert.ok(Math.hypot(foot.x-lx,foot.y-ly)<.01,'cascade ends at the lip');
  assert.ok(Math.abs(foot.z-top.z)<=1.5,`cascade foot ${foot.z.toFixed(2)} vs sheet top ${top.z.toFixed(2)}`);
});

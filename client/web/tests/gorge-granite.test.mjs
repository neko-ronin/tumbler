// The cascade's 2 m gorge (shared/geometry/gorge-granite/build.py): the drawn mesh is the physical grid, it meets the
// 8 m terrain exactly at its border, and it only reshapes the gorge's walls, never the bed or the ground beyond.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseGLB} from '../src3d/glb.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';

const bytes=p=>{const b=readFileSync(new URL('../../../'+p,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const json=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const data=json('shared/world/out/gorge_granite.json'),surface=createRiverGranite(data),g=data.grid,manifest=json('client/web/data/viewer.json');
const block=new HeightGrid({...manifest.height_grids.block,values:new Float32Array(bytes('client/web/data/heightmap.f32'))});
const far=new HeightGrid({...manifest.height_grids.far_field,values:new Float32Array(bytes('client/web/data/farfield.f32'))});
const geometry=parseGLB(bytes('shared/geometry/'+data.geometry)).primitives[0].geometry;
// A footbridge's approach treads are cut into this patch as benches (shared/geometry/gorge-granite/build.py: 2.2 m
// tread and a 3 m shoulder).
const treads=json('shared/world/out/footbridges.json').bridges.flatMap(b=>b.approach_treads_xyz_m);
const benched=(x,y)=>treads.some(t=>t.slice(1).some((b,k)=>{const a=t[k],dx=b[0]-a[0],dy=b[1]-a[1],l=dx*dx+dy*dy||1,u=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/l));return Math.hypot(x-a[0]-dx*u,y-a[1]-dy*u)<5.2;}));
const at=i=>[g.offset_xy_m[0]+i%g.columns*g.sample_m,g.offset_xy_m[1]+Math.floor(i/g.columns)*g.sample_m];

test('every drawn top vertex is a physical grid sample',()=>{
  const p=geometry.attributes.position;
  for(let i=0;i<g.heights_m.length;i++){const [x,y]=at(i);assert.ok(Math.abs(p.getX(i)-x)<1e-4&&Math.abs(p.getZ(i)+y)<1e-4&&Math.abs(p.getY(i)-g.heights_m[i])<1e-3,`vertex ${i}`);}
});

test('the border is the 8 m terrain, so the seam has no step',()=>{
  let worst=0;
  for(let i=0;i<g.heights_m.length;i++){
    const c=i%g.columns,r=Math.floor(i/g.columns);if(c&&r&&c<g.columns-1&&r<g.rows-1)continue;
    const [x,y]=at(i);worst=Math.max(worst,Math.abs(g.heights_m[i]-block.sample(x,y)));
  }
  assert.ok(worst<.01,`border off the terrain by ${worst.toFixed(3)} m`);
});

test('only the bare rock of the gorge and the trail benches of the footbridge are reshaped, and walking reads the patch there',()=>{
  let changed=0;
  for(let i=0;i<g.heights_m.length;i++){
    const [x,y]=at(i),d=g.heights_m[i]-block.sample(x,y);
    if(Math.abs(d)>.01){changed++;assert.ok(g.granite[i]>0||benched(x,y),`ground moved ${d.toFixed(2)} m outside the gorge and the trail's benches at ${x},${y}`);}
  }
  assert.ok(changed>500,`only ${changed} samples carry relief`);
  const ground=new GroundSampler(block,far,surface.height),[x,y]=at(Math.floor(g.heights_m.length/2)+3);
  assert.equal(ground.height(x,y),surface.height(x,y));
});

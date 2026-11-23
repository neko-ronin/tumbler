import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWater,mediumAt} from '../../../shared/activities/water.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {HeightGrid,GroundSampler} from '../src3d/heights.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url))),worldmap=read('../../../shared/world/worldmap.json'),manifest=read('../data/viewer.json');
const buffer=p=>{const b=readFileSync(new URL(p,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const grid=(key,file)=>new HeightGrid({...manifest.height_grids[key],values:new Float32Array(buffer(file))});
const ground=new GroundSampler(grid('block','../data/heightmap.f32'),grid('far_field','../data/farfield.f32'),createRiverGranite(read('../../../shared/world/out/river_granite.json')).height);

/** The walker's waterAt before water.js (walk.js at 5376829), kept as the reference for the
 * shapes it defined: outer reaches, the oval lake and the level river. */
function legacyWaterAt(worldmap,floorHeight){
 return (x,y)=>{
  const z=floorHeight(x,y);if(!Number.isFinite(z))return null;
  for(const reach of worldmap.mountains?.enclosure?.river_reaches??[]){
   const line=reach.polyline_xyz_m;
   if((x-line[0][0])*(line.at(-1)[0]-line[0][0])<0)continue;
   let nearest=null;
   for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(length*length)));
    const surface=a[2]+(b[2]-a[2])*t,distance=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
    const half=reach.half_widths_m?reach.half_widths_m[i-1]+(reach.half_widths_m[i]-reach.half_widths_m[i-1])*t:reach.half_width_m;
    if(distance>half||distance>=(nearest?.distance??Infinity))continue;
    const sign=b[2]>a[2]?-1:1;nearest={distance,surface,flow:[dx/length*sign,dy/length*sign]};
   }
   if(nearest)return z<nearest.surface+.05?{surface_z:nearest.surface,depth:Math.max(0,nearest.surface-z),flow:nearest.flow}:null;
  }
  for(const b of worldmap.water?.bodies??[]){
   if(z>=b.surface_z_m+.05)continue;
   const water=flow=>({surface_z:b.surface_z_m,depth:Math.max(0,b.surface_z_m-z),flow});
   if(b.kind==='lake'&&Math.hypot((x-b.centre_xy_m[0])/(b.size_m[0]/2+b.bank_m),(y-b.centre_xy_m[1])/(b.size_m[1]/2+b.bank_m))<=1)return water([0,0]);
   if(b.kind==='river')for(let i=1;i<b.polyline.length;i++){
    const a=b.polyline[i-1],c=b.polyline[i],dx=c[0]-a[0],dy=c[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
    if(Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t)<=Math.max(b.width_start_m,b.width_end_m)/2+b.bank_m)return water([dx/Math.hypot(dx,dy),dy/Math.hypot(dx,dy)]);
   }
  }
  return null;
 };
}
/** The map with its bodies in the shapes the old walker knew: no lake outline, no falling river. */
const legacyShaped=map=>({...map,water:{...map.water,bodies:map.water.bodies.map(({outline_xy_m,polyline_xyz_m,half_widths_m,...b})=>b)}});

/** Compare createWater with the old walker on the legacy-shaped map; returns how many were wet, by body. */
function parity(floorHeight,points){
 const map=legacyShaped(worldmap),was=legacyWaterAt(map,floorHeight),water=createWater(map,floorHeight),wet={};
 for(const [x,y] of points){
  const old=was(x,y),now=water.waterAt(x,y);
  if(!old){assert.equal(now,null,`(${x},${y}) was dry`);continue;}
  assert.ok(now,`(${x},${y}) was wet`);
  assert.deepEqual({surface_z:now.surface_z,depth:now.depth,flow:now.flow},old,`(${x},${y})`);
  assert.equal(now.bed_z,floorHeight(x,y));
  wet[now.body]=(wet[now.body]??0)+1;
 }
 return wet;
}

/** The new bodies against water.js's own contract; returns how many were wet, by body. */
function contract(floorHeight,points){
 const water=createWater(worldmap,floorHeight),lake=worldmap.water.bodies.find(b=>b.kind==='lake'),river=worldmap.water.bodies.find(b=>b.kind==='river');
 const levels=river.polyline_xyz_m.map(p=>p[2]),reaches=worldmap.mountains.enclosure.river_reaches.map(r=>r.id),wet={};
 for(const [x,y] of points){
  const w=water.waterAt(x,y);if(!w)continue;
  const at=`(${x},${y}) in ${w.body}`;
  assert.equal(w.bed_z,floorHeight(x,y),at);assert.ok(w.bed_z<w.surface_z+.05,at);assert.equal(w.depth,Math.max(0,w.surface_z-w.bed_z),at);
  if(w.body===lake.id)assert.deepEqual([w.surface_z,w.flow,w.speed_mps],[lake.surface_z_m,[0,0],0],at);
  else{
   assert.ok(Math.abs(Math.hypot(...w.flow)-1)<1e-9,`${at}: flow is a unit direction`);assert.ok(w.speed_mps>0,at);
   if(w.body===river.id)assert.ok(w.surface_z<=Math.max(...levels)&&w.surface_z>=Math.min(...levels),`${at}: surface ${w.surface_z} on the falling river`);
   else assert.ok(reaches.includes(w.body),at);
  }
  wet[w.body]=(wet[w.body]??0)+1;
 }
 return wet;
}

test('on the real map and ground, 200 fixed points match today\'s waterAt',()=>{
 const lake=worldmap.water.bodies.find(b=>b.kind==='lake'),river=worldmap.water.bodies.find(b=>b.kind==='river'),reaches=worldmap.mountains.enclosure.river_reaches,points=[];
 // 60 across the lake and its shore, 60 across the block river, 20 across each outer reach, 40 over the wider world.
 for(let i=0;i<60;i++)points.push([lake.centre_xy_m[0]+(i%10-4.5)*90,lake.centre_xy_m[1]+(Math.floor(i/10)-2.5)*110]);
 for(let i=0;i<60;i++){const p=river.polyline[Math.floor(i/3)*11];points.push([p[0]+(i%3-1)*55,p[1]+(i%3-1)*55]);}
 for(const reach of reaches)for(let i=0;i<20;i++){const p=reach.polyline_xyz_m[5+Math.floor(i/2)*20];points.push([p[0],p[1]+(i%2)*30]);}
 for(let i=0;i<40;i++)points.push([-3800+(i%8)*1000,-2400+Math.floor(i/8)*1100]);
 assert.equal(points.length,200);
 const floor=createWalkHeight(worldmap,(x,y)=>ground.height(x,y)).floorHeight,ids=['lake','river',...reaches.map(r=>r.id)];
 for(const wet of [parity(floor,points),contract(floor,points)]){
  for(const id of ids)assert.ok(wet[id]>0,`no wet sample in ${id}: ${JSON.stringify(wet)}`);
  assert.ok(Object.values(wet).reduce((a,b)=>a+b)<200,'some samples are dry');
 }
});

test('over a flat bed every footprint matches today\'s waterAt, and names its body and speed',()=>{
 const points=[];for(let x=-4000;x<4000;x+=173)for(let y=-1500;y<500;y+=97)points.push([x,y]);
 parity(()=>14,points);contract(()=>14,points);
 const water=createWater(worldmap,()=>14),lake=worldmap.water.bodies.find(b=>b.kind==='lake'),river=worldmap.water.bodies.find(b=>b.kind==='river');
 assert.deepEqual(water.waterAt(...lake.centre_xy_m),{surface_z:30,bed_z:14,depth:16,flow:[0,0],speed_mps:0,body:'lake'});
 const w=water.waterAt(...river.polyline[10]);assert.equal(w.body,'river');assert.equal(w.speed_mps,.6);assert.equal(w.surface_z,river.polyline_xyz_m[10][2]);
 assert.equal(createWater(worldmap,()=>NaN).waterAt(...lake.centre_xy_m),null);
});

test('a lake with an outline is wet inside its ring and dry outside',()=>{
 // An L: the notch at x > 10, y > 10 is outside the ring though inside its bounding box.
 const lake={id:'tarn',kind:'lake',surface_z_m:5,outline_xy_m:[[0,0],[20,0],[20,10],[10,10],[10,20],[0,20]]};
 const water=createWater({water:{bodies:[lake]}},(x,y)=>x<2?5.5:3);
 assert.deepEqual(water.waterAt(5,15),{surface_z:5,bed_z:3,depth:2,flow:[0,0],speed_mps:0,body:'tarn'});
 assert.ok(water.waterAt(15,5));
 assert.equal(water.waterAt(15,15),null,'the notch');
 assert.equal(water.waterAt(-1,5),null);assert.equal(water.waterAt(25,5),null);assert.equal(water.waterAt(5,21),null);
 assert.equal(water.waterAt(1,5),null,'ground above the surface inside the ring is dry');
});

test('a river with a falling polyline interpolates its surface and width, and flows downhill',()=>{
 // Listed uphill, so the flow must point back along the polyline.
 const river={id:'beck',kind:'river',polyline_xyz_m:[[0,0,10],[100,0,12],[100,100,16]],half_widths_m:[4,8,8]};
 const water=createWater({water:{bodies:[river]}},()=>9);
 assert.deepEqual(water.waterAt(50,3),{surface_z:11,bed_z:9,depth:2,flow:[-1,-0],speed_mps:.6,body:'beck'});  // -0: the uphill listing negates a zero component
 assert.deepEqual(water.waterAt(100,50).flow,[-0,-1]);assert.equal(water.waterAt(100,50).surface_z,14);
 assert.ok(water.waterAt(25,4.9),'half width is 5 a quarter of the way along');assert.equal(water.waterAt(25,5.1),null);
 assert.equal(water.waterAt(50,20),null);assert.equal(water.waterAt(-10,0),null);
 assert.equal(createWater({water:{bodies:[{...river,current_mps:1.5}]}},()=>9).waterAt(50,0).speed_mps,1.5);
 assert.equal(createWater({water:{bodies:[river]}},()=>11.5).waterAt(50,0),null,'ground above the surface is dry');
});

test('mediumAt says air, surface or under, with submersion across the 0.35 m band',()=>{
 const w={surface_z:10};
 assert.deepEqual(mediumAt(null,5),{medium:'air',submersion:0});
 assert.deepEqual(mediumAt(w,10.35),{medium:'air',submersion:0});
 assert.deepEqual(mediumAt(w,11),{medium:'air',submersion:0});
 const mid=mediumAt(w,10);assert.equal(mid.medium,'surface');assert.ok(Math.abs(mid.submersion-.5)<1e-9);
 const top=mediumAt(w,10.2),low=mediumAt(w,9.8);
 assert.equal(top.medium,'surface');assert.equal(low.medium,'surface');assert.ok(top.submersion<.5&&low.submersion>.5);
 assert.deepEqual(mediumAt(w,9.6),{medium:'under',submersion:1});
 assert.deepEqual(mediumAt(w,2),{medium:'under',submersion:1});
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRiverGranite} from '../../../shared/activities/river-surface.js';
import {createWalkHeight} from '../../../shared/activities/walk.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {parseGLB} from '../src3d/glb.js';
import {terrainTileLevels} from '../src3d/terrain-lod.js';
import {HeightGrid,GroundSampler,landscapeHeightGrid} from '../src3d/heights.js';
import {buildTerrainGeometry} from '../src3d/terrain.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url))),data=read('../../../shared/world/out/river_granite.json'),surface=createRiverGranite(data),worldmap=read('../../../shared/world/worldmap.json'),manifest=read('../data/viewer.json'),walk=read('../../../shared/characters/player.json').walk;
const buffer=p=>{const b=readFileSync(new URL(p,import.meta.url));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
const asset=parseGLB(buffer('../../../shared/geometry/river-granite/river_granite.glb')),geometry=asset.primitives[0].geometry,g=data.grid;
const block=new HeightGrid({...manifest.height_grids.block,values:new Float32Array(buffer('../data/heightmap.f32'))}),far=new HeightGrid({...manifest.height_grids.far_field,values:new Float32Array(buffer('../data/farfield.f32'))});
const ground=new GroundSampler(block,far,surface.height),height=createWalkHeight(worldmap,(x,y)=>ground.height(x,y));
const physics={height,floorHeight:height.floorHeight,waterAt:height.waterAt,hitTest:createCollisionIndex([])};

test('the physical bed is every glTF top vertex and exactly the same triangle plane',()=>{
 const p=geometry.attributes.position;
 for(let i=0;i<g.heights_m.length;i++){
  const x=g.offset_xy_m[0]+i%g.columns*g.sample_m,y=g.offset_xy_m[1]+Math.floor(i/g.columns)*g.sample_m;
  assert.ok(Math.abs(p.getX(i)-x)<1e-5&&Math.abs(p.getZ(i)+y)<1e-5&&Math.abs(p.getY(i)-surface.height(x,y))<1e-5);
 }
 // Check interior points on both halves, including water and steep slab faces.
 for(let i=0;i<g.heights_m.length-g.columns-1;i+=29){if(i%g.columns===g.columns-1)continue;
  for(const [u,v]of [[.7,.2],[.2,.7]]){
   const x=p.getX(i)+u*g.sample_m,y=-p.getZ(i)+v*g.sample_m;
   const a=p.getY(i),b=p.getY(i+1),d=p.getY(i+g.columns+1),c=p.getY(i+g.columns);
   const z=u>=v?a+(b-a)*u+(d-b)*v:a+(c-a)*v+(d-c)*u;
   assert.ok(Math.abs(surface.height(x,y)-z)<1e-5);
  }
 }
});

test('the granite volume is a closed outward solid and its top is upward',()=>{
 const p=geometry.attributes.position,index=geometry.index.array,edges=new Map();let volume=0;
 const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(n=>n.toFixed(4)).join(',');
 for(let i=0;i<index.length;i+=3){const [a,b,c]=Array.from(index.slice(i,i+3));
  const ax=p.getX(a),ay=p.getY(a),az=p.getZ(a),bx=p.getX(b),by=p.getY(b),bz=p.getZ(b),cx=p.getX(c),cy=p.getY(c),cz=p.getZ(c);
  volume+=(ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx))/6;
  if(i<(g.columns-1)*(g.rows-1)*6)assert.ok((bz-az)*(cx-ax)-(bx-ax)*(cz-az)>0);
  for(const [u,v]of [[a,b],[b,c],[c,a]]){const ka=key(u),kb=key(v),e=[ka,kb].sort().join('|'),n=edges.get(e)??[0,0];n[ka<kb?0:1]++;edges.set(e,n);}
 }
 assert.ok(volume>1e6);for(const counts of edges.values())assert.deepEqual(counts,[1,1]);
});

test('the patch rim meets the accepted landscape and the rest of its sampler is untouched',()=>{
 const lattice=landscapeHeightGrid(block,far),base=buildTerrainGeometry(lattice).geometry,p=base.attributes.position;
 for(let r=0;r<g.rows;r++)for(let c=0;c<g.columns;c++)if(r===0||c===0||r===g.rows-1||c===g.columns-1){
  const x=g.offset_xy_m[0]+c*g.sample_m,y=g.offset_xy_m[1]+r*g.sample_m,gx=(x-lattice.offsetX)/lattice.quad,gy=(y-lattice.offsetY)/lattice.quad,col=Math.min(lattice.resolution-2,Math.floor(gx)),row=Math.min(lattice.resolution-2,Math.floor(gy)),u=gx-col,v=gy-row,i=row*lattice.resolution+col;
  const a=p.getY(i),b=p.getY(i+1),d=p.getY(i+lattice.resolution+1),e=p.getY(i+lattice.resolution),z=u>=v?a+(b-a)*u+(d-b)*v:a+(e-a)*v+(d-e)*u;
  assert.ok(Math.abs(surface.height(x,y)-z)<.0002);
 }
 for(const [x,y]of [[0,0],[-3200,300],[2400,800],[1000,-600]])assert.equal(ground.height(x,y),block.sample(x,y)??far.sample(x,y));base.dispose();
});

test('LOD retains the complete top tile rim and bounds all removed source relief',()=>{
 const row=64,col=256,levels=terrainTileLevels({resolution:g.columns,values:g.heights_m},row,col,32,32,[1,2,4,8]);
 for(const l of levels){const used=new Set(l.index.array);for(let i=0;i<=32;i++)for(const v of [i,32*33+i,i*33,i*33+32])assert.ok(used.has(v));assert.ok(Number.isFinite(l.error)&&l.error>=0);}
 assert.equal(levels[0].error,0);assert.ok(levels.at(-1).triangles<levels[0].triangles/3);
});

test('published outer water flows downhill at both ends and exposes dry granite islands',()=>{
 for(const reach of worldmap.mountains.enclosure.river_reaches)for(let i=1;i<reach.polyline_xyz_m.length;i++){
  const a=reach.polyline_xyz_m[i-1],b=reach.polyline_xyz_m[i],x=a[0]+(b[0]-a[0])*.1,y=a[1]+(b[1]-a[1])*.1;
  const query=createWalkHeight(worldmap,()=>-20).waterAt(x,y);assert.ok(query);assert.ok(Math.abs(query.surface_z-(a[2]+(b[2]-a[2])*.1))<1e-6);assert.ok((query.flow[0]*(b[0]-a[0])+query.flow[1]*(b[1]-a[1]))*(b[2]-a[2])<0);
 }
 assert.equal(createWalkHeight(worldmap,()=>19.91).waterAt(2068,-421.49),null,'dry reach granite overrides the old block endpoint envelope');
 let wet=0,dry=0;for(let x=2250;x<3900;x+=13)for(let y=-780;y<-400;y+=7)if((surface.granite(x,y)??0)>.8){if(height.waterAt(x,y))wet++;else dry++;}
 assert.ok(wet>100&&dry>100,'both exposed granite and submerged bed exist');
});

test('a real downstream bank can be walked into, swum, dived and walked back out',()=>{
 const x=3400;let s={x,y:-725,z:ground.height(x,-725),heading:Math.PI/2,speed:0,grounded:true},modes=new Set(),maxRise=0,previous=s.z;
 const run=(seconds,input)=>{for(let i=0;i<seconds*60;i++){s=stepMoves(s,input,1/60,walk,physics);modes.add(s.mode??'ground');maxRise=Math.max(maxRise,Math.abs(s.z-previous));previous=s.z;assert.ok(s.z>=ground.height(s.x,s.y)-1e-5);}};
 run(19,{x:0,y:1});assert.equal(s.mode,'swim');const z=s.z;run(1,{x:0,y:0,run:true,pitch:-1});assert.ok(s.z<z-.2);run(3,{x:0,y:0});run(30,{x:0,y:-1});
 assert.equal(s.mode,'ground');assert.ok(s.y<-700);assert.ok(modes.has('ground')&&modes.has('swim'));assert.ok(maxRise<.15,`frame height change ${maxRise}`);
});

test('unknown versions and malformed physical grids fail instead of guessing',()=>{
 assert.throws(()=>createRiverGranite({...data,version:2}),/version/);assert.throws(()=>createRiverGranite({...data,grid:{...g,heights_m:[]}}),/grid/);assert.equal(surface.height(0,0),null);
});

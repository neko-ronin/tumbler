import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cloudForm,CLOUD_BILLOWS,CLOUD_DENSITY_GLSL,CLOUD_LEAN,CLOUD_TRAIL,CLOUD_TRAIL_START,CLOUD_SMEAR} from '../src3d/cloud-field.js';
import {cloudCellBounds,skyFor} from '../src3d/cloud-shadow-field.js';

const read=path=>JSON.parse(readFileSync(new URL(path,import.meta.url),'utf8'));
const map=read('../../../shared/world/worldmap.json').atmosphere;
// Every sky the map holds (golden hour and each time's own): flat humilis through 2.75 km congestus.
// Only shipped data: the public build runs these tests without docs/.
const skies=[map,...Object.values(map.times??{})];
const cells=skies.flatMap(sky=>sky.cloud_cells.map(cell=>({cell,extent:cloudCellBounds(cell,sky).extent})));

test('every billow stays inside its core cell, whatever the cell\'s proportions',()=>{
 for(const {cell,extent} of cells){
  const {billows,form:[aspect]}=cloudForm(cell.seed,extent);assert.equal(billows.length,CLOUD_BILLOWS*4);
  for(let i=4;i<billows.length;i+=4){
   const [x,y,z,gradient]=billows.slice(i,i+4),r=1/gradient;
   assert.ok(Math.hypot(x,z)+r<=.44+1e-6,`seed ${cell.seed}: a turret must not be cut by the cell wall`);
   // Below the base is fine: the base cut is what leaves the cloud flat-bottomed.
   assert.ok(y+r<=aspect*.5-aspect*.06+1e-6,`seed ${cell.seed}: a turret must not be cut by the cell top`);
  }
 }
});

test('empty-step bound conservatively encloses the actual density recipe',()=>{
 const density=CLOUD_DENSITY_GLSL;
 const body=[...density.matchAll(/vec3\(([\d.]+),uBillow\[0\]\.w,([\d.]+)\)/g)].flatMap(m=>[Number(m[1]),Number(m[2])]);
 assert.ok(body.length>=2&&body.every((v,i)=>v===body[i%2]),'the density and the marched span must use the same body scales');
 for(const {cell,extent} of cells){
  const {billows,form:[aspect],rate}=cloudForm(cell.seed,extent);
  // u-space stretches box-normalised y by the aspect, so a gradient there is up to max(1,aspect) steeper per unit travelled.
  const steepest=Math.max(...body,...Array.from({length:CLOUD_BILLOWS},(_,j)=>billows[j*4+3]))*Math.max(1,aspect);
  assert.ok(rate>=steepest-1e-9,`seed ${cell.seed}: a steeper billow needs a larger rate bound before any view samples can be skipped`);
 }
 const view=readFileSync(new URL('../src3d/clouds.js',import.meta.url),'utf8');
 assert.match(view,/cloudDensityRate=uBillowRate\*length/,'the view march must use the per-cell bound');
 const amplitude=Number(density.match(/\(n.r-\.5\)\*([\d.]+)/)?.[1]);
 const ramp=Number(density.match(/smoothstep\((-[\d.]+),[^,]+,shape\)/)?.[1]);
 const support=Number(density.match(/if\(shape<(-[\d.]+)\)/)?.[1]);
 assert.ok(Number.isFinite(amplitude)&&Number.isFinite(ramp)&&Number.isFinite(support));
 assert.ok(support<ramp-amplitude*.5,'positive noise must never bring a skipped point into nonzero density');
 // Noise gain never exceeds 1 and the edge sharpening only scales shape away from zero, so the bound above still holds.
 for(const {cell,extent} of cells){const [,frequency,gain]=cloudForm(cell.seed,extent).form;assert.ok(gain<=1&&frequency>=1.15,`seed ${cell.seed}`);}
});

test('the marched span encloses every point that can hold cloud',()=>{
 const density=CLOUD_DENSITY_GLSL;
 const amplitude=Number(density.match(/\(n.r-\.5\)\*([\d.]+)/)?.[1]),ramp=Number(density.match(/smoothstep\((-[\d.]+),[^,]+,shape\)/)?.[1]);
 const body=Number(density.match(/shape=([\d.]+)-length/)?.[1]),[bodyReach,bodySmear]=(density.match(/bodyReach=support\+([\d.]+)\+([\d.]+);/)||[]).slice(1).map(Number);
 assert.ok(Math.abs(body-1-bodyReach)<1e-9,'the body starts higher than a turret by exactly the extra reach its span is given');
 // The lean shifts cloud by LEAN; the trail stretches the farthest cloud (half a cell out) by TRAIL(.5-START)/(1-TRAIL).
 const smear=CLOUD_LEAN+CLOUD_TRAIL*(.5-CLOUD_TRAIL_START)/(1-CLOUD_TRAIL);
 assert.ok(CLOUD_SMEAR>=smear,'the span margin must cover the lean and the trail');
 assert.ok(bodySmear>=smear*2.3-1e-4,'the body span, squashed up to 2.3 times across, must carry the same margin');
 assert.ok(Number(density.match(/reach=support\/uBillow\[j\]\.w\+([\d.]+)/)?.[1])>=smear-1e-4,'each turret span must carry the margin');
 assert.match(density,/shape\*=1\.5\*uForm\.y\/1\.15/,'edge sharpening must only scale shape away from zero, which cannot widen the support');
 for(const {cell,extent} of cells){
  const {form:[,,gain],support}=cloudForm(cell.seed,extent);
  // A turret's shape is 1 at its centre and falls by 1 per radius; noise lifts it by at most half the amplitude times the gain; density needs more than the ramp's start.
  assert.ok(support>=1-ramp+amplitude*.5*gain-1e-9,`seed ${cell.seed}: cloud could exist outside the span the view ray marches`);
 }
 const view=readFileSync(new URL('../src3d/clouds.js',import.meta.url),'utf8');
 assert.match(view,/cloudSpan\(cameraPosition,ray,entry,exit,uSupport\)/,'the view march must narrow each ray with the per-cell support');
});

test('each light finds its own sky, and a light without one keeps golden hour\'s',()=>{
 assert.equal(skyFor(map,'golden'),map);
 for(const [light,sky]of Object.entries(map.times??{}))assert.equal(skyFor(map,light),sky,light);
 assert.equal(skyFor({...map,times:undefined},'dusk').cloud_cells,map.cloud_cells);
 const seeds=skies.flatMap(sky=>sky.cloud_cells.map(c=>c.seed));
 assert.equal(new Set(seeds).size,seeds.length,'seeds must differ across the map\'s skies, or two clouds would share one shape');
});

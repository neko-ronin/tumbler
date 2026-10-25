import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CLOUD_DENSITY_GLSL} from '../src3d/cloud-field.js';

test('empty-step bound conservatively encloses the actual density recipe',()=>{
 const density=CLOUD_DENSITY_GLSL;
 const scales=[...density.matchAll(/length\(\(p-vec3\([^)]*\)\)\*vec3\(([^)]*)\)/g)].flatMap(m=>m[1].split(',').map(Number));
 assert.ok(scales.length>0&&scales.every(v=>Number.isFinite(v)&&v>0),'derive the bound from actual billow scales');
 const view=readFileSync(new URL('../src3d/clouds.js',import.meta.url),'utf8');
 const rate=Number(view.match(/cloudDensityRate=([\d.]+)\*length/)?.[1]);
 assert.ok(rate>=Math.max(...scales),'a larger billow gradient needs a larger rate bound before any view samples can be skipped');
 const amplitude=Number(density.match(/shape\+=\(n.r-\.5\)\*([\d.]+)/)?.[1]);
 const ramp=Number(density.match(/smoothstep\((-[\d.]+),[\d.]+,shape\)/)?.[1]);
 const support=Number(density.match(/if\(shape<(-[\d.]+)\)/)?.[1]);
 assert.ok(Number.isFinite(amplitude)&&Number.isFinite(ramp)&&Number.isFinite(support));
 assert.ok(support<ramp-amplitude*.5,'positive noise must never bring a skipped point into nonzero density');
});

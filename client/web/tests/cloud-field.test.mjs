import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudNoiseAt,buildCloudNoise} from '../src3d/cloud-field.js';

test('cloud detail repeats continuously in every axis, including negative wind travel',()=>{
 for(const p of [[.124,.719,.337],[-.42,1.1,-2.71],[0,0,0]]){
  const a=cloudNoiseAt(...p);
  for(let axis=0;axis<3;axis++)for(const period of [-3,-1,1,4]){
   const q=[...p];q[axis]+=period;
   cloudNoiseAt(...q).forEach((v,i)=>assert.ok(Math.abs(v-a[i])<1e-9,'drifting detail must not jump at the repeating texture seam'));
  }
 }
 for(let axis=0;axis<3;axis++){
  const a=[.193,.347,.713],b=[...a];a[axis]=-1e-6;b[axis]=1e-6;
  const left=cloudNoiseAt(...a),right=cloudNoiseAt(...b);
  right.forEach((v,i)=>assert.ok(Math.abs(v-left[i])<.001,'both sides of the seam must approach the same field'));
 }
});

test('packed cloud detail is deterministic, bounded and carries independent spatial channels',()=>{
 const a=buildCloudNoise(8),b=buildCloudNoise(8);assert.deepEqual(a,b);
 const channels=[new Set(),new Set(),new Set()];let differs=0;
 for(let i=0;i<a.length;i+=4){
  assert.equal(a[i+3],255);
  for(let c=0;c<3;c++)channels[c].add(a[i+c]);
  if(a[i]!==a[i+1]&&a[i+1]!==a[i+2])differs++;
 }
 assert.ok(channels.every(c=>c.size>30),'each packed channel must contain spatial detail');
 assert.ok(differs>a.length/8,'detail channels must not collapse to copies');
});

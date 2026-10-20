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

test('cached lattice preserves the original field at texel centres and arbitrary signed coordinates',async()=>{
 // Hash/features are computed independently here, without the production cache.
 const wrap=(n,p)=>((n%p)+p)%p;
 const hash=(x,y,z,p)=>{let n=Math.imul(wrap(x,p),73856093)^Math.imul(wrap(y,p),19349663)^Math.imul(wrap(z,p),83492791);n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return ((n^(n>>>16))>>>0)/4294967296;};
 const value=(x,y,z,p)=>{const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),f=[x-ix,y-iy,z-iz].map(v=>v*v*(3-2*v));let sum=0;for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=hash(ix+i,iy+j,iz+k,p)*(i?f[0]:1-f[0])*(j?f[1]:1-f[1])*(k?f[2]:1-f[2]);return sum;};
 const worley=(x,y,z,p)=>{const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);let d=3;for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){const h=hash(ix+i,iy+j,iz+k,p)*65536,dx=ix+i+(h*13.37)%1-x,dy=iy+j+(h*7.19)%1-y,dz=iz+k+(h*3.71)%1-z;d=Math.min(d,dx*dx+dy*dy+dz*dz);}return 1-Math.min(1,Math.sqrt(d));};
 const reference=(x,y,z)=>[value(x*4,y*4,z*4,4)*.58+value(x*8,y*8,z*8,8)*.28+value(x*16,y*16,z*16,16)*.14,worley(x*6,y*6,z*6,6),worley(x*12,y*12,z*12,12)];
 for(const p of [[-.42,1.1,-2.71],[.124,.719,.337],...Array.from({length:40},(_,i)=>[(i+.5)/48,((i*17)%48+.5)/48,((i*31)%48+.5)/48])]){
  const actual=cloudNoiseAt(...p),expected=reference(...p);actual.forEach((v,i)=>assert.ok(Math.abs(v-expected[i])<1e-12));
 }
});

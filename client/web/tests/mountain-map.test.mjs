import test from 'node:test';import assert from 'node:assert/strict';
import {bakeMountainMap,bakeCreaseHeights,MOUNTAIN_SLOPE_RANGE} from '../src3d/granite-shading.js';
// A ridge running along y, falling to two valleys, with one meadow-flat corner.
const n=128,quad=8,values=new Float32Array(n*n);
for(let r=0;r<n;r++)for(let c=0;c<n;c++)values[r*n+c]=Math.max(40,900-Math.abs(c-64)*quad*1.1);
const channel=(data,k,r,c)=>data[(r*n+c)*4+k]/255;
const data=bakeMountainMap({values,resolution:n,quad});
const band=(k,fn,rows=[40,88])=>{let sum=0,count=0;for(let r=rows[0];r<rows[1];r++)for(let c=0;c<n;c++)if(fn(c)){sum+=channel(data,k,r,c);count++;}return sum/count;};
test('the ridge is exposed and the slope foot is not',()=>{
 assert.ok(band(1,c=>Math.abs(c-64)<2)>.6);
 assert.ok(band(1,c=>Math.abs(c-64)>30&&Math.abs(c-64)<40)<band(1,c=>Math.abs(c-64)<2)-.1);
});
test('gullies gather downslope on steep ground, and flat ground keeps none',()=>{
 assert.ok(band(0,c=>Math.abs(c-64)>50&&Math.abs(c-64)<56)>band(0,c=>Math.abs(c-64)<8));
 let peak=0;for(let r=30;r<98;r++)for(let c=8;c<56;c++)peak=Math.max(peak,channel(data,0,r,c));
 assert.ok(peak>.3,`no channel formed: ${peak}`);
 const flat=new Float32Array(n*n).fill(100),out=bakeMountainMap({values:flat,resolution:n,quad});
 for(let i=0;i<out.length;i+=4){assert.equal(out[i],0);assert.ok(Math.abs(out[i+1]-128)<=1);assert.ok(Math.abs(out[i+2]-128)<=1&&Math.abs(out[i+3]-128)<=1);}
});
test('the erosion slope is what the water cut, not the mountain\'s own slope',()=>{
 const decode=v=>(v/255-.5)*2*MOUNTAIN_SLOPE_RANGE;let total=0,count=0;
 for(let r=30;r<98;r++)for(let c=8;c<56;c++){total+=decode(data[(r*n+c)*4+2]);count++;}
 assert.ok(Math.abs(total/count)<.35,`added mean slope ${total/count} repeats the 1.1 terrain slope`);
});
test('the bake is deterministic',()=>assert.deepEqual(bakeMountainMap({values,resolution:n,quad}),data));
test('the crease tile wraps without a seam',()=>{
 const size=128,h=bakeCreaseHeights(size);let edge=0,inner=0;
 for(let i=0;i<size;i++){edge=Math.max(edge,Math.abs(h[i*size]-h[i*size+size-1]),Math.abs(h[i]-h[(size-1)*size+i]));inner=Math.max(inner,Math.abs(h[i*size+60]-h[i*size+61]));}
 assert.ok(edge<=inner*1.5,`seam ${edge} against interior step ${inner}`);
});

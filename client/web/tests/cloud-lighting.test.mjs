import test from 'node:test';import assert from 'node:assert/strict';
import {cloudLightUv} from '../src3d/cloud-lighting.js';
test('cached light interpolation stays within its cell/slice gutters at all six boundaries',()=>{
 const atlas=[1088,544],origin=[272,136];
 for(const layer of [0,7,8,15,24,31])for(const x of [-1,0,.5,1,2])for(const z of [-1,0,.5,1,2]){
  const uv=cloudLightUv([x,.5,z],layer,origin,atlas),pixel=uv.map((v,i)=>v*atlas[i]);
  const tile=[origin[0]+(layer%8)*34,origin[1]+Math.floor(layer/8)*34];
  for(let axis=0;axis<2;axis++)assert.ok(pixel[axis]>=tile[axis]+1.5-1e-9&&pixel[axis]<=tile[axis]+32.5+1e-9,'trilinear reads must not cross a slice or another cloud');
 }
 const centre=cloudLightUv([.5,.5,.5],0,origin,atlas);
 assert.deepEqual(centre.map((v,i)=>v*atlas[i]-origin[i]),[17,17]);
});

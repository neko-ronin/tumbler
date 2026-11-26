import test from 'node:test';import assert from 'node:assert/strict';
import {bakeTurf,turfTextures,TURF_SURFACE_GLSL} from '../src3d/turf-texture.js';

test('turf albedo x occlusion averages to 1, so LOD bands and mips hand off without a tone step',()=>{
 for(const opts of [{size:128,blades:2400,length:[3,12],width:[1,2],seed:5},{size:64,blades:900,length:[2,5],width:[1,1.5],tussock:1,seed:7}]){
  const patch=bakeTurf(opts),{colour,shape}=turfTextures(patch,{slopeScale:5,aoRadius:3,aoStrength:2}),n=opts.size*opts.size;
  for(let c=0;c<3;c++){let sum=0;for(let i=0;i<n;i++)sum+=colour[i*4+c]/255*4*shape[i*4+2]/255;assert.ok(Math.abs(sum/n-1)<.03,`channel ${c} mean ${sum/n}`);}
  const green=[[0,0],[0,0]];for(let i=0;i<n;i++){const k=patch.height[i]>0?1:0;green[k][0]+=colour[i*4+1];green[k][1]++;}
  assert.ok(green[0][1]&&green[1][1]&&green[0][0]/green[0][1]<green[1][0]/green[1][1]*.8,'soil darker than blades');
 }
});

test('turf bake is deterministic and wraps at the tile edge',()=>{
 const a=bakeTurf({size:64,blades:600,length:[4,20],width:[1,2],seed:3}),b=bakeTurf({size:64,blades:600,length:[4,20],width:[1,2],seed:3});
 assert.deepEqual(a.height,b.height);
 let left=0,right=0;for(let y=0;y<64;y++){left+=a.height[y*64]>0;right+=a.height[y*64+63]>0;}
 assert.ok(left>0&&right>0);
});

test('every turf tap is stochastically tiled, with gradients taken outside branches',()=>{
 const taps=TURF_SURFACE_GLSL.match(/textureGrad\(uGroundLayers,vec3\(o,/g)??[];
 assert.equal(taps.length,6);assert.ok(!/textureGrad\(uGroundLayers,vec3\(uv/.test(TURF_SURFACE_GLSL));
 const body=TURF_SURFACE_GLSL.slice(TURF_SURFACE_GLSL.indexOf('Turf turfSurface'));
 assert.ok(body.indexOf('dFdx')<body.indexOf('if('),'derivatives before the first branch');
});

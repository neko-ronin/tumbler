import test from 'node:test';
import assert from 'node:assert/strict';
import {createRidgeCull} from '../src3d/ridge-cull.js';

// A 32 m grid, flat at 0 m, with a 200 m wall running north-south at x = 0.
function grid(){
  const resolution=129,quad=32,offset=-2048,values=new Float32Array(resolution*resolution);
  for(let r=0;r<resolution;r++)for(let c=0;c<resolution;c++)values[r*resolution+c]=Math.abs(offset+c*quad)<=64?200:0;
  return {values,resolution,quad,offsetX:offset,offsetY:offset};
}

test('a wall hides what is behind it from the ground, not from above it', () => {
  const {hidden}=createRidgeCull(grid());
  const walker={x:-1000,y:2,z:0},pilot={x:-1000,y:600,z:0};
  assert.equal(hidden(walker,1000,30,0),true,'a tree 1 km behind the wall');
  assert.equal(hidden(pilot,1000,30,0),false,'seen over the wall from 600 m');
  assert.equal(hidden(walker,-500,30,0),false,'a tree on the walker\'s own side');
});

test('cautious mode needs the ground well above the sight line; on foot, touching it is enough', () => {
  // A 10 m bank: the walker's line to a 6 m tree top runs about 4 m above the ground there.
  const g=grid();
  for(let r=0;r<g.resolution;r++)for(let c=0;c<g.resolution;c++){const x=g.offsetX+c*g.quad;g.values[r*g.resolution+c]=Math.abs(x)<=64?10:0;}
  const {hidden}=createRidgeCull(g),walker={x:-1000,y:2,z:0};
  assert.equal(hidden(walker,1000,6,0,false),false);
  assert.equal(hidden(walker,1000,6,0,true),true);
});

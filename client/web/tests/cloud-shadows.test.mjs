import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudCellBounds,cloudGroundFootprint} from '../src3d/cloud-shadow-field.js';
const atmosphere={cloud_base_m:980,cloud_top_m:1600};
test('cloud bounds retain shared horizontal extents and clip only to the shared altitude band',()=>{
 const cell={centre_xy_m:[120,-350],size_m:[800,600,900]};
 assert.deepEqual(cloudCellBounds(cell,atmosphere),{centre:[120,1290,350],extent:[800,620,600]});
});
test('cloud shadow footprint follows solar bearing, elevation and receiver height',()=>{
 const box={centre:[0,1100,0],extent:[200,200,200]};
 const east=cloudGroundFootprint(box,[1,1,0],0,0),west=cloudGroundFootprint(box,[-1,1,0],0,0);
 assert.ok(east.high[0]<0,'light from east must cast a shadow west');
 assert.ok(west.low[0]>0,'reversing the sun must reverse the projection');
 const overhead=cloudGroundFootprint(box,[0,1,0],0,0);
 assert.deepEqual(overhead,{low:[-100,-100],high:[100,100]});
 const raised=cloudGroundFootprint(box,[1,1,0],500,500);
 assert.equal(raised.low[0]-east.low[0],500,'raising the receiver brings the shadow toward its cloud');
 const lowSun=cloudGroundFootprint(box,[1,.25,0],0,0);
 assert.ok(lowSun.high[0]<east.low[0],'low sunlight must project farther');
 assert.equal(cloudGroundFootprint(box,[1,0,0],0,0),null);
});

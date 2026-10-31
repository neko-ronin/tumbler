import test from 'node:test';
import assert from 'node:assert/strict';
import {FOREST_PALETTE,REPLACED,paletteOverride,hexToLinear} from '../../../shared/geometry/tree-design/forest-palette.js';
test('every chosen forest tone records what it replaced, and converts to linear RGB',()=>{
  for(const [type,tones] of Object.entries(FOREST_PALETTE))for(const tone of Object.keys(tones))assert.match(REPLACED[type][tone],/^#[0-9a-f]{6}$/,type+' '+tone);
  assert.deepEqual(Object.keys(REPLACED.giant),Object.keys(FOREST_PALETTE.giant));
  assert.ok(Math.abs(hexToLinear('#ffffff')[0]-1)<1e-9&&hexToLinear('#000000')[1]===0);
  assert.equal(paletteOverride('unknown'),undefined);
  assert.equal(paletteOverride('giant').mid.length,3);
});

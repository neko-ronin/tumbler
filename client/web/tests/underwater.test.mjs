import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {refractedSun,underwaterFog} from '../src3d/underwater.js';

test('sunlight refracts steeper into the water, by Snell\'s law', () => {
  for(const elevation of [.25,.48,.84]){
    const sun=new T.Vector3(.6,elevation,-.5).normalize(),ray=refractedSun(sun);
    assert.ok(ray.y<0,'the ray goes down');
    const sinAir=Math.hypot(sun.x,sun.z),sinWater=Math.hypot(ray.x,ray.z);
    assert.ok(Math.abs(sinAir-1.333*sinWater)<1e-6,`n1 sin a = n2 sin b at elevation ${elevation}`);
    assert.ok(Math.sign(ray.x)===-Math.sign(sun.x),'it travels away from the sun');
  }
  // A grazing sun still enters no shallower than the critical angle (48.6 deg from vertical).
  const grazing=refractedSun(new T.Vector3(1,1e-6,0));
  assert.ok(Math.abs(Math.asin(Math.hypot(grazing.x,grazing.z))*180/Math.PI-48.6)<.1);
});

test('the water darkens and closes in with depth, and dims with the light', () => {
  const surface=underwaterFog(0,1),deep=underwaterFog(20,1),deeper=underwaterFog(40,1);
  const lum=c=>c.r+c.g+c.b;
  assert.ok(lum(surface.color.clone())>lum(deep.color.clone())*1.8,'deep water is much darker');
  assert.equal(surface.far,20,'20 m visibility, a real alpine lake (the human, 2026-11-22)');assert.equal(deep.far,20);assert.equal(deeper.far,20);
  assert.ok(lum(underwaterFog(5,.52).color)<lum(underwaterFog(5,1).color),'dusk is darker than day');
  assert.ok(deep.color.b>deep.color.r&&deep.color.g>deep.color.r,'blue-green, never grey');
});

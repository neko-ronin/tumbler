import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {bindTreeSunShadow,updateTreeSunShadow,treeShadowUniforms} from '../src3d/tree-shadows.js';
import {treeMaterial,villageBarkMaterial} from '../src3d/tree-material.js';

test('tree receivers acquire the existing sun map after first allocation and follow replacement maps',()=>{
 const sun=new T.DirectionalLight(),uniforms=treeShadowUniforms();
 bindTreeSunShadow(sun);assert.equal(uniforms.uTreeSunReady.value,0,'warmup has not allocated the map yet');
 sun.shadow.map=new T.WebGLRenderTarget(2048,2048);sun.shadow.bias=-.00015;sun.shadow.normalBias=.7;
 const material=villageBarkMaterial();material.onBeforeRender();
 assert.equal(uniforms.uTreeSunReady.value,1);assert.equal(uniforms.uTreeSunMap.value,sun.shadow.map.texture);
 assert.equal(uniforms.uTreeSunMatrix.value,sun.shadow.matrix);assert.equal(uniforms.uTreeSunBias.value,-.00015);assert.equal(uniforms.uTreeSunNormalBias.value,.7);
 const first=sun.shadow.map;sun.shadow.map=new T.WebGLRenderTarget(1024,512);updateTreeSunShadow();
 assert.equal(uniforms.uTreeSunMap.value,sun.shadow.map.texture);assert.deepEqual(uniforms.uTreeSunTexel.value.toArray(),[1/1024,1/512]);
 assert.equal(treeShadowUniforms().uTreeSunMap,uniforms.uTreeSunMap,'compiled materials share live handles');
 bindTreeSunShadow(null);assert.equal(uniforms.uTreeSunReady.value,0,'isolated captures can opt out of scenery');
 first.dispose();sun.shadow.map.dispose();material.dispose();material.studioMaskMaterial.dispose();
});

test('redwood wood response is selected by biological profile for village and both forest species',()=>{
 for(const leafProfile of ['redwood','pine','fir']){
  const m=treeMaterial({leafProfile,toonBands:4,rimStrength:0,canopyShade:.85,transmission:.7,leafThickness:.4});
  assert.equal(m.userData.treeRedBark,leafProfile==='redwood');
  const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <common>\n#include <opaque_fragment>\n#include <alphatest_fragment>'};m.onBeforeCompile(shader);
  assert.equal(shader.uniforms.uTreeRedBark.value,+(leafProfile==='redwood'));assert.equal(shader.uniforms.uTreeSunReady,treeShadowUniforms().uTreeSunReady);
  m.dispose();m.studioMaskMaterial.dispose();
 }
});

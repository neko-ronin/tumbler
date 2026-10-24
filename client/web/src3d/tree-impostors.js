/** Multi-view impostors for the adopted tree plan. Reduced spatial capture
 * sources retain the saved distant-stage recipe; world light is baked only
 * when its preset changes. No runtime procedural tree generation. */
import * as T from '../vendor/three.module.min.js';
import {style,sunShadowShader} from './style.js';

export function bakeCards(renderer, geometry, material, representation, settings) {
  const views = representation === 'multiview' ? settings.views : representation === 'crossed' ? 2 : 1;
  const columns = Math.min(4, views + 1), rows = Math.ceil((views + 1) / columns), resolution = settings.resolution;
  const target = new T.WebGLRenderTarget(columns * resolution, rows * resolution);
  target.texture.colorSpace = T.SRGBColorSpace;
  target.texture.generateMipmaps = true; target.texture.minFilter = T.LinearMipmapLinearFilter;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, size = box.getSize(new T.Vector3()), centre = box.getCenter(new T.Vector3());
  const width = Math.max(size.x, size.z) * 1.14, height = size.y * 1.04;
  const scene = new T.Scene(), mesh = new T.Mesh(geometry, material); scene.add(mesh);
  material.defaultAttributeValues = {...material.defaultAttributeValues, forestInterval: [0, 1]};
  scene.add(new T.HemisphereLight('#dcebf3', '#7d8064', 2.1));
  const sun = new T.DirectionalLight('#fff1d3', 2.3); sun.position.copy(style.sun.value).multiplyScalar(1000); scene.add(sun);
  const camera = new T.OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, .1, 2000);
  const previous = {target: renderer.getRenderTarget(), viewport: renderer.getViewport(new T.Vector4()), scissor: renderer.getScissor(new T.Vector4()),
    scissorTest: renderer.getScissorTest(), color: renderer.getClearColor(new T.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear};
  renderer.setRenderTarget(target); renderer.setScissorTest(false); renderer.setClearColor(0, 0); renderer.clear(); renderer.autoClear = false; renderer.setScissorTest(true);
  const cloudReady=style.cloudGroundReady.value,actorReady=style.actorShadowReady.value;style.cloudGroundReady.value=style.actorShadowReady.value=0;
  try {
    for (let i = 0; i <= views; i++) {
      const top = i === views, yaw = settings.bakeYaw * Math.PI / 180 + (representation === 'crossed' ? i * Math.PI / 2 : i / views * Math.PI * 2);
      camera.top = (top ? width : height) / 2; camera.bottom = -camera.top;
      camera.up.set(0, top ? 0 : 1, top ? -1 : 0);
      camera.position.copy(centre).add(top ? new T.Vector3(0, size.y + width + 10, 0) : new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(size.y + width + 10));
      camera.lookAt(centre); camera.updateProjectionMatrix();
      const x = i % columns * resolution, y = Math.floor(i / columns) * resolution;
      renderer.setViewport(x, y, resolution, resolution); renderer.setScissor(x, y, resolution, resolution); renderer.render(scene, camera);
    }
  } finally {
    style.cloudGroundReady.value=cloudReady;style.actorShadowReady.value=actorReady;renderer.setRenderTarget(previous.target); renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor);
    renderer.setScissorTest(previous.scissorTest); renderer.setClearColor(previous.color, previous.alpha); renderer.autoClear = previous.autoClear;
    scene.remove(mesh);
  }
  const plane = representation === 'crossed' ? crossedGeometry(width, height, centre) : new T.PlaneGeometry(width, height).translate(centre.x, centre.y, centre.z);
  const shaderMaterial = new T.MeshBasicMaterial({map: target.texture, alphaTest: settings.alphaCutoff, side: T.DoubleSide, toneMapped: false, fog: true});
  shaderMaterial.onBeforeCompile = shader => {
    sunShadowShader(shader);shader.uniforms.uCardSun=style.sun;shader.vertexShader='varying vec3 vCardWorld;\n'+shader.vertexShader;shader.fragmentShader='varying vec3 vCardWorld;uniform vec3 uCardSun;\n'+shader.fragmentShader;
    Object.assign(shader.uniforms, {uAtlas: {value: new T.Vector2(columns, rows)}, uViews: {value: views}, uYawOffset: {value: settings.bakeYaw * Math.PI / 180},
      uTopRange: {value: new T.Vector2(settings.topStart * Math.PI / 180, settings.topEnd * Math.PI / 180)},
      uCentre: {value: centre}, uDims: {value: new T.Vector2(width, box.min.y + size.y * .72)}});
    shader.vertexShader = `attribute vec2 forestInterval; uniform float uViews,uYawOffset; uniform vec2 uTopRange,uDims; uniform vec3 uCentre;
      varying vec2 vStudyInterval; varying vec4 vCardViews;\n` + shader.vertexShader;
    shader.fragmentShader = 'uniform vec2 uAtlas; varying vec2 vStudyInterval; varying vec4 vCardViews;\n' + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', representation === 'crossed' ? `
      vStudyInterval=forestInterval; vCardViews=vec4(uv.x>1.?1.:0.,0.,0.,0.);
      vCardWorld=(modelMatrix*instanceMatrix*vec4(position,1.)).xyz;vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(position,1.); gl_Position=projectionMatrix*mvPosition;
    ` : `
      vStudyInterval=forestInterval;
      vec3 scale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      vec4 origin=modelMatrix*instanceMatrix*vec4(uCentre.x,0.,uCentre.z,1.);
      vec3 direction=normalize(cameraPosition-(modelMatrix*instanceMatrix*vec4(uCentre,1.)).xyz);
      float yaw=atan(direction.x,direction.z)-atan(instanceMatrix[2].x,instanceMatrix[0].x)-uYawOffset;
      float sector=mod(yaw+6.28318530718*3.,6.28318530718)/6.28318530718*uViews;
      float top=smoothstep(uTopRange.x,uTopRange.y,asin(clamp(direction.y,-1.,1.)));
      vCardViews=vec4(floor(sector),mod(floor(sector)+1.,uViews),fract(sector),top);
      vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
      vec3 sidePlace=origin.xyz+right*(position.x-uCentre.x)*scale.x+vec3(0.,position.y*scale.y,0.);
      vec3 viewUp=normalize(vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]));
      vec3 topPlace=origin.xyz+right*(position.x-uCentre.x)*scale.x+viewUp*(uv.y-.5)*uDims.x*scale.x+vec3(0.,uDims.y*scale.y,0.);
      vCardWorld=mix(sidePlace,topPlace,top);vec4 mvPosition=viewMatrix*vec4(vCardWorld,1.); gl_Position=projectionMatrix*mvPosition;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec2 cardUv=${representation === 'crossed' ? 'vec2(vMapUv.x-vCardViews.x*2.,vMapUv.y)' : 'vMapUv'};
      vec2 tileA=vec2(mod(vCardViews.x,uAtlas.x),floor(vCardViews.x/uAtlas.x));
      vec2 tileB=vec2(mod(vCardViews.y,uAtlas.x),floor(vCardViews.y/uAtlas.x));
      vec2 tileTop=vec2(mod(${views.toFixed(1)},uAtlas.x),floor(${views.toFixed(1)}/uAtlas.x));
      vec2 safeUv=clamp(cardUv,vec2(.5/${resolution.toFixed(1)}),vec2(1.-.5/${resolution.toFixed(1)}));
      vec4 sideA=texture2D(map,(tileA+safeUv)/uAtlas),sideB=texture2D(map,(tileB+safeUv)/uAtlas);
      vec4 sampleColor=mix(mix(sideA,sideB,vCardViews.z),texture2D(map,(tileTop+safeUv)/uAtlas),vCardViews.w);
      diffuseColor*=sampleColor;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight*=mix(.60,1.,cloudObjectLight(vCardWorld,uCardSun)*actorSunLight(vCardWorld));\n#include <opaque_fragment>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      float threshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(threshold<vStudyInterval.x||threshold>=vStudyInterval.y)discard;`);
  };
  shaderMaterial.customProgramCacheKey = () => `studio-cards-v1-${representation}-${views}-${resolution}`;
  plane.computeBoundingBox(); plane.computeBoundingSphere();
  return {geometry: plane, material: shaderMaterial, target, views, columns, rows, resolution,
    textureBytes: columns * rows * resolution * resolution * 4 * 4 / 3,
    dispose() {target.dispose(); plane.dispose(); shaderMaterial.dispose();}};
}

function crossedGeometry(width, height, centre) {
  const a = new T.PlaneGeometry(width, height).translate(centre.x, centre.y, centre.z).toNonIndexed();
  const b = new T.PlaneGeometry(width, height).rotateY(Math.PI / 2).translate(centre.x, centre.y, centre.z).toNonIndexed();
  // Extra UV range identifies the second fixed card without another draw.
  const uv = b.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) + 2);
  const geometry = new T.BufferGeometry();
  for (const key of ['position', 'normal', 'uv']) geometry.setAttribute(key, new T.BufferAttribute(new Float32Array([...a.attributes[key].array, ...b.attributes[key].array]), a.attributes[key].itemSize));
  a.dispose(); b.dispose(); return geometry;
}

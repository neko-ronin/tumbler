/** Planar reflection of the lake's surface. The scene is drawn a second time from the
 * camera mirrored about the water plane into a reduced target, with an oblique near plane
 * at the surface so nothing below the water shows in it; the water shader samples it
 * through `style.mirrorMatrix`. Only what reads in a reflection is drawn (`keep`): terrain,
 * rock, trees, houses, the falls, the painted sky and the cloud volumes. Sky and clouds are
 * drawn into a smaller target of their own and laid in under the world where it left the
 * mirror uncovered. The pass is skipped when no lake is on screen, when the eye is under the water, or when the eye is so high
 * that the nearest-to-grazing view of the lake is steeper than 45 degrees (Fresnel < 3%).
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';

/** The camera mirrored about the plane y = level (`virtual` is written), its clip-space
 * projection with an oblique near plane on the water, and the matrix that takes a world
 * point to the mirror texture's uv (in xy/w). After three's Reflector. */
export function mirrorView(camera,level,virtual=new T.PerspectiveCamera(),textureMatrix=new T.Matrix4()){
  camera.updateMatrixWorld();
  const eye=new T.Vector3().setFromMatrixPosition(camera.matrixWorld),rotation=new T.Matrix4().extractRotation(camera.matrixWorld);
  const ahead=new T.Vector3(0,0,-1).applyMatrix4(rotation).add(eye),up=new T.Vector3(0,1,0).applyMatrix4(rotation);
  virtual.position.set(eye.x,2*level-eye.y,eye.z);
  virtual.up.set(up.x,-up.y,up.z);
  virtual.lookAt(ahead.x,2*level-ahead.y,ahead.z);
  virtual.near=camera.near;virtual.far=camera.far;
  virtual.updateMatrixWorld();
  virtual.projectionMatrix.copy(camera.projectionMatrix);virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
  textureMatrix.set(.5,0,0,.5, 0,.5,0,.5, 0,0,.5,.5, 0,0,0,1).multiply(virtual.projectionMatrix).multiply(virtual.matrixWorldInverse);
  // Oblique near plane (Lengyel): the water plane in the virtual camera's view space.
  const plane=new T.Plane(new T.Vector3(0,1,0),-level).applyMatrix4(virtual.matrixWorldInverse);
  const clip=new T.Vector4(plane.normal.x,plane.normal.y,plane.normal.z,plane.constant),p=virtual.projectionMatrix.elements;
  const q=new T.Vector4((Math.sign(clip.x)+p[8])/p[0],(Math.sign(clip.y)+p[9])/p[5],-1,(1+p[10])/p[14]);
  clip.multiplyScalar(2/clip.dot(q));
  p[2]=clip.x;p[6]=clip.y;p[10]=clip.z+1;p[14]=clip.w;
  virtual.projectionMatrixInverse.copy(virtual.projectionMatrix).invert();
  return {virtual,textureMatrix};
}

/** Whether the mirror is worth drawing for an eye at height `eyeY` over a lake at `level`
 * whose farthest point is `reach` metres away horizontally. */
export function mirrorWorthDrawing(eyeY,level,reach){
  const height=eyeY-level;
  return height>.05&&height<reach;
}

/** The far form a near tree batch is drawn with in the mirror: its own instances and their
 * fade intervals, the farthest stage's card geometry and material. Adopted redwoods
 * (redwood-rendering.js) keep their stages as `studio_lod<n>_*` batches whose pool holds the
 * farthest stage (`userData.pool.meshes[3]`); the other trees (forest.js) pair each
 * `forest_near_*` batch with a `forest_far_*` impostor batch. Null: draw the mesh as it is. */
export function farTreeForm(mesh,root,cache=new WeakMap()){
  if(cache.has(mesh))return cache.get(mesh);
  let form=null;
  if(/^studio_lod[01]_/.test(mesh.name)&&mesh.userData.pool?.meshes[3]){
    const far=mesh.userData.pool.meshes[3],geometry=new T.BufferGeometry();
    geometry.setIndex(far.geometry.index);
    for(const [name,attribute] of Object.entries(far.geometry.attributes))geometry.setAttribute(name,name==='forestInterval'?mesh.geometry.attributes.forestInterval:attribute);
    geometry.boundingBox=far.geometry.boundingBox;geometry.boundingSphere=far.geometry.boundingSphere;
    form={geometry,material:far.material};
  }else if(mesh.name.startsWith('forest_near_')){
    const far=root.getObjectByName(mesh.name.replace('forest_near_','forest_far_'));
    if(far)form={geometry:far.geometry,material:far.material};
  }
  cache.set(mesh,form);return form;
}

/** `keep`: scene children drawn into the mirror besides lights; `sky`: the painted sky,
 * the backdrop; `clouds`: the cloud pass's volume scene, drawn over the sky with no world
 * depth (a cloud in front of a reflected ridge is hidden by it, an accepted error);
 * `lake`: the lake mesh (its bounds decide the skip); `trees`: the forest group, whose near
 * batches are drawn in their far form and whose batches beyond `reach` metres are left out;
 * `scale`: the mirror's size against the drawing buffer. `reach` and `scale` stay adjustable. */
export function createMirror(renderer,{level,keep,sky,clouds=null,lake,trees=null,reach=3000,scale=.5}){
  const target=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,samples:0});
  target.texture.colorSpace=T.LinearSRGBColorSpace;
  const virtual=new T.PerspectiveCamera(),oblique=new T.Matrix4(),size=new T.Vector2(),frustum=new T.Frustum(),viewProjection=new T.Matrix4();
  const far=new T.DataTexture(new Float32Array([1]),1,1,T.RedFormat,T.FloatType);far.needsUpdate=true;
  lake.geometry.computeBoundingBox();
  const bounds=lake.geometry.boundingBox.clone().applyMatrix4(lake.matrixWorld);
  const corners=[[bounds.min.x,bounds.min.z],[bounds.min.x,bounds.max.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z]];
  // Sky and clouds hold no fine detail and the ripples blur them: a quarter of the mirror's pixels.
  const backScale=.5,back=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,depthBuffer:false});back.texture.colorSpace=T.LinearSRGBColorSpace;
  const under=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  under.add(new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,
    blending:T.CustomBlending,blendSrc:T.OneMinusDstAlphaFactor,blendDst:T.OneFactor,blendSrcAlpha:T.OneMinusDstAlphaFactor,blendDstAlpha:T.OneFactor,
    uniforms:{uBack:{value:back.texture}},vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:'uniform sampler2D uBack;varying vec2 vUv;void main(){gl_FragColor=vec4(texture2D(uBack,vUv).rgb,1.);}'})));
  under.children[0].frustumCulled=false;
  const forms=new WeakMap(),swapped=[],hidden=[];
  const kept=new Set(keep.filter(Boolean)),shown=new Map(),savedColor=new T.Color();
  style.mirror.value=target.texture;style.mirrorLevel.value=level;
  const stats={drawn:false,width:0,height:0,calls:0,triangles:0};
  function update(scene,camera,enabled){
    stats.drawn=false;style.mirrorOn.value=0;
    if(!enabled)return false;
    const eye=camera.position,farthest=Math.max(...corners.map(([x,z])=>Math.hypot(x-eye.x,z-eye.z)));
    if(!mirrorWorthDrawing(eye.y,level,farthest))return false;
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    if(!frustum.intersectsBox(bounds))return false;
    renderer.getDrawingBufferSize(size);
    const width=Math.max(1,Math.round(size.x*api.scale)),height=Math.max(1,Math.round(size.y*api.scale));
    if(target.width!==width||target.height!==height){target.setSize(width,height);back.setSize(Math.ceil(width*backScale),Math.ceil(height*backScale));}
    mirrorView(camera,level,virtual,style.mirrorMatrix.value);
    // The oblique near plane skews the far plane too and would cut the 14 km sky dome away;
    // sky and clouds lie wholly above the water, so they take the plain projection.
    oblique.copy(virtual.projectionMatrix);virtual.projectionMatrix.copy(camera.projectionMatrix);virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    const before={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    let shadowUpdate=false;const autoClear=renderer.autoClear,previous=renderer.getRenderTarget(),color=renderer.getClearColor(savedColor),alpha=renderer.getClearAlpha();
    for(const child of scene.children)shown.set(child,child.visible);
    // A colour background makes every render clear the target; the sky pass covers it instead.
    const background=scene.background;
    try{
      // The sun's shadow update belongs to the main pass; the mirror's own texture must not be
      // bound while it is the render target.
      shadowUpdate=renderer.shadowMap.needsUpdate;renderer.shadowMap.needsUpdate=false;style.mirror.value=null;
      renderer.autoClear=false;scene.background=null;
      // Sky and cloud volumes go into their own target first, unlit, with the plain projection.
      renderer.setRenderTarget(back);renderer.setClearColor(0,1);renderer.clear();
      for(const child of scene.children)child.visible=child===sky;
      renderer.render(scene,virtual);
      if(clouds){
        const depths=clouds.children.map(box=>box.material.uniforms.uDepth.value);
        for(const box of clouds.children)box.material.uniforms.uDepth.value=far;
        renderer.render(clouds,virtual);
        clouds.children.forEach((box,i)=>{box.material.uniforms.uDepth.value=depths[i];});
      }
      // The lit world, clipped at the water, over a transparent clear; then sky and clouds
      // are laid in under it wherever it left the target uncovered.
      renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();
      for(const child of scene.children)child.visible=shown.get(child)&&(kept.has(child)||child.isLight===true);
      virtual.projectionMatrix.copy(oblique);virtual.projectionMatrixInverse.copy(oblique).invert();
      // Near trees are reflected in their far form: the mirror's cost is geometry, and the
      // ripples hide what the near stages add.
      // Tree batches wholly beyond `reach` are left out: at narrows they were 8 of the mirror's
      // 12.5 M triangles and 49 of its 50 ms, and fog and ripples leave little of them.
      trees?.traverseVisible(mesh=>{if(mesh.isInstancedMesh&&mesh.boundingSphere&&mesh.boundingSphere.center.distanceTo(camera.position)-mesh.boundingSphere.radius>api.reach){mesh.visible=false;hidden.push(mesh);}});
      trees?.traverseVisible(mesh=>{if(!mesh.isInstancedMesh||!mesh.count)return;const form=farTreeForm(mesh,trees,forms);
        if(form){swapped.push([mesh,mesh.geometry,mesh.material]);mesh.geometry=form.geometry;mesh.material=form.material;}});
      renderer.render(scene,virtual);
      renderer.render(under,quadCamera);
    }finally{
      for(const mesh of hidden)mesh.visible=true;hidden.length=0;
      for(const [mesh,geometry,material] of swapped){mesh.geometry=geometry;mesh.material=material;}swapped.length=0;
      scene.background=background;style.mirror.value=target.texture;for(const [child,visible] of shown)child.visible=visible;shown.clear();
      renderer.shadowMap.needsUpdate=shadowUpdate;renderer.setRenderTarget(previous);renderer.autoClear=autoClear;renderer.setClearColor(color,alpha);
    }
    stats.calls=renderer.info.render.calls-before.calls;stats.triangles=renderer.info.render.triangles-before.triangles;
    stats.width=width;stats.height=height;stats.drawn=true;style.mirrorOn.value=1;
    return true;
  }
  const api={reach,scale,target,update,stats,dispose(){target.dispose();back.dispose();far.dispose();under.children[0].geometry.dispose();under.children[0].material.dispose();}};
  return api;
}

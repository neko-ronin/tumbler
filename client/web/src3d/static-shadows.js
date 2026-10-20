/** Bake the existing terrain-conforming tree shadow layer once per sun preset.
 * This preserves its crown approximation; it is not a full-scene UV lightmap.
 */
import * as T from '../vendor/three.module.min.js';
export const STATIC_TREE_SHADOW_GLSL=`
uniform sampler2D uStaticTreeShadow;uniform vec4 uStaticTreeGrid;uniform float uStaticTreeReady;
vec3 staticTreeShade(vec3 colour,vec3 place){
 if(uStaticTreeReady<.5)return colour;
 vec2 uv=(place.xz-uStaticTreeGrid.xy)/uStaticTreeGrid.zw;
 if(min(uv.x,uv.y)<0.||max(uv.x,uv.y)>1.)return colour;
 vec4 shade=texture2D(uStaticTreeShadow,vec2(uv.x,1.-uv.y));
 return colour*(1.-shade.a)+shade.rgb;
}
`;
export function createStaticTreeShadows(renderer,source,ground,style){
 const g=ground.farField,grid=new T.Vector4(g.minX,-g.maxY,g.maxX-g.minX,g.maxY-g.minY),cache=new Map();
 const resolution=2048,stats={bakes:0,hits:0,bytes:0,entries:0,resolution,worldTexelM:grid.z/resolution};
 style.staticTreeGrid.value.copy(grid);source.group.visible=false;
 const camera=new T.OrthographicCamera(-grid.z/2,grid.z/2,grid.w/2,-grid.w/2,.1,10000);
 camera.position.set(grid.x+grid.z/2,5000,grid.y+grid.w/2);camera.up.set(0,0,-1);camera.lookAt(grid.x+grid.z/2,0,grid.y+grid.w/2);
 const color=new T.Color();let active=null;
 function setSun(sun){
  const key=sun.toArray().map(v=>v.toFixed(6)).join(',');let entry=cache.get(key);
  if(entry){cache.delete(key);cache.set(key,entry);stats.hits++;}
  else{
   source.setSun(sun);const scene=new T.Scene(),materials=new Map();
   for(const original of source.group.children){
    let material=materials.get(original.material);
    if(!material){material=original.material.clone();material.defines={...original.material.defines};material.onBeforeCompile=original.material.onBeforeCompile;material.customProgramCacheKey=original.material.customProgramCacheKey;material.fog=false;material.toneMapped=false;materials.set(original.material,material);}
    scene.add(new T.Mesh(original.geometry,material));
   }
   const target=new T.WebGLRenderTarget(resolution,resolution,{depthBuffer:false});target.texture.colorSpace=T.LinearSRGBColorSpace;
   const previous=renderer.getRenderTarget(),alpha=renderer.getClearAlpha();renderer.getClearColor(color);
   try{renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);}finally{renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);materials.forEach(m=>m.dispose());}
   entry={target};cache.set(key,entry);stats.bakes++;
   if(cache.size>3){const first=cache.keys().next().value;cache.get(first).target.dispose();cache.delete(first);}
  }
  stats.entries=cache.size;stats.bytes=cache.size*resolution*resolution*4;
  active=entry.target;style.staticTreeShadow.value=entry.target.texture;style.staticTreeReady.value=1;source.group.visible=false;return entry.target.texture;
 }
 function invalidate(){cache.forEach(e=>e.target.dispose());cache.clear();active=null;stats.entries=stats.bytes=0;style.staticTreeReady.value=0;}
 return {stats,get target(){return active;},setSun,invalidate,dispose:invalidate};
}

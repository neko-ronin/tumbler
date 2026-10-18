/** Renderer interpretation of shared sampleAir, sampled near the surface.
 * One small local texture feeds meadow, foliage and water. It carries actual
 * m/s vectors, not another gust/noise simulation. No places or plants authored.
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
export function createAirCues(sample,ground,{size=16,span=640,renderer}={}){
  const bytes=new Float32Array(size*size*4);
  const texture=new T.DataTexture(bytes,size,size,T.RGBAFormat,T.FloatType);
  // WebGL2 can sample float textures, but linear filtering is optional.
  const filter=renderer?.extensions.has('OES_texture_float_linear')?T.LinearFilter:T.NearestFilter;
  texture.minFilter=texture.magFilter=filter;texture.needsUpdate=true;
  style.air.value=texture;
  let elapsed=0,last=-1;
  function update(camera,dt){
    elapsed+=dt;if(Math.floor(elapsed*8)===last)return;last=Math.floor(elapsed*8);
    const x=Math.round(camera.position.x/32)*32-span/2,z=Math.round(camera.position.z/32)*32-span/2;
    style.airGrid.value.set(x,z,span,1);
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){
      const px=x+(col+.5)*span/size,py=-(z+(row+.5)*span/size);
      const air=sample(px,py,(ground.height(px,py)??0)+2),at=(row*size+col)*4;
      bytes[at]=air.wx;bytes[at+1]=-air.wy;bytes[at+2]=air.lift;bytes[at+3]=air.intensity;
    }
    texture.needsUpdate=true;
  }
  return {update,texture,dispose(){texture.dispose();style.airGrid.value.w=0;}};
}

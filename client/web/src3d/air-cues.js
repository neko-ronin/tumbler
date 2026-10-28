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
    // Keep the 8 Hz local field halfway between the 4 Hz meadow fills.
    // Both still sample current wind; the offset spreads their CPU work.
    elapsed+=dt;const tick=Math.floor((elapsed+1/16)*8);if(tick===last)return;last=tick;
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

/** Fixed world-space meadow field. Unlike the camera-centred cue texture it
 * covers the full core stamp from the air and cannot swim when the view moves.
 * RGBA is east/south velocity, signed core gust, and roughness.
 * Two grids interpolate in time; both use nearest hardware reads so manual
 * bilinear interpolation is legal with or without optional float filtering.
 */
export function createMeadowAir(sample,ground,{size=64,span=4096,x=-2048,z=-2048,hz=4}={}){
  const grids=[0,1].map(()=>{
    const data=new Float32Array(size*size*4);
    const texture=new T.DataTexture(data,size,size,T.RGBAFormat,T.FloatType);
    texture.minFilter=texture.magFilter=T.NearestFilter;texture.needsUpdate=true;
    return texture;
  });
  const heights=new Float32Array(size*size);
  for(let row=0;row<size;row++)for(let col=0;col<size;col++){
    const px=x+(col+.5)*span/size,py=-(z+(row+.5)*span/size);
    heights[row*size+col]=(ground.height(px,py)??0)+2;
  }
  style.meadowAirGrid.value.set(x,z,span,size);
  let elapsed=0,initialized=false,from=0,to=1;
  function fill(texture){
    const data=texture.image.data;
    for(let row=0;row<size;row++)for(let col=0;col<size;col++){
      const at=(row*size+col)*4;
      const air=sample(x+(col+.5)*span/size,-(z+(row+.5)*span/size),heights[row*size+col]);
      data[at]=air.wx;data[at+1]=-air.wy;data[at+2]=air.gust??0;data[at+3]=air.intensity;
    }
    texture.needsUpdate=true;
  }
  function update(dt){
    elapsed+=dt;
    if(!initialized){fill(grids[to]);grids[from].image.data.set(grids[to].image.data);grids[from].needsUpdate=true;initialized=true;elapsed=0;}
    else if(elapsed>=1/hz){[from,to]=[to,from];fill(grids[to]);elapsed%=1/hz;}
    style.meadowAirFrom.value=grids[from];style.meadowAirTo.value=grids[to];
    style.meadowAirMix.value=Math.min(1,elapsed*hz);
  }
  return {update,textures:grids,dispose(){grids.forEach(t=>t.dispose());}};
}

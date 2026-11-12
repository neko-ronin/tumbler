/** Small presentation geometry follows named core placements and tracks. */
import * as T from '../vendor/three.module.min.js';
import {instanceMatrix,toScene} from './world.js';
export const TRAIL_SURFACE_LIFT=.06;
/** One line per flying hull, from its mast's top to the hull's own `tether_anchor` node (under the head),
 * carried by the same instance transform that draws the hull, so the line meets the hull the core placed. */
export function buildTethers(placement,assets){
  const positions=[],masts=new Map(placement.instances.filter(i=>i.kind==='mooring_mast').map(i=>[i.tags[0],i]));
  for(const hull of placement.instances.filter(i=>i.kind==='blimp'&&i.tags.includes('flying'))){
    const mast=masts.get(hull.tags[0]);if(!mast)continue;
    const anchor=assets[hull.asset]?.root.getObjectByName('tether_anchor');
    if(!anchor)throw new Error(`${hull.asset} has no tether_anchor node to tie a tether to`);
    // A top-level node, so its own translation is its place in the asset, as the core reads it.
    const end=anchor.position.clone().applyMatrix4(instanceMatrix(hull.position_m,hull.yaw_deg,hull.scale));
    // The mast model stands 45 m to its cup at scale 1, and the core's tether leaves the cup.
    const [x,y,z]=mast.position_m,top=toScene([x,y,z+45*(mast.scale?.[2]??1)]);
    positions.push(top.x,top.y,top.z,end.x,end.y,end.z);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  const line=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#b6b7a0',transparent:true,opacity:.65}));line.name='generator_tethers';return line;
}
/** Roads follow the surface; mountain treads use the shared centreline. Stone
 * batter ties a raised downhill edge back into the slope instead of drawing
 * a vertical paper skirt. One mesh keeps the full trail network inexpensive. */
export function buildTrails(worldmap,ground){
  const positions=[],indices=[],colors=[],wallUV=[],built=new Set();
  const granite=new T.Color('#a59f91'),grus=new T.Color('#a59882'),soil=new T.Color('#887661');
  const color=new T.Color(),groundAt=(x,y)=>ground.height(x,y)??0;
  const quad=(a,b,c,d,base,wall=null)=>{
    const first=positions.length/3;
    for(const [x,y,z] of [a,b,c,d]){
      positions.push(x,y,z);
      const h=Math.sin(x*1.789+z*.931)*.035+Math.sin(x*.113-z*.177)*.12;
      color.copy(base).multiplyScalar(1+h);colors.push(color.r,color.g,color.b);
    }
    wallUV.push(...(wall??[-1,0,-1,0,-1,0,-1,0]));
    indices.push(first,first+2,first+1,first+1,first+2,first+3);
  };
  for(const {polyline:points,profile_z_m:profile,width_m:w=2.7} of worldmap.tracks){
    const normals=points.slice(1).map((b,i)=>{
      const a=points[i],dx=b[0]-a[0],dy=b[1]-a[1],run=Math.hypot(dx,dy)||1;return [-dy/run,dx/run];
    });
    const joins=points.map((_,i)=>{
      const a=normals[Math.max(0,i-1)],b=normals[Math.min(i,normals.length-1)];
      const dx=a[0]+b[0],dy=a[1]+b[1],m=Math.hypot(dx,dy);
      if(m<.01)return b;
      const k=Math.min(1.45,2/m)/m;return [dx*k,dy*k];
    });
    let distance=0;
    for(let i=0;i<normals.length;i++){
      const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;
      const start=distance;distance+=length;
      if(profile){
        const key=[a.join(','),b.join(',')].sort().join(':');
        if(built.has(key))continue;built.add(key);
      }
      const steps=Math.ceil(length/(profile?2:4));
      const section=t=>{
        const x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;
        const n=t===0?joins[i]:t===1?joins[i+1]:normals[i];
        return [-1,1].map(side=>{
          const nx=n[0]*side,ny=n[1]*side,ex=x+nx*w*.5,ey=y+ny*w*.5,g=groundAt(ex,ey);
          const z=profile?Math.max(g,profile[i]+(profile[i+1]-profile[i])*t)+TRAIL_SURFACE_LIFT:g+.09;
          const reach=profile?Math.min(.55,(z-g)*.23):0,tx=ex+nx*reach,ty=ey+ny*reach;
          return {top:[ex,z,-ey],toe:[tx,Math.min(z-.04,groundAt(tx,ty)+.02),-ty],fill:z-g};
        });
      };
      let previous=section(0);
      for(let j=1;j<=steps;j++){
        const next=section(j/steps);quad(previous[0].top,previous[1].top,next[0].top,next[1].top,profile?grus:soil);
        if(profile)for(let k=0;k<2;k++){
          const p=previous[k],q=next[k];
          if(Math.max(p.fill,q.fill)>.18){
            const a=start+(j-1)/steps*length,b=start+j/steps*length;
            quad(p.top,q.top,p.toe,q.toe,granite,[a,p.top[1],b,q.top[1],a,p.toe[1],b,q.toe[1]]);
          }
        }
        previous=next;
      }
    }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  geometry.setAttribute('trackWall',new T.Float32BufferAttribute(wallUV,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  const material=new T.MeshStandardMaterial({vertexColors:true,roughness:1,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.customProgramCacheKey=()=> 'granite-track-grus-v1';
  material.onBeforeCompile=shader=>{
    shader.vertexShader='attribute vec2 trackWall; varying vec2 vTrackWall; varying vec3 vTrackPlace;\n'+shader.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      vTrackWall=trackWall;vTrackPlace=position;`);
    shader.fragmentShader=`varying vec2 vTrackWall; varying vec3 vTrackPlace;
      float grainHash(vec3 p){return fract(sin(dot(p,vec3(15.79,87.12,37.73)))*42345.19);}
      `+shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      float pixel=max(length(dFdx(vTrackPlace)),length(dFdy(vTrackPlace)));
      float grains=grainHash(floor(vTrackPlace*vec3(24.,12.,24.)));
      float chips=grainHash(floor(vTrackPlace*vec3(5.,7.,5.)));
      diffuseColor.rgb*=1.+(grains-.5)*.34*(1.-smoothstep(.02,.07,pixel))+(chips-.5)*.27*(1.-smoothstep(.10,.35,pixel));
      if(vTrackWall.x>=0.){
        // Rough courses of the same jointed granite, only at supported fill.
        float course=floor(vTrackWall.y/.28);
        vec2 stone=vec2(vTrackWall.x/.52+course*.47+sin(vTrackWall.y*45.)*.035,vTrackWall.y/.28);
        vec2 edge=min(fract(stone),1.-fract(stone));
        float joint=(1.-smoothstep(.025,.065,min(edge.x,edge.y)))*(1.-smoothstep(.09,.25,pixel));
        diffuseColor.rgb*=mix(.83,1.13,grainHash(vec3(floor(stone),1.)))*(1.-joint*.23);
      }`);
  };
  const mesh=new T.Mesh(geometry,material);mesh.name='named_tracks';mesh.receiveShadow=true;return mesh;
}

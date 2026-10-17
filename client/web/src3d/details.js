/** Small presentation geometry follows named core placements and tracks. */
import * as T from '../vendor/three.module.min.js';
export function buildTethers(placement,worldmap){
  const positions=[];
  for(const blimp of placement.instances.filter(i=>i.kind==='blimp')){
    const mast=placement.instances.find(i=>i.kind==='mooring_mast'&&i.tags[0]===blimp.tags[0]);if(!mast)continue;
    const bearing=worldmap.wind.direction_deg*Math.PI/180;
    const nose=39.2*(blimp.scale?.[0]??1);
    const [x,y,z]=blimp.position_m;
    positions.push(mast.position_m[0],mast.position_m[2]+45*(mast.scale?.[2]??1),-mast.position_m[1],x+Math.sin(bearing)*nose,z,-y-Math.cos(bearing)*nose);
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  const line=new T.LineSegments(geometry,new T.LineBasicMaterial({color:'#b6b7a0',transparent:true,opacity:.65}));line.name='generator_tethers';return line;
}
/** Track treads. A graded track is drawn at its core profile (what wheels and skis run on), with a
 * skirt down to the 8 m terrain where the grid cannot hold the bench; other tracks lie on the ground. */
export function buildTrails(worldmap,ground){
  const positions=[],indices=[];
  const quad=(a,b,c,d)=>{const base=positions.length/3;positions.push(...a,...b,...c,...d);indices.push(base,base+2,base+1,base+1,base+2,base+3);};
  for(const track of worldmap.tracks){
    const points=track.polyline,profile=track.profile_z_m,w=track.width_m??2.7;
    for(let i=0;i<points.length-1;i++){
      const a=points[i],b=points[i+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;const steps=Math.ceil(length/6);
      const nx=-(b[1]-a[1])/length*w*.5,ny=(b[0]-a[0])/length*w*.5;
      const edge=(t,side)=>{const x=a[0]+(b[0]-a[0])*t+nx*side,y=a[1]+(b[1]-a[1])*t+ny*side;
        return [x,profile?profile[i]+(profile[i+1]-profile[i])*t+.06:(ground.height(x,y)??0)+.09,-y];};
      for(let j=0;j<steps;j++){
        const [l0,r0,l1,r1]=[edge(j/steps,-1),edge(j/steps,1),edge((j+1)/steps,-1),edge((j+1)/steps,1)];quad(l0,r0,l1,r1);
        if(profile)for(const [p,q] of [[l0,l1],[r0,r1]]){
          const drop=(e)=>[e[0],Math.min(e[1]-.3,(ground.height(e[0],-e[2])??0)-.3),e[2]];quad(p,q,drop(p),drop(q));
        }
      }
    }
  }
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();
  const mesh=new T.Mesh(geometry,new T.MeshStandardMaterial({color:'#9a947d',roughness:1,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));mesh.name='named_tracks';mesh.receiveShadow=true;return mesh;
}

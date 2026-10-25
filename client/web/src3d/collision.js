/** Simplified colliders measured from the actual placed shared geometry. */
import * as T from '../vendor/three.module.min.js';
import {instanceMatrix} from './world.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
export function buildWorldCollision(placement,assets){
  const local=new Map(),boxes=[];
  for(const i of placement.instances){
    if(['river','lake','hardstanding'].includes(i.kind))continue;
    if(!local.has(i.asset)){
      const asset=assets[i.asset];const shapes=[];
      if(i.asset.startsWith('redwood/')){
        const crown=new T.Box3();asset.primitives.filter(p=>/foliage/.test(p.materialName)).forEach(p=>crown.union(p.geometry.boundingBox));
        let radius=.2;
        for(const p of asset.primitives.filter(p=>/bark/.test(p.materialName))){const pos=p.geometry.attributes.position;for(let n=0;n<pos.count;n++)if(pos.getY(n)>=0&&pos.getY(n)<2)radius=Math.max(radius,Math.hypot(pos.getX(n),pos.getZ(n)));}
        // Trunk taper for climbing: the widest bark per 2 m band below the crown,
        // read from the same raw positions as the box. Reading, not changing, the tree.
        const bands=[];
        for(const p of asset.primitives.filter(p=>/bark/.test(p.materialName))){const pos=p.geometry.attributes.position;for(let n=0;n<pos.count;n++){const y=pos.getY(n);if(y>=0&&y<crown.min.y){const band=Math.floor(y/2);bands[band]=Math.max(bands[band]??0,Math.hypot(pos.getX(n),pos.getZ(n)));}}}
        const profile=[[0,radius]];
        for(let band=1;band<bands.length;band++)if(bands[band]&&band*2+1<crown.min.y)profile.push([band*2+1,bands[band]]);
        profile.push([crown.min.y,profile.at(-1)[1]]);
        shapes.push({box:new T.Box3(new T.Vector3(-radius,0,-radius),new T.Vector3(radius,crown.min.y,radius)),matrix:asset.primitives[0].local,profile});
        shapes.push({box:crown,matrix:asset.primitives[0].local});
      }else for(const p of asset.primitives)shapes.push({box:p.geometry.boundingBox,matrix:p.local});
      local.set(i.asset,shapes);
    }
    for(const shape of local.get(i.asset)){
      const b=shape.box.clone().applyMatrix4(instanceMatrix(i.position_m,i.yaw_deg,i.scale,shape.matrix));
      const record={min:[b.min.x,-b.max.z,b.min.y],max:[b.max.x,-b.min.z,b.max.y],kind:i.asset.startsWith('redwood/')?'tree':i.kind==='blimp'?'generator':'structure'};
      if(shape.profile){
        const matrix=instanceMatrix(i.position_m,i.yaw_deg,i.scale,shape.matrix),centre=new T.Vector3().applyMatrix4(matrix);
        const scale=new T.Vector3().setFromMatrixScale(matrix).x,height=h=>new T.Vector3(0,h,0).applyMatrix4(matrix).y;
        record.trunk={x:centre.x,y:-centre.z,base_z:height(0),top_z:record.max[2],profile:shape.profile.map(([h,r])=>[height(h),r*scale])};
      }
      boxes.push(record);
    }
  }
  return createCollisionIndex(boxes);
}

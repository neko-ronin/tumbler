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
        shapes.push({box:new T.Box3(new T.Vector3(-radius,0,-radius),new T.Vector3(radius,crown.min.y,radius)),matrix:asset.primitives[0].local});
        shapes.push({box:crown,matrix:asset.primitives[0].local});
      }else for(const p of asset.primitives)shapes.push({box:p.geometry.boundingBox,matrix:p.local});
      local.set(i.asset,shapes);
    }
    for(const shape of local.get(i.asset)){
      const b=shape.box.clone().applyMatrix4(instanceMatrix(i.position_m,i.yaw_deg,i.scale,shape.matrix));
      boxes.push({min:[b.min.x,-b.max.z,b.min.y],max:[b.max.x,-b.min.z,b.max.y],kind:i.asset.startsWith('redwood/')?'tree':i.kind==='blimp'?'generator':'structure'});
    }
  }
  return createCollisionIndex(boxes);
}

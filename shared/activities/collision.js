/** Engine-neutral swept-sphere/AABB broad phase in world metres. */
export function createCollisionIndex(boxes,cellM=64){
  const cells=new Map();
  for(const box of boxes)for(let y=Math.floor(box.min[1]/cellM);y<=Math.floor(box.max[1]/cellM);y++)for(let x=Math.floor(box.min[0]/cellM);x<=Math.floor(box.max[0]/cellM);x++){
    const key=`${x},${y}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(box);
  }
  const gather=(from,to,radius)=>{
    const candidates=new Set();
    for(let y=Math.floor((Math.min(from[1],to[1])-radius)/cellM);y<=Math.floor((Math.max(from[1],to[1])+radius)/cellM);y++)for(let x=Math.floor((Math.min(from[0],to[0])-radius)/cellM);x<=Math.floor((Math.max(from[0],to[0])+radius)/cellM);x++)for(const b of cells.get(`${x},${y}`)??[])candidates.add(b);
    return candidates;
  };
  const hit=(from,to,radius=.4)=>{
    for(const box of gather(from,to,radius)){let entry=0,exit=1;
      for(let axis=0;axis<3;axis++){
        const delta=to[axis]-from[axis],lo=box.min[axis]-radius,hi=box.max[axis]+radius;
        if(Math.abs(delta)<1e-10){if(from[axis]<lo||from[axis]>hi){exit=-1;break;}}
        else {const a=(lo-from[axis])/delta,b=(hi-from[axis])/delta;entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));}
      }
      if(entry<=exit&&exit>=0)return box;
    }
    return null;
  };
  /** Boxes whose extent grown by `radius` contains `point`: what is within reach. */
  hit.near=(point,radius)=>[...gather(point,point,radius)].filter(box=>box.min.every((lo,axis)=>point[axis]>=lo-radius&&point[axis]<=box.max[axis]+radius));
  return hit;
}

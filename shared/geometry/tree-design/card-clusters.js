/** Deterministic spatial foliage partition. Every source triangle is assigned
 * exactly once; actual vertex bounds, rather than centroid bounds, fit cards.
 * No renderer types or world placement live here. */
export const BOUGH_PROFILES = {
  bough: {label: 'Bough islands · multi-view', clusters: 48, fixed: false},
  sprays: {label: 'Fine leaf sprays · multi-view', clusters: 128, fixed: false},
  lattice: {label: 'Branch lattice · fixed cards', clusters: 80, fixed: true}
};

export function partitionFoliage(positions, indices, leafKind, count) {
  const wood = [], foliage = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ids = [indices[i], indices[i+1], indices[i+2]];
    if (!ids.some(id => leafKind[id] > .5)) {wood.push(...ids); continue;}
    foliage.push({index: i, centre: [0,1,2].map(axis => ids.reduce((sum,id) => sum+positions[id*3+axis],0)/3)});
  }
  const groups = foliage.length ? [foliage] : [];
  // Split the group with the largest spatial extent until the requested budget.
  // Median cuts keep thin needles together as triangles, including huge ones
  // spanning a split. They are never cropped to a cell boundary.
  while (groups.length < count) {
    let choice=-1, axis=0, best=-1;
    groups.forEach((group,i) => {
      if (group.length < 2) return;
      for (let a=0;a<3;a++) {
        let lo=Infinity,hi=-Infinity;for(const t of group){lo=Math.min(lo,t.centre[a]);hi=Math.max(hi,t.centre[a]);}
        const score=(hi-lo)*Math.cbrt(group.length);
        if(score>best){best=score;choice=i;axis=a;}
      }
    });
    if(choice<0)break;
    const group=groups.splice(choice,1)[0].sort((a,b)=>a.centre[axis]-b.centre[axis]||a.index-b.index),half=Math.ceil(group.length/2);
    groups.push(group.slice(0,half),group.slice(half));
  }
  return {wood: new Uint32Array(wood), clusters: groups.map(group => {
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity],out=[];
    for(const t of group)for(let j=0;j<3;j++){
      const id=indices[t.index+j];out.push(id);
      for(let a=0;a<3;a++){min[a]=Math.min(min[a],positions[id*3+a]);max[a]=Math.max(max[a],positions[id*3+a]);}
    }
    return {indices:new Uint32Array(out),min,max,centre:min.map((v,a)=>(v+max[a])/2)};
  })};
}

/** Keep complete wood components, largest surface area first. Spatial vertex
 * clustering can join nearby branches into broad bark sheets; this selection
 * never moves a vertex or invents an edge. The target is soft when even the
 * largest component exceeds it, so a trunk is never removed to meet a count.
 * Exact-position welding also handles expanded/non-indexed source assets. */
export function retainWood(positions, wood, target) {
  const welded=new Map(),ids=new Map(),parents=[];
  function id(vertex){
    if(ids.has(vertex))return ids.get(vertex);
    const key=[positions[vertex*3],positions[vertex*3+1],positions[vertex*3+2]].join(',');
    if(!welded.has(key)){welded.set(key,parents.length);parents.push(parents.length);}
    const result=welded.get(key);ids.set(vertex,result);return result;
  }
  function find(a){let r=a;while(parents[r]!==r)r=parents[r];while(parents[a]!==a){const next=parents[a];parents[a]=r;a=next;}return r;}
  function union(a,b){a=find(a);b=find(b);if(a!==b)parents[b]=a;}
  for(let i=0;i<wood.length;i+=3){const a=id(wood[i]);union(a,id(wood[i+1]));union(a,id(wood[i+2]));}
  const groups=new Map();
  for(let i=0;i<wood.length;i+=3){
    const root=find(id(wood[i]));if(!groups.has(root))groups.set(root,{indices:[],area:0});const group=groups.get(root);
    const a=wood[i]*3,b=wood[i+1]*3,c=wood[i+2]*3;
    const u=[0,1,2].map(k=>positions[b+k]-positions[a+k]),v=[0,1,2].map(k=>positions[c+k]-positions[a+k]);
    group.area+=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])*.5;
    group.indices.push(wood[i],wood[i+1],wood[i+2]);
  }
  const ranked=[...groups.values()].sort((a,b)=>b.area-a.area||a.indices[0]-b.indices[0]),selected=[];let kept=0;
  for(const group of ranked){if(selected.length&&selected.length/3+group.indices.length/3>target)break;for(const index of group.indices)selected.push(index);kept++;}
  return {indices:new Uint32Array(selected),components:ranked.length,keptComponents:kept};
}

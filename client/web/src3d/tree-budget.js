/** Pure browser presentation budgets. Every visible tree retains coverage one;
 * complete geometry costs, including both sides of a fade, reserve the budget.
 * Far impostors are never subject to a population/distance cutoff. */
export const TREE_BUDGETS=[800000,1050000,550000];
export function treeBudgetsForQuality(quality=1) {
  const scale=Math.max(.65,Math.min(1,quality));
  // Keep one full-detail hero tree. Lower render resolution alone cannot fix
  // vertex/shadow pressure, so middle/lattice geometry follows quality too.
  return TREE_BUDGETS.map((budget,lod)=>lod===0?budget:Math.floor(budget*scale*scale));
}
export function projectedTreePixels(height,distance,fov,viewportHeight) {
  return height*viewportHeight/(2*Math.tan(fov*Math.PI/360)*Math.max(1,distance));
}
export function preferredTreeLod(pixels, previous=-1) {
  const thresholds=[650,150,24],h=previous<0?0:.12;
  for(let lod=0;lod<3;lod++)if(pixels>=thresholds[lod]*(previous<=lod?1-h:1+h))return lod;
  return 3;
}
export function allocateTreeLods(trees,budgets=TREE_BUDGETS) {
  const remaining=[...budgets],used=[0,0,0,0],result=[];
  const ordered=[...trees].sort((a,b)=>b.priority-a.priority||a.id-b.id);
  for(const tree of ordered){
    let lod=preferredTreeLod(tree.pixels,tree.previous);
    // A camera inside/just above a crown always gets spatial geometry. LOD 1
    // is also a mesh, so admitting that tree need not spend a hero-tree budget.
    if(tree.clearance<14)lod=Math.min(lod,1);
    while(lod<3&&remaining[lod]<tree.costs[lod])lod++;
    if(lod<3)remaining[lod]-=tree.costs[lod];used[lod]+=tree.costs[lod];
    result.push({tree,lod});
  }
  return {result,used};
}

/** Reserve outgoing geometry too. An exhausted budget completes the handoff
 * immediately; it cannot submit an unbudgeted second dense tree for a fade. */
export function treeTransitionDraws(allocation,budgets,now) {
  const used=[...allocation.used],draws=[];let transitioning=0;
  for(const {tree,lod}of allocation.result){
    if(tree.previous!==lod){tree.from=tree.previous;tree.changedAt=now;}tree.previous=lod;
    let amount=1;const from=tree.from,elapsed=(now-tree.changedAt)/220;
    if(from>=0&&from!==lod&&elapsed<1&&(from===3||used[from]+tree.costs[from]<=budgets[from])){
      amount=elapsed*elapsed*(3-2*elapsed);transitioning++;used[from]+=tree.costs[from];
      draws.push({tree,lod:from,lo:amount,hi:1});
    }
    draws.push({tree,lod,lo:0,hi:amount});
  }
  return {used,draws,transitioning};
}

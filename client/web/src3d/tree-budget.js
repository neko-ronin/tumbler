/** Pure browser presentation budgets. Every visible tree retains coverage one;
 * complete geometry costs, including both sides of a fade, reserve the budget.
 * Far spatial trees are never subject to a population/distance cutoff. */
export const TREE_BUDGETS=[800000,1050000,550000];
export const TREE_FADE_MS=380;
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
  const priority=tree=>tree.priority*(tree.previous===0?1.15:tree.previous===1?1.05:1);
  const ordered=[...trees].sort((a,b)=>Number(b.clearance<14)-Number(a.clearance<14)||
    (a.clearance<14&&b.clearance<14?a.clearance-b.clearance:0)||priority(b)-priority(a)||a.id-b.id);
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

/** A quality reduction changes the destination budget immediately, but cannot
 * revoke geometry already participating in a fade. This temporary ceiling only
 * retains existing residents; it never exceeds their former allocation. */
export function treeTransitionBudgets(trees,requested,now) {
  const resident=[0,0,0];
  for(const tree of trees){
    if(tree.previous>=0&&tree.previous<3)resident[tree.previous]+=tree.costs[tree.previous];
    if(tree.from>=0&&tree.from<3&&tree.from!==tree.previous&&now-tree.changedAt<TREE_FADE_MS)resident[tree.from]+=tree.costs[tree.from];
  }
  return requested.map((budget,lod)=>Math.max(budget,resident[lod]));
}

/** Schedule handoffs against geometry already on screen. Outgoing geometry
 * owns its reservation until its fade finishes, at every LOD. New arrivals wait
 * in a cheaper representation; a full middle budget cannot force a hard cut.
 * Finish an in-flight handoff before reconsidering its target: restarting from
 * the nominal LOD would throw away the coverage that was actually displayed. */
export function treeTransitionDraws(allocation,budgets,now) {
  const used=[0,0,0,0],draws=[];
  const entries=allocation.result;
  for(const entry of entries)entry.wanted=entry.lod;
  const fits=(tree,lod)=>lod===3||used[lod]+tree.costs[lod]<=budgets[lod];
  const reserve=(tree,lod)=>{used[lod]+=tree.costs[lod];};
  // Existing residents and both sides of active fades reserve first. A newly
  // visible tree must not evict a visible neighbour halfway through a fade.
  for(const entry of entries){
    const tree=entry.tree;
    if(tree.previous<0)continue;
    if(tree.from>=0&&tree.from!==tree.previous&&now-tree.changedAt>=TREE_FADE_MS)tree.from=-1;
    reserve(tree,tree.previous);
    if(tree.from>=0&&tree.from!==tree.previous)reserve(tree,tree.from);
  }
  for(const entry of entries){
    const tree=entry.tree;
    if(tree.previous<0){let lod=entry.wanted;while(!fits(tree,lod))lod++;tree.previous=lod;tree.from=-1;reserve(tree,lod);}
  }
  // Release scarce stages before admitting promotions. LOD 3 retains the same
  // spatial tree as LOD 2, so saturation cannot substitute a whole-tree plane.
  const order=entries.filter(({tree,wanted})=>wanted!==tree.previous&&!(tree.from>=0&&tree.from!==tree.previous))
    .sort((a,b)=>Number(b.wanted>b.tree.previous)-Number(a.wanted>a.tree.previous));
  for(const entry of order){
    const tree=entry.tree,old=tree.previous;
    if((tree.from>=0&&tree.from!==old)||entry.wanted===old)continue;
    let next=entry.wanted;
    while(next<3&&!fits(tree,next))next++;
    if(next===old)continue;
    // Do not demote a resident merely because its requested promotion must wait.
    if(entry.wanted<old&&next>=old)continue;
    tree.from=old;tree.previous=next;tree.changedAt=now;reserve(tree,next);
  }
  let transitioning=0,pending=false;
  for(const entry of entries){
    const tree=entry.tree,lod=tree.previous;
    pending ||= lod!==entry.wanted;
    entry.lod=lod;
    let amount=1;
    if(tree.from>=0&&tree.from!==lod){
      const t=Math.max(0,Math.min(1,(now-tree.changedAt)/TREE_FADE_MS));amount=t*t*(3-2*t);transitioning++;
      draws.push({tree,lod:tree.from,lo:amount,hi:1});
    }
    draws.push({tree,lod,lo:0,hi:amount});
  }
  return {used,draws,transitioning,pending};
}

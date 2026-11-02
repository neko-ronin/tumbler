/** Mean nearest-neighbour centre spacing in horizontal core metres. Natural
 * forest instances are the redwood/ asset family, including pine and fir.
 * Exact 2-D kd-tree queries avoid a quadratic startup scan of the whole forest. */
export function forestSpacing(instances){
 const points=instances.filter(i=>i.asset?.startsWith('redwood/')).map((i,id)=>({x:i.position_m[0],y:i.position_m[1],id}));
 if(points.length<2)return {count:points.length,meanNearestM:0};
 const build=(items,depth=0)=>{
  if(!items.length)return null;
  const axis=depth%2?'y':'x';items.sort((a,b)=>a[axis]-b[axis]);const middle=items.length>>1;
  return {point:items[middle],axis,left:build(items.slice(0,middle),depth+1),right:build(items.slice(middle+1),depth+1)};
 };
 const tree=build([...points]);
 const nearest=(node,p,best=Infinity)=>{
  if(!node)return best;
  const q=node.point,dx=p.x-q.x,dy=p.y-q.y;
  if(p.id!==q.id)best=Math.min(best,dx*dx+dy*dy);
  const delta=p[node.axis]-q[node.axis],first=delta<0?node.left:node.right,other=delta<0?node.right:node.left;
  best=nearest(first,p,best);if(delta*delta<best)best=nearest(other,p,best);return best;
 };
 return {count:points.length,meanNearestM:points.reduce((sum,p)=>sum+Math.sqrt(nearest(tree,p)),0)/points.length};
}

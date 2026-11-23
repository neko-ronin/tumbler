/** Ridge culling: is a point hidden from the eye by the terrain between them? (2026-11-23, the human: "we never render
 * what can not be immediately seen. that changes between walking, paragliding and camera mode. walking/player mode
 * can be aggressive with culling".)
 * A sight line is marched over the height grid (nearest sample, every 1.5 grid cells); it is blocked where the ground
 * stands above it. Cautious mode (flight, camera) needs the ground CAUTIOUS_M above the line, so a grid sample that
 * overstates a crest never hides what can be seen; aggressive mode (on foot) hides on contact.
 * Three.js coordinates: x east, y up, z = -north.
 */
const CAUTIOUS_M=12;
export function createRidgeCull(grid){
  const {values,resolution:n,quad}=grid;let top=-Infinity;
  for(const v of values)top=Math.max(top,v);
  /** True when the terrain hides the point (x, y, z) from the eye. The first and last 64 m of the line are skipped. */
  function hidden(eye,x,y,z,aggressive=false){
    const margin=aggressive?0:CAUTIOUS_M,ex=eye.x,en=-eye.z,dx=x-ex,dn=-z-en,d=Math.hypot(dx,dn),step=quad*1.5;
    if(d<step*4)return false;
    const steps=Math.ceil(d/step),skip=Math.ceil(64/step);
    for(let s=skip;s<=steps-skip;s++){
      const t=s/steps,ray=eye.y+(y-eye.y)*t+margin;
      if(ray>top)return false;
      const c=Math.round((ex+dx*t-grid.offsetX)/quad),r=Math.round((en+dn*t-grid.offsetY)/quad);
      if(c<0||r<0||c>=n||r>=n)continue;
      if(values[r*n+c]>ray)return true;
    }
    return false;
  }
  return {hidden};
}

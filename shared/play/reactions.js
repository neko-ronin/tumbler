/** Things that answer you: the reaction table (reactions.json) and who a swing or a
 * bump touches. Engine-neutral, x east, y north, z up, deterministic. A client keeps
 * each thing's live state (where a flown pine cone has got to, whether a cut fern has
 * grown back) and draws the reaction its own way; the core says which reaction, to
 * what, and the push it starts with.
 */

/** Check a table against a set of placed things: every kind is known and every
 * reaction names an action the table defines. Throws on the first fault. */
export function checkReactions(table,things=[]){
  if(table.version!==1)throw new Error(`Unsupported reaction table version: ${table.version}`);
  for(const [kind,k] of Object.entries(table.kinds))for(const action of Object.keys(k.reactions))
    if(!table.actions[action])throw new Error(`${kind} reacts to unknown action ${action}`);
  for(const t of things)if(!table.kinds[t.kind])throw new Error(`No reactions for ${t.kind} (${t.id})`);
}

export function reactionFor(table,kind,action){return table.kinds[kind]?.reactions[action]??null;}

/** Things a blade reaches: within reach_m of `from` ([x, y]) horizontally (to the
 * thing's edge), inside arc_deg about `heading` (rad, from east). Nearest first. */
export function swingHits(table,things,from,heading){
  const {reach_m,arc_deg}=table.actions.swing,half=arc_deg*Math.PI/360;
  return things.map(t=>{
    const dx=t.xy_m[0]-from[0],dy=t.xy_m[1]-from[1],d=Math.hypot(dx,dy),r=table.kinds[t.kind].radius_m;
    const off=Math.abs(Math.atan2(Math.sin(Math.atan2(dy,dx)-heading),Math.cos(Math.atan2(dy,dx)-heading)));
    return {t,d,ok:d-r<=reach_m&&(d<=r||off<=half)};
  }).filter(h=>h.ok).sort((a,b)=>a.d-b.d||(a.t.id<b.t.id?-1:1)).map(h=>h.t);
}

/** Things a moving body of radius `radius` at `at` ([x, y]) is touching, if it moves
 * faster than bump.min_mps. Nearest first. */
export function bumpHits(table,things,at,speed,radius){
  if(!(speed>=table.actions.bump.min_mps))return [];
  return things.map(t=>({t,d:Math.hypot(t.xy_m[0]-at[0],t.xy_m[1]-at[1])})).filter(h=>h.d<=radius+table.kinds[h.t.kind].radius_m)
    .sort((a,b)=>a.d-b.d||(a.t.id<b.t.id?-1:1)).map(h=>h.t);
}

/** The push a reaction starts a thing with: away from `from` along the ground at
 * impulse_mps, up at up_mps, spinning at spin_dps. [vx, vy, vz, spin_rad_s]. */
export function launch(reaction,from,thing){
  const dx=thing.xy_m[0]-from[0],dy=thing.xy_m[1]-from[1],d=Math.hypot(dx,dy)||1,k=reaction.impulse_mps??0;
  return [dx/d*k,dy/d*k,reaction.up_mps??0,(reaction.spin_dps??0)*Math.PI/180];
}

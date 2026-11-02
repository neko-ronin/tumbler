/** Shared presentation contacts, rig axes: +X pilot-left, +Y up, +Z forward.
 * Handle travel is visual apparatus fitting, never an aerodynamic input. */
const clamp=v=>Math.max(0,Math.min(1,v));
export const SOURCE_GRIP=Object.freeze([.48,1.25,.22]);
export function controlGrip(state,side){
 const pull=clamp(state.mode==='parakite'?(side>0?state.handleLeft:state.handleRight)??.45:(side>0?state.brakeLeft:state.brakeRight)??0);
 const y=state.mode==='parakite'?1.15-(pull-.45)*.32:1.30-pull*.35;
 return [side*.35,y,.25+pull*.05];
}

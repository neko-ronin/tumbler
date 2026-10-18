/** Device mapping only. Flight meaning and response remain in shared/. */
export const flightDeadzone=v=>{
  const a=Math.abs(v??0);return a<=.12?0:Math.sign(v)*Math.pow(Math.min(1,(a-.12)/.88),1.35);
};
export function flightInput(pad,keys=new Set()){
  const held=(a,b)=>Number(keys.has(a)||keys.has(b));
  const axis=(i)=>flightDeadzone(pad?.axes[i]);
  return {
    turn:Math.max(-1,Math.min(1,held('KeyD','ArrowRight')-held('KeyA','ArrowLeft')+axis(0))),
    brake:Math.max(-1,Math.min(1,held('KeyS','ArrowDown')-held('KeyW','ArrowUp')+axis(1))),
    brakeLeft:pad?.buttons[6]?.value??0,brakeRight:pad?.buttons[7]?.value??0,
    maneuver:keys.has('ShiftLeft')||keys.has('ShiftRight')||(pad?.buttons[1]?.pressed??false),
    throttle:Number(keys.has('KeyR'))-Number(keys.has('KeyF'))+Number(pad?.buttons[5]?.pressed??false)-Number(pad?.buttons[4]?.pressed??false),
    lookX:axis(2),lookY:axis(3),
  };
}

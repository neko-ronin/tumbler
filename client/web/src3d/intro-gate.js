/** The opening pan is presentation work, so a clock may not start it: any
 * first-use work that survives the loading screen then lands *inside* the shot.
 * The accepted frame intervals main.js already records are the live evidence of
 * whether the frames the shot will consume are evenly paced, so this module
 * judges that and nothing else. It owns no button, DOM node or timer; main.js
 * steps it from animate() and owns the one transition.
 *
 * "Calm" is a full window of INTRO_WINDOW (24) rendered intervals at a
 * stable cadence, either near the target or at a steady slower rate.
 *
 *  - Target rate: the window's mean interval is within INTRO_RATE_SHARE (8%) of
 *    WEB_FRAME_MS, with room for the uneven whole refreshes needed by a
 *    display such as 75 Hz. The longest interval is still bounded.
 *  - Slower rate held: the intervals' median m, a band of INTRO_TOLERANCE_SHARE
 *    (18%) of max(WEB_FRAME_MS, m) — ±6.0 ms at 30 FPS — and at least 22 of the
 *    24 inside it. Absolute rate is the resolution governor's business, so a
 *    steady 133 ms host (three dropped slots every frame) is calm; only a
 *    *changing* cadence is not.
 *
 * Two outliers in 24 are tolerated in the slow half because the pacer's
 * dropped-slot behaviour is exactly what turns a late frame into a 2x or 3x
 * interval — a gate that demanded a pristine window would stay shut for the
 * whole ceiling on a machine that is otherwise perfectly paced. Three or more
 * means a skipped slot every eighth frame and a cadence that has not settled.
 */
import {WEB_FRAME_MS} from './frame-pacing.js';

export const INTRO_WINDOW = 24;
export const INTRO_TOLERANCE_SHARE = .18;
export const INTRO_OUTLIERS = 2;
export const INTRO_RATE_SHARE = .08;
export const INTRO_SPREAD_MAX = 1.65;
export const INTRO_MIN_DWELL_S = 3;
export const INTRO_MAX_WAIT_S = 8;

/** Judge the most recent `window` intervals. Returns the numbers it judged on,
 * so a browser measurement can report why the shot did or did not start. */
export function introCalm(values,{
  window=INTRO_WINDOW,share=INTRO_TOLERANCE_SHARE,outliers=INTRO_OUTLIERS,
  rateShare=INTRO_RATE_SHARE,spreadMax=INTRO_SPREAD_MAX,
}={}){
  if(values.length<window)return {window:values.length,median:0,mean:0,band:0,inside:0,steady:false,onRate:false,calm:false};
  const recent=values.slice(values.length-window),ordered=[...recent].sort((a,b)=>a-b);
  const median=ordered.length%2?ordered[(ordered.length-1)>>1]:(ordered[ordered.length/2-1]+ordered[ordered.length/2])/2;
  const band=Math.max(WEB_FRAME_MS,median)*share;
  let inside=0,sum=0,longest=0;
  for(const value of recent){sum+=value;if(Math.abs(value-median)<=band)inside++;if(value>longest)longest=value;}
  const mean=sum/recent.length;
  const steady=inside>=window-outliers;
  const onRate=mean<=WEB_FRAME_MS*(1+rateShare)&&longest<=Math.max(WEB_FRAME_MS,median)*spreadMax;
  return {window,median,mean,band,inside,steady,onRate,calm:steady||onRate};
}

/** A gate, not a scheduler: `step` is idempotent for a given clock and window
 * and returns 'wait' or 'go'. The 3 s dwell keeps the establishing beat it has
 * always had; the 8 s ceiling is a clock on purpose, because a throttled or
 * hidden page must still reach the walk view instead of holding a still frame
 * longer than the 2.5 s shot it is waiting to start. */
export function createIntroGate({
  minDwellS=INTRO_MIN_DWELL_S,maxWaitS=INTRO_MAX_WAIT_S,startMs=0,
  window=INTRO_WINDOW,share=INTRO_TOLERANCE_SHARE,outliers=INTRO_OUTLIERS,
  rateShare=INTRO_RATE_SHARE,spreadMax=INTRO_SPREAD_MAX,
}={}){
  let releasedAtMs=null,last=null;
  return {
    get releasedAtMs(){return releasedAtMs;},
    get last(){return last;},
    step(nowMs,values){
      const elapsedS=Math.max(0,nowMs-startMs)/1000;
      const state=introCalm(values,{window,share,outliers,rateShare,spreadMax});
      const go=elapsedS>=maxWaitS||(elapsedS>=minDwellS&&state.calm);
      last={...state,elapsedS,verdict:go?'go':'wait'};
      if(go&&releasedAtMs===null)releasedAtMs=nowMs;
      return last.verdict;
    },
  };
}

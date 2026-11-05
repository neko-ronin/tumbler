/** Presentation-only render scale. A trial must improve observed frame pacing;
 * a CPU limit or browser frame cap must not silently make the picture blurry.
 */
export function createResolutionGovernor({frameBudgetMs=1000/60}={}){
  let scale=1,trial=null,cooldown=0;
  return {sample(p95,now,enabled=true){
    if(!enabled){scale=1;trial=null;cooldown=0;return scale;}
    if(now<cooldown)return scale;
    if(trial){
      if(p95>=trial.p95*.92){scale=trial.scale;cooldown=now+15000;}
      else cooldown=now+3000;
      trial=null;return scale;
    }
    if(p95>frameBudgetMs*1.35&&scale>.65){trial={scale,p95};scale=Math.max(.65,scale-.1);}
    else if(p95<frameBudgetMs*1.08&&scale<1){scale=Math.min(1,scale+.05);cooldown=now+6000;}
    return scale;
  },
  /** Freeze the current scale through a scripted move. An open trial is dropped
   * rather than judged on frames that were not steady play, and the next
   * decision waits a full window. This never changes the scale itself: forcing
   * it back to 1 here would be the mid-move resize the hold exists to avoid. */
  hold(now){trial=null;cooldown=now+3000;return scale;},
  get scale(){return scale;}};
}

/** One render-scale decision per frame, with the opening shot exempt. The shot
 * is a single authored move down into the chase view: a resize in the middle of
 * it is a visible hitch and changes the picture while it travels. Its frames are
 * also not a sample of steady play, so they never decide the first p95 after it.
 * Returns the scale to adopt, or null to leave the renderer untouched. */
export function createQualityGate(governor,{windowMs=3000,minSamples=120}={}){
  let last=-Infinity,held=false;
  return {
    /** Restart the spacing clock without making a decision (warm-up, resume). */
    reset(now=0){last=now;},
    decide(time,samples,enabled,shotActive){
      if(shotActive){held=true;governor.hold(time);return null;}
      if(held){held=false;samples.length=0;last=time;return null;}
      if(time-last<windowMs||samples.length<minSamples)return null;
      last=time;
      const ordered=[...samples].sort((a,b)=>a-b);
      return governor.sample(ordered[Math.floor(ordered.length*.95)],time,enabled);
    },
  };
}

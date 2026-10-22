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
  }};
}

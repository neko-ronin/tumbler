/** Authored presentation intent, in core x east/y north/z up metres.
 * Ordered areas apply last-wins, feathered inside their bounds. No place is
 * invented here: areas are explicit human/level-design judgements. */
export function cameraProfile(data,activity,position,forestSpacingM=0){
 if(data.version!==1)throw new Error(`Unsupported camera policy ${data.version}`);
 const result={follow_distance_m:0,follow_hold_m:0,screen_lower_fraction:0,follow_spacing_fraction:0,follow_hold_fraction:0,follow_hold_s:0,follow_ramp_s:0,max_turn_rad_s:3.5,...(data.profiles[activity]??data.profiles.walk)};
 for(const area of data.areas){
  if(area.activities&&!area.activities.includes(activity))continue;
  const edge=Math.min(...position.flatMap((v,i)=>[v-area.min[i],area.max[i]-v]));
  if(edge<0)continue;
  const u=area.feather_m>0?Math.min(1,edge/area.feather_m):1,w=u*u*(3-2*u);
  for(const [key,value] of Object.entries(area.settings))result[key]+=(value-result[key])*w;
 }
 if(result.follow_spacing_fraction>0)result.follow_distance_m=result.follow_spacing_fraction*Math.max(0,forestSpacingM);
 return result;
}

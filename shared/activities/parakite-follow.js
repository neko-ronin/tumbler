import {launchFlight,stepFlight} from './flight.js';

const STEP=1/120;
const LEAD_STEPS=108;
export const parakiteTourLessons=['stall','tuck-left','tuck-right','spiral','abort','loop','clearance'];

// Lower North Bench, then two opposing turns across the forested shoulder.
// Full axes and neutral beats keep the same line flyable with keys or a stick.
const route=[
  {until:8.5,input:{brake:-1},cue:'Follow Juno into the dive. Hold W or stick forward.'},
  {until:8.7,input:{},cue:'Centre for a beat.'},
  {until:14.05,input:{brake:1},cue:'Pull up for the loop. Hold S or stick back.'},
  {until:16,input:{},cue:'Centre and let the wing settle.'},
  {until:31,input:{turn:-1},cue:'Follow the descending spiral. Hold A or stick left.'},
  {until:31.85,input:{},cue:'Centre for the turn across the shoulder.'},
  {until:41.9,input:{turn:1},cue:'Follow the forest edge. Hold D or stick right.'},
  {until:44.1,input:{},cue:'Centre. Look for Juno’s wing over the trees.'},
  {until:52,input:{turn:-1},cue:'Bank left with Juno. Follow the gap toward the landing.'},
  {until:52.7,input:{brake:1},cue:'Straighten and pull S or stick back briefly to round out.'},
  {until:Infinity,input:{},cue:'Centre and glide to the landing.'},
];
const leg=time=>route.find(segment=>time<segment.until);
export const followInput=time=>leg(time).input;
export const followCue=time=>leg(time).cue;

export function stepParakiteFollowFlight(state,input,dt,config,wind,height,hitTest,walkHeight=height){
  const next=stepFlight(state,input,dt,state.followStep*STEP,config,wind,height,hitTest,height,walkHeight);
  next.followStep=state.followStep+1;
  return next;
}

export function createParakiteFollow({config,wind,height,hitTest,walkHeight=height}){
  const initial={...launchFlight(config,'parakite',config.parakite_practice_launch,height,'calm'),guidedParakite:true,followStep:0};
  const history=Array(LEAD_STEPS+1);
  history[0]=initial;
  let elapsed=0,guide=initial,checkpoint=null,apart=0,collapsed=0;
  function step(){
    guide=stepParakiteFollowFlight(guide,followInput(guide.followStep*STEP),STEP,config,wind,height,hitTest,walkHeight);
    history[guide.followStep%history.length]=guide;
  }
  for(let n=0;n<LEAD_STEPS;n++)step();
  checkpoint={guide,player:initial};
  function retry(){
    guide=checkpoint.guide;
    history.fill(null);
    history[guide.followStep%history.length]=guide;
    elapsed=apart=collapsed=0;
    return {player:checkpoint.player,guide};
  }
  function advance(dt,player){
    let candidate=null;
    elapsed+=Math.min(dt,.05);
    while(elapsed>=STEP&&!guide.grounded){
      elapsed-=STEP;
      step();
      const t=guide.followStep-LEAD_STEPS;
      if(t===16*120||t===43*120)candidate=history[t%history.length];
    }
    if(guide.grounded)elapsed=0;
    const distance=Math.hypot(guide.x-player.x,guide.y-player.y,guide.z-player.z);
    const fullCollapse=player.collapsed||player.rotation?.pressure.every(value=>value<.28);
    collapsed=fullCollapse?collapsed+dt:0;
    apart=distance>(guide.grounded?110:155)?apart+dt:0;
    if(guide.impact||guide.landingQuality==='hard')return 'guide-contact';
    if(guide.grounded&&player.grounded&&distance<=85&&!player.impact)return 'landed';
    // Being down in the same landing area is enough to finish the escort.
    // Give a low, bumpy arrival time to settle while Juno waits on the ground.
    const inLandingArea=guide.grounded&&distance<=85&&player.z-height(player.x,player.y)<16;
    const tooEarly=player.grounded&&!guide.grounded&&(distance>80||guide.z-height(guide.x,guide.y)>16);
    const missedLanding=player.grounded&&distance>85;
    if(player.impact||tooEarly||missedLanding||collapsed>2.4&&!inLandingArea||apart>3.5)return 'lost';
    if(candidate&&!fullCollapse&&!player.grounded&&
      Math.hypot(candidate.x-player.x,candidate.y-player.y)<62&&Math.abs(candidate.z-player.z)<42){
      // The player is still one or more render ticks behind the marker. Retain
      // the paired flight states from the crossing, even on a multi-step frame.
      checkpoint={player:candidate,guide:history[(candidate.followStep+LEAD_STEPS)%history.length]};
    }
    return 'flying';
  }
  return {advance,retry,get guide(){return guide;},get time(){return guide.followStep*STEP;},get checkpointTime(){return checkpoint.player.followStep*STEP;}};
}

/** Balance: a budget that the ground spends, and what the body does when it runs out.
 *
 * Engine-neutral, x east, y north, SI units, deterministic. This knows nothing about
 * walking: a caller senses the ground it stands on (surface, grade, downhill direction)
 * and its own velocity, and reads back a phase, how much control the body keeps, and,
 * while it is down (trip, tumble, slide, recover, roll), the velocity it now has.
 * Walking uses it (moves.js); a unicycle, a branch or a rail can sense their own
 * ground and use it the same way.
 *
 *   steady ─(budget < stumble_below)─▶ stumble ─(budget ≤ trip_below)─▶ trip
 *   trip ─(steep or fast)─▶ tumble ─(slow, or long)─▶ slide ─(stopped)─▶ recover ─▶ steady
 *   trip on the level ─▶ recover;  recover where no one could stand ─▶ roll
 *   tuck on a slope ≥ roll.min_grade, from any phase but recover ─▶ roll (cannot fail)
 */

export const PHASES=Object.freeze(['steady','stumble','trip','tumble','slide','recover','roll']);
/** Phases in which the body is moved by the slope, not by its legs. */
export const DOWN=new Set(['trip','tumble','slide','recover','roll']);

export function createBalance(){return {phase:'steady',budget:1,t:0,vx:0,vy:0,spin:0,auto:false,tuckHeld:false,load:0};}

/** How hard the ground is working the body: 1 is all it can sustain. */
export function balanceLoad(config,surface,grade,speed){
  const b=config.budget,k=surfaceRules(config,surface);
  return b.speed_weight*speed/b.speed_ref_mps+b.slope_weight*grade/k.hold_grade;
}

function surfaceRules(config,surface){
  const k=config.surfaces[surface];if(!k)throw new Error(`Unknown balance surface: ${surface}`);
  return k;
}

/** Advance the balance by dt. `ground = {surface, grade, downhill:[ux,uy]}` where the
 * body stands; `body = {vx, vy}` its velocity now; `input = {tuck, x, y}` (x, y: the
 * direction the player asks for, world frame, length ≤ 1). Returns a new state with
 * `control` (0-1, how much of the asked-for movement the legs still deliver) and,
 * while DOWN.has(phase), the velocity `vx, vy` the caller must apply. */
export function stepBalance(state,ground,body,input,dt,config){
  if(!(dt>0)||!Number.isFinite(dt))return {...state};
  const s={...createBalance(),...state},n=Math.ceil(dt/config.step_s-1e-9),h=dt/n;
  const tuckEdge=!!input.tuck&&!s.tuckHeld;s.tuckHeld=!!input.tuck;
  if(!DOWN.has(s.phase)){s.vx=body.vx??0;s.vy=body.vy??0;}
  const k=surfaceRules(config,ground.surface),p=config.phases,r=config.roll,g=config.gravity_mps2;
  const grade=Math.max(0,ground.grade??0),[ux,uy]=grade>0?ground.downhill:[0,0];
  const sin=grade/Math.hypot(1,grade),cos=1/Math.hypot(1,grade);
  // Could anyone stand here at all? Standing still on it would spend more than it gives.
  const standable=grade<k.hold_grade;
  const enter=phase=>{s.phase=phase;s.t=0;};
  if(tuckEdge&&grade>=r.min_grade&&s.phase!=='roll'&&s.phase!=='recover'){enter('roll');s.auto=false;}
  for(let i=0;i<n;i++){
    s.t+=h;
    const speed=Math.hypot(s.vx,s.vy);
    switch(s.phase){
      case 'steady':case 'stumble':{
        s.load=balanceLoad(config,ground.surface,grade,speed);
        const b=config.budget;
        s.budget=Math.max(0,Math.min(1,s.budget-(s.load>1?b.drain_per_s*(s.load-1):-b.regen_per_s*(1-s.load))*h));
        if(s.budget<=b.trip_below)enter('trip');
        else if(s.phase==='steady'&&s.budget<b.stumble_below)enter('stumble');
        else if(s.phase==='stumble'&&s.budget>b.steady_above)enter('steady');
        break;
      }
      case 'trip':{
        // Pitching over: the legs have gone and the slope already pulls.
        slope(s,ux,uy,g*sin,h);drag(s,k.tumble_drag_per_s*3,h);
        if(s.t>=p.trip_s){
          if(grade>=p.tumble_grade||Math.hypot(s.vx,s.vy)>=p.tumble_mps)enter('tumble');
          else recover(s,standable,grade,enter);
        }
        break;
      }
      case 'tumble':
        slope(s,ux,uy,g*sin,h);drag(s,k.tumble_drag_per_s,h);
        if(s.t>=p.tumble_max_s||s.t>=p.tumble_min_s&&Math.hypot(s.vx,s.vy)<p.slide_below_mps)enter('slide');
        break;
      case 'slide':{
        slope(s,ux,uy,g*sin,h);
        // Coulomb friction against the motion, never past a stop.
        const v=Math.hypot(s.vx,s.vy),f=Math.min(v,k.slide_friction*g*cos*h);
        if(v>0){s.vx-=s.vx/v*f;s.vy-=s.vy/v*f;}
        if(Math.hypot(s.vx,s.vy)<p.rest_mps||s.t>=p.slide_max_s)recover(s,standable,grade,enter);
        break;
      }
      case 'recover':
        drag(s,8,h);
        if(s.t>=p.recover_s){enter('steady');s.budget=p.recover_budget;}
        break;
      case 'roll':{
        // Cannot fail: the budget is full for as long as he rolls.
        s.budget=1;
        slope(s,ux,uy,g*sin,h);
        const v=Math.hypot(s.vx,s.vy);
        if(grade>=r.min_grade&&v<r.min_mps)slope(s,ux,uy,(r.min_mps-v)*4,h);
        if(v>.1){
          // Steer: only the part of the ask that is across the motion.
          const lx=-s.vy/v,ly=s.vx/v,across=(input.x??0)*lx+(input.y??0)*ly;
          s.vx+=lx*across*r.steer_mps2*h;s.vy+=ly*across*r.steer_mps2*h;
        }
        drag(s,k.roll_drag_per_s,h);
        const held=s.tuckHeld&&!s.auto,flat=grade<r.min_grade*.6&&Math.hypot(s.vx,s.vy)<r.exit_mps;
        const free=s.t>=r.min_s&&(s.auto?grade<k.hold_grade*.9:!held&&standable);
        if(flat||free){enter('steady');s.budget=r.exit_budget;s.auto=false;}
        break;
      }
    }
    if(s.phase==='tumble'||s.phase==='roll')s.spin+=Math.hypot(s.vx,s.vy)/p.body_radius_m*h;
  }
  s.control=s.phase==='steady'?1:s.phase==='stumble'?config.budget.stumble_control:0;
  return s;
}

function slope(s,ux,uy,a,h){s.vx+=ux*a*h;s.vy+=uy*a*h;}
function drag(s,rate,h){const d=Math.exp(-rate*h);s.vx*=d;s.vy*=d;}
// Stand up, unless no one could stand here: then curl into a roll and carry on down.
function recover(s,standable,grade,enter){
  if(!standable){enter('roll');s.auto=true;}
  else enter('recover');
}

/** The ground under a point from a height sampler: grade and downhill unit vector,
 * by central differences over ±d metres. Unknown heights read as level. */
export function senseGround(height,x,y,d=.75){
  const e=height(x+d,y),w=height(x-d,y),n=height(x,y+d),so=height(x,y-d);
  if(![e,w,n,so].every(Number.isFinite))return {grade:0,downhill:[0,0]};
  const gx=(e-w)/(2*d),gy=(n-so)/(2*d),grade=Math.hypot(gx,gy);
  return {grade,downhill:grade>1e-9?[-gx/grade,-gy/grade]:[0,0]};
}

/** Replay an input tape: `{dt, frames:[[count, input, dt?], ...]}`, each input held for
 * `count` steps of the frame's own dt, or the tape's. `step(state, input, dt)` advances the state; `visit` sees each
 * state after its step. Returns the last state. A tape is plain JSON, so a run recorded
 * in a client can be checked headless against the same rules. */
export function playTape(tape,state,step,visit=null){
  for(const [count,input,dt=tape.dt] of tape.frames)for(let i=0;i<count;i++){state=step(state,input,dt);visit?.(state);}
  return state;
}

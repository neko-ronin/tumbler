/** Two small encounters between the player and the meadow's insects.
 *
 * A bee that finds you standing still lands on your head; you shoo it with a wave
 * and it wanders peacefully off. A butterfly that finds you sitting lands on your
 * nose and stays until you move, while your eye settles on it.
 *
 * Each visit borrows one insect from ecology.js for its duration: the ordinary
 * flight is replaced by the pose here, then the insect is handed back (with a
 * cooldown, so it does not return at once). Positions are scene coordinates:
 * x east, y up, z = -north.
 */
import * as T from '../vendor/three.module.min.js';

const RULES={
  bee:{reach:1.3,still:2.5,approach:1.8,perch:2.4,gesture:3.8,liftAt:1.5,leave:10,cooldown:90},
  butterfly:{reach:2.4,approach:2.8,leave:8,cooldown:60,settle:1.4},
};
const ease=t=>t*t*(3-2*t),clamp01=t=>Math.max(0,Math.min(1,t));
const turn=(from,to,k)=>from+Math.atan2(Math.sin(to-from),Math.cos(to-from))*k;

/** @param {'bee'|'butterfly'} kind */
export function createVisit(kind){
  const rule=RULES[kind],bee=kind==='bee';
  const v={kind,state:'idle',id:-1,lastId:-1,releasedAt:-99,t:0,cool:0,start:new T.Vector3(),pos:new T.Vector3(),away:new T.Vector3(),
    heading:0,pitch:0,roll:0,landed:false,fade:1,shrink:0,gesture:0,wave:0,gestureT:-1,focus:0};
  const goal=new T.Vector3();
  const anchor=p=>bee?p.top:p.nose;
  const free=p=>p?.active&&!p.moving&&(bee?p.still>=rule.still:p.sitting);

  /** Offer an insect (id i at x,y,z) to the visit; true if it takes the role. */
  function claim(i,x,y,z,p){
    if(v.state!=='idle'||v.cool>0||!free(p))return false;
    const a=anchor(p);
    if((a.x-x)**2+(a.y-y)**2+(a.z-z)**2>rule.reach**2)return false;
    v.id=i;v.state='approach';v.t=0;v.start.set(x,y,z);v.pos.copy(v.start);v.landed=false;v.fade=1;return true;
  }
  function leave(p,time){
    v.state='leave';v.t=0;v.landed=false;
    // Off to one side and a little behind, never straight at the player's face.
    const side=(v.id%2?1:-1)*(1.2+(v.id%5)*.12),yaw=(p?.yaw??0)+side;
    v.away.set(Math.sin(yaw),0,Math.cos(yaw));v.start.copy(v.pos);
  }
  function release(time){v.state='idle';v.cool=rule.cooldown;v.lastId=v.id;v.releasedAt=time;v.id=-1;v.fade=1;v.landed=false;}

  function tick(dt,p,time=0){
    v.cool=Math.max(0,v.cool-dt);
    if(v.gestureT>=0){
      v.gestureT+=dt;const g=v.gestureT,len=rule.gesture;
      v.gesture=g>=len?0:ease(clamp01(g/1))*(1-ease(clamp01((g-(len-1))/1)));v.wave=g;
      if(g>=len){v.gestureT=-1;v.gesture=0;}
    }
    if(v.state==='idle'){v.focus=Math.max(0,v.focus-dt/.8);return;}
    const a=anchor(p??{top:v.pos,nose:v.pos});
    const calm=p?.active&&!p.moving&&(bee||p.sitting||v.state==='leave');
    if(v.state!=='leave'&&!calm){leave(p,time);}
    v.t+=dt;
    if(v.state==='approach'){
      const k=ease(clamp01(v.t/rule.approach));
      goal.copy(a);
      v.pos.lerpVectors(v.start,goal,k);
      // A fluttering, descending arc rather than a straight line.
      const flutter=(1-k)*(bee?.1:.2);
      v.pos.x+=Math.sin(v.t*5.3)*flutter;v.pos.y+=Math.sin(v.t*4.1)*flutter*.7+(1-k)*k*(bee?.15:.3);
      const dir=goal.clone().sub(v.pos);
      if(k<.85&&dir.lengthSq()>1e-4)v.heading=turn(v.heading,Math.atan2(dir.x,dir.z),.2);
      else v.heading=turn(v.heading,(p?.yaw??0)+(bee?0:Math.PI),.12);
      v.shrink=k;
      v.pitch=-.45*Math.sin(Math.PI*k)*(bee?1:.7);v.roll=Math.sin(v.t*3.1)*.3*(1-k);
      if(k>=1){v.state=bee?'perch':'settle';v.t=0;v.landed=true;}
    }else if(v.state==='perch'||v.state==='settle'){
      v.pos.copy(a);v.landed=true;v.shrink=1;v.pitch=0;v.roll=0;v.heading=turn(v.heading,(p?.yaw??0)+(bee?0:Math.PI),.25);
      if(bee&&v.state==='perch'&&v.t>=rule.perch){v.state='shoo';v.t=0;v.gestureT=0;}
      if(!bee)v.focus=Math.min(1,v.focus+dt/rule.settle);
    }else if(v.state==='shoo'){
      v.pos.copy(a);v.landed=true;
      if(v.t>=rule.liftAt)leave(p,time);
    }else if(v.state==='leave'){
      const speed=Math.min(bee?3.2:2.4,.6+.4*v.t);
      v.pos.addScaledVector(v.away,speed*dt);
      v.pos.y+=(v.t<4?.35:.12)*dt;
      v.heading=turn(v.heading,Math.atan2(v.away.x,v.away.z)+Math.sin(v.t*.9)*.35,.08);
      v.pitch=bee?Math.sin(v.t*2.3)*.3-.1:0;v.roll=Math.sin(v.t*1.7)*.4;
      v.fade=clamp01((rule.leave-v.t)/1.2);v.shrink=clamp01(1-v.t/1.5);
      if(!bee)v.focus=Math.max(0,v.focus-dt/.8);
      if(v.t>=rule.leave)release(time);
    }
  }
  return {v,rule,claim,tick,release};
}

/** Feeds the player's state to the visits and shows their effects: the shoo wave, the nod, and the eye
 * settling on a butterfly (everything but that spot softens, via a masked backdrop blur on #focus). */
export function createVisitorWatch({ecology,character,navigation,camera,focusEl}){
  const player={active:false,still:0,moving:false,sitting:false,yaw:0,top:new T.Vector3(),nose:new T.Vector3()};
  const forward=new T.Vector3(),screen=new T.Vector3(),edge=new T.Vector3(),right=new T.Vector3();
  ecology.setPlayer(player);
  return {player,update(dt){
    const st=navigation.state,walking=navigation.mode==='walk'&&!!st&&st.mode!=='climb'&&st.mode!=='swim'&&!navigation.underwater;
    player.active=walking;
    player.moving=!walking||(st.speed??0)>.1||(!!st.jumpPhase&&st.jumpPhase!=='grounded');
    player.still=player.moving?0:player.still+dt;
    player.sitting=character.sitting;
    forward.set(0,0,1).applyQuaternion(character.object.quaternion);player.yaw=Math.atan2(forward.x,forward.z);
    character.anchors(player);
    const first=navigation.view==='first';
    if(first){
      // In first person the camera is his eye: the nose is just below the middle of the view, the crown just above.
      camera.getWorldDirection(forward);
      player.nose.copy(camera.position).addScaledVector(forward,.26);player.nose.y-=.07;
      player.top.copy(camera.position);player.top.y+=.14;
      player.yaw=Math.atan2(forward.x,forward.z);
    }
    const bee=ecology.visits.bee.v,butterfly=ecology.visits.butterfly.v;
    character.gesture.shoo=bee.gesture;character.gesture.wave=bee.wave;
    character.gesture.nod=first?0:butterfly.focus;
    let amount=butterfly.focus;
    if(focusEl){
      screen.copy(butterfly.pos).project(camera);
      if(screen.z>1||screen.z<-1)amount=0;
      focusEl.hidden=amount<.002;
      focusEl.style.setProperty('--f',amount.toFixed(3));
      // Keep the whole butterfly sharp: the clear spot is as wide as its wings appear.
      right.setFromMatrixColumn(camera.matrixWorld,0);edge.copy(butterfly.pos).addScaledVector(right,.14).project(camera);
      focusEl.style.setProperty('--r',Math.max(24,Math.hypot((edge.x-screen.x)*.5*innerWidth,(edge.y-screen.y)*.5*innerHeight)*1.15).toFixed(0)+'px');
      focusEl.style.setProperty('--x',((screen.x*.5+.5)*100).toFixed(1)+'%');focusEl.style.setProperty('--y',((-screen.y*.5+.5)*100).toFixed(1)+'%');
    }
  }};
}

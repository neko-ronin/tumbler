/** Engine-neutral rules for salvage, equipment construction, power and wear. */
const range=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const angle=(a,b)=>Math.atan2(b.y-a.y,b.x-a.x);
const facing=(a,b,spread)=>Math.cos(angle(a,b)-a.heading)>=Math.cos(spread);
const clear=(world,a,b)=>!world.hitTest?.([a.x,a.y,a.z+.85],[b.x,b.y,b.z+.85],.12);
const nearby=(a,b,r)=>range(a,b)<=r&&Math.abs(a.z-b.z)<1.65;
const healthMax=3;
const integrityMax=100;

export function createSalvage(yard,world,saved={}){
  if(yard.version!==1)throw new Error(`Unsupported maintenance yard version ${yard.version}`);
  return {
    parts:Number.isSafeInteger(saved?.parts)&&saved.parts>=0?saved.parts:0,
    robots:yard.robots.flatMap(([x,y],id)=>{
      const z=world.height(x,y);
      return Number.isFinite(z)?[{id,x,y,z,home:{x,y,z},heading:Math.PI,hp:3,phase:'patrol',left:id*.4}]:[];
    }),
    equipment:yard.equipment.flatMap(item=>{
      const [x,y]=item.xy,z=world.height(x,y);
      const value=saved?.equipment?.[item.id];
      const integrity=Number.isFinite(value)?Math.max(0,Math.min(integrityMax,value)):0;
      return Number.isFinite(z)?[{...item,x,y,z,built:Number.isFinite(value),integrity}]:[];
    }),
    health:healthMax,stun:0,invulnerable:0,drops:[],revision:0
  };
}

export function salvageProgress(state){
  return {parts:state.parts,equipment:Object.fromEntries(state.equipment.filter(e=>e.built).map(e=>[e.id,e.integrity]))};
}

export function equipmentPowered(state,item){
  return item.built&&item.integrity>0&&(item.id==='solar'||state.equipment.some(e=>e.id==='solar'&&e.built&&e.integrity>0));
}

export function equipmentAction(state,player){
  if(!player?.grounded)return null;
  const item=state.equipment.filter(e=>nearby(player,e,2.25)).sort((a,b)=>range(player,a)-range(player,b))[0];
  if(!item)return null;
  const build=!item.built;
  const cost=build?item.build:item.integrity<90?item.repair:0;
  return {item, cost, label:build?'Build':cost?'Service':'', affordable:state.parts>=cost};
}

export function useEquipment(state,player){
  const action=equipmentAction(state,player);
  if(!action?.cost||!action.affordable)return false;
  const {item,cost}=action;
  state.parts-=cost;
  item.built=true;item.integrity=integrityMax;
  state.revision++;
  return true;
}

/** One committed swing, with a forward arc, vertical reach and line of sight. */
export function strikeSalvage(state,player,world,charged=false){
  if(!player||state.stun>0)return 0;
  let hits=0;
  for(const robot of state.robots){
    if(robot.hp<=0||!nearby(player,robot,charged?3.1:2.35)||!facing(player,robot,charged?1.33:1.12)||!clear(world,player,robot))continue;
    hits++;robot.hp=Math.max(0,robot.hp-(charged?2:1));
    robot.phase=robot.hp?'stagger':'broken';robot.left=robot.hp ? .34 : 12;
    if(!robot.hp)state.drops.push({x:robot.x,y:robot.y,z:robot.z,count:2,robot:robot.id});
  }
  return hits;
}

function moveRobot(robot,target,step,world,speed){
  const d=range(robot,target);
  if(d<.02)return false;
  const k=Math.min(1,speed*step/d);
  const x=robot.x+(target.x-robot.x)*k,y=robot.y+(target.y-robot.y)*k,z=world.height(x,y);
  if(!Number.isFinite(z)||Math.abs(robot.z-z)>Math.max(.03,speed*step*.65)||!clear(world,robot,{x,y,z}))return false;
  Object.assign(robot,{x,y,z});
  return true;
}

export function stepSalvage(state,player,world,dt){
  if(!(dt>0))return;
  const step=Math.min(dt,.05);
  state.invulnerable=Math.max(0,state.invulnerable-step);
  state.stun=Math.max(0,state.stun-step);
  if(state.health===0&&state.stun===0){state.health=healthMax;state.invulnerable=1;}
  for(const robot of state.robots){
    if(!player||!nearby(player,robot.home,45))continue;
    robot.left=Math.max(0,robot.left-step);
    if(robot.phase==='broken'){
      if(robot.left===0&&range(player,robot.home)>6){
        const oldDrop=state.drops.find(d=>d.robot===robot.id);
        if(!oldDrop)Object.assign(robot,robot.home,{hp:3,phase:'patrol',left:0});
      }
      continue;
    }
    if(robot.phase==='windup'){
      if(robot.left>0)continue;
      if(!state.invulnerable&&!player.dodging&&nearby(player,robot,2.05)&&facing(robot,player,.85)&&clear(world,robot,player)){
        state.health--;state.stun=state.health ? .22 : 1.05;state.invulnerable=1.1;
      }
      robot.phase='recover';robot.left=.8;
      continue;
    }
    if(robot.left>0)continue;
    const engaged=nearby(player,robot,8)&&nearby(player,robot.home,11)&&clear(world,robot,player);
    const target=engaged?player:robot.home;
    if(range(robot,target)>.08)robot.heading=angle(robot,target);
    if(engaged&&range(robot,target)<=1.65){robot.phase='windup';robot.left=.62;}
    else robot.phase=moveRobot(robot,target,step,world,engaged?3:1.8)?'chase':'patrol';
  }
  if(!player)return;
  state.drops=state.drops.filter(drop=>{
    if(!nearby(player,drop,1.15)||!clear(world,player,drop))return true;
    state.parts+=drop.count;state.revision++;
    return false;
  });
  for(const item of state.equipment){
    if(equipmentPowered(state,item)&&nearby(player,item,30)){
      item.integrity=Math.max(0,item.integrity-step*.32);
    }
  }
}

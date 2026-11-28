import * as T from '../vendor/three.module.min.js';
import {createSalvage,equipmentAction,equipmentPowered,salvageProgress,stepSalvage,strikeSalvage,useEquipment} from '../../../shared/activities/salvage.js';

const SAVE_KEY='tumbler.maintenance-yard.v1';

export function createSalvageLayer({scene,panel,config,height,hitTest}){
  const world={height,hitTest};
  let saved;
  try{saved=JSON.parse(localStorage.getItem(SAVE_KEY));}catch{}
  const state=createSalvage(config,world,saved);
  const group=new T.Group();
  group.name='maintenance-yard';
  scene.add(group);
  const alloy=new T.MeshStandardMaterial({color:0x425756,metalness:.55,roughness:.42});
  const dark=new T.MeshStandardMaterial({color:0x222b2e,roughness:.86});
  const ceramic=new T.MeshStandardMaterial({color:0xb69a66,roughness:.7});
  const copper=new T.MeshStandardMaterial({color:0xdd9b55,metalness:.45,roughness:.42});
  const live=new T.MeshStandardMaterial({color:0x88dcca,emissive:0x368779,emissiveIntensity:.7});
  const cell=new T.MeshStandardMaterial({color:0x254970,metalness:.43,roughness:.3});
  const box=(root,size,xyz,material)=>{
    const mesh=new T.Mesh(new T.BoxGeometry(...size),material);
    mesh.position.set(...xyz);
    root.add(mesh);
    return mesh;
  };
  const cylinder=(root,radius,height,xyz,material)=>{
    const mesh=new T.Mesh(new T.CylinderGeometry(radius,radius,height,10),material);
    mesh.position.set(...xyz);
    root.add(mesh);
    return mesh;
  };
  const at=(root,s)=>root.position.set(s.x,s.z,-s.y);
  const robots=state.robots.map(robot=>{
    const root=new T.Group(),body=new T.Group();
    root.add(body);group.add(root);at(root,robot);
    box(body,[1.06,.36,.72],[0,.58,0],alloy);
    box(body,[.77,.36,.63],[0,.93,.02],ceramic);
    cylinder(body,.032,.31,[.26,1.23,-.17],alloy);
    box(body,[.075,.058,.075],[.26,1.39,-.17],copper);
    box(body,[.55,.14,.06],[0,.96,.36],dark);
    const eye=live.clone();
    box(body,[.36,.055,.08],[0,.96,.39],eye);
    const legs=[-1,1].flatMap(side=>[-1,1].map(end=>{
      const leg=new T.Group();
      leg.position.set(side*.44,.55,end*.23);
      body.add(leg);
      box(leg,[.12,.39,.14],[side*.11,-.17,0],alloy).rotation.z=side*.53;
      box(leg,[.16,.29,.13],[side*.22,-.38,0],dark);
      box(leg,[.25,.08,.24],[side*.22,-.51,0],ceramic);
      return leg;
    }));
    const arm=new T.Group();
    arm.position.set(0,.7,.23);body.add(arm);
    box(arm,[.26,.14,.71],[0,0,.37],alloy);
    box(arm,[.36,.16,.15],[0,0,.73],copper);
    const arc=new T.Mesh(new T.RingGeometry(1.71,1.79,32,1,Math.PI*.23,Math.PI*.54),
      new T.MeshBasicMaterial({color:0xf6ae63,side:T.DoubleSide,transparent:true,opacity:.8,depthWrite:false}));
    arc.rotation.set(-Math.PI/2,0,Math.PI);
    arc.position.y=.42;root.add(arc);
    return {root,body,legs,arm,arc,eye,robot};
  });
  const fixtures=state.equipment.map(item=>{
    const root=new T.Group(),installed=new T.Group();
    group.add(root);root.add(installed);at(root,item);
    box(root,[1.24,.2,.93],[0,.1,0],dark);
    for(const x of [-.46,.46])box(root,[.15,.28,.67],[x,.17,0],alloy);
    const indicator=live.clone();
    const status=box(root,[.19,.07,.08],[0,.29,.45],indicator);
    let rotor=null;
    if(item.id==='solar'){
      cylinder(installed,.08,.9,[0,.58,0],alloy);
      const array=new T.Group();array.position.set(0,1.18,0);array.rotation.x=.53;installed.add(array);
      box(array,[1.75,.06,1.04],[0,0,0],alloy);
      for(let row=0;row<3;row++)for(let column=0;column<6;column++)
        box(array,[.26,.044,.29],[(column-2.5)*.278,.025,(row-1)*.322],cell);
    }else{
      box(installed,[.69,.53,.57],[0,.51,0],ceramic);
      for(const x of [-.38,.38])cylinder(installed,.1,.72,[x,.45,0],alloy);
      rotor=new T.Group();rotor.position.set(0,.57,.32);installed.add(rotor);
      cylinder(rotor,.22,.13,[0,0,0],dark).rotation.x=Math.PI/2;
      box(rotor,[.34,.045,.03],[0,0,.077],copper);
    }
    return {item,installed,indicator,status,rotor};
  });
  const pickupSignal=new T.MeshBasicMaterial({color:0xffc67d});
  const pickupDiamond=new T.OctahedronGeometry(.12);
  const pickups=robots.map(()=>{
    const root=new T.Group();
    group.add(root);
    box(root,[.28,.19,.24],[0,0,0],copper).rotation.z=.26;
    box(root,[.19,.22,.19],[.18,.02,.06],alloy).rotation.z=-.35;
    const marker=new T.Mesh(pickupDiamond,pickupSignal);
    marker.position.y=.74;
    root.add(marker);
    return root;
  });
  const counter=panel.querySelector('[data-parts]'),hint=panel.querySelector('[data-yard-hint]'),button=panel.querySelector('button');
  let seconds=0,revision=-1,saveAfter=0,dirty=false;
  const save=()=>{
    try{localStorage.setItem(SAVE_KEY,JSON.stringify(salvageProgress(state)));}catch{}
  };
  const update=(dt,player,{active=true}={})=>{
    seconds+=dt;
    stepSalvage(state,active?player:null,world,active?dt:0);
    if(revision!==state.revision){revision=state.revision;save();saveAfter=seconds+5;}
    else if(dirty&&seconds>=saveAfter){save();saveAfter=seconds+5;dirty=false;}
    const inYard=player&&state.equipment.some(e=>Math.hypot(player.x-e.x,player.y-e.y)<30&&Math.abs(player.z-e.z)<5);
    panel.hidden=!active||!inYard;
    if(inYard&&active){
      const action=equipmentAction(state,player);
      const count=`Maintenance yard · Spare parts ${state.parts} · Resolve ${state.health}/3`;
      if(counter.textContent!==count)counter.textContent=count;
      const dropNear=state.drops.some(d=>Math.hypot(player.x-d.x,player.y-d.y)<5&&Math.abs(player.z-d.z)<1.65);
      const description=action?`${action.item.label} · ${action.item.built?`${equipmentPowered(state,action.item)?'Powered':'Offline'} · ${Math.ceil(action.item.integrity)}% condition`:'Empty mount'}`:
        dropNear?'Spare parts nearby · walk over them to collect':'Q / B to strike · Ctrl / R3 to dodge or slide';
      if(hint.textContent!==description)hint.textContent=description;
      button.hidden=!action?.cost;
      button.disabled=!action?.affordable;
      if(action?.cost){
        const label=`${action.label} · ${action.cost} ${action.cost===1?'part':'parts'} (I / RB)`;
        if(button.textContent!==label)button.textContent=label;
      }
    }
    for(const {root,body,legs,arm,arc,eye,robot} of robots){
      at(root,robot);
      root.rotation.y=robot.heading+Math.PI/2;
      const broken=robot.hp===0,windup=robot.phase==='windup',moving=robot.phase==='chase';
      body.rotation.z=broken?1.23:robot.phase==='stagger' ? .14 : 0;
      body.position.y=broken?-.28:moving?Math.abs(Math.sin(seconds*12+robot.id))*.07:0;
      for(const [i,leg] of legs.entries())leg.rotation.x=moving?Math.sin(seconds*14+i*Math.PI/2)*.32:0;
      arm.rotation.x=windup?-.55-robot.left:robot.phase==='recover'?Math.min(.5,(.8-robot.left)*2):0;
      arc.visible=windup;
      eye.emissive.setHex(windup?0xff642a:broken?0x070a09:0x368779);
      eye.color.setHex(windup?0xffbd78:broken?0x202827:0x88dcca);
    }
    for(const [i,mesh] of pickups.entries()){
      const drop=state.drops[i];mesh.visible=!!drop;
      if(drop){at(mesh,drop);mesh.position.y+=.86+Math.sin(seconds*4)*.08;mesh.rotation.y=seconds*1.7;}
    }
    for(const {item,installed,indicator,status,rotor} of fixtures){
      installed.visible=item.built;
      const powered=equipmentPowered(state,item);
      indicator.emissiveIntensity=powered ? .9 : 0;
      status.visible=item.built;
      if(rotor&&powered)rotor.rotation.z+=dt*5;
      dirty||=!!(inYard&&active&&powered);
    }
  };
  const interact=player=>useEquipment(state,player);
  return {group,state,update,strike:(player,charged)=>strikeSalvage(state,player,world,charged),interact};
}

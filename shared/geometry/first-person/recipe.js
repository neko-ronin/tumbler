/** Deterministic engine-neutral close-body source. Metres, glTF Y-up/+Z forward.
 * Character anatomy is explicit: imported meshes do not imply digit topology.
 * Geometry, material channels and posed surfaces can be consumed by any
 * engine; the browser batches rigid parts and updates the garment surface. No physics state is modified. */
import {validateAppearance,DEFAULT_APPEARANCE,CHARACTER_BASES} from '../../characters/appearance.js';
export const GENERATOR_VERSION=3;
export const FELID=Object.freeze({id:'felid-biped-v1',eye:Object.freeze([0,1.28,-.20]),hip:Object.freeze([0,.65,0]),upperArm:.18,forearm:.18,digits:4});
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),length=a=>Math.hypot(...a),unit=a=>mul(a,1/Math.max(1e-10,length(a)));
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
/** Long axis +Y along `axis`, flat face +Z towards `facing`: a strap, not a rod. */
function strapRotation(axis,facing){
 const y=unit(axis),f=sub(facing,mul(y,dot(facing,y))),z=length(f)<1e-6?unit(Math.abs(y[0])<.9?[1,0,0]:[0,0,1]):unit(f),x=[y[1]*z[2]-y[2]*z[1],y[2]*z[0]-y[0]*z[2],y[0]*z[1]-y[1]*z[0]];
 const t=x[0]+y[1]+z[2];
 if(t>0){const r=2*Math.sqrt(1+t);return [(y[2]-z[1])/r,(z[0]-x[2])/r,(x[1]-y[0])/r,r/4];}
 if(x[0]>y[1]&&x[0]>z[2]){const r=2*Math.sqrt(1+x[0]-y[1]-z[2]);return [r/4,(y[0]+x[1])/r,(z[0]+x[2])/r,(y[2]-z[1])/r];}
 if(y[1]>z[2]){const r=2*Math.sqrt(1+y[1]-x[0]-z[2]);return [(y[0]+x[1])/r,r/4,(z[1]+y[2])/r,(z[0]-x[2])/r];}
 const r=2*Math.sqrt(1+z[2]-x[0]-y[1]);return [(z[0]+x[2])/r,(z[1]+y[2])/r,r/4,(x[1]-y[0])/r];
}
function rotation(direction){const v=unit(direction),q=[v[2],0,-v[0],1+v[1]],n=Math.hypot(...q);return n<1e-7?[1,0,0,0]:q.map(x=>x/n);}
export function resolveFirstPersonDesign(config){
 const base=Object.keys(CHARACTER_BASES).find(k=>CHARACTER_BASES[k].asset===config.asset);
 if(!base&&!config.appearance)return {supported:false,reason:'unsupported-anatomy'};
 const appearance=validateAppearance(config.appearance??{...DEFAULT_APPEARANCE,base});
 const anatomy=CHARACTER_BASES[appearance.base].anatomy;
 if(anatomy!==FELID.id)return {supported:false,reason:'unsupported-anatomy'};
 const {name,...design}=appearance;
 return {supported:true,appearance,anatomy:FELID,key:JSON.stringify({generator:GENERATOR_VERSION,anatomy,design,equipment:'para-contact-v1',tier:'close'})};
}
/** Two fixed-length bones. An unreachable target is clamped, never stretched. */
export function solveArm(root,target,a,b,hint){
 const delta=sub(target,root),raw=length(delta),d=Math.max(Math.abs(a-b)+1e-6,Math.min(a+b-1e-6,raw)),axis=raw<1e-9?[0,0,1]:unit(delta);
 const along=(a*a-b*b+d*d)/(2*d),offset=sub(hint,root),projected=sub(offset,mul(axis,dot(offset,axis)));
 const fallback=Math.abs(axis[1])<.9?[0,1,0]:[1,0,0];
 const bend=length(projected)<1e-8?unit(sub(fallback,mul(axis,dot(fallback,axis)))):unit(projected);
 return {elbow:add(add(root,mul(axis,along)),mul(bend,Math.sqrt(Math.max(0,a*a-along*along)))),wrist:add(root,mul(axis,d)),clamped:Math.abs(raw-d)>1e-5};
}
export function unitGeometry(segments=12,rings=8){
 const positions=[],normals=[],uv=[],indices=[];
 for(let y=0;y<=rings;y++)for(let x=0;x<=segments;x++){
  const p=Math.PI*y/rings,a=2*Math.PI*x/segments,n=[-Math.cos(a)*Math.sin(p),Math.cos(p),Math.sin(a)*Math.sin(p)];positions.push(...n);normals.push(...n);uv.push(x/segments,1-y/rings);
 }
 for(let y=0;y<rings;y++)for(let x=0;x<segments;x++){const a=y*(segments+1)+x,b=a+segments+1;if(y>0)indices.push(a,b,a+1);if(y<rings-1)indices.push(b,b+1,a+1);}
 return {positions,normals,uv,indices};
}
/** One continuous tube across the elbow; fixed bones remain the pose source.
 * Catmull-Rom centreline rounds the garment fold without a rigid-part end cap. */
export function sleeveGeometry(root=[0,0,0],elbow=[0,.5,0],hem=[0,1,0]){
 const positions=[],normals=[],uv=[],indices=[],steps=12,segments=12;
 const nodes=[sub(mul(root,2),elbow),root,elbow,hem,sub(mul(hem,2),elbow)];
 const centre=t=>{const i=t<.5?0:1,u=t*2-i,[a,b,c,d]=nodes.slice(i,i+4);return a.map((_,k)=>.5*((2*b[k])+(-a[k]+c[k])*u+(2*a[k]-5*b[k]+4*c[k]-d[k])*u*u+(-a[k]+3*b[k]-3*c[k]+d[k])*u*u*u));};
 for(let row=0;row<=steps;row++){
  const t=row/steps,c=centre(t),axis=unit(sub(centre(Math.min(1,t+.001)),centre(Math.max(0,t-.001)))),ref=Math.abs(axis[0])<.9?[1,0,0]:[0,0,1],x=unit(sub(ref,mul(axis,dot(ref,axis)))),z=[axis[1]*x[2]-axis[2]*x[1],axis[2]*x[0]-axis[0]*x[2],axis[0]*x[1]-axis[1]*x[0]];
  const radius=(t===0?0:Math.min(1,t*12))*(.047*(1-t)+.035*t);
  for(let col=0;col<=segments;col++){
   const angle=col/segments*Math.PI*2,n=add(mul(x,-Math.cos(angle)),mul(z,Math.sin(angle)));
   positions.push(...add(c,mul(n,radius)));normals.push(...(row===0?mul(axis,-1):n));uv.push(col/segments,t);
  }
 }
 for(let row=0;row<steps;row++)for(let col=0;col<segments;col++){const a=row*(segments+1)+col,b=a+segments+1;if(row>0)indices.push(a,b,a+1);indices.push(b,b+1,a+1);}
 return {positions,normals,uv,indices};
}
/** Flat webbing and hard parts: a unit box (-1..1) with its own UVs on each face. */
export function boxGeometry(){
 const positions=[],normals=[],uv=[],indices=[];
 for(const [n,u,v]of [[[0,0,1],[1,0,0],[0,1,0]],[[0,0,-1],[-1,0,0],[0,1,0]],[[1,0,0],[0,0,-1],[0,1,0]],[[-1,0,0],[0,0,1],[0,1,0]],[[0,1,0],[1,0,0],[0,0,-1]],[[0,-1,0],[1,0,0],[0,0,1]]]){
  const start=positions.length/3;
  for(const [a,b]of [[-1,-1],[1,-1],[1,1],[-1,1]]){positions.push(...add(n,add(mul(u,a),mul(v,b))));normals.push(...n);uv.push((a+1)/2,(b+1)/2);}
  indices.push(start,start+1,start+2,start,start+2,start+3);
 }
 return {positions,normals,uv,indices};
}
/** Carabiners, maillons, leg loops and pulley wheels: a unit torus in its XY plane. */
export function ringGeometry(segments=14,sides=5,minor=.2){
 const positions=[],normals=[],uv=[],indices=[];
 for(let i=0;i<=segments;i++)for(let j=0;j<=sides;j++){
  const a=i/segments*Math.PI*2,b=j/sides*Math.PI*2,n=[Math.cos(a)*Math.cos(b),Math.sin(a)*Math.cos(b),Math.sin(b)];
  positions.push(Math.cos(a)+n[0]*minor,Math.sin(a)+n[1]*minor,n[2]*minor);normals.push(...n);uv.push(i/segments,j/sides);
 }
 for(let i=0;i<segments;i++)for(let j=0;j<sides;j++){const a=i*(sides+1)+j,b=a+sides+1;indices.push(a,b,a+1,b,b+1,a+1);}
 return {positions,normals,uv,indices};
}
const APPARATUS=Object.freeze({strap:'#505b60',riser:'#5d6e74',seat:'#4d575a',buckle:'#2c3234',instrument:'#23282a',steel:'#c6ced0',anodized:'#d2553a',line:'#d9a06e'});
export function generateFirstPerson(design){
 if(!design.supported)return {supported:false,reason:design.reason};
 const original=design.appearance.base==='cat-ronin-original';
 return {supported:true,key:design.key,version:GENERATOR_VERSION,anatomy:design.anatomy,geometry:unitGeometry(),geometries:{knit:sleeveGeometry(),strap:boxGeometry(),metal:ringGeometry()},
  materials:{coat:{base:'#92958c',tint:design.appearance.palette.coat},knit:{base:original?'#94372f':'#bca35c',tint:design.appearance.palette.outfit,pattern:original?'plaid':'knit'},cloth:{base:'#343c3d',tint:design.appearance.palette.outfit},pads:{base:'#7d6267',tint:design.appearance.palette.coat},webbing:{base:'#bd8354',tint:design.appearance.palette.accent},strap:{base:'#ffffff',tint:'#ffffff',pattern:'webbing'},metal:{base:'#ffffff',tint:'#ffffff'}},original};
}
/** Curved sleeves and overlapping rounded paws/digits share a solved pose.
 * No permanent third-person mesh, animation state or force is shared. */
export function firstPersonPose(recipe,state,grips,time=0,{body=true,pilotScale=1}={}){
 const parts=[],joints=[];let coatOrigin=[0,0,0],instrument=null;
 // The sail keeps its world size when the character is small, so the riser tops
 // stay put in the world: undo the hip-centred scale this frame is drawn under.
 const worldFixed=p=>add(FELID.hip,mul(sub(p,FELID.hip),1/pilotScale));
 const rush=Math.min(1.6,((state.speed??0)/24)**2),roll=state.rollRate??0;
 const strap=(id,a,b,width,thick,tint,facing=[0,0,1],material='strap')=>parts.push({id,material,tint,position:mix(a,b,.5),scale:[width/2,length(sub(b,a))/2,thick/2],quaternion:strapRotation(sub(b,a),facing)});
 const ring=(id,tint,position,scale,axis=[0,0,1],up=[0,1,0])=>parts.push({id,material:'metal',tint,position,scale,quaternion:strapRotation(up,axis)});
 const ball=(id,material,position,scale,quaternion=[0,0,0,1])=>parts.push({id,material,position,scale,quaternion,...(material==='coat'?{patternOrigin:coatOrigin}:{})});
 const beam=(id,material,a,b,r0,r1=r0)=>ball(id,material,mix(a,b,.5),[r0,length(sub(b,a))*.5+r0*.18,r1],rotation(sub(b,a)));
 for(const side of [1,-1]){
  const prefix=side>0?'left':'right',grip=grips[side>0?0:1];coatOrigin=grip;
  if(body){const shoulder=[side*.20,1.02,.02],wrist=add(grip,[0,-.01,-.09]);
  const arm=solveArm(shoulder,wrist,FELID.upperArm,FELID.forearm,[side*.55,.65,.04]);joints.push({side,shoulder,...arm,grip});
  parts.push({id:prefix+'_sleeve',material:'knit',position:[0,0,0],scale:[1,1,1],quaternion:[0,0,0,1],surface:sleeveGeometry(shoulder,arm.elbow,mix(arm.elbow,arm.wrist,.64))});
  beam(prefix+'_forearm','coat',mix(arm.elbow,arm.wrist,.54),add(grip,[0,-.005,-.045]),.032,.028);
  ball(prefix+'_cuff','cloth',mix(arm.elbow,arm.wrist,.64),[.038,.009,.035],rotation(sub(arm.wrist,arm.elbow)));
  ball(prefix+'_palm','coat',add(grip,[0,0,-.045]),[.047,.030,.052]);
  // Four curled digits, two phalanges each, across the handle's transverse bar.
  for(let i=0;i<FELID.digits;i++){
   const x=side*(i-1.5)*.026,root=add(grip,[x,.031,-.040]),knuckle=add(grip,[x,.038,.024]),tip=add(grip,[x,-.014,.040]);
   beam(prefix+`_digit_${i}_a`,'coat',root,knuckle,.014,.014);beam(prefix+`_digit_${i}_b`,'coat',knuckle,tip,.013,.013);
   ball(prefix+`_pad_${i}`,'pads',add(tip,[0,0,-.011]),[.012,.016,.006]);
  }
  const thumb=add(grip,[-side*.060,-.006,-.040]),thumbJoint=add(grip,[-side*.048,-.040,-.005]),thumbTip=add(grip,[-side*.016,-.041,.023]);
  beam(prefix+'_thumb_a','coat',thumb,thumbJoint,.018);beam(prefix+'_thumb_b','coat',thumbJoint,thumbTip,.017);
  ball(prefix+'_thumb_pad','pads',add(thumbTip,[0,.010,0]),[.017,.008,.013]);
  const sway=Math.sin(time*1.8+side)*Math.min(.012,Math.max(0,(state.load??1)-1)*.005),drift=roll*.03,hip=[side*.14,.64,0],knee=[side*.18+drift*.5,.40+sway,.38-.025*rush],ankle=[side*.18+drift,.18+sway+.03*rush,.65-.05*rush];
  beam(prefix+'_thigh','cloth',hip,knee,.115,.10);beam(prefix+'_shin','cloth',knee,ankle,.085,.078);
  coatOrigin=ankle;
  // Apparatus seen only from the pilot's own eye. Load path, as on the rig:
  // leg loops -> waist -> carabiner -> three risers -> the rig's maillons above.
  const carabiner=[side*.27,1.04,-.02],facing=[side*.3,.1,-1];
  ring(prefix+'_carabiner',APPARATUS.steel,carabiner,[.021,.038,.024],[0,0,1],[.12*side,1,0]);
  ring(prefix+'_carabiner_gate',APPARATUS.anodized,add(carabiner,[0,.026,0]),[.012,.008,.016],[0,0,1],[0,1,0]);
  for(const [row,top]of [.19,.02,-.15].entries()){
   const end=worldFixed([side*.35,1.72,top]),tremble=(.0012+.0035*rush)*Math.sin(time*37+row*1.7+side),mid=add(mix(carabiner,end,.56),[side*tremble,0,tremble*.6]),name=prefix+`_riser_${row}`;
   strap(name+'_lower',carabiner,mid,.024,.0045,APPARATUS.riser,facing);strap(name+'_upper',mid,end,.024,.0045,APPARATUS.riser,facing);
   // The A riser carries the colour pilots find it by; stitched keeper near each end.
   if(row===0)strap(name+'_mark',mix(carabiner,mid,.25),mix(carabiner,mid,.85),.0255,.005,APPARATUS.anodized,facing);
   strap(name+'_keeper',mix(mid,end,.74),mix(mid,end,.84),.028,.008,APPARATUS.strap,facing);
   ring(name+'_maillon',APPARATUS.steel,end,[.016,.026,.018],[0,0,1],[0,1,0]);
  }
  ring(prefix+'_pulley',APPARATUS.steel,worldFixed([side*.385,1.70,-.17]),[.024,.024,.018],[1,0,0],[0,1,0]);
  strap(prefix+'_shoulder',[side*.165,.965,.115],[side*.15,.80,.15],.032,.005,APPARATUS.strap,[0,.3,1]);
  strap(prefix+'_chest',[side*.15,.86,.14],[side*.018,.865,.158],.024,.005,APPARATUS.strap,[0,.1,1]);
  // Thin brake line, hand to the riser guides, replacing the rig's chase-weight tube.
  const swivel=add(grip,[0,.062,.002]);
  strap(prefix+'_brake_line',swivel,worldFixed([side*.40,1.72,-.19]),.0034,.0034,APPARATUS.line,facing);
  for(const [i,top]of [.19,-.15].entries())strap(prefix+`_return_${i}`,swivel,state.mode==='parakite'?worldFixed([side*.35,1.72,top]):swivel,.0026,.0026,APPARATUS.line,facing);
  strap(prefix+'_waist',[side*.21,.70,.08],[side*.02,.70,.165],.05,.007,APPARATUS.strap,[0,.1,1]);
  strap(prefix+'_pickup',[side*.215,.72,.04],carabiner,.036,.006,APPARATUS.strap,[side,0,.3]);
  const thigh=sub(knee,hip);ring(prefix+'_leg_loop',APPARATUS.strap,mix(hip,knee,.42),[.122,.106,.05],thigh,Math.abs(unit(thigh)[0])<.9?[1,0,0]:[0,1,0]);
  // Padded grip sleeve and swivel above each paw, for the hand-side of the line.
  beam(prefix+'_grip_pad','cloth',add(grip,[-.056,.002,0]),add(grip,[.056,.002,0]),.016,.016);
  ring(prefix+'_swivel',APPARATUS.steel,add(grip,[0,.062,.002]),[.011,.015,.012],[0,0,1],[0,1,0]);
  if(side>0){
   // On the chest strap: a glance down, the way a pilot reads a vario.
   const at=[0,.935,.18],n=unit(sub(FELID.eye,at)),q=strapRotation(sub([0,1,0],mul(n,n[1])),n);
   parts.push({id:'instrument_body',material:'strap',tint:APPARATUS.instrument,position:at,scale:[.058,.04,.009],quaternion:q});
   instrument={position:add(at,mul(n,.0098)),quaternion:q,width:.104,height:.069};
   strap('chest_buckle',[-.028,.865,.162],[.028,.865,.162],.026,.012,APPARATUS.buckle,[0,.1,1]);
   strap('waist_buckle',[-.036,.70,.168],[.036,.70,.168],.046,.014,APPARATUS.buckle,[0,.1,1]);
   parts.push({id:'seat',material:'strap',tint:APPARATUS.seat,position:[0,.515,.17],scale:[.215,.012,.235],quaternion:[0,0,0,1]});
  }
  ball(prefix+'_foot','coat',add(ankle,[0,-.04,.065]),[.070,.050,.12]);
  for(let i=0;i<4;i++)ball(prefix+`_toe_${i}`,'coat',add(ankle,[(i-1.5)*.028,-.048,.155]),[.020,.026,.036]);
  }
  // Soft toggle loop, underside grip bar and paired sewn attachment tails.
  const corners=[[-.066,-.036,0],[.066,-.036,0],[.066,.036,0],[-.066,.036,0]];
  for(let i=0;i<4;i++)beam(prefix+`_toggle_${i}`,'webbing',add(grip,corners[i]),add(grip,corners[(i+1)%4]),.0055,.0075);
  beam(prefix+'_grip_bar','webbing',add(grip,[-.065,0,0]),add(grip,[.065,0,0]),.010,.012);
 }
 return {parts,joints,instrument};
}

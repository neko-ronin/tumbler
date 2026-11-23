/** Deterministic engine-neutral close-body source. Metres, glTF Y-up/+Z forward.
 * Character anatomy is explicit: imported meshes do not imply digit topology.
 * Geometry, material channels and posed surfaces can be consumed by any
 * engine; the browser batches rigid parts and updates the garment surface. No physics state is modified. */
import {validateAppearance,DEFAULT_APPEARANCE,CHARACTER_BASES} from '../../characters/appearance.js';
export const GENERATOR_VERSION=7;
// Encloses the shirt's upper closure (all rings at and above y = .975).
const COLLAR_BOUNDS=Object.freeze({centre:Object.freeze([0,.99,-.108]),radius:.164,halfSize:Object.freeze([.163,.018,.087])});
export const FELID=Object.freeze({collarBounds:COLLAR_BOUNDS,id:'felid-biped-v1',eye:Object.freeze([0,1.28,-.20]),hip:Object.freeze([0,.65,0]),upperArm:.18,forearm:.18,digits:4});
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
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const TAU=2*Math.PI;
const identity=[0,0,0,1];

/** A two-span centreline with a shared tangent at the bent joint. */
function bentCentre(root,joint,end){
 const a=sub(joint,root),b=sub(end,joint),middle=mul(add(a,b),.5);
 return t=>{
  const first=t<.5,u=t*2-Number(!first),u2=u*u,u3=u2*u;
  const start=first?root:joint,finish=first?joint:end,m0=first?a:middle,m1=first?middle:b;
  return start.map((value,i)=>(2*u3-3*u2+1)*value+(u3-2*u2+u)*m0[i]+(-2*u3+3*u2)*finish[i]+(u3-u2)*m1[i]);
 };
}

/** Ring coordinates run with the fabric. Finite-difference normals follow
 * the actual folds and share the two sides of the UV seam. */
function garment(steps,segments,centre,reference,section,uvSize){
 const positions=[],normals=[],uv=[],indices=[],rings=[];
 for(let row=0;row<=steps;row++){
  const t=row/steps,c=centre(t),axis=unit(sub(centre(Math.min(1,t+.001)),centre(Math.max(0,t-.001))));
  const seed=Math.abs(dot(reference,axis))>.99?[0,1,0]:reference;
  const across=unit(sub(seed,mul(axis,dot(seed,axis)))),around=cross(axis,across),ring=[];
  for(let col=0;col<segments;col++){
   const angle=col/segments*TAU,[x,z]=section(t,angle);
   ring.push(add(c,add(mul(across,-x*Math.cos(angle)),mul(around,z*Math.sin(angle)))));
  }
  rings.push(ring);
 }
 for(let row=0;row<=steps;row++)for(let col=0;col<=segments;col++){
  const j=col%segments,around=sub(rings[row][(j+1)%segments],rings[row][(j+segments-1)%segments]);
  const along=sub(rings[Math.min(row+1,steps)][j],rings[Math.max(row-1,0)][j]);
  positions.push(...rings[row][j]);normals.push(...unit(cross(along,around)));uv.push(col/segments*uvSize[0],row/steps*uvSize[1]);
  if(row<steps&&col<segments){const a=row*(segments+1)+col,b=a+segments+1;indices.push(a,b,a+1,b,b+1,a+1);}
 }
 return {positions,normals,uv,indices};
}

export function sleeveGeometry(root,elbow,hem,side){
 // The arm's bend plane fixes the cloth's orientation as the brakes travel.
 const across=mul(unit(cross(sub(elbow,root),sub(hem,elbow))),side);
 return garment(20,16,bentCentre(root,elbow,hem),length(across)>.5?across:[1,0,0],(t,angle)=>{
  const elbowFold=.0035*Math.exp(-((t-.56)**2)/.023)*Math.cos(72*(t-.5)+1.2*Math.cos(angle));
  const cuff=.007*Math.exp(-((t-.91)**2)/.003);
  const radius=(.061-.019*t+elbowFold+cuff+.002*Math.sin(3*angle+4*t))*Math.min(1,.27+t*9);
  return [radius,radius*.91];
 },[.324,.29]);
}

function shirtTorso(){
 // Pull the upper torso back into the seat below the eye. The top rolls
 // down onto the chest so the downward view cannot see into an open collar.
 const sections=[
  [.580,.198,.130,-.018],[.625,.209,.141,-.016],[.674,.204,.143,-.016],
  [.715,.200,.145,-.019],[.755,.202,.144,-.025],[.795,.208,.141,-.032],
  [.835,.211,.134,-.040],[.875,.206,.125,-.054],[.914,.200,.113,-.076],
  [.951,.189,.095,-.095],[.975,.160,.077,-.108],[.993,.121,.054,-.122],
  [1.002,.075,.035,-.127],[1.006,.032,.018,-.129],[1.007,0,0,-.129],
 ];
 const positions=[],normals=[],uv=[],indices=[],sides=28,rows=sections.length;
 function point(row,col){
  const [y,width,depth,z]=sections[row],angle=TAU*col/sides;
  const fold=.0035*Math.cos(7*angle+row*.34)*Math.sin(Math.PI*row/(rows-1));
  const x=Math.cos(angle),fwd=Math.sin(angle);
  const shape=v=>Math.sign(v)*Math.abs(v)**.82;
  return [-shape(x)*(width+fold),y,-shape(fwd)*(depth+fold)+z];
 }
 for(let row=0;row<rows;row++)for(let col=0;col<=sides;col++){
  const p=point(row,col%sides),along=sub(point(Math.min(rows-1,row+1),col),point(Math.max(0,row-1),col));
  const around=sub(point(row,(col+1)%sides),point(row,(col+sides-1)%sides));
  positions.push(...p);normals.push(...(row===rows-1?[0,1,0]:unit(cross(along,around))));
  uv.push(p[0],(p[1]-.58)*.82+p[2]*.63);
  if(row<rows-1&&col<sides){
   const a=row*(sides+1)+col,b=a+sides+1;
   indices.push(a,b,a+1);
   if(row<rows-2)indices.push(b,b+1,a+1);
  }
 }
 return {positions,normals,uv,indices};
}

function hakama(hip,knee,hem,side){
 const thigh=sub(knee,hip),shin=sub(hem,knee);
 const bend=1-dot(unit(thigh),unit(shin));
 return garment(16,20,bentCentre(hip,knee,hem),[-side,0,0],(t,angle)=>{
  const kneePanel=Math.exp(-((t-.50)**2)/.015);
  const pleats=.007*(1-t*.6)*(1-.72*kneePanel)*Math.cos(5*angle+.25);
  const hipFit=Math.min(1,.60+t*5);
  const front=Math.max(0,-side*Math.sin(angle));
  const back=Math.max(0,side*Math.sin(angle));
  const kneeFold=.035*bend*back*Math.cos(88*(t-.5));
  const width=(.139-.081*t+.010*kneePanel+pleats)*hipFit;
  const depth=(.104-.047*t+(.006+.014*front+kneeFold)*kneePanel+pleats)*hipFit;
  return [width,depth];
 },[.76,.55]);
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
 const palette=design.appearance.palette;
 return {
  supported:true,key:design.key,version:GENERATOR_VERSION,anatomy:design.anatomy,geometry:unitGeometry(),
  geometries:{strap:boxGeometry(),metal:ringGeometry(10),pads:unitGeometry(8,6)},
  materials:{
   coat:{base:'#919397',tint:palette.coat},
   shirt:{base:'#b05746',tint:palette.outfit,pattern:'flannel'},
   hakama:{base:'#495468',tint:palette.outfit,pattern:'twill'},
   cloth:{base:'#343c3d',tint:palette.outfit},
   pads:{base:'#7d6267',tint:palette.coat},
   webbing:{base:'#bd8354',tint:palette.accent},
   strap:{base:'#ffffff',tint:'#ffffff',pattern:'webbing'},
   metal:{base:'#ffffff',tint:'#ffffff'},
  },
  torso:shirtTorso(),
 };
}
const STILL_LEG=Object.freeze({sweep:0,hipPitch:0,kneeFlex:0});
const STILL_LEGS=Object.freeze([STILL_LEG,STILL_LEG]);
const limit=(v,min,max)=>Math.max(min,Math.min(max,v));
const THIGH_M=.439, SHIN_M=.453;

/** Per-leg angles around a seated rest pose. Steering shifts the inside leg
 * first. Apparent acceleration and airflow then move both free lower legs,
 * whose angular rates carry through changes in load. */
export function createSeatedLegSwing(){
 const legs=[{...STILL_LEG},{...STILL_LEG}],rates=legs.map(()=>({...STILL_LEG}));
 const channels=[
  ['sweep',7,7],
  ['hipPitch',10,8],
  ['kneeFlex',5.5,8],
 ];
 return {
  reset(){
   for(const leg of [...legs,...rates])Object.assign(leg,STILL_LEG);
  },
  update(dt,{lean=0,lateral=0,vertical=0,forward=0,sideAir=0,headwind=0}={}){
   if(!(dt>0))return legs;
   const t=Math.min(dt,.05);
   const drift=limit(-lateral*.023+sideAir*.004,-.20,.20);
   const drag=headwind*Math.abs(headwind)*.00010;
   const pitch=limit(forward*.009+vertical*.011+drag*.25,-.13,.17);
   const flex=limit(forward*.031+vertical*.016+drag,-.37,.36);
   const shift=limit(lean,-1,1);
   for(const [key,decay,frequency] of channels){
    const loss=Math.exp(-decay*t),c=Math.cos(frequency*t),sn=Math.sin(frequency*t);
    for(let i=0;i<legs.length;i++){
     const inside=(i===0?1:-1)*shift;
     const target=key==='sweep'?drift+shift*.075:key==='hipPitch'?pitch+inside*.12:flex+inside*.25;
     const error=legs[i][key]-target,rate=rates[i][key];
     const impulse=rate+decay*error;
     legs[i][key]=target+loss*(error*c+impulse*sn/frequency);
     rates[i][key]=loss*(rate*c-(frequency*error+decay*impulse/frequency)*sn);
    }
   }
   return legs;
  },
 };
}

function legRotation(yaw,pitch){
 const sx=Math.sin(pitch*.5),cx=Math.cos(pitch*.5),sy=Math.sin(yaw*.5),cy=Math.cos(yaw*.5);
 return [sx*cy,cx*sy,-sx*sy,cx*cy];
}

function turnLeg(vector,[x,y,z,w]){
 const twice=mul(cross([x,y,z],vector),2);
 return add(vector,add(mul(twice,w),cross([x,y,z],twice)));
}

/** Curved sleeves and overlapping rounded paws/digits share a solved pose.
 * No permanent third-person mesh, animation state or force is shared. */
export function firstPersonPose(recipe,state,grips,time=0,{body=true,pilotScale=1,legSwing=STILL_LEGS}={}){
 const parts=[],joints=[],legJoints=[];let coatOrigin=[0,0,0],instrument=null;
 // The sail keeps its world size when the character is small, so the riser tops
 // stay put in the world: undo the hip-centred scale this frame is drawn under.
 const worldFixed=p=>add(FELID.hip,mul(sub(p,FELID.hip),1/pilotScale));
 const rush=Math.min(1.6,((state.speed??0)/24)**2);
 const strap=(id,a,b,width,thick,tint,facing=[0,0,1],material='strap')=>parts.push({id,material,tint,position:mix(a,b,.5),scale:[width/2,length(sub(b,a))/2,thick/2],quaternion:strapRotation(sub(b,a),facing)});
 const ring=(id,tint,position,scale,axis=[0,0,1],up=[0,1,0])=>parts.push({id,material:'metal',tint,position,scale,quaternion:strapRotation(up,axis)});
 const ball=(id,material,position,scale,quaternion=[0,0,0,1])=>parts.push({id,material,position,scale,quaternion,...(material==='coat'?{patternOrigin:coatOrigin}:{})});
 const beam=(id,material,a,b,r0,r1=r0)=>ball(id,material,mix(a,b,.5),[r0,length(sub(b,a))*.5+r0*.18,r1],rotation(sub(b,a)));
 for(const side of [1,-1]){
  const prefix=side>0?'left':'right',grip=grips[side>0?0:1];coatOrigin=grip;
  if(body){const shoulder=[side*.20,1.02,.02],wrist=add(grip,[0,-.015,-.078]);
  const arm=solveArm(shoulder,wrist,FELID.upperArm,FELID.forearm,[side*.55,.65,.04]);
  joints.push({side,shoulder,...arm,grip});
  const hem=mix(arm.elbow,arm.wrist,.76);
  parts.push({id:prefix+'_sleeve',material:'shirt',position:[0,0,0],scale:[1,1,1],quaternion:identity,surface:sleeveGeometry(mix(shoulder,[side*.119,.941,-.081],.77),arm.elbow,hem,side)});
  beam(prefix+'_forearm','coat',mix(arm.elbow,arm.wrist,.65),add(grip,[0,.003,-.019]),.033,.031);
  // Overlap the palm and curled digits so the paw closes around the bar.
  ball(prefix+'_palm','coat',add(grip,[0,.009,-.033]),[.053,.035,.051]);
  for(let i=0;i<FELID.digits;i++){
   const x=side*(i-1.5)*.024,endShape=Math.abs(i-1.5),reach=.026-endShape*.004;
   const root=add(grip,[x,.026,-.043]),knuckle=add(grip,[x,.030,reach]),tip=add(grip,[x,-.013,reach+.013]);
   beam(prefix+`_digit_${i}_a`,'coat',root,knuckle,.015,.015);beam(prefix+`_digit_${i}_b`,'coat',knuckle,tip,.013,.013);
   ball(prefix+`_pad_${i}`,'pads',add(tip,[0,0,-.010]),[.011,.013,.006]);
  }
  const thumb=add(grip,[-side*.041,-.011,-.042]),thumbJoint=add(grip,[-side*.052,-.033,-.015]),thumbTip=add(grip,[-side*.028,-.036,.022]);
  beam(prefix+'_thumb_a','coat',thumb,thumbJoint,.020);beam(prefix+'_thumb_b','coat',thumbJoint,thumbTip,.017);
  ball(prefix+'_thumb_pad','pads',add(thumbTip,[0,.008,0]),[.016,.007,.013]);
  const hip=[side*.116,.653,-.022];
  const {sweep,hipPitch,kneeFlex}=legSwing[side>0?0:1];
  // The shin hinges in the thigh's plane. Hip rotation carries the whole
  // chain, and independent knee flexion never changes either bone length.
  const yaw=side*.12+sweep,thighPitch=.14+hipPitch;
  const flexion=limit(.52+kneeFlex,.20,1.25);
  const shinPitch=thighPitch+flexion;
  const knee=add(hip,turnLeg([0,0,THIGH_M],legRotation(yaw,thighPitch)));
  const ankle=add(knee,turnLeg([0,0,SHIN_M],legRotation(yaw,shinPitch)));
  legJoints.push({side,hip,knee,ankle,flexion});
  const trouserHem=mix(knee,ankle,.89);
  parts.push({id:prefix+'_hakama',material:'hakama',position:[0,0,0],scale:[1,1,1],quaternion:identity,surface:hakama(hip,knee,trouserHem,side)});
  coatOrigin=ankle;
  // Apparatus seen only from the pilot's own eye. Load path, as on the rig:
  // leg loops -> waist -> carabiner -> three risers -> the rig's maillons above.
  const carabiner=[side*.312,1.012,-.055],facing=[side*.3,.1,-1];
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
  const strapTop=[side*.129,.963,-.043],strapMid=[side*.131,.931,-.006],strapChest=[side*.132,.866,.064];
  strap(prefix+'_shoulder_top',strapTop,strapMid,.028,.005,APPARATUS.strap,[0,.3,1]);
  strap(prefix+'_shoulder',strapMid,strapChest,.028,.005,APPARATUS.strap,[0,.3,1]);
  strap(prefix+'_chest',strapChest,[side*.018,.865,.085],.024,.005,APPARATUS.strap,[0,.1,1]);
  // Thin brake line, hand to the riser guides, replacing the rig's chase-weight tube.
  const swivel=add(grip,[0,.062,.002]);
  strap(prefix+'_brake_line',swivel,worldFixed([side*.40,1.72,-.19]),.0034,.0034,APPARATUS.line,facing);
  for(const [i,top]of [.19,-.15].entries())strap(prefix+`_return_${i}`,swivel,state.mode==='parakite'?worldFixed([side*.35,1.72,top]):swivel,.0026,.0026,APPARATUS.line,facing);
  strap(prefix+'_waist',[side*.177,.700,.072],[side*.02,.700,.131],.044,.007,APPARATUS.strap,[0,.1,1]);
  strap(prefix+'_pickup',[side*.177,.700,.072],carabiner,.033,.006,APPARATUS.strap,[side,0,.3]);
  const thigh=sub(knee,hip);ring(prefix+'_leg_loop',APPARATUS.strap,mix(hip,knee,.30),[.112,.092,.052],thigh,[1,0,0]);
  // Padded grip sleeve and swivel above each paw, for the hand-side of the line.
  beam(prefix+'_grip_pad','cloth',add(grip,[-.056,.002,0]),add(grip,[.056,.002,0]),.016,.016);
  ring(prefix+'_swivel',APPARATUS.steel,add(grip,[0,.062,.002]),[.011,.015,.012],[0,0,1],[0,1,0]);
  if(side>0){
   parts.push({id:'torso',material:'shirt',position:[0,0,0],scale:[1,1,1],quaternion:identity,surface:recipe.torso});
   const at=[0,.891,.150],n=unit(sub(FELID.eye,at)),q=strapRotation(sub([0,1,0],mul(n,n[1])),n);
   parts.push({id:'instrument_body',material:'strap',tint:APPARATUS.instrument,position:at,scale:[.058,.04,.009],quaternion:q});
   instrument={position:add(at,mul(n,.0098)),quaternion:q,width:.104,height:.069};
   strap('vario_mount',[0,.844,.089],sub(at,mul(n,.026)),.048,.012,APPARATUS.buckle,[0,.1,1]);
   strap('chest_buckle',[-.028,.865,.088],[.028,.865,.088],.026,.012,APPARATUS.buckle,[0,.1,1]);
   strap('waist_buckle',[-.036,.70,.135],[.036,.70,.135],.046,.014,APPARATUS.buckle,[0,.1,1]);
   parts.push({id:'seat',material:'strap',tint:APPARATUS.seat,position:[0,.510,.108],scale:[.218,.012,.176],quaternion:[0,0,0,1]});
  }
  const pawRotation=legRotation(yaw-side*.17,-.09+(shinPitch-.66)*.66);
  const pawAt=offset=>add(ankle,turnLeg(offset,pawRotation));
  beam(prefix+'_ankle','coat',mix(knee,ankle,.81),pawAt([0,-.022,.037]),.043,.042);
  ball(prefix+'_foot','coat',pawAt([0,-.025,.038]),[.073,.053,.078],pawRotation);
  for(const toe of [-1,0,1]){
   const edge=Math.abs(toe);
   ball(prefix+`_toe_${toe+1}`,'coat',pawAt([toe*.039,-.023,.101-edge*.011]),
    [.026-edge*.002,.032-edge*.003,.029-edge*.003],pawRotation);
  }
  }
  // Soft toggle loop, underside grip bar and paired sewn attachment tails.
  const corners=[[-.066,-.036,0],[.066,-.036,0],[.066,.036,0],[-.066,.036,0]];
  for(let i=0;i<4;i++)beam(prefix+`_toggle_${i}`,'webbing',add(grip,corners[i]),add(grip,corners[(i+1)%4]),.0055,.0075);
  beam(prefix+'_grip_bar','webbing',add(grip,[-.065,0,0]),add(grip,[.065,0,0]),.010,.012);
 }
 return {parts,joints,legJoints,instrument};
}

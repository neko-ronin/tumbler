/** Deterministic engine-neutral close-body source. Metres, glTF Y-up/+Z forward.
 * Character anatomy is explicit: imported meshes do not imply digit topology.
 * Geometry, material channels and posed surfaces can be consumed by any
 * engine; the browser batches rigid parts and updates the garment surface. No physics state is modified. */
import {validateAppearance,DEFAULT_APPEARANCE,CHARACTER_BASES} from '../../characters/appearance.js';
export const GENERATOR_VERSION=2;
export const FELID=Object.freeze({id:'felid-biped-v1',eye:Object.freeze([0,1.28,-.20]),hip:Object.freeze([0,.65,0]),upperArm:.18,forearm:.18,digits:4});
const add=(a,b)=>a.map((v,i)=>v+b[i]),sub=(a,b)=>a.map((v,i)=>v-b[i]),mul=(a,s)=>a.map(v=>v*s),dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),length=a=>Math.hypot(...a),unit=a=>mul(a,1/Math.max(1e-10,length(a)));
const mix=(a,b,t)=>add(mul(a,1-t),mul(b,t));
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
export function generateFirstPerson(design){
 if(!design.supported)return {supported:false,reason:design.reason};
 const original=design.appearance.base==='cat-ronin-original';
 return {supported:true,key:design.key,version:GENERATOR_VERSION,anatomy:design.anatomy,geometry:unitGeometry(),geometries:{knit:sleeveGeometry()},
  materials:{coat:{base:'#92958c',tint:design.appearance.palette.coat},knit:{base:original?'#94372f':'#bca35c',tint:design.appearance.palette.outfit,pattern:original?'plaid':'knit'},cloth:{base:'#343c3d',tint:design.appearance.palette.outfit},pads:{base:'#7d6267',tint:design.appearance.palette.coat},webbing:{base:'#bd8354',tint:design.appearance.palette.accent}},original};
}
/** Curved sleeves and overlapping rounded paws/digits share a solved pose.
 * No permanent third-person mesh, animation state or force is shared. */
export function firstPersonPose(recipe,state,grips,time=0,{body=true}={}){
 const parts=[],joints=[];let coatOrigin=[0,0,0];
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
  const sway=Math.sin(time*1.8+side)*Math.min(.012,Math.max(0,(state.load??1)-1)*.005),hip=[side*.14,.64,0],knee=[side*.18,.40+sway,.38],ankle=[side*.18,.18+sway,.65];
  beam(prefix+'_thigh','cloth',hip,knee,.115,.10);beam(prefix+'_shin','cloth',knee,ankle,.085,.078);
  coatOrigin=ankle;
  ball(prefix+'_foot','coat',add(ankle,[0,-.04,.065]),[.070,.050,.12]);
  for(let i=0;i<4;i++)ball(prefix+`_toe_${i}`,'coat',add(ankle,[(i-1.5)*.028,-.048,.155]),[.020,.026,.036]);
  }
  // Soft toggle loop, underside grip bar and paired sewn attachment tails.
  const corners=[[-.075,-.042,0],[.075,-.042,0],[.075,.042,0],[-.075,.042,0]];
  for(let i=0;i<4;i++)beam(prefix+`_toggle_${i}`,'webbing',add(grip,corners[i]),add(grip,corners[(i+1)%4]),.008,.011);
  beam(prefix+'_grip_bar','webbing',add(grip,[-.065,0,0]),add(grip,[.065,0,0]),.010,.012);
 }
 return {parts,joints};
}

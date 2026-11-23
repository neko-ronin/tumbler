import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../vendor/three.module.min.js';
import {DEFAULT_APPEARANCE,APPEARANCE_PRESETS} from '../../../shared/characters/appearance.js';
import {resolveFirstPersonDesign,generateFirstPerson,firstPersonPose,solveArm,createSeatedLegSwing} from '../../../shared/geometry/first-person/recipe.js';
import {controlGrip} from '../../../shared/geometry/flight/contacts.js';
import {createFirstPersonFlight} from '../src3d/first-person-flight.js';
import {forearmFringe} from '../src3d/paw-groom.js';
const config={asset:'cat-ronin/ronin.glb'},design=()=>resolveFirstPersonDesign(config);
const gap=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]));
test('deterministic anatomy recipe preserves palette identity without inferring anatomy from imported meshes',()=>{
 const a=generateFirstPerson(design()),b=generateFirstPerson(design());assert.deepEqual(a,b);assert.equal(a.anatomy.digits,4);
 assert.ok(a.geometry.indices.every(i=>i>=0&&i<a.geometry.positions.length/3));assert.ok(a.geometry.positions.every(Number.isFinite));
 assert.equal(resolveFirstPersonDesign({asset:'unknown/visitor.glb'}).supported,false);
 const ember=resolveFirstPersonDesign({...config,appearance:APPEARANCE_PRESETS[2].recipe});assert.notEqual(ember.key,design().key);assert.equal(generateFirstPerson(ember).materials.coat.tint,APPEARANCE_PRESETS[2].recipe.palette.coat);assert.equal(generateFirstPerson(ember).materials.shirt.tint,APPEARANCE_PRESETS[2].recipe.palette.outfit);assert.ok(Object.isFrozen(a.anatomy.eye));
 assert.equal(resolveFirstPersonDesign({...config,appearance:{...DEFAULT_APPEARANCE,name:'Renamed'}}).key,design().key);
});
test('both paws wrap independently around shared contacts at every control extreme without stretching either arm',()=>{
 const recipe=generateFirstPerson(design());
 for(const mode of ['paraglider','parakite','paramotor'])for(const left of [0,.45,1])for(const right of [0,.45,1]){
  const state={mode,handleLeft:left,handleRight:right,brakeLeft:left,brakeRight:right,load:2},before=structuredClone(state),grips=[controlGrip(state,1),controlGrip(state,-1)],pose=firstPersonPose(recipe,state,grips,2);
  assert.deepEqual(state,before);assert.ok(grips[0][0]>0&&grips[1][0]<0);
  for(const j of pose.joints){assert.equal(j.clamped,false);assert.ok(Math.abs(gap(j.shoulder,j.elbow)-recipe.anatomy.upperArm)<1e-9);assert.ok(Math.abs(gap(j.elbow,j.wrist)-recipe.anatomy.forearm)<1e-9);}
  assert.equal(pose.parts.filter(p=>p.id.includes('_digit_')).length,16);assert.ok(pose.parts.every(p=>[...p.position,...p.scale,...p.quaternion].every(Number.isFinite)));
 }
 const far=solveArm([0,0,0],[0,0,5],.3,.3,[.2,-.2,0]);assert.equal(far.clamped,true);assert.ok(gap([0,0,0],far.wrist)<.6);
});
test('chase view needs only the same equipment contacts, without generating unseen limb poses',()=>{
 const recipe=generateFirstPerson(design()),s={mode:'parakite'},grips=[controlGrip(s,1),controlGrip(s,-1)];
 const a=firstPersonPose(recipe,s,grips),b=firstPersonPose(recipe,s,grips,0,{body:false});assert.deepEqual(b.parts,a.parts.filter(p=>p.material==='webbing'));assert.equal(b.joints.length,0);assert.equal(b.legJoints.length,0);
});
test('lazy requests reuse one model, reject stale design output and dispose pending resources',async()=>{
 const a=createFirstPersonFlight(config);assert.equal(a.stats.builds,0);
 const old=a.request(design()),newest=a.setDesign(APPEARANCE_PRESETS[2].recipe);await Promise.all([old,newest]);assert.equal(a.stats.builds,1);assert.equal(a.ready,true);
 await a.setDesign(APPEARANCE_PRESETS[2].recipe);assert.equal(a.stats.builds,1);
 a.update({active:true,view:'first',pilotMatrix:new T.Matrix4(),state:{mode:'parakite'},grips:[new T.Vector3(.4,1.25,.45),new T.Vector3(-.4,1.25,.45)]});assert.equal(a.group.visible,true);assert.ok(a.stats.triangles<75000);
 a.update({active:false});assert.equal(a.group.visible,false);a.dispose();assert.equal(a.group.children.length,0);
 const pending=createFirstPersonFlight(config),request=pending.request(design());pending.dispose();await request;assert.equal(pending.group.children.length,0);assert.equal(pending.stats.builds,0);
});

test('vertical or coincident arm targets keep finite fixed-length bones with a degenerate bend hint',()=>{
 for(const target of [[0,.2,0],[0,-.2,0],[0,0,0]]){
  const p=solveArm([0,0,0],target,.18,.18,[0,1,0]);assert.ok(Math.abs(gap([0,0,0],p.elbow)-.18)<1e-8);assert.ok(Math.abs(gap(p.elbow,p.wrist)-.18)<1e-8);
 }
});
test('a failed shader preparation releases the unattached model and preserves failure state',async()=>{
 const body=createFirstPersonFlight(config,{compile:async()=>{throw Error('compile fixture');}});
 await assert.rejects(body.request(design()),/compile fixture/);assert.equal(body.group.children.length,0);assert.equal(body.stats.builds,0);assert.equal(body.stats.status,'failed');body.dispose();
});

test('garment profile has finite unit normals and each paw shares a grip-relative coat frame',()=>{
 const recipe=generateFirstPerson(design());
 for(const pull of [0,.45,1]){
  const s={mode:'parakite',handleLeft:pull,handleRight:1-pull},grips=[controlGrip(s,1),controlGrip(s,-1)],pose=firstPersonPose(recipe,s,grips);
  for(const {surface:g} of pose.parts.filter(p=>p.surface)){
   for(let i=0;i<g.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...g.normals.slice(i,i+3))-1)<1e-9);
   assert.ok(g.positions.every(Number.isFinite));assert.ok(g.indices.every(i=>i<g.positions.length/3));
  }
  for(const [i,side]of ['left','right'].entries()){
   const sleeve=pose.parts.find(p=>p.id===side+'_sleeve').surface,ring=sleeve.positions.slice(10*17*3,10*17*3+16*3),centre=[0,1,2].map(k=>ring.filter((v,i)=>i%3===k).reduce((a,b)=>a+b,0)/16);
   assert.ok(gap(centre,pose.joints[i].elbow)<.003,'the continuous garment passes through the solved elbow');
   const paw=pose.parts.filter(p=>p.material==='coat'&&p.id.startsWith(side)&&!/_ankle|_foot|_toe/.test(p.id));
   assert.ok(paw.length>10);for(const part of paw)assert.deepEqual(part.patternOrigin,grips[i]);
  }
 }
});
test('close apparatus exists only in first person and meets the rig at its real load points',()=>{
 const recipe=generateFirstPerson(design()),s={mode:'parakite',speed:26},grips=[controlGrip(s,1),controlGrip(s,-1)],pose=firstPersonPose(recipe,s,grips,1);
 const chase=firstPersonPose(recipe,s,grips,1,{body:false});assert.equal(chase.parts.filter(p=>['strap','metal'].includes(p.material)).length,0);assert.equal(chase.instrument,null);
 assert.ok(pose.parts.every(p=>[...p.position,...p.scale,...p.quaternion].every(Number.isFinite)));
 for(const p of pose.parts.filter(p=>['strap','metal'].includes(p.material)))assert.ok(Math.abs(Math.hypot(...p.quaternion)-1)<1e-9,p.id);
 // A strap's flat face and length follow the requested frame, not a sphere's arbitrary roll.
 const riser=pose.parts.find(p=>p.id==='left_riser_0_upper'),q=new T.Quaternion(...riser.quaternion),along=new T.Vector3(0,1,0).applyQuaternion(q),maillon=pose.parts.find(p=>p.id==='left_riser_0_maillon');
 assert.ok(gap(new T.Vector3(...riser.position).addScaledVector(along,riser.scale[1]).toArray(),[.35,1.72,.19])<1e-9,'the riser ends at the rig maillon');assert.ok(gap(maillon.position,[.35,1.72,.19])<1e-9);
 const small=firstPersonPose(recipe,s,grips,1,{pilotScale:.5}).parts.find(p=>p.id==='left_riser_0_maillon').position;
 assert.ok(gap([.65+0,0,0].map((_,i)=>[0,.65,0][i]+(small[i]-[0,.65,0][i])*.5),[.35,1.72,.19])<1e-9,'a small pilot keeps the world-sized riser top');
 assert.ok(pose.instrument.width>0);assert.equal(pose.parts.filter(p=>p.id==='instrument_body').length,1);
 const still=firstPersonPose(recipe,s,grips,0).parts.map(p=>p.id);assert.deepEqual(pose.parts.map(p=>p.id),still,'instance layout is stable');
});


test('seated knees lag a brake pulse, overshoot and settle at different frame cadences',()=>{
 const brake={forward:-8},check=hz=>{
  const legs=createSeatedLegSwing(),dt=1/hz;
  const first=legs.update(dt,brake)[0].kneeFlex;
  assert.ok(first<0&&first>-.03,'the knee starts extending without snapping');
  for(let i=1;i<hz/2;i++)legs.update(dt,brake);
  const braked=legs.update(0)[0].kneeFlex;
  assert.ok(braked<-.20);
  let peak=0;
  for(let i=0;i<hz;i++)peak=Math.max(peak,legs.update(dt)[0].kneeFlex);
  assert.ok(peak>.02&&peak<.045,'the shin swings past neutral before settling');
  assert.ok(Math.abs(legs.update(0)[0].kneeFlex)<.003);
  legs.update(dt,{lean:1,lateral:4});
  legs.reset();
  assert.deepEqual(legs.update(0),Array.from({length:2},()=>({sweep:0,hipPitch:0,kneeFlex:0})));
  return [braked,peak];
 };
 const a=check(30),b=check(120);
 assert.ok(Math.abs(a[0]-b[0])<1e-10);
 assert.ok(Math.abs(a[1]-b[1])<.001); // the samples need not catch the same peak
});

test('weight shift bends the inside knee and mirrors, while apparent load moves both legs',()=>{
 const left=createSeatedLegSwing(),right=createSeatedLegSwing(),loaded=createSeatedLegSwing();
 for(let i=0;i<60;i++){
  left.update(1/120,{lean:1,lateral:5,sideAir:2});
  right.update(1/120,{lean:-1,lateral:-5,sideAir:-2});
  loaded.update(1/120,{vertical:8,headwind:26});
 }
 const [inside,outside]=left.update(0);
 const [mirrorOutside,mirrorInside]=right.update(0);
 assert.ok(inside.kneeFlex>outside.kneeFlex+.45);
 assert.ok(inside.hipPitch>outside.hipPitch+.20);
 assert.ok(inside.sweep<0,'lateral acceleration can carry both shins outside the turn');
 for(const [a,b] of [[inside,mirrorInside],[outside,mirrorOutside]]){
  assert.equal(a.sweep,-b.sweep);
  assert.equal(a.hipPitch,b.hipPitch);
  assert.equal(a.kneeFlex,b.kneeFlex);
 }
 assert.ok(loaded.update(0).every(leg=>leg.kneeFlex>.17));
});

test('the seated knee hinges at fixed lengths through the full pose and keeps cloth, cuffs and paws connected',()=>{
 const recipe=generateFirstPerson(design()),state={mode:'parakite'},grips=[controlGrip(state,1),controlGrip(state,-1)];
 const rest=firstPersonPose(recipe,state,grips);
 const get=(pose,name)=>pose.parts.find(part=>part.id===name);
 assert.ok(rest.legJoints.every(j=>j.flexion>.5&&j.flexion<.7));
 for(const [lean,lateral] of [[-1,-24],[0,0],[1,24]])for(const forward of [-24,0,24])for(const vertical of [-24,0,24]){
  const legs=createSeatedLegSwing();
  for(let i=0;i<24;i++)legs.update(1/30,{lean,lateral,vertical,forward,headwind:30});
  const pose=firstPersonPose(recipe,state,grips,0,{legSwing:legs.update(0)});
  for(const [i,side] of ['left','right'].entries()){
   const {hip,knee,ankle,flexion}=pose.legJoints[i];
   assert.deepEqual(hip,rest.legJoints[i].hip);
   assert.ok(Math.abs(gap(hip,knee)-.439)<1e-10);
   assert.ok(Math.abs(gap(knee,ankle)-.453)<1e-10);
   assert.ok(flexion>=.20&&flexion<=1.25);
   const cloth=get(pose,side+'_hakama').surface;
   const centre=row=>[0,1,2].map(axis=>{
    let sum=0;
    for(let col=0;col<20;col++)sum+=cloth.positions[(row*21+col)*3+axis];
    return sum/20;
   });
   assert.ok(gap(centre(8),knee)<.01);
   assert.ok(Math.abs(gap(centre(16),ankle)-.453*.11)<.01);
   assert.ok(cloth.normals.every(Number.isFinite));
   const foot=get(pose,side+'_foot');
   for(const toe of pose.parts.filter(part=>part.id.startsWith(side+'_toe_'))){
    assert.deepEqual(toe.quaternion,foot.quaternion);
    assert.deepEqual(toe.patternOrigin,ankle);
   }
   assert.deepEqual(get(pose,side+'_grip_bar'),get(rest,side+'_grip_bar'));
  }
 }
});

test('the browser uses pilot-local acceleration and discards pre-reset momentum',async()=>{
 const body=createFirstPersonFlight(config);
 await body.request(design());
 const state={mode:'parakite'},matrix=new T.Matrix4().makeRotationY(Math.PI/2);
 const grips=[1,-1].map(side=>new T.Vector3(...controlGrip(state,side)).applyMatrix4(matrix));
 const coat=firstPersonPose(generateFirstPerson(design()),state,[controlGrip(state,1),controlGrip(state,-1)])
  .parts.filter(part=>part.material==='coat');
 const index=coat.findIndex(part=>part.id==='left_foot');
 const paw=()=>{
  const mesh=body.group.getObjectByName('fp_coat_0'),transform=new T.Matrix4();
  mesh.getMatrixAt(index,transform);
  return transform.elements.slice(12,15);
 };
 const update=(vx,wx,reset=false)=>body.update({active:true,view:'first',pilotMatrix:matrix,state,grips,
  velocity:[vx,0,0],air:{wx},dt:1/60,reset});
 update(20,20);
 const rest=paw();
 for(let i=1;i<=30;i++){
  const velocity=20-8*i/60;
  update(velocity,velocity);
 }
 const braked=paw();
 assert.ok(braked[2]>rest[2]+.045&&braked[1]>rest[1]+.06);
 update(-20,-20,true);
 assert.deepEqual(paw(),rest);
 body.dispose();
});

test('forearm and paw fringes follow their selected coat parts through brake travel',async()=>{
 const body=createFirstPersonFlight(config);
 await body.request(design());
 const recipe=generateFirstPerson(design());
 const coat=body.group.getObjectByName('fp_coat_0'),fur=body.group.getObjectByName('fp_coat_1');
 assert.equal(fur.count,2);
 const toes=body.group.getObjectByName('fp_coat_2');
 assert.equal(toes.count,8);
 const transform=new T.Matrix4(),base=new T.Matrix4();
 for(const mode of ['parakite','paraglider','paramotor'])for(const pull of [0,.5,1]){
  const state={mode,handleLeft:pull,handleRight:1-pull,brakeLeft:pull,brakeRight:1-pull};
  const local=[1,-1].map(side=>controlGrip(state,side));
  const grips=local.map(point=>new T.Vector3(...point));
  body.update({active:true,view:'first',state,grips,pilotMatrix:new T.Matrix4(),dt:1/60});
  const parts=firstPersonPose(recipe,state,local).parts.filter(p=>p.material==='coat');
  for(const [i,name] of ['left_forearm','right_forearm'].entries()){
   const j=parts.findIndex(p=>p.id===name);
   fur.getMatrixAt(i,transform);coat.getMatrixAt(j,base);
   assert.deepEqual(transform.elements,base.elements);
   assert.ok(transform.elements[0]*(i===0?-1:1)>0);
   assert.equal(coat.geometry.attributes.closePart.getX(j),2);
   const palm=parts.findIndex(p=>p.id===name.replace('_forearm','_palm'));
   const bandAt=(mesh,index)=>new T.Vector4().fromBufferAttribute(mesh.geometry.attributes.closeBands,index);
   const forearmBand=bandAt(coat,j);
   assert.ok(forearmBand.length()>1);
   assert.deepEqual(bandAt(coat,palm),forearmBand);
   assert.deepEqual(bandAt(fur,i),forearmBand);
   const [x,y,z,w]=forearmBand.toArray();
   const axis=new T.Vector3(x,y,z),origin=new T.Vector3(...parts[j].patternOrigin);
   const along=point=>point.applyMatrix4(base).sub(origin).dot(axis)+w;
   assert.ok(Math.abs(along(new T.Vector3()))<1e-5);
   assert.ok(Math.abs(along(new T.Vector3(0,1,0))-1)<1e-5);

  }
 }
 const roots=fur.geometry.attributes.position,fibres=fur.geometry.attributes.closeFibre;
 let tuftCount=0,start=0;
 for(let i=0;i<roots.count;i++){
  if(fibres.getX(i)!==1)continue;
  const root=new T.Vector3().fromBufferAttribute(roots,start);
  assert.ok(root.length()<=1&&root.length()>.9);
  assert.ok(root.x>Math.abs(root.z)*.62&&Math.abs(root.y)<.93);
  assert.deepEqual(new T.Vector3().fromBufferAttribute(roots,i),root);
  assert.equal(fibres.getX(start),0);
  assert.equal(fibres.getY(i),0);
  assert.equal(i-start,2);
  start=i+1;
  tuftCount++;
 }
 assert.equal(start,roots.count);
 assert.equal(tuftCount,480);
 const toeRoots=toes.geometry.attributes.position;
 assert.ok(toes.geometry.index.count>0);
 for(let i=0;i<toeRoots.count;i++){
  const x=toeRoots.getX(i),y=toeRoots.getY(i),z=toeRoots.getZ(i);
  assert.ok(y>-.34&&y<.48&&z>-.60);
  // A root can lie between two sampled vertices at a rim corner.
  assert.ok(Math.abs(x)>.60||z>.69);
 }
 assert.ok(body.stats.triangles<30000);
 body.dispose();
});

test('fur roots interpolate the same displacement as their coat triangle',()=>{
 const triangle={indices:[0,1,2],positions:[1,0,0,.8,.4,.2,.85,-.2,.3],relief:[.2,0,0,.16,.04,.06,.17,-.02,.09]};
 const fur=forearmFringe(triangle);
 for(let i=0;i<fur.positions.length;i+=3){
  assert.ok(Math.abs(fur.relief[i]-.2*fur.positions[i])<1e-12);
  assert.ok(Math.abs(fur.relief[i+1]-.1*fur.positions[i+1])<1e-12);
  assert.ok(Math.abs(fur.relief[i+2]-.3*fur.positions[i+2])<1e-12);
 }
});

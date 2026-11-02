import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {controlGrip,SOURCE_GRIP} from '../../../shared/geometry/flight/contacts.js';

const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const config=read('../../../shared/activities/flight.json'),player=read('../../../shared/characters/player.json');
const assets=Object.fromEntries([config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset].map(p=>
  [p,parseGLB(readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url)))]));

for(const hz of [60,144])for(const mode of Object.keys(config.modes))for(const scale of [1,.52])test(`${mode}, scale ${scale}: hip equipment follows suspension every ${hz} Hz render between cloth ticks`,()=>{
  const rig=createFlightRig(assets,config),wing=rig.wings[mode==='parakite'?'parakite':'paraglider'];
  const state={mode,pressure:1,grounded:false,coupled:{lineSlackM:0}};
  const anchor=new T.Vector3().fromArray(player.flight_attachment.position_m),matrix=new T.Matrix4();
  const view={pilotScale:scale,pilotAttachment:anchor.toArray(),pilotTransform:matrix};
  try{
    rig.update(.1,state,view);
    const full=wing.indices.findIndex((point,i)=>wing.coupledFit[point]===1&&!wing.controlFit[point]&&wing.rest[i*3+1]<1.3);
    assert.ok(full>=0,'exercise a real fully fitted harness vertex');
    const rest=new T.Vector3().fromArray(wing.rest,full*3),actual=new T.Vector3(),expected=new T.Vector3();
    let worst=0;
    for(let frame=1;frame<=hz;frame++){
      const t=frame/hz;
      matrix.compose(new T.Vector3(.18*Math.sin(t*6),.08*Math.sin(t*4),0),
        new T.Quaternion().setFromEuler(new T.Euler(.12*Math.sin(t*5),0,.1*Math.sin(t*6))),new T.Vector3(1,1,1));
      rig.update(1/hz,state,view);
      actual.fromBufferAttribute(wing.mesh.geometry.attributes.position,full);expected.copy(rest).sub(anchor).multiplyScalar(scale).add(anchor).applyMatrix4(matrix);
      worst=Math.max(worst,actual.distanceTo(expected));
    }
    assert.ok(worst<2e-6,`harness detached from current physical transform by ${worst.toFixed(5)} m`);
  }finally{rig.dispose();}
});

test('full cloth/normal work retains its 30 Hz budget while equipment normals follow each render',()=>{
  const rig=createFlightRig(assets,config),w=rig.wings.paraglider,state={mode:'paramotor',pressure:1,grounded:false,coupled:{lineSlackM:0}};
  const matrix=new T.Matrix4(),view={pilotAttachment:player.flight_attachment.position_m,pilotTransform:matrix};
  const geometry=w.mesh.geometry,compute=geometry.computeVertexNormals.bind(geometry);let fullNormals=0;
  geometry.computeVertexNormals=()=>{fullNormals++;return compute();};
  try{
    rig.update(.1,state,view);
    const triangle=w.attachmentTriangles.find(i=>[0,1,2].every(k=>w.coupledFit[w.indices[i+k]]===1&&w.rest[(i+k)*3+1]<1.3)&&new T.Vector3().fromBufferAttribute(geometry.attributes.normal,i).length()>.9);
    assert.ok(triangle!==undefined,'use a real fully fitted harness face');
    const original=new T.Vector3().fromBufferAttribute(geometry.attributes.normal,triangle),rotation=new T.Quaternion();
    for(let frame=1;frame<=144;frame++){
      rotation.setFromEuler(new T.Euler(.18*Math.sin(frame/30),0,.14*Math.sin(frame/24)));
      matrix.compose(new T.Vector3(.1*Math.sin(frame/19),0,0),rotation,new T.Vector3(1,1,1));
      rig.update(1/144,state,view);
      const expected=original.clone().applyQuaternion(rotation),actual=new T.Vector3().fromBufferAttribute(geometry.attributes.normal,triangle);
      assert.ok(actual.distanceTo(expected)<2e-5,'harness face lighting follows its current rigid transform');
    }
    assert.ok(fullNormals>=30&&fullNormals<=32,`whole-cloth normals ran ${fullNormals} times for 144 display frames`);
  }finally{rig.dispose();}
});

test('between cloth ticks only attachments move and pending complete uploads remain queued',()=>{
  const rig=createFlightRig(assets,config),w=rig.wings.paraglider,state={mode:'paraglider',pressure:1,grounded:false,coupled:{lineSlackM:0}};
  const view={pilotTransform:new T.Matrix4(),pilotAttachment:player.flight_attachment.position_m};
  try{
    rig.update(.1,state,view);
    const p=w.mesh.geometry.attributes.position,n=w.mesh.geometry.attributes.normal,upper=w.indices.findIndex((point,i)=>!w.coupledFit[point]&&w.rest[i*3+1]>3.6);
    const before=new T.Vector3().fromBufferAttribute(p,upper),normal=new T.Vector3().fromBufferAttribute(n,upper);
    view.pilotTransform.makeTranslation(.3,0,0);state.brakeLeft=1;
    rig.update(1/144,state,view);
    assert.ok(new T.Vector3().fromBufferAttribute(p,upper).equals(before),'upper sail is still cached between 30 Hz ticks');
    assert.ok(new T.Vector3().fromBufferAttribute(n,upper).equals(normal),'upper sail normals are cached too');
    for(const attr of [p,n])assert.ok(attr.updateRanges.some(r=>r.start===0&&r.count===attr.array.length),'partial equipment upload cannot discard an unconsumed complete-cloth update');
    // Simulate the renderer consuming those uploads, then check a gear-only
    // update stays inside the lower part of the actual merged vertex stream.
    p.clearUpdateRanges();n.clearUpdateRanges();view.pilotTransform.makeTranslation(.4,0,0);
    rig.update(1/144,state,view);
    for(const attr of [p,n]){
      assert.equal(attr.updateRanges.length,1);
      assert.ok(attr.updateRanges[0].start>attr.array.length*.5);
      assert.ok(attr.updateRanges[0].count<attr.array.length*.25);
    }
  }finally{rig.dispose();}
});

test('mode, grounded, collapsed and harness transitions invalidate cloth immediately',()=>{
  const rig=createFlightRig(assets,config),state={mode:'paraglider',pressure:1,grounded:false};
  const counts={paraglider:0,parakite:0};
  for(const [name,w] of Object.entries(rig.wings)){
    const compute=w.mesh.geometry.computeVertexNormals.bind(w.mesh.geometry);
    w.mesh.geometry.computeVertexNormals=()=>{counts[name]++;return compute();};
  }
  try{
    rig.update(.1,state);
    for(const mode of ['parakite','paraglider','paramotor']){
      const name=mode==='parakite'?'parakite':'paraglider',before=counts[name];state.mode=mode;rig.update(0,state);
      assert.equal(counts[name],before+1,'mode changes rebuild even inside the same cloth tick');
    }
    for(const flags of [{grounded:true},{grounded:false,collapsed:true},{collapsed:false,harnessed:false},{harnessed:true}]){
      const before=counts.paraglider;Object.assign(state,flags);rig.update(0,state);
      assert.equal(counts.paraglider,before+1,'contact and hook transitions do not reuse stale cloth state');
    }
  }finally{rig.dispose();}
});

test('grip endpoints and brake-line vertices share control travel through pilot fit and suspension transforms',()=>{
 const rig=createFlightRig(assets,config),anchor=new T.Vector3().fromArray(player.flight_attachment.position_m),transform=new T.Matrix4();
 try{for(const mode of Object.keys(config.modes))for(const scale of [1,.52])for(const pull of [0,.45,1]){
  const state={mode,handleLeft:pull,handleRight:1-pull,brakeLeft:pull,brakeRight:1-pull,coupled:{lineSlackM:0}};
  transform.compose(new T.Vector3(.1,.07,-.13),new T.Quaternion().setFromEuler(new T.Euler(.12,0,.2)),new T.Vector3(1,1,1));
  rig.update(.01,state,{pilotScale:scale,pilotAttachment:anchor.toArray(),pilotTransform:transform});
  const w=rig.wings[mode==='parakite'?'parakite':'paraglider'];
  for(const side of [1,-1]){
   const grip=controlGrip(state,side),expected=new T.Vector3(...grip).sub(anchor).multiplyScalar(scale).add(anchor).applyMatrix4(transform);
   assert.ok(rig.getGripWorld(side).distanceTo(expected)<1e-8);
   const vertex=w.indices.findIndex((point,i)=>w.controlFit[point]===1&&Math.sign(w.rest[i*3])===side);assert.ok(vertex>=0);
   const rest=new T.Vector3().fromArray(w.rest,vertex*3).add(new T.Vector3(grip[0]-side*SOURCE_GRIP[0],grip[1]-SOURCE_GRIP[1],grip[2]-SOURCE_GRIP[2])).sub(anchor).multiplyScalar(scale).add(anchor).applyMatrix4(transform);
   assert.ok(new T.Vector3().fromBufferAttribute(w.mesh.geometry.attributes.position,vertex).distanceTo(rest)<2e-6);
  }
 }}finally{rig.dispose();}
});

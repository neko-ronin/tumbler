import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {launchFlight} from '../../../shared/activities/flight.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const assets=Object.fromEntries([config.wing_asset,config.motor_asset,config.modes.parakite.wing_asset].map(path=>[path,parseGLB(readFileSync(new URL('../../../shared/geometry/'+path,import.meta.url)))]));

for(const name of ['paraglider','parakite']){
 test(`${name}: looking upward inside an open intake sees cloth instead of the sky`,()=>{
  const rig=createFlightRig(assets,config);
  try{
   const mode=config.modes[name],mesh=rig.wings[name].mesh;
   mesh.updateMatrixWorld(true);
   // Inside a central cell, behind its open mouth.
   const origin=new T.Vector3(mode.span_m/72,mode.canopy_height_m-.02,mode.chord_m*.33);
   const hit=new T.Raycaster(origin,new T.Vector3(0,1,0),0,mode.chord_m).intersectObject(mesh)[0];
   assert.ok(hit,'upper fabric disappears when viewed from inside the intake');
   assert.ok(hit.distance<mode.chord_m*.2,'ray must stop at the cell roof');
   const outward=new T.Raycaster(origin,new T.Vector3(0,0,1),0,mode.chord_m).intersectObject(mesh);
   assert.equal(outward.length,0,'the intake must stay open, without an opaque front cap');
   const inward=new T.Raycaster(origin,new T.Vector3(0,0,-1),0,mode.chord_m).intersectObject(mesh)[0];
   assert.ok(inward,'the cell has a closed tapered rear');
   assert.ok(inward.distance>mode.chord_m*.35,'the chamber extends beyond a shallow intake backstop');
  }finally{rig.dispose();}
 });
 test(`${name}: inner skin stays visible across port and starboard cells under independent pulls`,()=>{
  const rig=createFlightRig(assets,config),mesh=rig.wings[name].mesh;
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),normal=new T.Vector3(),centre=new T.Vector3();
  const ray=new T.Raycaster();ray.far=.025;
  try{
   for(const side of ['brakeLeft','brakeRight']){
    rig.update(.1,{...launchFlight(config,name,{xy_m:[0,0],heading_deg:0},()=>0),[side]:1,bank:side==='brakeLeft'?-.7:.7,pressure:.65});
    mesh.updateMatrixWorld(true);
    const w=rig.wings[name],p=mesh.geometry.attributes.position;
    let offset=0,checked=0;
    for(const primitive of assets[config.modes[name].wing_asset??config.wing_asset].primitives){
     const count=primitive.geometry.index?.count??primitive.geometry.attributes.position.count;
     if(/^(upper|lower)_/.test(primitive.materialName))for(let i=offset;i<offset+count;i+=45){
      // Visible bay interiors near the nose, on both sides of the span.
      if(Math.abs(w.rest[i*3])>config.modes[name].span_m*.4||w.rest[i*3+2]<0)continue;
      a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
      T.Triangle.getNormal(a,b,c,normal);if(normal.lengthSq()<.99)continue;
      centre.copy(a).add(b).add(c).multiplyScalar(1/3);
      ray.set(centre.clone().addScaledVector(normal,-.015),normal);
      assert.ok(ray.intersectObject(mesh)[0]?.distance<.02,`${side}: inside skin at ${centre.toArray()} disappears`);
      checked++;
     }
     offset+=count;
    }
    assert.ok(checked>0,'exercise actual deformed fabric triangles');
   }
  }finally{rig.dispose();}
 });
}

test('new cross-port rib vertices remain inside the sewn skin envelope',()=>{
 for(const name of ['paraglider','parakite']){
  const source=assets[config.modes[name].wing_asset??config.wing_asset].primitives;
  const skins=source.filter(p=>/^(upper|lower)_/.test(p.materialName)).map(p=>new T.Mesh(p.geometry,new T.MeshBasicMaterial({side:T.DoubleSide})));
  const positions=source.find(p=>p.materialName==='ribs_baffles').geometry.attributes.position;
  const ray=new T.Raycaster();let checked=0;
  try{
   for(let i=0;i<positions.count;i++){
    const x=positions.getX(i),y=positions.getY(i),z=positions.getZ(i);
    const t=.52-z/config.modes[name].chord_m;
    if(Math.abs(x)>.001||t<.339||t>.611)continue;
    ray.set(new T.Vector3(x,config.modes[name].canopy_height_m+1,z),new T.Vector3(0,-1,0));
    const hits=ray.intersectObjects(skins).map(h=>h.point.y);
    assert.ok(hits.length,'rib is enclosed by the real upper/lower skin');
    assert.ok(y<=Math.max(...hits)+.0001&&y>=Math.min(...hits)-.0001,`${name}: rib at ${[x,y,z]} protrudes through the skin`);
    checked++;
   }
   assert.ok(checked>0);
  }finally{for(const mesh of skins)mesh.material.dispose();}
 }
});

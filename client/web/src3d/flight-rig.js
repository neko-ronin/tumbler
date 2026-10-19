/** Browser cloth presentation of the core's inflated rest shape. A bounded
 * deformation, not a cloth solver: brakes/load flex the sail and its line ends.
 */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
import {applyCanopyLighting} from './canopy-light.js';

// One continuous field, evaluated once for every welded rest-space point.
// A smooth blend through the centre replaces the discontinuous x<0 selector.
function deform(x,y,z,mode,state,inflation,clock,out){
  if(y<1.3)return out.set(x,y,z);
  const half=mode.span_m*.5,depth=mode.chord_m,span=x/half;
  const across=T.MathUtils.smoothstep(span,-.65,.65);
  const brake=T.MathUtils.lerp(state.brakeLeft??0,state.brakeRight??0,across);
  const handle=T.MathUtils.lerp(state.handleLeft??.45,state.handleRight??.45,across);
  const weight=T.MathUtils.smoothstep(y,1.3,3.6);
  const trailing=T.MathUtils.smoothstep(-z/depth,-.05,.45);
  const pull=brake*trailing*.52;
  const chord=depth*(1-.42*Math.min(1,span*span));
  const t=T.MathUtils.clamp(.52-(z+span*span*depth*.23)/chord,0,1);
  const centre=mode.canopy_height_m-mode.arc_m*span*span+chord*.055*Math.sin(Math.PI*t);
  const skin=T.MathUtils.smoothstep(y,2.8,3.6);
  const pressure=state.pressure??1,bank=state.bank??0;
  const incidence=state.mode==='parakite'?(handle-.45)*z*.16:0;
  const sideLoad=span*bank;
  const outside=state.mode==='parakite'?(Math.hypot(sideLoad,.03)-sideLoad-.03)*.11:0;
  const ripple=Math.sin(x*13+z*7+clock*15)*.004*(1+Math.abs(state.turbulence??0))*(1-pressure*.5);
  const flex=span*span*(Math.abs(bank)*.12+(1-pressure)*.35);
  const py=y+weight*(ripple-pull-flex+outside+incidence+(y-centre)*(pressure-1)*.45*skin+(state.rollRate??0)*span*.08);
  const pz=z+weight*((state.accelerator??0)*(y-3)*.1+pull*.22);
  const drop=1-inflation;
  // Reduced cloth shape: lower the centre first, lose cell volume, and let
  // broad folds settle aft. Common coordinates keep ribs and cascades attached.
  const sag=drop*drop*(3-2*drop);
  const fold=Math.sin(x*2.3+z*2.1)*Math.sin(x*.7-z*1.4);
  const clothY=.055+.16*fold*fold+(y-centre)*.025;
  out.set(x+weight*sag*.13*Math.sin(x*2+z),
    T.MathUtils.lerp(py,clothY,weight*sag),
    pz-weight*sag*(3.4+.25*Math.cos(x*.8)));
  return out;
}

function clothPoints(geometry){
  const rest=geometry.attributes.position.array.slice(),map=new Map(),points=[],indices=[];
  for(let i=0;i<rest.length;i+=3){
    const key=[rest[i],rest[i+1],rest[i+2]].map(v=>Math.round(v*1e5)).join(',');
    let index=map.get(key);
    if(index===undefined){index=points.length;map.set(key,index);points.push(new T.Vector3(rest[i],rest[i+1],rest[i+2]));}
    indices.push(index);
  }
  return {rest,points,indices:Uint32Array.from(indices),moved:new Float32Array(points.length*3)};
}

// Average only sewn skin normals; keep ribs, intake walls and line edges crisp.
function smoothSkinGroups(primitives,rest){
  let offset=0;const groups=new Map();
  for(const p of primitives.filter(p=>p.alphaMode==='OPAQUE')){
    const count=p.geometry.index?.count??p.geometry.attributes.position.count;
    if(/^(upper|lower)_/.test(p.materialName))for(let i=offset;i<offset+count;i++){
      const key=[...rest.slice(i*3,i*3+3)].map(v=>Math.round(v*1e5)).join(',')+p.materialName.split('_')[0];
      if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);
    }
    offset+=count;
  }
  return [...groups.values()];
}
// A parked canopy keeps its cloth draw but releases the equipment that would
// otherwise obscure a standing pilot. Reuse the same vertex/deformation data;
// switching the draw index also keeps depth and sun-shadow passes consistent.
function releasedDrawIndex(primitives){
  let offset=0;const indices=[];
  for(const primitive of primitives.filter(p=>p.alphaMode==='OPAQUE')){
    const count=primitive.geometry.index?.count??primitive.geometry.attributes.position.count;
    if(!/^(harness|webbing_risers|maillons|suspension_cascade|brake_fan)$/.test(primitive.materialName))
      for(let i=0;i<count;i++)indices.push(offset+i);
    offset+=count;
  }
  return new T.BufferAttribute(Uint32Array.from(indices),1);
}
export function createFlightRig(assets,config){
  const group=new T.Group();group.name='player_parafoil';group.rotation.order='YXZ';group.visible=false;
  const wings={};
  for(const name of ['paraglider','parakite']){
    const primitives=assets[config.modes[name].wing_asset??config.wing_asset].primitives;
    const data=mergePrimitives(primitives,'opaque');
    applyCanopyLighting(data.material);
    const mesh=new T.Mesh(data.geometry,data.material);mesh.name=`${name}_fabric`;
    mesh.castShadow=true;mesh.frustumCulled=false;
    const cloth=clothPoints(mesh.geometry);
    wings[name]={mesh,...cloth,smooth:smoothSkinGroups(primitives,cloth.rest),inflation:1,attachedIndex:mesh.geometry.index,releasedIndex:releasedDrawIndex(primitives)};group.add(mesh);
  }
  const source=assets[config.motor_asset].primitives;
  const cage=mergePrimitives(source.filter(p=>p.materialName!=='propeller'),'opaque');
  const motor=new T.Group();motor.position.set(0,.95,-.7);group.add(motor);
  motor.add(new T.Mesh(cage.geometry,cage.material));
  const blade=mergePrimitives(source.filter(p=>p.materialName==='propeller'),'opaque');
  const prop=new T.Mesh(blade.geometry,blade.material);motor.add(prop);
  let clock=0,last=-1,elapsed=0;
  const point=new T.Vector3(),normal=new T.Vector3();
  /** Optional presentation input: localAir is the shared air vector rotated
   * into rig axes (+Z forward); groundAt(x,z) returns local floor Y. Without
   * it, landed air is still, harnessed reads presentation then state and defaults true; floor Y is zero.
   * No lift/locomotion is awarded by this visual inflation approximation.
   */
  function update(dt,state,presentation={}){
    const harnessed=presentation.harnessed??state.harnessed??true;
    clock+=dt;motor.visible=state.mode==='paramotor'&&harnessed;
    elapsed+=dt;
    prop.rotation.z+=dt*(12+(state.engine??0)*150);
    const name=state.mode==='parakite'?'parakite':'paraglider';
    for(const [key,w] of Object.entries(wings)){
      w.mesh.visible=key===name;
      const index=harnessed?w.attachedIndex:w.releasedIndex;
      if(w.mesh.geometry.index!==index)w.mesh.geometry.setIndex(index);
    }
    // Cloth work has a fixed 30 Hz budget independent of display refresh.
    const tick=Math.floor(clock*30);if(tick===last)return;last=tick;
    const w=wings[name],{mesh,points,indices,moved}=w,positions=mesh.geometry.attributes.position;
    const grounded=presentation.grounded??state.grounded??false;
    const air=presentation.localAir;
    const feed=air?Math.max(0,-air.z):0;
    const target=grounded?(!harnessed?0:T.MathUtils.smoothstep(feed,1.5,5.5)*(1-Math.max(state.brakeLeft??0,state.brakeRight??0)*.75)):1;
    w.inflation+=(target-w.inflation)*(1-Math.exp(-elapsed*(target>w.inflation?1.5:1.05)));
    elapsed=0;
    // Sample a small floor lattice, then interpolate it for all skin/line
    // points. This bounds terrain reads independently of asset tessellation.
    const floors=[],cols=17,rows=9,half=config.modes[name].span_m*.5+.5;
    if(grounded&&presentation.groundAt)for(let row=0;row<rows;row++)for(let col=0;col<cols;col++)floors.push(presentation.groundAt(-half+col*half*2/(cols-1),-6+row*9/(rows-1))+.025);
    const floorAt=(x,z)=>{
      if(!floors.length)return .025;
      const a=T.MathUtils.clamp((x+half)/(half*2)*(cols-1),0,cols-1.000001),b=T.MathUtils.clamp((z+6)/9*(rows-1),0,rows-1.000001);
      const ix=Math.floor(a),iz=Math.floor(b),i=iz*cols+ix;
      return T.MathUtils.lerp(T.MathUtils.lerp(floors[i],floors[i+1],a-ix),T.MathUtils.lerp(floors[i+cols],floors[i+cols+1],a-ix),b-iz);
    };
    const slopeX=grounded?floorAt(.5,-3)-floorAt(-.5,-3):0;
    const slopeZ=grounded?floorAt(0,-2.5)-floorAt(0,-3.5):0;
    const slope2=slopeX*slopeX+slopeZ*slopeZ;
    for(let i=0;i<points.length;i++){
      const p=points[i];
      deform(p.x,p.y,p.z,config.modes[name],state,w.inflation,clock,point);
      if(grounded&&p.y>=1.3){
        const drop=1-w.inflation,sag=T.MathUtils.smoothstep(p.y,1.3,3.6)*drop*drop*(3-2*drop);
        // Preserve approximate cloth length on a hillside: compress the
        // horizontal component along its gradient before projecting to it.
        // Merely lifting an unchanged footprint stretches it up steep faces.
        if(slope2>.0001){
          const along=(point.x*slopeX+(point.z+3.4)*slopeZ)/slope2;
          const fold=along*(1-1/Math.sqrt(1+slope2))*sag;
          point.x-=slopeX*fold;point.z-=slopeZ*fold;
        }
        const floor=floorAt(point.x,point.z);
        point.y+=floor*sag;
        point.y=Math.max(point.y,floor);
      }
      moved[i*3]=point.x;moved[i*3+1]=point.y;moved[i*3+2]=point.z;
    }
    for(let i=0;i<positions.count;i++){
      const n=indices[i]*3;positions.setXYZ(i,moved[n],moved[n+1],moved[n+2]);
    }
    positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
    const normals=mesh.geometry.attributes.normal;
    for(const ids of w.smooth){
      normal.set(0,0,0);for(const i of ids)normal.add(point.fromBufferAttribute(normals,i));normal.normalize();
      for(const i of ids)normals.setXYZ(i,normal.x,normal.y,normal.z);
    }
    normals.needsUpdate=true;
  }
  return {group,wings,motor,prop,update,dispose(){group.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});}};
}

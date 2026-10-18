/** Browser cloth presentation of the core's inflated rest shape. A bounded
 * deformation, not a cloth solver: brakes/load flex the sail and its line ends.
 */
import * as T from '../vendor/three.module.min.js';
import {mergePrimitives} from './glb.js';
export function createFlightRig(assets,config){
  const group=new T.Group();group.name='player_parafoil';group.rotation.order='YXZ';group.visible=false;
  const wings={};
  for(const name of ['paraglider','parakite']){
    const data=mergePrimitives(assets[config.modes[name].wing_asset??config.wing_asset].primitives,'opaque');
    const previous=data.material.onBeforeCompile;
    data.material.onBeforeCompile=shader=>{
      previous(shader);
      shader.vertexShader='varying vec3 vCloth;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvCloth=position;');
      shader.fragmentShader='varying vec3 vCloth;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
        float sail=smoothstep(2.6,3.1,vCloth.y);
        float weave=(sin(vCloth.x*240.)*sin(vCloth.z*240.))*.025;
        float detail=1.-smoothstep(.008,.035,max(length(dFdx(vCloth)),length(dFdy(vCloth))));
        float through=pow(max(0.,dot(normalize(vPlace-cameraPosition),uSun)),3.);
        outgoingLight*=1.+weave*detail*sail;
        outgoingLight+=diffuseColor.rgb*vec3(1.,.86,.63)*through*.2*sail;
        #include <opaque_fragment>`);
    };
    data.material.customProgramCacheKey=()=> 'flight-cloth-v1';
    const mesh=new T.Mesh(data.geometry,data.material);mesh.name=`${name}_fabric`;
    mesh.castShadow=true;mesh.frustumCulled=false;
    const rest=mesh.geometry.attributes.position.array.slice();
    wings[name]={mesh,rest};group.add(mesh);
  }
  const source=assets[config.motor_asset].primitives;
  const cage=mergePrimitives(source.filter(p=>p.materialName!=='propeller'),'opaque');
  const motor=new T.Group();motor.position.set(0,.95,-.7);group.add(motor);
  motor.add(new T.Mesh(cage.geometry,cage.material));
  const blade=mergePrimitives(source.filter(p=>p.materialName==='propeller'),'opaque');
  const prop=new T.Mesh(blade.geometry,blade.material);motor.add(prop);
  let clock=0,last=-1;
  function update(dt,state){
    clock+=dt;motor.visible=state.mode==='paramotor';
    prop.rotation.z+=dt*(12+(state.engine??0)*150);
    const name=state.mode==='parakite'?'parakite':'paraglider';
    for(const [key,w] of Object.entries(wings))w.mesh.visible=key===name;
    // Cloth work has a fixed 30 Hz budget independent of display refresh.
    const tick=Math.floor(clock*30);if(tick===last)return;last=tick;
    const {mesh,rest}=wings[name],positions=mesh.geometry.attributes.position;
    const half=config.modes[name].span_m*.5,depth=config.modes[name].chord_m;
    for(let i=0;i<positions.count;i++){
      const n=i*3,x=rest[n],y=rest[n+1],z=rest[n+2];
      if(y<1.3){positions.setXYZ(i,x,y,z);continue;}
      const span=x/half,weight=Math.min(1,Math.max(0,(y-1.3)/2.3));
      const brake=x<0?state.brakeLeft:state.brakeRight;
      const handle=x<0?state.handleLeft:state.handleRight;
      const trailing=T.MathUtils.smoothstep(-z/depth,-.05,.45);
      const pull=(brake??0)*trailing*.52;
      const release=state.accelerator??0;
      const outside=state.mode==='parakite'?Math.max(0,-Math.sign(x)*state.bank)*.22:0;
      const ripple=Math.sin(x*13+z*7+clock*15)*.004*(1+Math.abs(state.turbulence??0))*(1-(state.pressure??1)*.5);
      const incidence=state.mode==='parakite'?((handle??.45)-.45)*z*.16:0;
      const chord=depth*(1-.42*Math.abs(span)**2);
      const t=T.MathUtils.clamp(.52-(z+span*span*depth*.23)/chord,0,1);
      const centre=config.modes[name].canopy_height_m-config.modes[name].arc_m*span*span+chord*.055*Math.sin(Math.PI*t);
      const inflation=y>3?(y-centre)*((state.pressure??1)-1)*.45:0;
      const flex=Math.abs(span)**2*(Math.abs(state.bank)*.12+(1-(state.pressure??1))*.35);
      positions.setXYZ(i,x+Math.sin(clock*2+x)*.012*weight,
        y+weight*(ripple-pull-flex+outside+incidence+inflation+state.rollRate*span*.08),
        z+weight*(release*(y-3)*.1+pull*.22));
    }
    positions.needsUpdate=true;mesh.geometry.computeVertexNormals();
  }
  return {group,wings,motor,prop,update,dispose(){group.traverse(m=>{if(m.isMesh){m.geometry.dispose();m.material.dispose();}});}};
}

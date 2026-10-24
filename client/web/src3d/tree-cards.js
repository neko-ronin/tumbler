/** Spatial, source-derived leaf cards for the adopted redwoods. Wood remains geometry. Independent
 * leaf islands carry view-dependent captures at their real 3D positions.
 * All islands and wood share one instanced draw and one bounded atlas. */
import * as T from '../vendor/three.module.min.js';
import {style,sunShadowShader} from './style.js';
import {partitionFoliage, retainWood, BOUGH_PROFILES} from '../../../shared/geometry/tree-design/card-clusters.js';

export {BOUGH_PROFILES};
export function bakeBoughCards(renderer, source, sourceMaterial, representation, settings) {
  const profile=BOUGH_PROFILES[representation],fixed=profile.fixed;
  const count=settings.clusters??profile.clusters,sideViews=fixed?2:settings.views,views=sideViews+2;
  // Whole-tree capture settings map to smaller per-island tiles. A 512px
  // source setting means 128px for EACH island/view, not a giant forest atlas.
  const resolution={128:48,256:80,512:128}[settings.resolution];
  const indices=source.index?.array??Uint32Array.from({length:source.attributes.position.count},(_,i)=>i);
  const partition=partitionFoliage(source.attributes.position.array,indices,source.attributes.leafKind.array,count);
  const clusters=partition.clusters,total=clusters.length*views,columns=Math.max(1,Math.ceil(Math.sqrt(total))),rows=Math.max(1,Math.ceil(total/columns));
  if(Math.max(columns,rows)*resolution>renderer.capabilities.maxTextureSize)throw new Error('This card atlas exceeds the device texture limit. Reduce leaf islands or capture resolution.');
  const target=new T.WebGLRenderTarget(columns*resolution,rows*resolution,{depthBuffer:true});
  target.texture.colorSpace=T.LinearSRGBColorSpace;target.texture.generateMipmaps=true;target.texture.minFilter=T.LinearMipmapLinearFilter;
  const scene=new T.Scene(),capture=source.clone(),mesh=new T.Mesh(capture,sourceMaterial);scene.add(mesh);
  sourceMaterial.defaultAttributeValues={...sourceMaterial.defaultAttributeValues,forestInterval:[0,1]};
  scene.add(new T.HemisphereLight('#dcebf3','#7d8064',2.1));const sun=new T.DirectionalLight('#fff1d3',2.3);sun.position.copy(style.sun.value).multiplyScalar(1000);scene.add(sun);
  const camera=new T.OrthographicCamera(-1,1,1,-1,.01,2000),yawOffset=settings.bakeYaw*Math.PI/180;
  const previous={target:renderer.getRenderTarget(),viewport:renderer.getViewport(new T.Vector4()),scissor:renderer.getScissor(new T.Vector4()),scissorTest:renderer.getScissorTest(),color:renderer.getClearColor(new T.Color()),alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear};
  const started=performance.now(),cloudReady=style.cloudGroundReady.value,actorReady=style.actorShadowReady.value;style.cloudGroundReady.value=style.actorShadowReady.value=0;
  try {
    renderer.setRenderTarget(target);renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.clear();renderer.autoClear=false;renderer.setScissorTest(true);
    clusters.forEach((cluster,c)=>{
      const size=cluster.max.map((v,a)=>v-cluster.min[a]);
      // Same square framing for all directions makes UV coordinates stable.
      cluster.diameter=Math.max(.02,Math.hypot(...size)*1.04);
      capture.setIndex(new T.BufferAttribute(cluster.indices,1));capture.computeBoundingSphere();
      camera.left=camera.bottom=-cluster.diameter/2;camera.right=camera.top=cluster.diameter/2;camera.updateProjectionMatrix();
      const centre=new T.Vector3(...cluster.centre),distance=cluster.diameter+10;
      for(let v=0;v<views;v++){
        const top=v>=sideViews,below=v===sideViews+1,yaw=yawOffset+v*(fixed?Math.PI/2:Math.PI*2/sideViews);
        const dir=top?new T.Vector3(0,below?-1:1,0):new T.Vector3(Math.sin(yaw),0,Math.cos(yaw));
        camera.up.set(0,top?0:1,top?(below?1:-1):0);camera.position.copy(centre).addScaledVector(dir,distance);camera.lookAt(centre);camera.updateMatrixWorld();
        const tile=c*views+v,x=tile%columns*resolution,y=Math.floor(tile/columns)*resolution;
        renderer.setViewport(x,y,resolution,resolution);renderer.setScissor(x,y,resolution,resolution);
        renderer.clear(true,true,false);renderer.render(scene,camera);
      }
    });
  } catch(error) {target.dispose();throw error;
  } finally {
    style.cloudGroundReady.value=cloudReady;style.actorShadowReady.value=actorReady;renderer.setRenderTarget(previous.target);renderer.setViewport(previous.viewport);renderer.setScissor(previous.scissor);renderer.setScissorTest(previous.scissorTest);renderer.setClearColor(previous.color,previous.alpha);renderer.autoClear=previous.autoClear;capture.dispose();scene.remove(mesh);
  }
  const retained=retainWood(source.attributes.position.array,partition.wood,settings.woodBudget??6000);
  const pos=[],normal=[],color=[],uv=[],centres=[],info=[];
  function vertex(p,n,c,u,centre,data){pos.push(...p);normal.push(...n);color.push(...c);uv.push(...u);centres.push(...centre);info.push(...data);}
  for(const id of retained.indices){
    const read=(name,fallback)=>source.attributes[name]?[source.attributes[name].getX(id),source.attributes[name].getY(id),source.attributes[name].getZ(id)]:fallback;
    vertex(read('position',[0,0,0]),read('normal',[0,1,0]),read('color',[1,1,1]),[0,0],[0,0,0],[0,0,-1,0]);
  }
  const woodTriangles=pos.length/9;
  for(let c=0;c<clusters.length;c++){
    const cluster=clusters[c];
    // Three planes: two neighbouring side captures plus a polar capture, or
    // three fixed orthogonal cards. Angled planes preserve volume/parallax.
    for(let plane=0;plane<3;plane++)for(const corner of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]]){
      const offset=corner.map(x=>(x-.5)*cluster.diameter);
      vertex([cluster.centre[0]+offset[0],cluster.centre[1]+offset[1],cluster.centre[2]],[0,0,1],[1,1,1],corner,cluster.centre,[...offset,c*views,plane]);
    }
  }
  const geometry=new T.BufferGeometry();
  for(const [name,array,size] of [['position',pos,3],['normal',normal,3],['color',color,3],['uv',uv,2],['cardCentre',centres,3],['cardInfo',info,4]])geometry.setAttribute(name,new T.Float32BufferAttribute(array,size));
  // Dynamic card orientations can extend beyond their rest plane bounds.
  source.computeBoundingBox();geometry.boundingBox=source.boundingBox.clone();for(const cluster of clusters){const b=new T.Box3().setFromCenterAndSize(new T.Vector3(...cluster.centre),new T.Vector3().setScalar(cluster.diameter*Math.SQRT2));geometry.boundingBox.union(b);}geometry.boundingSphere=geometry.boundingBox.getBoundingSphere(new T.Sphere());
  const material=new T.MeshBasicMaterial({map:target.texture,vertexColors:true,side:T.DoubleSide,alphaTest:settings.alphaCutoff,alphaToCoverage:true,toneMapped:false,fog:true});
  material.onBeforeCompile=shader=>{
    sunShadowShader(shader);
    shader.vertexShader='varying vec3 vCardWorld;\n'+shader.vertexShader;shader.fragmentShader='varying vec3 vCardWorld;uniform vec3 uCardSun;\n'+shader.fragmentShader;shader.uniforms.uCardSun=style.sun;
    Object.assign(shader.uniforms,{uAtlas:{value:new T.Vector2(columns,rows)},uSideViews:{value:sideViews},uYaw:{value:yawOffset},uPolar:{value:new T.Vector2(settings.topStart*Math.PI/180,settings.topEnd*Math.PI/180)},uBoughSun:style.sun});
    shader.vertexShader='attribute vec3 cardCentre;attribute vec4 cardInfo;attribute vec2 forestInterval;uniform float uSideViews,uYaw;uniform vec2 uPolar;uniform vec3 uBoughSun;varying vec4 vBough;varying vec2 vInterval;varying float vWoodLight;\n'+shader.vertexShader;
    shader.fragmentShader='uniform vec2 uAtlas;varying vec4 vBough;varying vec2 vInterval;varying float vWoodLight;\n'+shader.fragmentShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vInterval=forestInterval;vBough=vec4(-1.,0.,1.,0.);vWoodLight=1.;
      vec3 placed=position;
      if(cardInfo.z>=0.){
        mat4 world=modelMatrix*instanceMatrix;
        vec3 worldCentre=(world*vec4(cardCentre,1.)).xyz;
        vec3 direction=normalize(transpose(mat3(world))*(cameraPosition-worldCentre));
        float sector=mod(atan(direction.x,direction.z)-uYaw+18.8495559215,6.28318530718)/6.28318530718*uSideViews;
        float polar=smoothstep(uPolar.x,uPolar.y,asin(clamp(abs(direction.y),0.,1.)));
        float index=0.,start=0.,end=1.;
        ${fixed?`index=cardInfo.w;`:`
          if(cardInfo.w<.5){index=floor(sector);end=(1.-fract(sector))*(1.-polar);}
          else if(cardInfo.w<1.5){index=mod(floor(sector)+1.,uSideViews);start=(1.-fract(sector))*(1.-polar);end=1.-polar;}
          else{index=uSideViews+step(direction.y,0.);start=1.-polar;}
        `}
        vec3 right,up;
        if(index<uSideViews){float yaw=uYaw+index*${fixed?'1.57079632679':'6.28318530718/uSideViews'};right=vec3(cos(yaw),0.,-sin(yaw));up=vec3(0.,1.,0.);}
        else{right=vec3(1.,0.,0.);up=vec3(0.,0.,index>uSideViews+.5?1.:-1.);}
        placed=cardCentre+right*cardInfo.x+up*cardInfo.y;
        vBough=vec4(cardInfo.z+index,start,end,1.);
      }else{
        vec3 N=normalize(mat3(modelMatrix*instanceMatrix)*normal);
        float d=dot(N,normalize(uBoughSun))*.5+.5;vWoodLight=.48+.5*(floor(d*3.)+smoothstep(.35,.65,fract(d*3.)))/3.;
      }
      vCardWorld=(modelMatrix*instanceMatrix*vec4(placed,1.)).xyz;vec4 mvPosition=modelViewMatrix*instanceMatrix*vec4(placed,1.);gl_Position=projectionMatrix*mvPosition;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
      if(vBough.w>.5){
        vec2 tile=vec2(mod(vBough.x,uAtlas.x),floor(vBough.x/uAtlas.x));
        vec2 safeUv=clamp(vMapUv,vec2(1.5/${resolution.toFixed(1)}),vec2(1.-1.5/${resolution.toFixed(1)}));
        vec4 leafSample=texture2D(map,(tile+safeUv)/uAtlas);
        // Transparent atlas texels are black. Filtering/mipmaps produce
        // coverage-weighted RGB; recover straight colour before alpha test.
        leafSample.rgb/=max(leafSample.a,.001);diffuseColor*=leafSample;
        float choice=fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189);
        if(choice<vBough.y||choice>=vBough.z)discard;
      }else diffuseColor.rgb*=vWoodLight;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight*=mix(.60,1.,cloudObjectLight(vCardWorld,uCardSun)*actorSunLight(vCardWorld));\n#include <opaque_fragment>`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`if(diffuseColor.a<alphaTest)discard;
      float threshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(threshold<vInterval.x||threshold>=vInterval.y)discard;
    `);
  };
  material.customProgramCacheKey=()=>`studio-bough-v1-${fixed}-${sideViews}-${resolution}`;
  const atlasBytes=columns*rows*resolution*resolution;
  return {geometry,material,target,views:sideViews,columns,rows,resolution,textureBytes:atlasBytes*4*4/3,
    detail:{profile:representation,clusters:clusters.length,cards:clusters.length*3,woodTriangles,woodComponents:retained.components,keptWoodComponents:retained.keptComponents,sourceLeafTriangles:clusters.reduce((n,c)=>n+c.indices.length/3,0),captureViews:views,bakeMs:performance.now()-started,depthBytes:atlasBytes*4},
    dispose(){target.dispose();geometry.dispose();material.dispose();}};
}

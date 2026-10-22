/** Source-derived forest presentation: spatial shared meshes nearby, crown
 * volumes in the middle distance and baked views across the whole stand.
 * All representations retain the core's individuals and transforms.
 */
import * as T from '../vendor/three.module.min.js';
import { instanceMatrix } from './world.js';
import { mergePrimitives } from './glb.js';
import { toonMaterial,style,sunShadowShader } from './style.js';

export function stylizedTreeGeometry(asset) {
  const foliage = asset.primitives.filter(p => /foliage/.test(p.materialName));
  if (!foliage.length) throw new Error('redwood has no foliage envelope');
  const bark = asset.primitives.find(p => /bark/.test(p.materialName));
  const barkBase=bark.geometry.boundingBox.min.y,barkPos=bark.geometry.attributes.position;
  let rootX=0,rootZ=0,roots=0;
  for(let i=0;i<barkPos.count;i++)if(barkPos.getY(i)<barkBase+.2){rootX+=barkPos.getX(i);rootZ+=barkPos.getZ(i);roots++;}
  rootX/=Math.max(1,roots);rootZ/=Math.max(1,roots);
  const box = new T.Box3();
  for (const p of foliage) box.union(p.geometry.boundingBox);
  const levels = 22, radial = 12;
  const radii = new Float32Array(levels * radial);
  const step = (box.max.y - box.min.y) / levels;
  for (const primitive of foliage) {
    const pos = primitive.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)-rootX, y = pos.getY(i), z = pos.getZ(i)-rootZ;
      const level = Math.min(levels - 1, Math.max(0, Math.floor((y - box.min.y) / step)));
      const sector = Math.min(radial - 1, Math.floor((Math.atan2(z, x) + Math.PI) / (2 * Math.PI) * radial));
      radii[level * radial + sector] = Math.max(radii[level * radial + sector], Math.hypot(x, z));
    }
  }
  const positions = [], colors = [];
  const color = new T.Color();
  const foliageColors = ['#356953', '#4a8055', '#7a9e59'].map(c => new T.Color(c));
  const tri = (a, b, c, shade) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(shade.r, shade.g, shade.b);
  };
  // A continuous lobed crown avoids the old cone's flat stacked plates.
  // Reuse indexed ring vertices so lighting normals flow around each lobe.
  const crownIndices = [];
  for (let level = 0; level < levels; level++) {
    const y = box.min.y + level / (levels - 1) * (box.max.y - box.min.y);
    color.copy(foliageColors[0]).lerp(foliageColors[2], level / (levels - 1) * .8);
    for (let sector = 0; sector < radial; sector++) {
      const angle = sector / radial * Math.PI * 2 - Math.PI;
      const lobe = .86 + .10 * Math.sin(angle * 3 + level * .85) + .04 * Math.cos(angle * 5 - level);
      const r = level === levels - 1 ? 0 : radii[level * radial + sector] * lobe * (level === 0 ? .5 : 1);
      positions.push(rootX+Math.cos(angle)*r, y + (level > 0 && level < levels-1 ? Math.sin(angle*3+level)*.45 : 0), rootZ+Math.sin(angle)*r);
      colors.push(color.r,color.g,color.b);
      if(level < levels-1){
        const a=level*radial+sector, b=level*radial+(sector+1)%radial,c=a+radial,d=b+radial;
        crownIndices.push(a,c,b,b,c,d);
      }
    }
  }
  // The central trunk uses the source's own vertical extent; the crown hull
  // express the crown instead of retaining millions of subpixel needle faces.
  const bottom = bark.geometry.boundingBox.min.y, top = Math.min(bark.geometry.boundingBox.max.y, box.max.y - .1);
  const barkPositions=bark.geometry.attributes.position;
  let baseRadius=0;
  for(let i=0;i<barkPositions.count;i++)if(barkPositions.getY(i)<bottom+(top-bottom)*.08)baseRadius=Math.max(baseRadius,Math.hypot(barkPositions.getX(i)-rootX,barkPositions.getZ(i)-rootZ));
  const barkColor = new T.Color('#946044');
  for (let i = 0; i < radial; i++) {
    const a = i / radial * Math.PI * 2, b = (i + 1) / radial * Math.PI * 2;
    const p = [rootX+Math.cos(a)*baseRadius, bottom, rootZ+Math.sin(a)*baseRadius];
    const q = [rootX+Math.cos(b)*baseRadius, bottom, rootZ+Math.sin(b)*baseRadius];
    const r = [rootX+Math.cos(a)*baseRadius*.08, top, rootZ+Math.sin(a)*baseRadius*.08];
    const s = [rootX+Math.cos(b)*baseRadius*.08, top, rootZ+Math.sin(b)*baseRadius*.08];
    tri(p, r, q, barkColor); tri(q, r, s, barkColor);
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  const trunkStart = levels * radial;
  for(let i=trunkStart;i<positions.length/3;i++) crownIndices.push(i);
  geometry.setIndex(crownIndices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return { geometry, triangles: crownIndices.length / 3, sourceBounds: box };
}

/** Bake actual shared branches into an alpha impostor, retaining the whole stand.
 * The nearby representation uses the complete shared mesh. A stable hysteresis
 * avoids repeated swaps on the boundary; neither representation moves a tree.
 */
function bakeImpostor(asset,renderer){
  const merged=mergePrimitives(asset.primitives,'opaque');
  const bounds=new T.Box3();asset.primitives.forEach(p=>bounds.union(p.geometry.boundingBox));
  const size=bounds.getSize(new T.Vector3()),centre=bounds.getCenter(new T.Vector3());
  const target=new T.WebGLRenderTarget(256,512);target.texture.colorSpace=T.SRGBColorSpace;target.texture.generateMipmaps=true;target.texture.minFilter=T.LinearMipmapLinearFilter;
  const topTarget=target.clone();topTarget.texture.colorSpace=T.SRGBColorSpace;
  const bakeMaterial=merged.material.clone();
  bakeMaterial.onBeforeCompile=merged.material.onBeforeCompile;
  bakeMaterial.customProgramCacheKey=merged.material.customProgramCacheKey;
  const scene=new T.Scene(),mesh=new T.Mesh(merged.geometry,bakeMaterial);scene.add(mesh);
  scene.add(new T.HemisphereLight('#e1edff','#535d3c',2.2));
  const light=new T.DirectionalLight('#fff6df',2);light.position.set(-20,60,35);scene.add(light);
  const width=Math.max(size.x,size.z)*1.12,height=size.y*1.02;
  const camera=new T.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,500);
  camera.position.set(centre.x,centre.y,centre.z+150);camera.lookAt(centre);
  const topCamera=new T.OrthographicCamera(-width/2,width/2,width/2,-width/2,.1,500);
  topCamera.position.set(centre.x,centre.y+150,centre.z);topCamera.up.set(0,0,-1);topCamera.lookAt(centre);
  function refresh(sunDirection){
  if(sunDirection)light.position.copy(sunDirection).multiplyScalar(100);
  const previous=renderer.getRenderTarget(),color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
  const cloudReady=style.cloudGroundReady.value,actorReady=style.actorShadowReady.value;
  style.cloudGroundReady.value=style.actorShadowReady.value=0;
  try{
   renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.render(scene,camera);
   renderer.setRenderTarget(topTarget);renderer.render(scene,topCamera);
  }finally{renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);style.cloudGroundReady.value=cloudReady;style.actorShadowReady.value=actorReady;}
  }
  refresh();
  const geometry=new T.PlaneGeometry(width,height);geometry.translate(centre.x,centre.y,centre.z);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const material=new T.MeshBasicMaterial({map:target.texture,alphaTest:.22,side:T.DoubleSide,fog:true});
  material.onBeforeCompile=shader=>{
    sunShadowShader(shader);shader.uniforms.uSun=style.sun;
    shader.vertexShader='varying vec3 vCloudPlace;\n'+shader.vertexShader;
    shader.fragmentShader='uniform vec3 uSun;varying vec3 vCloudPlace;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`outgoingLight*=mix(.60,1.,cloudObjectLight(vCloudPlace,uSun)*actorSunLight(vCloudPlace));\n#include <opaque_fragment>`);
    shader.uniforms.uTop={value:topTarget.texture};shader.uniforms.uCanopyDims={value:new T.Vector2(width,bounds.min.y+size.y*.72)};
    shader.uniforms.uTreeCentre={value:centre};
    shader.vertexShader='uniform vec2 uCanopyDims;uniform vec3 uTreeCentre;varying float vOverhead;\n'+shader.vertexShader;
    shader.fragmentShader='uniform sampler2D uTop;varying float vOverhead;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
      diffuseColor*=mix(texture2D(map,vMapUv),texture2D(uTop,vMapUv),vOverhead);
    #endif`);
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec3 scale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      vec4 origin=modelMatrix*instanceMatrix*vec4(uTreeCentre.x,0.,uTreeCentre.z,1.);
      vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
      vOverhead=smoothstep(.45,.82,normalize(cameraPosition-origin.xyz).y);
      vec3 sidePlace=origin.xyz+right*(position.x-uTreeCentre.x)*scale.x+vec3(0.,position.y*scale.y,0.);
      vec3 viewUp=normalize(vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]));
      vec3 topPlace=origin.xyz+right*(position.x-uTreeCentre.x)*scale.x+viewUp*(uv.y-.5)*uCanopyDims.x*scale.x+vec3(0.,uCanopyDims.y*scale.y,0.);
      vCloudPlace=mix(sidePlace,topPlace,vOverhead);vec4 mvPosition=viewMatrix*vec4(vCloudPlace,1.);
      gl_Position=projectionMatrix*mvPosition;
    `);
  };
  material.customProgramCacheKey=()=> 'forest-impostor-overhead-v3';
  return {geometry,material,detail:merged,target,refresh};
}
/** Vertex clustering keeps the source's branches, gaps and material colours in
 * the middle distance. The cell size grows only until the per-species budget is
 * met; a broad crown hull is reserved for invisible shadow proxies. */
export function clusteredTreeGeometry(source, maxTriangles=8000) {
  const position=source.attributes.position,normal=source.attributes.normal,color=source.attributes.color;
  const height=source.boundingBox.max.y-source.boundingBox.min.y;
  let cell=Math.max(.25,height*.008),result;
  for(let attempt=0;attempt<9;attempt++,cell*=1.3){
    const clusters=new Map(),vertices=[],remap=new Uint32Array(position.count);
    for(let i=0;i<position.count;i++){
      const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
      // Bark and foliage cannot collapse into one another at a branch joint.
      const leafy=color.getY(i)>color.getX(i)*1.1;
      const key=`${Math.floor(x/cell)},${Math.floor(y/cell)},${Math.floor(z/cell)},${+leafy}`;
      let v=clusters.get(key);
      if(v===undefined){v=vertices.length;clusters.set(key,v);vertices.push({p:[0,0,0],n:[0,0,0],c:[0,0,0,0],count:0});}
      remap[i]=v;const entry=vertices[v];entry.count++;
      entry.p[0]+=x;entry.p[1]+=y;entry.p[2]+=z;
      entry.n[0]+=normal.getX(i);entry.n[1]+=normal.getY(i);entry.n[2]+=normal.getZ(i);
      entry.c[0]+=color.getX(i);entry.c[1]+=color.getY(i);entry.c[2]+=color.getZ(i);entry.c[3]+=color.itemSize===4?color.getW(i):1;
    }
    const indices=[],seen=new Set(),count=source.index?.count??position.count;
    for(let i=0;i<count;i+=3){
      const a=remap[source.index?source.index.getX(i):i],b=remap[source.index?source.index.getX(i+1):i+1],c=remap[source.index?source.index.getX(i+2):i+2];
      if(a===b||b===c||a===c)continue;
      const key=[a,b,c].sort((a,b)=>a-b).join(',');if(seen.has(key))continue;seen.add(key);indices.push(a,b,c);
    }
    result={vertices,indices,cell};if(indices.length/3<=maxTriangles)break;
  }
  const geometry=new T.BufferGeometry(),positions=[],normals=[],colors=[];
  for(const v of result.vertices){positions.push(...v.p.map(n=>n/v.count));const length=Math.hypot(...v.n)||1;normals.push(...v.n.map(n=>n/length));colors.push(...v.c.map(n=>n/v.count));}
  geometry.setAttribute('position',new T.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new T.Float32BufferAttribute(normals,3));geometry.setAttribute('color',new T.Float32BufferAttribute(colors,4));geometry.setIndex(result.indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return {geometry,triangles:result.indices.length/3,cellM:result.cell};
}

// Surface distances are measured against transformed source bounds, including
// the whole height of giants. These values are presentation, never geography.
export function treeLodDistances(bounds, options = {}) {
  const height = bounds.max.y - bounds.min.y;
  const near = options.enterM ?? 42 + Math.min(30, height * .2);
  return {near, nearEnd: near + 22, nearLeave: Math.max(near + 34, options.leaveM ?? 0),
    mid: options.midM ?? 190 + Math.min(100, height * .65), midFade: 55};
}
export function treeLodWeights(distance, distances) {
  const smooth = (a,b,x) => {const t=T.MathUtils.clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const near = 1-smooth(distances.near,distances.nearEnd,distance);
  const far = smooth(distances.mid,distances.mid+distances.midFade,distance);
  return [near,1-near-far,far];
}
function intervalMaterial(material) {
  const original = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    original.call(material,shader);
    shader.vertexShader='attribute vec2 forestInterval; varying vec2 vForestInterval;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvForestInterval=forestInterval;');
    shader.fragmentShader='varying vec2 vForestInterval;\n'+shader.fragmentShader;
    // Complementary screen-door intervals avoid transparency sorting and holes
    // during overlap. Both representations use exactly the same threshold.
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float forestThreshold=fract(dot(floor(gl_FragCoord.xy),vec2(.754877666,.569840296)));
      if(forestThreshold<vForestInterval.x||forestThreshold>=vForestInterval.y)discard;
    `);
  };
  const key=material.customProgramCacheKey();
  material.customProgramCacheKey=()=>key+'-forest-interval-v1';
  return material;
}
function instanceGeometry(source, count) {
  // Attribute buffers are shared; only the per-batch interval is allocated.
  const geometry=new T.BufferGeometry();geometry.setIndex(source.index);
  for(const [key,value] of Object.entries(source.attributes))geometry.setAttribute(key,value);
  geometry.boundingBox=source.boundingBox;geometry.boundingSphere=source.boundingSphere;
  geometry.setAttribute('forestInterval',new T.InstancedBufferAttribute(new Float32Array(count*2),2).setUsage(T.DynamicDrawUsage));
  return geometry;
}
function sourceBounds(asset, foliage=false) {
  const box=new T.Box3();
  for(const p of asset.primitives)if(!foliage||/foliage/.test(p.materialName))box.union(p.geometry.boundingBox.clone().applyMatrix4(p.local));
  return box;
}
function placedBounds(asset, tree) {
  const box=new T.Box3(),worldSpace=tree.tags?.includes('world_space');
  for(const p of asset.primitives)box.union(p.geometry.boundingBox.clone().applyMatrix4(instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale,p.local,worldSpace)));
  return box;
}
export function buildStylizedForest(placement, assets, renderer=null, options={}) {
  const trees=placement.instances.filter(options.filter??(i=>i.asset.startsWith('redwood/')));
  // Ecology also uses the bake/instance API for rocks, reeds and bank plants.
  // Keep that existing two-representation path outside the tree-only recipe.
  if(renderer&&trees.some(t=>!assets[t.asset]?.primitives.some(p=>/bark/.test(p.materialName)))){
    return buildBakedPlantings({instances:trees},assets,renderer,{...options,filter:()=>true});
  }
  const group=new T.Group();group.name=options.name??'forest';
  const types=new Map(),batches=[],kits=[];
  for(const tree of trees){if(!types.has(tree.asset))types.set(tree.asset,[]);types.get(tree.asset).push(tree);}
  const stats={trees:trees.length,tiles:0,trianglesPerTree:0,near:0,mid:0,far:trees.length,transitioning:0,shadowProxies:0,shadowRevision:0,midTrianglesByAsset:{},
    presentation:renderer?'shared mesh / clustered source mesh / source-baked distant views':'source-envelope crown'};
  for(const [path,entries] of types){
    const asset=assets[path];if(!asset)throw new Error(`No tree source: ${path}`);
    const kit=renderer?bakeImpostor(asset,renderer):null,hull=stylizedTreeGeometry(asset);
    const middle=kit?clusteredTreeGeometry(kit.detail.geometry):hull;
    stats.midTrianglesByAsset[path]=middle.triangles;
    if(kit){kit.detail.material.side=T.DoubleSide;intervalMaterial(kit.detail.material);intervalMaterial(kit.material);kits.push(kit);}
    const hullMaterial=toonMaterial({vertexColors:true,side:T.DoubleSide},{foliage:true});
    if(kit)intervalMaterial(hullMaterial);
    stats.trianglesPerTree=kit?2:hull.triangles;
    const tiles=new Map();
    entries.forEach(tree=>{const [x,y]=tree.position_m;const key=`${Math.floor(x/(options.tileM??256))},${Math.floor(y/(options.tileM??256))}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(tree);});
    for(const [key,records] of tiles){
      const bounds=records.map(t=>placedBounds(asset,t));
      const matrices=records.map(t=>instanceMatrix(t.position_m,t.yaw_deg,t.scale,asset.primitives[0].local,t.tags?.includes('world_space')));
      // Billboards rotate in the shader, so CPU plane bounds are insufficient.
      // A sphere around every source box also covers overhead interpolation and
      // camera rotation without requiring a selection refresh on every turn.
      const sphere=new T.Sphere();bounds.forEach(b=>sphere.union(b.getBoundingSphere(new T.Sphere())));
      sphere.radius*=1.15;
      const make=(source,material,name)=>{
        const mesh=new T.InstancedMesh(kit?instanceGeometry(source,records.length):source,material,records.length);
        mesh.name=`forest_${name}_${path}_${key}`;mesh.boundingSphere=sphere.clone();mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);group.add(mesh);return mesh;
      };
      const far=make(kit?.geometry??hull.geometry,kit?.material??hullMaterial,'far');
      const near=kit?make(kit.detail.geometry,kit.detail.material,'near'):null;
      const mid=kit?make(middle.geometry,hullMaterial,'mid'):null;
      // Shadow geometry stays source-identical when visual detail changes.
      // A cheaper crown envelope here made an entire ground shadow pop at once.
      // Share vertex/index buffers; this mesh writes only to the cached sun map.
      const proxy=kit?make(kit.detail.geometry,new T.MeshBasicMaterial({side:T.DoubleSide,colorWrite:false,depthWrite:false}),'shadow'):null;
      if(near){
        near.count=mid.count=proxy.count=0;near.castShadow=near.receiveShadow=true;mid.receiveShadow=true;proxy.castShadow=true;
        // Colour/depth writes alone do not avoid vertex work in the beauty pass.
        // Geometry wrappers are per mesh, so their draw range is independent.
        proxy.onBeforeRender=()=>proxy.geometry.setDrawRange(0,0);
        proxy.onAfterRender=proxy.onBeforeShadow=()=>proxy.geometry.setDrawRange(0,Infinity);
      }
      matrices.forEach((m,i)=>{far.setMatrixAt(i,m);if(kit)far.geometry.attributes.forestInterval.setXY(i,0,1);});far.instanceMatrix.needsUpdate=true;
      batches.push({far,near,mid,proxy,records,matrices,bounds,distances:bounds.map(b=>treeLodDistances(b,options)),selected:new Uint8Array(records.length),casters:new Uint8Array(records.length)});
    }
  }
  stats.tiles=batches.length;
  const last=new T.Vector3(Infinity,Infinity,Infinity),lastAnchor=last.clone();
  function invalidateShadows(){stats.shadowRevision++;}
  function update(camera, anchor=camera.position){
    // Sub-metre updates preserve the fade while walking; first load, teleports
    // and vertical approaches always run. Rotation needs no distance refresh.
    if(camera.position.distanceToSquared(last)<.25&&anchor.distanceToSquared(lastAnchor)<4)return false;
    last.copy(camera.position);lastAnchor.copy(anchor);
    let nearTotal=0,midTotal=0,farTotal=0,transitions=0,proxies=0,changed=false;
    for(const b of batches){
      if(!b.near)continue;let n=0,m=0,f=0,s=0;
      const write=(mesh,index,i,lo,hi)=>{mesh.setMatrixAt(index,b.matrices[i]);mesh.geometry.attributes.forestInterval.setXY(index,lo,hi);};
      b.bounds.forEach((box,i)=>{
        const d=box.distanceToPoint(last),limits=b.distances[i],weights=treeLodWeights(d,limits);
        const selected=d<(b.selected[i]?limits.nearLeave:limits.nearEnd);
        b.selected[i]=+selected;
        // Retain an empty interval in the hysteresis margin; no visible switch
        // occurs on allocation/release and every tree has total coverage one.
        if(selected)write(b.near,n++,i,0,weights[0]);
        if(weights[1]>0)write(b.mid,m++,i,weights[0],1-weights[2]);
        if(weights[2]>0)write(b.far,f++,i,1-weights[2],1);
        if(weights.filter(w=>w>0).length>1)transitions++;
        const dx=Math.max(box.min.x-anchor.x,0,anchor.x-box.max.x),dz=Math.max(box.min.z-anchor.z,0,anchor.z-box.max.z);
        const casts=dx*dx+dz*dz<380*380||selected;
        // A near/proxy allocation switch preserves identical depth geometry.
        // Invalidate only actual caster membership, not a visual LOD change.
        if(casts!==!!b.casters[i])changed=true;b.casters[i]=+casts;
        if(casts&&!selected)b.proxy.setMatrixAt(s++,b.matrices[i]);
      });
      b.near.count=n;b.mid.count=m;b.far.count=f;b.proxy.count=s;nearTotal+=n;midTotal+=m;farTotal+=f;proxies+=s;
      for(const mesh of [b.near,b.mid,b.far,b.proxy]){mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.forestInterval.needsUpdate=true;}
    }
    stats.near=nearTotal;stats.mid=midTotal;stats.far=farTotal;stats.transitioning=transitions;stats.shadowProxies=proxies;
    if(changed)invalidateShadows();return changed;
  }
  return {group,stats,update,invalidateShadows,rebuildImpostors(direction){kits.forEach(kit=>kit.refresh(direction));invalidateShadows();}};
}

/** Coarse canopy ground darkening beyond the cached sun map. These are soft,
 * terrain-conforming projected ellipses derived from the actual source crown,
 * not persisted plants or authored places. The near sun map supplies branches.
 */
export function buildTreeGroundShadows(placement, assets, ground) {
  const group=new T.Group();group.name='tree_ground_shadows';
  const trees=placement.instances.filter(t=>t.asset.startsWith('redwood/')||t.kind==='arboreal_tree');
  const crowns=new Map();
  for(const t of trees)if(!crowns.has(t.asset))crowns.set(t.asset,sourceBounds(assets[t.asset],true));
  const material=new T.MeshBasicMaterial({color:'#223526',transparent:true,opacity:.23,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-1,side:T.DoubleSide});
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
      float radius=length(vUv*2.-1.);
      diffuseColor.a*=1.-smoothstep(.22,1.,radius);
      if(diffuseColor.a<.003)discard;
    `);
  };
  // Basic materials otherwise omit UVs when no texture is bound.
  material.defines={USE_UV:''};material.customProgramCacheKey=()=> 'tree-ground-shadow-v1';
  const stats={trees:trees.length,patches:0,triangles:0,tiles:0,revision:0,contactFallbacks:0};let direction=null;
  function setSun(sun){
    if(direction&&direction.distanceToSquared(sun)<1e-10)return false;
    direction=sun.clone().normalize();
    for(const mesh of [...group.children]){group.remove(mesh);mesh.geometry.dispose();}
    const tiles=new Map();stats.patches=stats.triangles=stats.contactFallbacks=0;
    const across=new T.Vector2(-direction.z,direction.x).normalize(),along=new T.Vector2(direction.x,direction.z).normalize();
    if(across.lengthSq()<1e-8){across.set(1,0);along.set(0,1);}
    for(const tree of trees){
      const local=crowns.get(tree.asset);if(local.isEmpty())continue;
      const box=local.clone().applyMatrix4(instanceMatrix(tree.position_m,tree.yaw_deg,tree.scale,null,tree.tags?.includes('world_space')));
      const centre=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());
      // Intersect the centre ray with the same ground sampler used by walking.
      // Bisection keeps the approximation stable on slopes at low sun angles.
      let lo=0,hi=Math.min(1200,Math.max(80,(centre.y-(ground.height(centre.x,-centre.z)??centre.y)+100)/Math.max(.12,direction.y)));
      const clearance=t=>{const h=ground.height(centre.x-direction.x*t,-centre.z+direction.z*t);return h==null?Infinity:centre.y-direction.y*t-h;};
      const contact=clearance(hi)>0;
      if(contact){centre.y=ground.height(centre.x,-centre.z)??centre.y;stats.contactFallbacks++;}
      else{
        for(let i=0;i<11;i++){const t=(lo+hi)/2;if(clearance(t)>0)lo=t;else hi=t;}
        centre.addScaledVector(direction,-hi);
      }
      const radius=Math.max(size.x,size.z)*.48;
      const stretch=contact?radius:Math.min(110,Math.hypot(radius,size.y*.3*Math.hypot(direction.x,direction.z)/Math.max(.12,direction.y)));
      const key=`${Math.floor(centre.x/512)},${Math.floor(centre.z/512)}`;
      if(!tiles.has(key))tiles.set(key,{positions:[],uv:[],indices:[]});
      const tile=tiles.get(key),base=tile.positions.length/3;
      const nx=Math.max(3,Math.ceil(radius*2/6)+1),nz=Math.max(3,Math.ceil(stretch*2/8)+1);
      let valid=true;const positions=[];
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++){
        const u=x/(nx-1)*2-1,v=z/(nz-1)*2-1;
        const px=centre.x+across.x*u*radius+along.x*v*stretch,pz=centre.z+across.y*u*radius+along.y*v*stretch;
        const h=ground.height(px,-pz);if(h==null){valid=false;break;}positions.push(px,h+.12,pz);
      }
      if(!valid)continue;tile.positions.push(...positions);
      for(let z=0;z<nz;z++)for(let x=0;x<nx;x++)tile.uv.push(x/(nx-1),z/(nz-1));
      for(let z=0;z<nz-1;z++)for(let x=0;x<nx-1;x++){const a=base+z*nx+x;tile.indices.push(a,a+nx,a+1,a+1,a+nx,a+nx+1);}
      stats.patches++;stats.triangles+=(nx-1)*(nz-1)*2;
    }
    for(const [key,tile]of tiles){
      const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(tile.positions,3));geometry.setAttribute('uv',new T.Float32BufferAttribute(tile.uv,2));geometry.setIndex(tile.indices);geometry.computeBoundingSphere();
      const mesh=new T.Mesh(geometry,material);mesh.name=`tree_ground_shadow_${key}`;mesh.renderOrder=1;group.add(mesh);
    }
    stats.tiles=group.children.length;stats.revision++;return true;
  }
  return {group,stats,setSun};
}

// Existing ecology presentation; tree representation changes do not retune it.
function buildBakedPlantings(placement, assets,renderer=null,options={}) {
  const trees=placement.instances.filter(options.filter??(i=>i.asset.startsWith('redwood/')&&!i.tags?.includes('world_space')));
  const group=new T.Group();group.name=options.name??'forest';
  const types=new Map(),batches=[],kits=[];
  for(const tree of trees){if(!types.has(tree.asset))types.set(tree.asset,[]);types.get(tree.asset).push(tree);}
  let triangles=0;
  for(const [path,entries] of types){
    const asset=assets[path];if(!asset)throw new Error(`No tree source: ${path}`);
    const kit=renderer?bakeImpostor(asset,renderer):null;
    if(kit){kit.detail.material.side=T.DoubleSide;kits.push(kit);}
    const hull=kit?null:stylizedTreeGeometry(asset);
    const geometry=kit?.geometry??hull.geometry;
    const material=kit?.material??toonMaterial({vertexColors:true,side:T.DoubleSide},{foliage:true});
    triangles=kit?2:hull.triangles;
    const tiles=new Map();
    entries.forEach(tree=>{const [x,y]=tree.position_m;const key=`${Math.floor(x/(options.tileM??256))},${Math.floor(y/(options.tileM??256))}`;if(!tiles.has(key))tiles.set(key,[]);tiles.get(key).push(tree);});
    for(const [key,records] of tiles){
      const far=new T.InstancedMesh(geometry,material,records.length);far.name=`forest_far_${path}_${key}`;
      const near=kit?new T.InstancedMesh(kit.detail.geometry,kit.detail.material,records.length):null;
      if(near){near.name=`forest_near_${path}_${key}`;near.count=0;near.castShadow=near.receiveShadow=true;group.add(near);}
      const matrices=records.map(t=>instanceMatrix(t.position_m,t.yaw_deg,t.scale,asset.primitives[0].local));
      matrices.forEach((m,i)=>far.setMatrixAt(i,m));far.computeBoundingSphere();far.instanceMatrix.needsUpdate=true;group.add(far);
      batches.push({far,near,records,matrices,selected:new Uint8Array(records.length)});
    }
  }
  const stats={trees:trees.length,tiles:batches.length,trianglesPerTree:triangles,near:0,presentation:renderer?'shared mesh nearby; source-baked alpha impostor afar':'source-envelope crown'};
  let lastX=Infinity,lastY=Infinity,lastZ=Infinity;
  function update(camera){
    if((camera.position.x-lastX)**2+(camera.position.y-lastY)**2+(camera.position.z-lastZ)**2<64)return;
    ({x:lastX,y:lastY,z:lastZ}=camera.position);let nearTotal=0;
    for(const batch of batches){
      if(!batch.near)continue;let n=0,f=0;
      batch.records.forEach((tree,i)=>{
        const [x,y,z]=tree.position_m;const d=Math.hypot(x-lastX,-y-lastZ,z+24-lastY);
        const selected=d<(batch.selected[i]?(options.leaveM??155):(options.enterM??125));batch.selected[i]=+selected;
        (selected?batch.near:batch.far).setMatrixAt(selected?n++:f++,batch.matrices[i]);
      });
      batch.near.count=n;batch.far.count=f;nearTotal+=n;
      for(const mesh of [batch.near,batch.far]){mesh.instanceMatrix.needsUpdate=true;mesh.computeBoundingSphere();}
    }
    stats.near=nearTotal;
  }
  return {group,stats,update,rebuildImpostors(){kits.forEach(kit=>kit.refresh());}};
}

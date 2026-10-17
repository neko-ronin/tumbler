/** A uniform stylization of the source crown, never a distance-switched asset.
 * The source's foliage envelope is measured in height/azimuth slices. The slices
 * form one continuous lobed crown; all published transforms are retained.
 * This is a deliberately stylized silhouette, not full needle-detail parity.
 */
import * as T from '../vendor/three.module.min.js';
import { instanceMatrix } from './world.js';
import { mergePrimitives } from './glb.js';
import { toonMaterial } from './style.js';

export function stylizedTreeGeometry(asset) {
  const foliage = asset.primitives.filter(p => /foliage/.test(p.materialName));
  if (!foliage.length) throw new Error('redwood has no foliage envelope');
  const box = new T.Box3();
  for (const p of foliage) box.union(p.geometry.boundingBox);
  const levels = 22, radial = 12;
  const radii = new Float32Array(levels * radial);
  const step = (box.max.y - box.min.y) / levels;
  for (const primitive of foliage) {
    const pos = primitive.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
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
      positions.push(Math.cos(angle)*r, y + (level > 0 && level < levels-1 ? Math.sin(angle*3+level)*.45 : 0), Math.sin(angle)*r);
      colors.push(color.r,color.g,color.b);
      if(level < levels-1){
        const a=level*radial+sector, b=level*radial+(sector+1)%radial,c=a+radial,d=b+radial;
        crownIndices.push(a,c,b,b,c,d);
      }
    }
  }
  // The central trunk uses the source's own vertical extent; the crown hull
  // express the crown instead of retaining millions of subpixel needle faces.
  const bark = asset.primitives.find(p => /bark/.test(p.materialName));
  const bottom = bark.geometry.boundingBox.min.y, top = Math.min(bark.geometry.boundingBox.max.y, box.max.y - .1);
  const barkColor = new T.Color('#946044');
  for (let i = 0; i < radial; i++) {
    const a = i / radial * Math.PI * 2, b = (i + 1) / radial * Math.PI * 2;
    const p = [Math.cos(a) * 1.12, bottom, Math.sin(a) * 1.12];
    const q = [Math.cos(b) * 1.12, bottom, Math.sin(b) * 1.12];
    const r = [Math.cos(a) * .12, top, Math.sin(a) * .12];
    const s = [Math.cos(b) * .12, top, Math.sin(b) * .12];
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
  const scene=new T.Scene(),mesh=new T.Mesh(merged.geometry,merged.material);scene.add(mesh);
  scene.add(new T.HemisphereLight('#e1edff','#535d3c',2.2));
  const light=new T.DirectionalLight('#fff6df',2);light.position.set(-20,60,35);scene.add(light);
  const width=Math.max(size.x,size.z)*1.12,height=size.y*1.02;
  const camera=new T.OrthographicCamera(-width/2,width/2,height/2,-height/2,.1,500);
  camera.position.set(0,centre.y,150);camera.lookAt(0,centre.y,0);
  const topCamera=new T.OrthographicCamera(-width/2,width/2,width/2,-width/2,.1,500);
  topCamera.position.set(0,centre.y+150,0);topCamera.up.set(0,0,-1);topCamera.lookAt(centre);
  function refresh(){
  const previous=renderer.getRenderTarget(),color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
  renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.render(scene,camera);
  renderer.setRenderTarget(topTarget);renderer.render(scene,topCamera);
  renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);
  }
  refresh();
  const geometry=new T.PlaneGeometry(width,height);geometry.translate(0,centre.y,0);
  const material=new T.MeshBasicMaterial({map:target.texture,alphaTest:.22,side:T.DoubleSide,fog:true});
  material.onBeforeCompile=shader=>{
    shader.uniforms.uTop={value:topTarget.texture};shader.uniforms.uCanopyDims={value:new T.Vector2(width,bounds.max.y*.72)};
    shader.vertexShader='uniform vec2 uCanopyDims;varying float vOverhead;\n'+shader.vertexShader;
    shader.fragmentShader='uniform sampler2D uTop;varying float vOverhead;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
      diffuseColor*=mix(texture2D(map,vMapUv),texture2D(uTop,vMapUv),vOverhead);
    #endif`);
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`
      vec3 scale=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
      vec4 origin=modelMatrix*instanceMatrix*vec4(0.,0.,0.,1.);
      vec3 right=normalize(vec3(viewMatrix[0][0],0.,viewMatrix[2][0]));
      vOverhead=smoothstep(.45,.82,normalize(cameraPosition-origin.xyz).y);
      vec3 sidePlace=origin.xyz+right*position.x*scale.x+vec3(0.,position.y*scale.y,0.);
      vec3 viewUp=normalize(vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]));
      vec3 topPlace=origin.xyz+right*position.x*scale.x+viewUp*(uv.y-.5)*uCanopyDims.x*scale.x+vec3(0.,uCanopyDims.y*scale.y,0.);
      vec4 mvPosition=viewMatrix*vec4(mix(sidePlace,topPlace,vOverhead),1.);
      gl_Position=projectionMatrix*mvPosition;
    `);
  };
  material.customProgramCacheKey=()=> 'forest-impostor-overhead-v2';
  return {geometry,material,detail:merged,target,refresh};
}
export function buildStylizedForest(placement, assets,renderer=null,options={}) {
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

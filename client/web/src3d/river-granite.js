/** Display the shared indexed bedrock; source-preserving tile LOD, no cards.
 * Substrate/water level come from glTF UV0, habitat from the shared area stamp.
 */
import * as T from '../vendor/three.module.min.js';
import {terrainTileLevels} from './terrain-lod.js';
import {toonMaterial} from './style.js';
export function buildRiverGranite(surface,asset,terrain,assets,landscapeGrid){
 const data=surface.data,g=data.grid,group=new T.Group();group.name='downstream_granite';
 const source=asset.primitives[0].geometry,cols=g.columns,rows=g.rows,tiles=[];
 const material=toonMaterial({name:'wet_dry_river_granite',vertexColors:true,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1},{terrain:true,horizonM:landscapeGrid.maxX});
 const compile=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  compile(shader);
  shader.vertexShader='varying vec2 vRiver;\n'+shader.vertexShader;
  shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvRiver=uv;');
  shader.fragmentShader='varying vec2 vRiver;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('GraniteSurface granite=GraniteSurface', 'rockMask=max(rockMask,vRiver.x);\nGraniteSurface granite=GraniteSurface');
  shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb=mix(diffuseColor.rgb,granite.color,rockMask);',`
   float wet=1.-smoothstep(vRiver.y+.06,vRiver.y+.95,vPlace.y);
   granite.color*=mix(vec3(1.),vec3(.48,.57,.56),wet);
   granite.roughness=mix(granite.roughness,.24,wet);
   diffuseColor.rgb=mix(diffuseColor.rgb,granite.color,rockMask);
   // Warm fine alluvium stays sparse among the exposed bedrock shelves.
   float alluvium=(1.-vRiver.x)*smoothstep(.2,.8,vRiver.x*3.);
   diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.39,.34,.23),alluvium*.7);`);
 };
 material.defines={...material.defines,USE_UV:''};material.customProgramCacheKey=()=> 'river-granite-wet-dry-v1';
 const grid={resolution:cols,values:g.heights_m};
 const baseGeometry=terrain.group.children[0].geometry;
 function nativeAttribute(name,x,y){
  const a=baseGeometry.attributes[name],n=landscapeGrid.resolution,gx=(x-landscapeGrid.offsetX)/landscapeGrid.quad,gy=(y-landscapeGrid.offsetY)/landscapeGrid.quad,
    c=Math.min(n-2,Math.floor(gx)),r=Math.min(n-2,Math.floor(gy)),u=gx-c,v=gy-r;
  return [0,1,2].map(k=>{const at=(r,c)=>a.array[(r*n+c)*3+k],z=at(r,c),b=at(r,c+1),d=at(r+1,c+1),e=at(r+1,c);return u>=v?z+(b-z)*u+(d-b)*v:z+(e-z)*v+(d-e)*u;});
 }

 for(let r=0;r<rows-1;r+=32)for(let c=0;c<cols-1;c+=32){
  const nr=Math.min(32,rows-1-r),nc=Math.min(32,cols-1-c),geometry=new T.BufferGeometry();
  for(const name of ['position','normal','uv']){
   const attr=source.attributes[name],values=new Float32Array((nr+1)*(nc+1)*attr.itemSize);let k=0;
   for(let y=0;y<=nr;y++)for(let x=0;x<=nc;x++){const i=((r+y)*cols+c+x)*attr.itemSize;values.set(attr.array.subarray(i,i+attr.itemSize),k);k+=attr.itemSize;}
   geometry.setAttribute(name,new T.Float32BufferAttribute(values,attr.itemSize));
  }
  const colors=[],normals=geometry.attributes.normal;
  for(let y=0;y<=nr;y++)for(let x=0;x<=nc;x++){
   const wx=g.offset_xy_m[0]+(c+x)*g.sample_m,wy=g.offset_xy_m[1]+(r+y)*g.sample_m,weight=g.granite[(r+y)*cols+c+x];
   colors.push(...nativeAttribute('color',wx,wy));
   if(weight<.08){const n=nativeAttribute('normal',wx,wy),i=y*(nc+1)+x,w=Math.min(1,weight/.08);for(let k=0;k<3;k++)n[k]=n[k]*(1-w)+normals.array[i*3+k]*w;normals.setXYZ(i,...n);}
  }
  geometry.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  const levels=terrainTileLevels(grid,r,c,nr,nc,[1,2,4,8]);
  geometry.setIndex(new T.Uint16BufferAttribute(new Uint16Array(levels[0].index.array),1).setUsage(T.DynamicDrawUsage));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,material);mesh.name=`river_granite_${r}_${c}`;mesh.castShadow=mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);tiles.push({mesh,levels,level:0,row:r,col:c,bounds:geometry.boundingBox.clone()});
 }
 // Retain each source tile's LOD, but submit 4x4 tiles together. Shared
 // selected index buffers change only after camera/projection movement.
 const batches=new Map();
 for(const tile of tiles){const key=`${Math.floor(tile.row/128)},${Math.floor(tile.col/128)}`;if(!batches.has(key))batches.set(key,{tiles:[],dirty:true});batches.get(key).tiles.push(tile);}
 function writeBatch(batch){
  let count=0;for(const tile of batch.tiles){const index=tile.levels[tile.level].batchIndex;batch.mesh.geometry.index.array.set(index,count);count+=index.length;}
  batch.mesh.geometry.index.clearUpdateRanges();batch.mesh.geometry.index.addUpdateRange(0,count);batch.mesh.geometry.index.needsUpdate=true;batch.mesh.geometry.setDrawRange(0,count);batch.dirty=false;
 }
 for(const [key,batch]of batches){
  const geometry=new T.BufferGeometry();let vertices=0;
  for(const tile of batch.tiles){tile.vertexBase=vertices;vertices+=tile.mesh.geometry.attributes.position.count;tile.batch=batch;}
  for(const name of ['position','normal','uv','color']){
   const size=batch.tiles[0].mesh.geometry.attributes[name].itemSize,values=new Float32Array(vertices*size);let offset=0;
   for(const tile of batch.tiles){const attr=tile.mesh.geometry.attributes[name];values.set(attr.array,offset);offset+=attr.array.length;}
   geometry.setAttribute(name,new T.Float32BufferAttribute(values,size));
  }
  for(const tile of batch.tiles)for(const level of tile.levels)level.batchIndex=Uint16Array.from(level.index.array,i=>i+tile.vertexBase);
  const capacity=batch.tiles.reduce((n,t)=>n+t.levels[0].index.count,0);
  geometry.setIndex(new T.Uint16BufferAttribute(new Uint16Array(capacity),1).setUsage(T.DynamicDrawUsage));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new T.Mesh(geometry,material);mesh.name=`river_granite_batch_${key}`;mesh.castShadow=mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;batch.mesh=mesh;
  for(const tile of batch.tiles){group.remove(tile.mesh);tile.mesh.geometry.dispose();}
  group.add(mesh);writeBatch(batch);
 }
 // Four metres of native-height underlap plus a depth bias close raster cracks.
 // The detailed patch replaces coarse pixels. Keep the native boundary tiles
 // at full source resolution so their visible rim is identical to the patch.
 const bounds=data.bounds_xy_m;
 for(const tile of terrain.tiles){
  const b=tile.bounds??tile.mesh.geometry.boundingBox;
  if(b.max.x<bounds[0]||b.min.x>bounds[2]||-b.min.z<bounds[1]||-b.max.z>bounds[3])continue;
  // Fully covered native tiles cannot contribute a visible pixel. Retain
  // their source attributes/collision, but submit no hidden triangles.
  if(b.min.x>bounds[0]+4&&b.max.x<bounds[2]-4&&-b.max.z>bounds[1]+4&&-b.min.z<bounds[3]-4){
   for(const level of tile.levels){level.globalIndex=new Uint32Array();level.index=new T.Uint16BufferAttribute([],1);level.triangles=level.error=0;}
   if(tile.batch)tile.batch.dirty=true;else tile.mesh.geometry.setDrawRange(0,0);
   continue;
  }
  tile.levels.forEach(l=>{if(l.stride>1)l.error=Infinity;});
 }
 const baseMaterial=terrain.group.children[0].material,baseCompile=baseMaterial.onBeforeCompile;
 baseMaterial.onBeforeCompile=shader=>{
  baseCompile(shader);shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>',`#include <clipping_planes_fragment>
   if(vPlace.x>${(bounds[0]+4).toFixed(1)}&&vPlace.x<${(bounds[2]-4).toFixed(1)}&&-vPlace.z>${(bounds[1]+4).toFixed(1)}&&-vPlace.z<${(bounds[3]-4).toFixed(1)})discard;`);
 };
 const baseKey=baseMaterial.customProgramCacheKey.bind(baseMaterial);baseMaterial.customProgramCacheKey=()=>baseKey()+':river-cutout-v3';baseMaterial.needsUpdate=true;
 const stats={tiles:tiles.length,batches:batches.size,sourceTriangles:(cols-1)*(rows-1)*2,triangles:0,lodCounts:[0,0,0,0],maxProjectedError:0,plants:0};
 // Sedge groups are client interpretation of a plant/density habitat stamp.
 const plantAsset=assets['waterside/sedge.glb'];
 if(plantAsset){
  const points=[];
  for(let r=0;r<rows;r+=2)for(let c=0;c<cols;c+=2){
   const x=g.offset_xy_m[0]+c*g.sample_m,y=g.offset_xy_m[1]+r*g.sample_m,habitat=surface.riparian(x,y),seed=Math.sin(x*12.9+y*78.2)*43758.54,hash=seed-Math.floor(seed);
   if(hash<habitat*data.flora.density_groups_m2*64)points.push([x,surface.height(x,y),-y,hash]);
  }
  for(const p of plantAsset.primitives){const m=toonMaterial({color:'#7c8651'},{foliage:true}),mesh=new T.InstancedMesh(p.geometry,m,points.length),matrix=new T.Matrix4();
   points.forEach(([x,z,y,h],i)=>{matrix.makeRotationY(h*6.28).setPosition(x,z,y).multiply(p.local);mesh.setMatrixAt(i,matrix);});mesh.computeBoundingSphere();group.add(mesh);}
  stats.plants=points.length;
 }
 const last=new T.Vector3(Infinity,Infinity,Infinity);let lastProjection='',lastHeight=0;
 function update(camera,height=900){
  const projection=Array.from(camera.projectionMatrix.elements).join(',');if(last.distanceToSquared(camera.position)<1&&projection===lastProjection&&height===lastHeight)return;
  last.copy(camera.position);lastProjection=projection;lastHeight=height;
  const focal=height*Math.abs(camera.projectionMatrix.elements[5])*.5;stats.triangles=stats.maxProjectedError=0;stats.lodCounts.fill(0);
  for(const t of tiles){const distance=Math.max(.1,t.bounds.distanceToPoint(camera.position));let level=0;
   if(distance>180)for(let i=1;i<t.levels.length;i++)if(t.levels[i].error*focal/distance<=2*(i<=t.level?1.15:.85))level=i;
   if(level!==t.level){t.level=level;t.batch.dirty=true;}
   stats.triangles+=t.levels[level].triangles;stats.lodCounts[level]++;stats.maxProjectedError=Math.max(stats.maxProjectedError,t.levels[level].error*focal/distance);
  }
  for(const batch of batches.values())if(batch.dirty)writeBatch(batch);
 }
 function dispose(){
  for(const batch of batches.values())batch.mesh.geometry.dispose();
  for(const child of group.children)if(child.isInstancedMesh){child.dispose();child.material.dispose();}
  material.dispose();group.clear();
 }
 return {group,stats,update,surface,dispose};
}

/** Source-sample terrain LOD. Every level retains the full published tile rim;
 * adjacent tiles therefore meet exactly even when their interior detail differs.
 * No displacement, invented peak or change to the collision surface.
 */
import {Color,Group,Mesh,BufferGeometry,Float32BufferAttribute,Uint16BufferAttribute,Uint32BufferAttribute,DynamicDrawUsage,Vector3,Box3,Sphere} from '../vendor/three.module.min.js';
import {buildTerrainGeometry,vertexColor} from './terrain.js';
import {toonMaterial} from './style.js';

export function terrainTileLevels(grid,row0,col0,rows,cols,strides=[1,4,8,16]){
 const n=cols+1,id=(r,c)=>r*n+c,levels=[];
 for(const stride of strides){
  const indices=[];
  const cuts=length=>{const list=[0];for(let p=stride;p<length;p+=stride)list.push(p);if(stride>1&&length-list.at(-1)===1&&list.length>1)list.pop();list.push(length);return list;};
  const rowCuts=cuts(rows),colCuts=cuts(cols);
  for(let ri=0;ri<rowCuts.length-1;ri++)for(let ci=0;ci<colCuts.length-1;ci++){
   const r=rowCuts[ri],c=colCuts[ci],re=rowCuts[ri+1],ce=colCuts[ci+1];
   if(re-r<2||ce-c<2){
    // Narrow remainder cells keep their original triangles.
    for(let y=r;y<re;y++)for(let x=c;x<ce;x++)indices.push(id(y,x),id(y+1,x+1),id(y+1,x),id(y,x),id(y,x+1),id(y+1,x+1));
    continue;
   }
   const ring=[];
   for(let x=c;x<ce;x+=r===0?1:ce-c)ring.push(id(r,x));
   for(let y=r;y<re;y+=ce===cols?1:re-r)ring.push(id(y,ce));
   for(let x=ce;x>c;x-=re===rows?1:ce-c)ring.push(id(re,x));
   for(let y=re;y>r;y-=c===0?1:re-r)ring.push(id(y,c));
   const centre=id(Math.floor((r+re)/2),Math.floor((c+ce)/2));
   for(let k=0;k<ring.length;k++)indices.push(centre,ring[k],ring[(k+1)%ring.length]);
  }
  // Conservative deviation: compare each coarse triangle plane with every
  // source vertex in its bounding rectangle, including outside that triangle.
  // This also bounds fine triangles crossed by a coarse edge, where checking
  // only the interpolated vertices could miss an interior extremum.
  let error=0;
  if(stride>1){
   const h=(r,c)=>grid.values[(row0+r)*grid.resolution+col0+c];
   for(let k=0;k<indices.length;k+=3){
    const a=indices[k],b=indices[k+1],d=indices[k+2],ax=a%n,ay=Math.floor(a/n),bx=b%n,by=Math.floor(b/n),dx=d%n,dy=Math.floor(d/n);
    const det=(by-dy)*(ax-dx)+(dx-bx)*(ay-dy);if(!det)continue;
    for(let y=Math.min(ay,by,dy);y<=Math.max(ay,by,dy);y++)for(let x=Math.min(ax,bx,dx);x<=Math.max(ax,bx,dx);x++){
     const u=((by-dy)*(x-dx)+(dx-bx)*(y-dy))/det,v=((dy-ay)*(x-dx)+(ax-dx)*(y-dy))/det;
     error=Math.max(error,Math.abs(h(y,x)-(u*h(ay,ax)+v*h(by,bx)+(1-u-v)*h(dy,dx))));
    }
   }
  }
  levels.push({index:new Uint16BufferAttribute(indices,1),triangles:indices.length/3,error,stride});
 }
 return levels;
}

export function buildTerrainLod(grid,{tileCells=32,pixelError=2,nearM=320,horizonM=0,batchTiles=1,normalRegion=null}={}){
 if(batchTiles>1)return buildBatchedTerrainLod(grid,{tileCells,pixelError,nearM,horizonM,batchTiles,normalRegion});
 const source=buildTerrainGeometry(grid,{normalRegion}).geometry,group=new Group(),tiles=[];
 group.name='terrain';
 const material=toonMaterial({name:'block_granite_terrain',vertexColors:true},{terrain:true,horizonM});
 for(let row=0;row<grid.resolution-1;row+=tileCells)for(let col=0;col<grid.resolution-1;col+=tileCells){
  const rows=Math.min(tileCells,grid.resolution-1-row),cols=Math.min(tileCells,grid.resolution-1-col),geometry=new BufferGeometry();
  for(const name of ['position','normal','color']){
   const attr=source.attributes[name],values=new Float32Array((rows+1)*(cols+1)*3);let k=0;
   for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const i=((row+r)*grid.resolution+col+c)*3;values.set(attr.array.subarray(i,i+3),k);k+=3;}
   geometry.setAttribute(name,new Float32BufferAttribute(values,3));
  }
  const levels=terrainTileLevels(grid,row,col,rows,cols);geometry.setIndex(new Uint16BufferAttribute(new Uint16Array(levels[0].index.array),1).setUsage(DynamicDrawUsage));geometry.computeBoundingBox();geometry.computeBoundingSphere();
  const mesh=new Mesh(geometry,material);mesh.name=`terrain_${col}_${row}`;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;
  mesh.userData={source:'heightmap.f32',row,col,levels:levels.map(l=>({stride:l.stride,triangles:l.triangles,error:l.error}))};group.add(mesh);tiles.push({mesh,levels,level:0});
 }
 source.dispose();const stats={tiles:tiles.length,lodCounts:[0,0,0,0],triangles:0,sourceTriangles:(grid.resolution-1)**2*2,maxProjectedError:0};
 const last=new Vector3(Infinity,Infinity,Infinity);let lastProjection='',lastHeight=0;
 function update(camera,height=900){
  const projection=Array.from(camera.projectionMatrix.elements).join(',');
  if(last.distanceToSquared(camera.position)<1&&lastProjection===projection&&lastHeight===height)return;
  last.copy(camera.position);lastProjection=projection;lastHeight=height;
  const focal=height*Math.abs(camera.projectionMatrix.elements[5])*.5;
  stats.lodCounts.fill(0);stats.triangles=stats.maxProjectedError=0;
  for(const tile of tiles){
   const {mesh,levels}=tile,distance=Math.max(.1,mesh.geometry.boundingBox.distanceToPoint(camera.position));let level=0;
   if(distance>nearM)for(let k=1;k<levels.length;k++){
    const pixels=levels[k].error*focal/(camera.isOrthographicCamera?1:distance);
    if(pixels<=pixelError*(k<=tile.level?1.15:.85))level=k;
   }
   if(level!==tile.level){mesh.geometry.index.array.set(levels[level].index.array);mesh.geometry.index.needsUpdate=true;mesh.geometry.setDrawRange(0,levels[level].index.count);tile.level=level;}
   stats.lodCounts[level]++;stats.triangles+=levels[level].triangles;
   stats.maxProjectedError=Math.max(stats.maxProjectedError,levels[level].error*focal/(camera.isOrthographicCamera?1:distance));
  }
 }
 return {group,stats,tiles,update,dispose(){for(const t of tiles)t.mesh.geometry.dispose();material.dispose();group.clear();}};
}


/** Shared vertex attributes and a retained index buffer per spatial batch.
 * Tile-level error/stitched rims stay independent; only submission is grouped.
 */
function buildBatchedTerrainLod(grid,{tileCells,pixelError,nearM,horizonM,batchTiles,normalRegion}){
 const source=buildTerrainGeometry(grid,{normalRegion}).geometry,group=new Group(),tiles=[],batches=new Map();group.name='terrain';
 const material=toonMaterial({name:'continuous_granite_terrain',vertexColors:true},{terrain:true,horizonM});
 for(let row=0;row<grid.resolution-1;row+=tileCells)for(let col=0;col<grid.resolution-1;col+=tileCells){
  const rows=Math.min(tileCells,grid.resolution-1-row),cols=Math.min(tileCells,grid.resolution-1-col),levels=terrainTileLevels(grid,row,col,rows,cols),bounds=new Box3();
  let low=Infinity,high=-Infinity;
  for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const h=grid.values[(row+r)*grid.resolution+col+c];low=Math.min(low,h);high=Math.max(high,h);}
  bounds.min.set(grid.offsetX+col*grid.quad,low,-grid.offsetY-(row+rows)*grid.quad);bounds.max.set(grid.offsetX+(col+cols)*grid.quad,high,-grid.offsetY-row*grid.quad);
  for(const level of levels)level.globalIndex=Uint32Array.from(level.index.array,i=>(row+Math.floor(i/(cols+1)))*grid.resolution+col+i%(cols+1));
  const key=`${Math.floor(col/(tileCells*batchTiles))},${Math.floor(row/(tileCells*batchTiles))}`;
  if(!batches.has(key))batches.set(key,{tiles:[],bounds:new Box3(),dirty:true});
  const batch=batches.get(key),tile={bounds,levels,level:0,batch};batch.tiles.push(tile);batch.bounds.union(bounds);tiles.push(tile);
 }
 // All batches share these position/normal/color buffers. The temporary full
 // source index is not needed: every selected tile supplies its own indices.
 source.setIndex(null);
 for(const [key,batch]of batches){
  const geometry=new BufferGeometry();for(const name of ['position','normal','color'])geometry.setAttribute(name,source.attributes[name]);
  const capacity=batch.tiles.reduce((n,t)=>n+t.levels[0].index.count,0);
  geometry.setIndex(new Uint32BufferAttribute(new Uint32Array(capacity),1).setUsage(DynamicDrawUsage));geometry.boundingBox=batch.bounds;geometry.boundingSphere=batch.bounds.getBoundingSphere(new Sphere());
  const mesh=new Mesh(geometry,material);mesh.name=`terrain_batch_${key}`;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;group.add(mesh);batch.mesh=mesh;
  for(const tile of batch.tiles)tile.mesh=mesh;
 }
 function write(batch){let count=0;for(const tile of batch.tiles){const indices=tile.levels[tile.level].globalIndex;batch.mesh.geometry.index.array.set(indices,count);count+=indices.length;}
  batch.mesh.geometry.index.clearUpdateRanges();batch.mesh.geometry.index.addUpdateRange(0,count);batch.mesh.geometry.index.needsUpdate=true;batch.mesh.geometry.setDrawRange(0,count);batch.dirty=false;
 }
 for(const batch of batches.values())write(batch);
 const stats={tiles:tiles.length,batches:batches.size,lodCounts:[0,0,0,0],triangles:0,sourceTriangles:(grid.resolution-1)**2*2,maxProjectedError:0};
 const last=new Vector3(Infinity,Infinity,Infinity);let lastProjection='',lastHeight=0;
 function update(camera,height=900){
  const projection=Array.from(camera.projectionMatrix.elements).join(',');if(last.distanceToSquared(camera.position)<1&&lastProjection===projection&&lastHeight===height)return;
  last.copy(camera.position);lastProjection=projection;lastHeight=height;const focal=height*Math.abs(camera.projectionMatrix.elements[5])*.5;
  stats.lodCounts.fill(0);stats.triangles=stats.maxProjectedError=0;
  for(const tile of tiles){const distance=Math.max(.1,tile.bounds.distanceToPoint(camera.position));let level=0;
   if(distance>nearM)for(let k=1;k<tile.levels.length;k++)if(tile.levels[k].error*focal/(camera.isOrthographicCamera?1:distance)<=pixelError*(k<=tile.level?1.15:.85))level=k;
   if(level!==tile.level){tile.level=level;tile.batch.dirty=true;}
   stats.lodCounts[level]++;stats.triangles+=tile.levels[level].triangles;stats.maxProjectedError=Math.max(stats.maxProjectedError,tile.levels[level].error*focal/(camera.isOrthographicCamera?1:distance));
  }
  for(const batch of batches.values())if(batch.dirty)write(batch);
 }
 return {group,stats,tiles,update,dispose(){for(const batch of batches.values())batch.mesh.geometry.dispose();material.dispose();source.dispose();group.clear();}};
}


/** The whole world's ground, built tile by tile as the camera needs it.
 *
 * One vertex buffer over 3009^2 samples would hold 326 MB, so each tile keeps only the
 * resolution its projected error asks for and rebuilds when that changes, a few per frame,
 * nearest first. Coarse tiles hide their cracks with a skirt. Normals always read the full
 * grid at the tile's own stride, so shading doesn't jump at a tile edge. Heights are the
 * published samples: no displacement, and collision never reads this.
 */
export function buildStreamingTerrain(grid,{tileCells=128,strides=[1,2,4,8,16],pixelError=1.5,nearM=260,skirtM=24,buildsPerFrame=3}={}){
 const group=new Group();group.name='terrain';
 const material=toonMaterial({name:'continuous_granite_terrain',vertexColors:true},{terrain:true});
 const R=grid.resolution,quad=grid.quad,values=grid.values,tiles=[],indexCache=new Map(),scratch=new Color();
 const at=(r,c)=>values[Math.max(0,Math.min(R-1,r))*R+Math.max(0,Math.min(R-1,c))];
 function indexFor(nr,nc){
  const key=nr*100000+nc;let cached=indexCache.get(key);if(cached)return cached;
  const list=[],row=nc+1,grid_=(r,c)=>r*row+c;
  for(let r=0;r<nr;r++)for(let c=0;c<nc;c++){const a=grid_(r,c),b=a+1,d=grid_(r+1,c),e=d+1;list.push(a,e,d,a,b,e);}
  // Skirt: a ring below the rim, wound to face outward.
  const ring=[];for(let c=0;c<nc;c++)ring.push(grid_(0,c));for(let r=0;r<nr;r++)ring.push(grid_(r,nc));for(let c=nc;c>0;c--)ring.push(grid_(nr,c));for(let r=nr;r>0;r--)ring.push(grid_(r,0));
  const first=(nr+1)*(nc+1),count=ring.length;
  for(let k=0;k<count;k++){const a=ring[k],b=ring[(k+1)%count],a2=first+k,b2=first+(k+1)%count;list.push(a,b,a2,b,b2,a2);}
  cached={index:new Uint16BufferAttribute(list,1),ring,triangles:list.length/3};indexCache.set(key,cached);return cached;
 }
 for(let row=0;row<R-1;row+=tileCells)for(let col=0;col<R-1;col+=tileCells){
  const rows=Math.min(tileCells,R-1-row),cols=Math.min(tileCells,R-1-col);let low=Infinity,high=-Infinity;
  for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){const h=at(row+r,col+c);if(h<low)low=h;if(h>high)high=h;}
  const bounds=new Box3(new Vector3(grid.offsetX+col*quad,low-skirtM,-grid.offsetY-(row+rows)*quad),new Vector3(grid.offsetX+(col+cols)*quad,high,-grid.offsetY-row*quad));
  // Largest difference between the samples and each stride's bilinear surface.
  const levels=strides.map(stride=>{let error=0;if(stride>1)for(let r=0;r<=rows;r++)for(let c=0;c<=cols;c++){
    const r0=Math.floor(r/stride)*stride,c0=Math.floor(c/stride)*stride,r1=Math.min(rows,r0+stride),c1=Math.min(cols,c0+stride),u=c1>c0?(c-c0)/(c1-c0):0,v=r1>r0?(r-r0)/(r1-r0):0;
    const fit=(at(row+r0,col+c0)*(1-u)+at(row+r0,col+c1)*u)*(1-v)+(at(row+r1,col+c0)*(1-u)+at(row+r1,col+c1)*u)*v;error=Math.max(error,Math.abs(fit-at(row+r,col+c)));}
   return {stride,error,geometry:null,triangles:0};});
  const mesh=new Mesh(new BufferGeometry(),material);mesh.name=`terrain_${col}_${row}`;mesh.receiveShadow=true;mesh.matrixAutoUpdate=false;mesh.visible=false;group.add(mesh);
  tiles.push({row,col,rows,cols,bounds,levels,level:-1,want:levels.length-1,mesh,hidden:false});
 }
 function build(tile,level){
  const entry=tile.levels[level];if(entry.geometry)return entry.geometry;
  const s=entry.stride,nr=Math.ceil(tile.rows/s),nc=Math.ceil(tile.cols/s),{index,ring,triangles}=indexFor(nr,nc),rimCount=ring.length,count=(nr+1)*(nc+1)+rimCount;
  const positions=new Float32Array(count*3),normals=new Float32Array(count*3),colors=new Float32Array(count*3);let k=0;
  for(let r=0;r<=nr;r++){const gr=tile.row+Math.min(tile.rows,r*s),wy=grid.offsetY+gr*quad;for(let c=0;c<=nc;c++){
   const gc=tile.col+Math.min(tile.cols,c*s),wx=grid.offsetX+gc*quad,h=at(gr,gc);
   const dzdx=(at(gr,gc+s)-at(gr,gc-s))/(2*s*quad),dzdy=(at(gr+s,gc)-at(gr-s,gc))/(2*s*quad),len=Math.hypot(dzdx,dzdy,1);
   positions[k]=wx;positions[k+1]=h;positions[k+2]=-wy;normals[k]=-dzdx/len;normals[k+1]=1/len;normals[k+2]=dzdy/len;vertexColor(colors,k,h,wx,wy,scratch);k+=3;}}
  for(const v of ring){const i=v*3;positions[k]=positions[i];positions[k+1]=positions[i+1]-skirtM;positions[k+2]=positions[i+2];
   normals[k]=normals[i];normals[k+1]=normals[i+1];normals[k+2]=normals[i+2];colors[k]=colors[i];colors[k+1]=colors[i+1];colors[k+2]=colors[i+2];k+=3;}
  const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.setAttribute('color',new Float32BufferAttribute(colors,3));geometry.setIndex(index);
  geometry.boundingBox=tile.bounds;geometry.boundingSphere=tile.bounds.getBoundingSphere(new Sphere());entry.geometry=geometry;entry.triangles=triangles;stats.builds++;return geometry;
 }
 function show(tile,level){
  const previous=tile.level;tile.level=level;tile.mesh.geometry=tile.levels[level].geometry;tile.mesh.visible=!tile.hidden;
  // Only the two finest levels are worth giving back; coarse ones are small and come back often.
  if(previous>=0&&previous<level&&previous<2&&tile.levels[previous].geometry){tile.levels[previous].geometry.dispose();tile.levels[previous].geometry=null;}
 }
 const stats={tiles:tiles.length,lodCounts:strides.map(()=>0),triangles:0,sourceTriangles:(R-1)**2*2,maxProjectedError:0,builds:0,pending:0};
 for(const tile of tiles){build(tile,strides.length-1);show(tile,strides.length-1);}
 const queue=[];
 function update(camera,height=900,{flush=false}={}){
  const focal=height*Math.abs(camera.projectionMatrix.elements[5])*.5,orthographic=camera.isOrthographicCamera;queue.length=0;
  for(const tile of tiles){
   const distance=Math.max(.1,tile.bounds.distanceToPoint(camera.position));tile.distance=distance;let want=0;
   if(distance>nearM)for(let k=1;k<tile.levels.length;k++){const pixels=tile.levels[k].error*focal/(orthographic?1:distance);if(pixels<=pixelError*(k<=tile.level?1.15:.85))want=k;else break;}
   if(tile.pinned)want=0;
   tile.want=want;
   if(want===tile.level)continue;
   if(tile.levels[want].geometry)show(tile,want);else queue.push(tile);
  }
  queue.sort((a,b)=>a.distance-b.distance);
  const budget=flush?queue.length:buildsPerFrame;
  for(let k=0;k<budget&&k<queue.length;k++){const tile=queue[k];build(tile,tile.want);show(tile,tile.want);}
  stats.pending=Math.max(0,queue.length-budget);stats.lodCounts.fill(0);stats.triangles=0;stats.maxProjectedError=0;
  for(const tile of tiles){if(tile.hidden)continue;const entry=tile.levels[tile.level];stats.lodCounts[tile.level]++;stats.triangles+=entry.triangles;stats.maxProjectedError=Math.max(stats.maxProjectedError,entry.error*focal/(orthographic?1:tile.distance||1));}
 }
 /** The shading a tile's vertex would have here, for meshes that must match the ground at a rim. */
 function attributeAt(name,x,y){
  const gx=(x-grid.offsetX)/quad,gy=(y-grid.offsetY)/quad,c=Math.floor(gx),r=Math.floor(gy),u=gx-c,v=gy-r;
  const value=(rr,cc)=>{const h=at(rr,cc);
   if(name==='position')return [grid.offsetX+cc*quad,h,-(grid.offsetY+rr*quad)];
   if(name==='normal'){const a=(at(rr,cc+1)-at(rr,cc-1))/(2*quad),b=(at(rr+1,cc)-at(rr-1,cc))/(2*quad),l=Math.hypot(a,b,1);return [-a/l,1/l,b/l];}
   const out=new Float32Array(3);vertexColor(out,0,h,grid.offsetX+cc*quad,grid.offsetY+rr*quad,scratch);return out;};
  const z=value(r,c),b=value(r,c+1),d=value(r+1,c+1),e=value(r+1,c);
  return [0,1,2].map(k=>u>=v?z[k]+(b[k]-z[k])*u+(d[k]-b[k])*v:z[k]+(e[k]-z[k])*v+(d[k]-e[k])*u);
 }
 return {group,material,stats,tiles,update,attributeAt,dispose(){for(const t of tiles)for(const l of t.levels)l.geometry?.dispose();material.dispose();group.clear();}};
}

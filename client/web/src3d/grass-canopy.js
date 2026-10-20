/** Dense, shader-displaced grass canopy. Crossed cards contain individually
 * cut-out blades. Cached world tiles follow the ground in the camera's view;
 * roots, colour and wind phase never depend on the viewer or player.
 */
import {BufferGeometry,Float32BufferAttribute,InstancedBufferAttribute,InstancedMesh,Group,Matrix4,Quaternion,Vector3,Color,DoubleSide,Frustum,Sphere} from '../vendor/three.module.min.js';
import {toonMaterial} from './style.js';
import {deterministicTurn,meadowViewFocus} from './groundcover.js';

const TILE=24,PITCH=.8;
const random=(x,y)=>deterministicTurn(x,y)/(Math.PI*2);

/** Two curved crossed surfaces, with blade detail evaluated in the fragment
 * shader. UVs stay with the plant as its vertices bend in shared air.
 */
export function grassCardGeometry({distant=false}={}){
  const p=[],n=[],uv=[],color=[];
  const dark=new Color('#385a28'),light=new Color('#819e4b');
  for(const angle of [0,Math.PI/2]){
    const dx=Math.cos(angle),dz=Math.sin(angle);
    const rows=(distant?[0,1]:[0,.5,1]).map(t=>{
      const y=t*.82,curve=.20*t*t;
      const centre=new Vector3(-dz*curve,y,dx*curve),side=new Vector3(dx,0,dz).multiplyScalar(.66);
      return {a:centre.clone().sub(side),b:centre.clone().add(side),normal:new Vector3(dz*.82,.5+.4*t,-dx*.82).normalize(),t};
    });
    const add=(row,edge)=>{p.push(...row[edge].toArray());n.push(...row.normal.toArray());uv.push(edge==='a'?0:1,row.t);const c=dark.clone().lerp(light,row.t);color.push(c.r,c.g,c.b)};
    for(let i=0;i<rows.length-1;i++){
      const a=rows[i],b=rows[i+1];
      add(a,'a');add(a,'b');add(b,'a');add(a,'b');add(b,'b');add(b,'a');
    }
  }
  const geometry=new BufferGeometry(),count=p.length/3;
  geometry.setAttribute('position',new Float32BufferAttribute(p,3));geometry.setAttribute('normal',new Float32BufferAttribute(n,3));
  geometry.setAttribute('uv',new Float32BufferAttribute(uv,2));geometry.setAttribute('color',new Float32BufferAttribute(color,3));
  geometry.setAttribute('bladeRoot',new Float32BufferAttribute(new Float32Array(count*3),3));
  geometry.setAttribute('flex',new Float32BufferAttribute(new Float32Array(count).fill(1.25),1));
  for(const name of ['petal','plant'])geometry.setAttribute(name,new Float32BufferAttribute(new Float32Array(count),1));
  geometry.computeBoundingSphere();return geometry;
}

/** Close silhouettes are individual curved ribbons. No triangle spans a clump,
 * so a grazing view cannot reveal the broad carrier used by distant cards.
 */
export function grassBladeGeometry(){
  const p=[],n=[],roots=[],colors=[],flex=[],uv=[];
  const dark=new Color('#385a28'),light=new Color('#819e4b');
  for(let i=0;i<24;i++){
    const angle=deterministicTurn(i,83),dx=Math.cos(angle),dz=Math.sin(angle);
    const radius=Math.sqrt(random(i,19))*.61,turn=deterministicTurn(i,29),root=new Vector3(Math.cos(turn)*radius,0,Math.sin(turn)*radius);
    const height=.42+random(i,41)*.43,width=.009+random(i,53)*.011,curve=.12+random(i,67)*.15;
    const rows=[0,.55,1].map(t=>{const centre=root.clone().add(new Vector3(-dz*curve*t*t,height*t,dx*curve*t*t)),side=new Vector3(dx,0,dz).multiplyScalar(width*(1-t*t));return {a:centre.clone().sub(side),b:centre.clone().add(side),t,normal:new Vector3(dz*height,2*curve*t,-dx*height).normalize()};});
    const add=(row,edge)=>{p.push(...row[edge].toArray());n.push(...row.normal.toArray());roots.push(...root.toArray());const c=dark.clone().lerp(light,row.t);colors.push(c.r,c.g,c.b);flex.push(1.1+random(i,79)*.3);uv.push(edge==='a'?0:1,row.t);};
    for(const [a,ae,b,be,c,ce]of [[rows[0],'a',rows[0],'b',rows[1],'a'],[rows[0],'b',rows[1],'b',rows[1],'a'],[rows[1],'a',rows[1],'b',rows[2],'a']]){add(a,ae);add(b,be);add(c,ce);}
  }
  const g=new BufferGeometry(),count=p.length/3;
  for(const [name,data,size]of [['position',p,3],['normal',n,3],['bladeRoot',roots,3],['color',colors,3],['flex',flex,1],['uv',uv,2]])g.setAttribute(name,new Float32BufferAttribute(data,size));
  for(const name of ['petal','plant'])g.setAttribute(name,new Float32BufferAttribute(new Float32Array(count),1));
  g.computeBoundingSphere();return g;
}

export function buildGrassCanopy(cover,ground,{samples=0}={}){
  const group=new Group();group.name='meadow';
  // Keep subpixel blades partially covered instead of making the card opaque.
  // Hashed coverage is the sorting-free fallback when MSAA is unavailable.
  const coverage={vertexColors:true,side:DoubleSide,alphaToCoverage:samples>1,alphaHash:samples<=1};
  const prototype=grassCardGeometry(),distant=grassCardGeometry({distant:true}),material=toonMaterial({name:'flowing_grass_canopy',...coverage},{meadow:true,canopy:true,meadowRange:[65,210]});
  // Beyond the resolved clumps, nine times fewer roots carry the same ground
  // footprint. Width grows with spacing; height, air and terrain stay real.
  const farMaterial=toonMaterial({name:'distant_grass_canopy',...coverage},{meadow:true,canopy:true,canopyStart:[110,200],meadowRange:[320,620]});
  const blades=grassBladeGeometry(),bladeMaterial=toonMaterial({name:'near_grass_blades',vertexColors:true,side:DoubleSide,alphaToCoverage:samples>1,alphaHash:samples<=1},{meadow:true,grassBlades:true,meadowRange:[27,46]});
  const layers=[{name:'canopy',tile:TILE,pitch:PITCH,start:0,end:218,material,geometry:prototype},{name:'distant',tile:48,pitch:2.4,start:102,end:628,material:farMaterial,geometry:distant},{name:'blades',tile:TILE,pitch:PITCH,start:0,end:54,material:bladeMaterial,geometry:blades}];
  for(const layer of layers){layer.tiles=new Map();layer.bounds=new Map();}
  const matrix=new Matrix4(),position=new Vector3(),scale=new Vector3(),rotation=new Quaternion(),tilt=new Quaternion(),up=new Vector3(0,1,0),normal=new Vector3(),projection=new Matrix4(),frustum=new Frustum(),marginSphere=new Sphere();
  const stats={patches:cover.covered.reduce((sum,n)=>sum+n,0),tiles:0,clumps:0,nearClumps:0,triangles:0,visibleTiles:0,visibleTriangles:0,farClumps:0};
  const contains=(x,y)=>{const col=Math.floor((x-cover.offsetX)/cover.quad),row=Math.floor((y-cover.offsetY)/cover.quad);return row>=0&&col>=0&&row<cover.resolution&&col<cover.resolution&&cover.covered[row*cover.resolution+col];};
  let frame=0;
  const release=mesh=>{mesh.dispose();mesh.geometry.dispose();};
  function tileAt(tx,ty,layer){
    const {tile,pitch}=layer;
    const cells=[];
    for(let row=0;row<tile/pitch;row++)for(let col=0;col<tile/pitch;col++){
      const gx=tx*(tile/pitch)+col,gy=ty*(tile/pitch)+row;
      const x=(gx+.5)*pitch+(random(gx,gy)-.5)*pitch*.75,y=(gy+.5)*pitch+(random(gx+71,gy-39)-.5)*pitch*.75;
      if(!contains(x,y))continue;const h=ground.height(x,y);if(h===null)continue;cells.push({x,y,h,gx,gy});
    }
    if(!cells.length)return null;
    const geometry=layer.geometry.clone(),traits=new Float32Array(cells.length*3),tint=new Float32Array(cells.length*3).fill(1);
    const mesh=new InstancedMesh(geometry,layer.material,cells.length);mesh.name=`grass_${layer.name}_${tx}_${ty}`;
    for(let i=0;i<cells.length;i++){
      const {x,y,h,gx,gy}=cells[i],east=ground.height(x+1,y)??h,west=ground.height(x-1,y)??h,north=ground.height(x,y+1)??h,south=ground.height(x,y-1)??h;
      normal.set((west-east)*.5,1,(north-south)*.5).normalize();
      position.set(x,h,-y);rotation.setFromAxisAngle(up,deterministicTurn(gx,gy));rotation.premultiply(tilt.setFromUnitVectors(up,normal));
      const growth=.78+random(gx+17,gy-11)*.44,width=pitch/PITCH;scale.set(growth*width,growth,growth*width);
      matrix.compose(position,rotation,scale);mesh.setMatrixAt(i,matrix);
      traits.set([1,.87+random(gx-31,gy+57)*.26,deterministicTurn(gx+91,gy-13)],i*3);
    }
    geometry.setAttribute('flowerTint',new InstancedBufferAttribute(tint,3));geometry.setAttribute('meadowTraits',new InstancedBufferAttribute(traits,3));
    mesh.instanceMatrix.needsUpdate=true;mesh.receiveShadow=true;mesh.computeBoundingSphere();mesh.boundingSphere.radius+=3;
    return mesh;
  }
  // A bilinear heightfield cannot exceed its surrounding published samples.
  // Include every grid vertex under the tile, not only its corners: a ridge in
  // the middle must survive culling. Extra bounds cover leaning blades/wind.
  function boundsAt(tx,ty,layer){
    const key=`${tx},${ty}`;if(layer.bounds.has(key))return layer.bounds.get(key);
    const {tile}=layer,x=tx*tile,y=ty*tile;
    if(x+tile<cover.offsetX||y+tile<cover.offsetY||x>=cover.offsetX+cover.quad*cover.resolution||y>=cover.offsetY+cover.quad*cover.resolution)return null;
    const minCol=Math.max(0,Math.floor((x-cover.offsetX)/cover.quad)),maxCol=Math.min(cover.resolution-1,Math.floor((x+tile-cover.offsetX)/cover.quad));
    const minRow=Math.max(0,Math.floor((y-cover.offsetY)/cover.quad)),maxRow=Math.min(cover.resolution-1,Math.floor((y+tile-cover.offsetY)/cover.quad));
    let occupied=false;for(let row=minRow;row<=maxRow&&!occupied;row++)for(let col=minCol;col<=maxCol;col++)if(cover.covered[row*cover.resolution+col]){occupied=true;break;}
    if(!occupied){layer.bounds.set(key,null);return null;}
    const grid=ground.block,pitch=grid?.quad??cover.quad,ox=grid?.offsetX??cover.offsetX,oy=grid?.offsetY??cover.offsetY;
    let low=Infinity,high=-Infinity;
    for(let row=Math.floor((y-oy)/pitch);row<=Math.ceil((y+tile-oy)/pitch);row++)for(let col=Math.floor((x-ox)/pitch);col<=Math.ceil((x+tile-ox)/pitch);col++){
      const h=ground.height(ox+col*pitch,oy+row*pitch);if(h!==null){low=Math.min(low,h);high=Math.max(high,h);}
    }
    const sphere=Number.isFinite(low)?new Sphere(new Vector3(x+tile/2,(low+high)/2,-y-tile/2),Math.hypot(tile/2+8,tile/2+8,(high-low)/2+8)):null;
    layer.bounds.set(key,sphere);return sphere;
  }
  function update(camera,focus=meadowViewFocus(camera,ground)){
    frame++;
    const hasView=!!camera.projectionMatrix;
    if(hasView){camera.updateMatrixWorld();frustum.setFromProjectionMatrix(projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse),camera.coordinateSystem);}
    const origin=hasView?camera.position:focus;
    stats.tiles=stats.clumps=stats.nearClumps=stats.farClumps=stats.triangles=stats.visibleTiles=stats.visibleTriangles=0;
    for(const layer of layers){
      const {tile,end,start}=layer,tx=Math.floor(origin.x/tile),ty=Math.floor(-origin.z/tile),extent=Math.ceil(end/tile)+1;
      for(const entry of layer.tiles.values())if(entry.mesh)entry.mesh.visible=false;
      for(let j=-extent;j<=extent;j++)for(let i=-extent;i<=extent;i++){
        if(Math.hypot(i*tile,j*tile)>end+tile*1.5)continue;
        const x=tx+i,y=ty+j,key=`${x},${y}`,bounds=boundsAt(x,y,layer);if(!bounds)continue;
        const distance=bounds.center.distanceTo(camera.position);
        if(hasView&&(distance>end+bounds.radius||distance+bounds.radius<start))continue;
        marginSphere.copy(bounds);marginSphere.radius+=8;
        if(hasView&&!frustum.intersectsSphere(marginSphere))continue;
        let entry=layer.tiles.get(key);
        if(!entry){const mesh=tileAt(x,y,layer);entry={mesh,last:frame};layer.tiles.set(key,entry);if(mesh)group.add(mesh);}
        entry.last=frame;
        if(entry.mesh){const sphere=entry.mesh.boundingSphere,d=sphere.center.distanceTo(camera.position);entry.mesh.visible=(!hasView||frustum.intersectsSphere(sphere))&&d<end+sphere.radius&&d+sphere.radius>start;}
      }
      for(const [key,entry]of layer.tiles){
        // Keep a small cache behind the view while turning; hidden tiles do no
        // draw/vertex work. A teleport releases buffers immediately.
        const mesh=entry.mesh;
        if(frame-entry.last>90||(mesh&&mesh.boundingSphere.center.distanceTo(origin)>end+tile*3)){
          if(mesh){group.remove(mesh);release(mesh);}layer.tiles.delete(key);continue;
        }
        if(!mesh)continue;
        const triangles=mesh.count*layer.geometry.attributes.position.count/3;
        stats.tiles++;stats.triangles+=triangles;
        if(layer.name==='blades')stats.nearClumps+=mesh.count;else stats.clumps+=mesh.count;
        if(layer.name==='distant')stats.farClumps+=mesh.count;
        if(mesh.visible){stats.visibleTiles++;stats.visibleTriangles+=triangles;}
      }
    }
  }
  function dispose(){for(const layer of layers){for(const {mesh}of layer.tiles.values())if(mesh)release(mesh);layer.tiles.clear();layer.bounds.clear();}group.clear();prototype.dispose();distant.dispose();blades.dispose();material.dispose();farMaterial.dispose();bladeMaterial.dispose();}
  return {group,update,dispose,stats,contains};
}

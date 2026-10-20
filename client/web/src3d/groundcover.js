/** The core's ground-cover mask, rendered as spatially culled meadow cells.
 * All stamped cells remain represented, using bendable grass/flower kits locally and
 * a filtered opaque grass surface at distance. Density and plant appearance are client presentation.
 * No ground-cover placement instances are persisted into shared/.
 */

import { InstancedMesh, Matrix4, Group, Quaternion, Vector3, Color, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, DoubleSide } from "../vendor/three.module.min.js";
import { toonMaterial, style } from "./style.js";
import { mergePrimitives } from "./glb.js";

/** Default tile size in metres; the block is 4096 m, so 512 m → 8×8, 1024 m → 4×4. */
export const TILE_M = 512;

/**
 * One tile's worth of meadow, as an instanced mesh standing on the ground.
 *
 * `ground` is a `GroundSampler`, and it is what puts each patch on the terrain:
 * the stamp publishes which cells are covered, not how high the ground is, so
 * the height is sampled from the core's published heightfield per patch. The
 * rotation is a deterministic turn from the cell's own coordinates, so a tile
 * looks grown rather than stamped — again the client's flourish, and again it
 * is a function of the core's own grid rather than anything invented.
 *
 * `options.tileM` overrides the default tile size (512 m). Larger tiles = fewer
 * draw calls but less frustum culling granularity.
 */
export function buildMeadowTiles(cover, ground, patch, options = {}) {
  const { covered, resolution, quad, offsetX, offsetY } = coverageOf(cover);
  const tileM = options.tileM ?? TILE_M;
  const tiles = new Map();
  const stats = { tiles: 0, patches: 0, triangles: 0, skippedNoGround: 0, cells: resolution * resolution };
  const perTile = Math.ceil(4096 / tileM);
  const bucket = (x, y) => {
    const tileX = Math.min(perTile - 1, Math.max(0, Math.floor((x + 2048) / tileM)));
    const tileY = Math.min(perTile - 1, Math.max(0, Math.floor((y + 2048) / tileM)));
    return tileY * perTile + tileX;
  };

  for (let row = 0; row < resolution; row += 1) {
    for (let column = 0; column < resolution; column += 1) {
      if (!covered[row * resolution + column]) continue;
      const x = offsetX + (column + 0.5) * quad;
      const y = offsetY + (row + 0.5) * quad;
      const height = ground.height(x, y);
      if (height === null) {
        stats.skippedNoGround += 1;
        continue;
      }
      const tile = bucket(x, y);
      if (!tiles.has(tile)) tiles.set(tile, []);
      tiles.get(tile).push({ x, y, height });
    }
  }

  const group = new Group();
  group.name = "meadow";
  for (const [tile, cells] of tiles) {
    if (!cells.length) continue;
    const geometry = patch.geometry.clone();
    const flowerTints = new Float32Array(cells.length * 3),traits = new Float32Array(cells.length * 3);
    const mesh = new InstancedMesh(geometry, patch.material, cells.length);
    mesh.name = `meadow_${tile}`;
    mesh.frustumCulled = true;
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const tilt = new Quaternion(),normal = new Vector3(),up = new Vector3(0,1,0);
    const scale = new Vector3(options.patchScale ?? 1, options.patchScale ?? 1, options.patchScale ?? 1);
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      const appearance=meadowAppearance(cell.x,cell.y,options.flowerMix);
      appearance.tint.toArray(flowerTints,i*3);traits.set(appearance.traits,i*3);
      position.set(cell.x, cell.height, -cell.y);
      // A deterministic turn per cell: the meadow reads as grown, and two runs
      // over the same committed data produce the same picture.
      rotation.setFromAxisAngle(up, deterministicTurn(cell.x, cell.y));
      meadowUp(ground,cell.x,cell.y,normal);
      rotation.premultiply(tilt.setFromUnitVectors(up,normal));
      scale.setScalar((options.patchScale??1)*appearance.scale);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    if (patch.geometry.hasAttribute('petal')) geometry.setAttribute('flowerTint', new InstancedBufferAttribute(flowerTints, 3));
    if (patch.geometry.hasAttribute('bladeRoot')) geometry.setAttribute('meadowTraits',new InstancedBufferAttribute(traits,3));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 2; // conservative wind bound
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    stats.tiles += 1;
    stats.patches += cells.length;
    stats.triangles += patch.triangles * cells.length;
  }
  group.userData = stats;
  return { group, stats };
}

/** Which cells are stamped, from `ground_cover.json`. */
function coverageOf(cover) {
  if (!(cover.covered instanceof Uint8Array)) throw new Error("the stamp's decoded mask is missing");
  const quad = Number(cover.quad);
  const resolution = Number(cover.resolution);
  if (!(quad > 0) || !Number.isInteger(resolution)) throw new Error("the stamp's grid is missing");
  return cover;
}

/**
 * Merge the meadow patch asset's primitives into one geometry+material.
 * Used by the main scene to get a single patch geometry for instancing.
 */
export function patchGeometry(asset) {
  return mergePrimitives(asset.primitives, "opaque");
}

/**
 * A deterministic turn, in radians, from a cell's own row and column.
 *
 * Not a yaw from the world: the stamp has no yaw, and inventing one would be
 * the client owning the map. This is a hash, which is a decision about how the
 * same data is drawn twice.
 */
export function deterministicTurn(row, column) {
  const value = Math.sin(row * 127.1 + column * 311.7) * 43758.5453;
  return (value - Math.floor(value)) * Math.PI * 2;
}

/** Ground at the centre of the rendered view, bounded to the local detail
 * budget. A view turned in place must move detail without moving world roots.
 */
export function meadowViewFocus(camera,ground,result=new Vector3()){
  if(!camera.getWorldDirection)return result.copy(camera.position).setY(ground.height(camera.position.x,-camera.position.z)??0);
  const direction=camera.getWorldDirection(new Vector3()),origin=camera.position;
  let previous=0;
  for(let distance=4;distance<=192;distance+=4){
    const x=origin.x+direction.x*distance,z=origin.z+direction.z*distance,h=ground.height(x,-z);
    if(h!==null&&origin.y+direction.y*distance<=h){
      let low=previous,high=distance;
      for(let i=0;i<12;i++){
        const mid=(low+high)*.5,mx=origin.x+direction.x*mid,mz=origin.z+direction.z*mid;
        if(origin.y+direction.y*mid>(ground.height(mx,-mz)??-Infinity))low=mid;else high=mid;
      }
      const reach=Math.min((low+high)*.5,96/Math.max(.001,Math.hypot(direction.x,direction.z)));
      const px=origin.x+direction.x*reach,pz=origin.z+direction.z*reach;
      return result.set(px,ground.height(px,-pz)??origin.y,pz);
    }
    previous=distance;
  }
  const horizontal=Math.hypot(direction.x,direction.z),reach=horizontal>.001?64/horizontal:0;
  const x=origin.x+direction.x*reach,z=origin.z+direction.z*reach;
  return result.set(x,ground.height(x,-z)??0,z);
}

const fraction=(x,y)=>deterministicTurn(x,y)/(Math.PI*2);
function meadowNoise(x,y){
  const a=Math.floor(x),b=Math.floor(y),u=x-a,v=y-b,s=u*u*(3-2*u),t=v*v*(3-2*v);
  return (fraction(a,b)*(1-s)+fraction(a+1,b)*s)*(1-t)+(fraction(a,b+1)*(1-s)+fraction(a+1,b+1)*s)*t;
}
const FLOWER_MIX={violet:.43,white:.37,orange:.15,red:.05};
// Existing reference-kit colours, including its blue-violet rather than purple.
const FLOWERS={violet:'#5b6fc4',white:'#f0ede2',orange:'#d9792b',red:'#c74e6e'};
/** Smooth blossom drifts and per-root variation; no individual plants persisted. */
export function meadowAppearance(x,y,mix=FLOWER_MIX){
  // A nearest jittered centre gives irregular colour drifts while keeping a
  // uniform categorical draw. Thresholding smooth noise biased almost every
  // bloom to white and made the low-weight red/orange colours disappear.
  const gx=Math.floor(x/13),gy=Math.floor(y/13);let nearest=Infinity,choice=0,chosen='white';
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const a=gx+i,b=gy+j,d=(x/13-a-fraction(a,b))**2+(y/13-b-fraction(a+19,b-7))**2;
    if(d<nearest){nearest=d;choice=fraction(a+37,b-11);}
  }
  for(const [name,weight]of Object.entries(mix)){choice-=weight;if(choice<=0){chosen=name;break;}}
  return {tint:new Color(FLOWERS[chosen]),scale:.78+fraction(x+3.7,y-8.1)*.42,
    traits:[meadowNoise(x/7,y/7)*.78+fraction(x,y)*.22,.85+fraction(x-17,y+5)*.3,fraction(x+71,y-39)*Math.PI*2]};
}

/** Curved ribbon tussocks plus three generic blossom silhouettes. The close kit
 * has a smaller footprint; both are one opaque draw with the same air response.
 * These are interpretations of the stamp, not new shared botanical species.
 */
export function buildMeadowPatch({range=[150,225],close=false}={}) {
  const positions=[],colors=[],petals=[],roots=[],flexes=[],plants=[],normals=[];
  const green=new Color('#60843e'),tip=new Color('#9eaf60'),stem=new Color('#527238'),white=new Color('#fff8dc'),gold=new Color('#c39938');
  const triangle=(a,b,c,color,root,flex,plant=0,petal=0,ns=null)=>{
    positions.push(...a,...b,...c);
    const face=new Vector3().subVectors(new Vector3(...b),new Vector3(...a)).cross(new Vector3().subVectors(new Vector3(...c),new Vector3(...a))).normalize();
    for(let i=0;i<3;i++){colors.push(color.r,color.g,color.b);petals.push(petal);roots.push(...root);flexes.push(flex);plants.push(plant);normals.push(...(ns?.[i]??face.toArray()));}
  };
  // A curved midpoint and a tip retain the silhouette without alpha edges.
  function ribbon(root,angle,h,w,curve,color,flex,plant=0){
    const dx=Math.cos(angle),dz=Math.sin(angle),rows=[0,.55,1].map(t=>{
      const width=w*(1-t*t),bend=curve*t*t;
      const p=[root[0]-dz*bend,root[1]+h*t,root[2]+dx*bend];
      const n=new Vector3(dz*h,curve*2*t+h*.32,-dx*h).normalize().toArray();
      return {a:[p[0]-dx*width,p[1],p[2]-dz*width],b:[p[0]+dx*width,p[1],p[2]+dz*width],n};
    });
    for(let j=0;j<rows.length-1;j++){
      const a=rows[j],b=rows[j+1],c=color.clone().lerp(tip,j*.13);
      triangle(a.a,a.b,b.a,c,root,flex,plant,0,[a.n,a.n,b.n]);
      if(j<rows.length-2)triangle(a.b,b.b,b.a,c,root,flex,plant,0,[a.n,b.n,b.n]);
    }
  }
  for(let tuft=0;tuft<(close?8:4);tuft++){
    const angle=deterministicTurn(tuft,31),radius=Math.sqrt(fraction(tuft,71))*(close?1.2:3.4);
    const x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    for(let leaf=0;leaf<(close?5:6);leaf++){
      const seed=tuft*(close?5:6)+leaf,a=deterministicTurn(seed,19),r=fraction(seed,49)*.13;
      // Middle tussocks retain enough projected leaf area to read from a
      // low glide; using the walking widths there exposed only the turf bed.
      ribbon([x+Math.cos(a)*r,0,z+Math.sin(a)*r],a,(close?.38:.48)+fraction(seed,83)*(close?.57:.7),
        (close?.025:.075)+fraction(seed,11)*(close?.018:.03),.12+fraction(seed,7)*.32,
        green.clone().lerp(tip,fraction(seed,13)*.3),.8+fraction(seed,97)*.4);
    }
  }
  for(let i=0;i<3;i++){
    const phase=deterministicTurn(i,42),radius=close?.67:2.7,root=[Math.cos(phase)*radius,0,Math.sin(phase)*radius];
    const h=[.64,.92,.48][i],flex=[.72,.52,.9][i],plant=[.42,.58,.7][i];
    const head=[root[0]+.09,h,root[2]-.04];
    triangle([root[0]-.009,0,root[2]],[root[0]+.009,0,root[2]],head,stem,root,flex,plant);
    for(let leaf=0;leaf<2;leaf++){
      const y=h*(.22+leaf*.2),p=[root[0]+.09*y/h,y,root[2]-.04*y/h],a=phase+leaf*Math.PI;
      triangle(p,[p[0]+Math.cos(a)*.17,p[1]+.11,p[2]+Math.sin(a)*.17],[p[0]+Math.cos(a+.6)*.10,p[1]+.02,p[2]+Math.sin(a+.6)*.10],green,root,flex,plant);
    }
    // Ray head with a warm centre, upright florets, and a small cupped head.
    const rings=i===1?2:1,count=close?(i===0?6:5):4;
    for(let ring=0;ring<rings;ring++)for(let j=0;j<count;j++){
      const a=j/count*Math.PI*2+phase+ring*.7,b=a+Math.PI*2/count*.7;
      const y=h+ring*.065,r=i===1?.068-ring*.009:i===0?.115:.095;
      const centre=[head[0],y,head[2]],lift=i===2?.075:.018;
      const inner=[head[0]+Math.cos(a)*r*.28,y+.012,head[2]+Math.sin(a)*r*.28];
      const outer=[head[0]+Math.cos(a)*r,y+lift,head[2]+Math.sin(a)*r];
      const edge=[head[0]+Math.cos(b)*r,y+lift,head[2]+Math.sin(b)*r];
      triangle(centre,inner,edge,i===0?gold:white,root,flex,plant,i===0?0:1);
      triangle(inner,outer,edge,white,root,flex,plant,1);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.setAttribute('petal',new Float32BufferAttribute(petals,1));
  geometry.setAttribute('bladeRoot',new Float32BufferAttribute(roots,3));
  geometry.setAttribute('flex',new Float32BufferAttribute(flexes,1));
  geometry.setAttribute('plant',new Float32BufferAttribute(plants,1));
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.computeBoundingSphere();
  const material=toonMaterial({name:'meadow_toon',vertexColors:true,side:DoubleSide},{meadow:true,meadowRange:range,meadowFocused:close});
  return {geometry,material,triangles:positions.length/9};
}

/** Ground-tangent placement, in the same east/up/south frame as terrain. */
function meadowUp(ground,x,y,result){
  const h=ground.height(x,y),e=ground.height(x+1,y)??h,w=ground.height(x-1,y)??h;
  const n=ground.height(x,y+1)??h,s=ground.height(x,y-1)??h;
  return result.set((w-e)*.5,1,(n-s)*.5).normalize();
}

/** Dense local sward, regenerated on 12 m boundaries and faded before its rim. */
export function buildCloseMeadow(cover,ground,{flowerMix}={}){
  const patch=buildMeadowPatch({range:[27,37],close:true}),capacity=6400;
  const mesh=new InstancedMesh(patch.geometry,patch.material,capacity);
  const tint=new Float32Array(capacity*3);mesh.geometry.setAttribute('flowerTint',new InstancedBufferAttribute(tint,3));
  const traits=new Float32Array(capacity*3);mesh.geometry.setAttribute('meadowTraits',new InstancedBufferAttribute(traits,3));
  mesh.count=0;mesh.name='close_lush_meadow';mesh.receiveShadow=true;
  let lastX=Infinity,lastY=Infinity;
  const matrix=new Matrix4(),q=new Quaternion(),up=new Vector3(0,1,0),position=new Vector3(),scale=new Vector3(.72,.85,.72);
  const tilt=new Quaternion(),normal=new Vector3();
  const contains=(x,y)=>{const col=Math.floor((x-cover.offsetX)/cover.quad),row=Math.floor((y-cover.offsetY)/cover.quad);return row>=0&&col>=0&&row<cover.resolution&&col<cover.resolution&&cover.covered[row*cover.resolution+col];};
  function update(camera,focus=meadowViewFocus(camera,ground)){
    style.meadowFocus.value.copy(focus);
    const cx=Math.round(focus.x/12)*12,cy=Math.round(-focus.z/12)*12;
    const agl=camera.position.y-(ground.height(camera.position.x,-camera.position.z)??0);
    mesh.visible=agl<140;if(!mesh.visible||cx===lastX&&cy===lastY)return;
    lastX=cx;lastY=cy;let n=0;
    // The window may move; the lattice stays in world space. 12 m is not a
    // multiple of 1.35 m, so adding offsets to cx/cy moved every surviving root.
    const baseX=Math.round(cx/1.35),baseY=Math.round(cy/1.35);
    // 55.35 m leaves room for the 43 m longest clump fade, the observer's
    // offset from a snapped centre, and the kit/wind bounds. Capacity covers
    // this disk even when every candidate falls on grass.
    for(let j=-41;j<=41;j++)for(let i=-41;i<=41;i++){
      if(i*i+j*j>41*41)continue;
      const gx=baseX+i,gy=baseY+j;
      const x=gx*1.35+(fraction(gx,gy)-.5)*.8,y=gy*1.35+(fraction(gx+27,gy-61)-.5)*.8;if(!contains(x,y))continue;
      const h=ground.height(x,y);if(h===null)continue;
      const angle=deterministicTurn(x,y);
      const appearance=meadowAppearance(x,y,flowerMix);scale.set(.92*appearance.scale,.9*appearance.scale,.92*appearance.scale);
      position.set(x,h,-y);q.setFromAxisAngle(up,angle);meadowUp(ground,x,y,normal);q.premultiply(tilt.setFromUnitVectors(up,normal));matrix.compose(position,q,scale);mesh.setMatrixAt(n,matrix);
      appearance.tint.toArray(tint,n*3);traits.set(appearance.traits,n*3);n++;
    }
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.flowerTint.needsUpdate=true;mesh.geometry.attributes.meadowTraits.needsUpdate=true;mesh.computeBoundingSphere();
    if(mesh.boundingSphere)mesh.boundingSphere.radius+=2;
  }
  return {mesh,update,contains};
}

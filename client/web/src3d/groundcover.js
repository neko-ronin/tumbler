/** The core's ground-cover mask, rendered as spatially culled meadow cells.
 * All stamped cells remain represented, using the same bendable grass/flower
 * kit at every distance. Density and plant appearance are client presentation.
 * No ground-cover placement instances are persisted into shared/.
 */

import { InstancedMesh, Matrix4, Group, Quaternion, Vector3, Color, BufferGeometry, Float32BufferAttribute, InstancedBufferAttribute, DoubleSide } from "../vendor/three.module.min.js";
import { toonMaterial } from "./style.js";
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
    const flowerTints = new Float32Array(cells.length * 3);
    const mesh = new InstancedMesh(geometry, patch.material, cells.length);
    mesh.name = `meadow_${tile}`;
    mesh.frustumCulled = true;
    const matrix = new Matrix4();
    const position = new Vector3();
    const rotation = new Quaternion();
    const scale = new Vector3(options.patchScale ?? 1, options.patchScale ?? 1, options.patchScale ?? 1);
    for (let i = 0; i < cells.length; i += 1) {
      const cell = cells[i];
      const weights = options.flowerMix ?? { violet: .43, white: .37, orange: .15, red: .05 };
      const palette = { violet: '#a990da', white: '#fff3cb', orange: '#eeb76a', red: '#d98185' };
      let choice = deterministicTurn(Math.floor(cell.x / 24), Math.floor(cell.y / 24)) / (Math.PI * 2);
      let chosen = 'white';
      for (const [name, weight] of Object.entries(weights)) { choice -= weight; if (choice <= 0) { chosen = name; break; } }
      new Color(palette[chosen]).toArray(flowerTints, i * 3);
      position.set(cell.x, cell.height, -cell.y);
      // A deterministic turn per cell: the meadow reads as grown, and two runs
      // over the same committed data produce the same picture.
      rotation.setFromAxisAngle(new Vector3(0, 1, 0), deterministicTurn(cell.x, cell.y));
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    if (patch.geometry.hasAttribute('petal')) geometry.setAttribute('flowerTint', new InstancedBufferAttribute(flowerTints, 3));
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

/** One uniform meadow kit: bendable blades and petalled wildflowers, 8 m wide. */
export function buildMeadowPatch() {
  const positions = [], colors = [], petals = [];
  const green = new Color('#668940'), tip = new Color('#93ad58');
  const triangle = (a,b,c,color,petal=0) => {
    positions.push(...a,...b,...c);
    for(let i=0;i<3;i++){colors.push(color.r,color.g,color.b);petals.push(petal);}
  };
  for(let i=0;i<12;i++){
    const phase=deterministicTurn(i,19), x=Math.sin(phase)*(1+(i%4))*.9, z=Math.cos(phase)*(1+(i%5))*.72;
    const h=.55+(i%5)*.17, w=.16+(i%3)*.045;
    const dx=Math.cos(phase)*w,dz=Math.sin(phase)*w;
    const a=[x-dx,0,z-dz], b=[x+dx,0,z+dz];
    const midA=[x-dx*.55+.10,h*.52,z-dz*.55+.05],midB=[x+dx*.55+.10,h*.52,z+dz*.55+.05];
    triangle(a,b,midA,green);triangle(b,midB,midA,green);
    triangle(midA,midB,[x+.24,h,z+.12],i%3===0 ? tip : green);
  }
  const white=new Color('#fff8dc');
  for(let i=0;i<5;i++){
    const phase=deterministicTurn(i,42),x=Math.cos(phase)*3.2,z=Math.sin(phase)*3.2,h=.7+i*.1;
    triangle([x-.04,0,z],[x+.04,0,z],[x,h,z],green);
    for(let j=0;j<5;j++){
      const a=j/5*Math.PI*2,b=a+.8;
      triangle([x,h,z],[x+Math.cos(a)*.17,h+.07,z+Math.sin(a)*.17],[x+Math.cos(b)*.17,h+.07,z+Math.sin(b)*.17],white,1);
    }
  }
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new Float32BufferAttribute(colors,3));
  geometry.setAttribute('petal',new Float32BufferAttribute(petals,1));
  geometry.computeVertexNormals();geometry.computeBoundingSphere();
  const material=toonMaterial({name:'meadow_toon',vertexColors:true,side:DoubleSide},{meadow:true});
  return {geometry,material,triangles:positions.length/9};
}

/** Dense close sward, regenerated only on a 12 m cell boundary. Reads the
 * stamp at each root; the distant colour remains the terrain's interpretation.
 */
export function buildCloseMeadow(cover,ground){
  const patch=buildMeadowPatch(),capacity=6400;
  const mesh=new InstancedMesh(patch.geometry,patch.material,capacity);
  const tint=new Float32Array(capacity*3);mesh.geometry.setAttribute('flowerTint',new InstancedBufferAttribute(tint,3));
  mesh.count=0;mesh.name='close_lush_meadow';mesh.receiveShadow=true;
  let lastX=Infinity,lastY=Infinity;
  const matrix=new Matrix4(),q=new Quaternion(),up=new Vector3(0,1,0),position=new Vector3(),scale=new Vector3(.72,.85,.72);
  const palette=['#aa82dc','#fff2ca','#f0b05d','#df828d'].map(c=>new Color(c));
  const contains=(x,y)=>{const col=Math.floor((x-cover.offsetX)/cover.quad),row=Math.floor((y-cover.offsetY)/cover.quad);return row>=0&&col>=0&&row<cover.resolution&&col<cover.resolution&&cover.covered[row*cover.resolution+col];};
  function update(camera){
    const cx=Math.round(camera.position.x/12)*12,cy=Math.round(-camera.position.z/12)*12;
    const agl=camera.position.y-(ground.height(cx,cy)??0);
    mesh.visible=agl<140;if(!mesh.visible||cx===lastX&&cy===lastY)return;
    lastX=cx;lastY=cy;let n=0;
    for(let j=-35;j<=35;j++)for(let i=-35;i<=35;i++){
      if(i*i+j*j>35*35)continue;
      const x=cx+i*1.35,y=cy+j*1.35;if(!contains(x,y))continue;
      const h=ground.height(x,y);if(h===null)continue;
      const angle=deterministicTurn(x,y);
      position.set(x,h,-y);q.setFromAxisAngle(up,angle);matrix.compose(position,q,scale);mesh.setMatrixAt(n,matrix);
      palette[Math.floor(deterministicTurn(Math.floor(x/9),Math.floor(y/9))/Math.PI/2*4)%4].toArray(tint,n*3);n++;
    }
    mesh.count=n;mesh.instanceMatrix.needsUpdate=true;mesh.geometry.attributes.flowerTint.needsUpdate=true;mesh.computeBoundingSphere();
    if(mesh.boundingSphere)mesh.boundingSphere.radius+=2;
  }
  return {mesh,update,contains};
}

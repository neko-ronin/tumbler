/** Wet-meadow corn lilies (Veratrum californicum): the broad-leaved plant that stands a metre and
 * more above a Sierra meadow's grass, in clumps where the ground stays wet beside the river and lake.
 * A different texture from grass entirely: wide, pleated, pale leaves spiralling up a stalk.
 * Client presentation only. Roots sit on a world lattice (they never swim with the view), chosen
 * from the terrain's own water field (style.waterLevel: nearest water's distance) and the meadow's
 * stand noise; the layer is rebuilt as the focus moves. Bends in the shared meadow air like grass.
 */
import {BufferGeometry,Float32BufferAttribute,InstancedBufferAttribute,InstancedMesh,Matrix4,Quaternion,Vector3,Color,DoubleSide,DataUtils} from '../vendor/three.module.min.js';
import {toonMaterial,style} from './style.js';
import {coverAmount} from './heights.js';
import {onRock,deterministicTurn} from './groundcover.js';
import {meadowStandAt} from './meadow-shading.js';

const fraction=(x,y)=>deterministicTurn(x,y)/(Math.PI*2);

/** One plant, about 1.6 m: a stalk and nine leaves in a 2/5 spiral, broad below and narrowing up. Each leaf is
 * a cupped blade folded into pleats along its length (a zigzag across it), so light and shade run
 * in stripes, which is what makes a corn lily read at a distance. */
export function cornLilyGeometry(){
  const p=[],c=[],n=[];
  const pale=new Color('#8fb055'),fold=new Color('#5f8338'),stem=new Color('#7c9a48');
  const push=(v,col,nn)=>{p.push(...v);c.push(col.r,col.g,col.b);n.push(...nn);};
  const tri=(a,b,d,ca,cb,cd)=>{
    const e1=new Vector3(...b).sub(new Vector3(...a)),e2=new Vector3(...d).sub(new Vector3(...a)),nn=e1.cross(e2).normalize();
    if(nn.y<0)nn.negate();push(a,ca,nn.toArray());push(b,cb,nn.toArray());push(d,cd,nn.toArray());
  };
  // Stalk: two crossed tapered strips.
  for(const a of [0,Math.PI/2]){const dx=Math.cos(a)*.018,dz=Math.sin(a)*.018;
    tri([-dx,0,-dz],[dx,0,dz],[0,1.6,0],stem,stem,stem);}
  const across=[-1,-.5,0,.5,1],pleat=[0,1,0,1,0];
  for(let k=0;k<9;k++){
    const turn=k*2.39996,up=.12+k*.15,len=.52-k*.035,wid=.25-k*.017,dx=Math.cos(turn),dz=Math.sin(turn);
    const rows=[0,.3,.65,1].map(t=>{
      // Rises, then arches out and down; widest a third of the way along.
      const out=t*len,rise=Math.sin(t*Math.PI*.55)*len*.45-t*t*len*.18,w=wid*Math.sin(Math.min(1,t*1.15+.12)*Math.PI)*(t<.05?.4:1);
      return across.map((s,j)=>{const cup=Math.abs(s)*w*.35,z=pleat[j]*.012*(1-t);
        return [dx*out-dz*s*w,up+rise+cup+z,dz*out+dx*s*w];});
    });
    for(let r=0;r<3;r++)for(let j=0;j<4;j++){
      const a=rows[r][j],b=rows[r][j+1],d=rows[r+1][j],e=rows[r+1][j+1],ca=pleat[j]?pale:fold,cb=pleat[j+1]?pale:fold;
      tri(a,b,d,ca,cb,ca);tri(b,e,d,cb,cb,ca);
    }
  }
  const g=new BufferGeometry(),count=p.length/3;
  g.setAttribute('position',new Float32BufferAttribute(p,3));g.setAttribute('color',new Float32BufferAttribute(c,3));g.setAttribute('normal',new Float32BufferAttribute(n,3));
  // The meadow material's per-vertex plant inputs: one base for the whole plant, a stiff stalk.
  g.setAttribute('bladeRoot',new Float32BufferAttribute(new Float32Array(count*3),3));
  g.setAttribute('flex',new Float32BufferAttribute(new Float32Array(count).fill(.32),1));
  for(const name of ['petal','plant'])g.setAttribute(name,new Float32BufferAttribute(new Float32Array(count),1));
  g.computeBoundingSphere();return g;
}

/** Distance to the nearest water (m) from the terrain's half-float field; Infinity before it exists. */
function waterDistance(x,y){
  const tex=style.waterLevel.value,grid=style.waterLevelGrid.value;if(!tex||!grid.w)return Infinity;
  const size=tex.image.width,u=Math.min(size-1,Math.max(0,Math.floor((x-grid.x)/grid.z*size))),v=Math.min(size-1,Math.max(0,Math.floor((y-grid.y)/grid.z*size)));
  return DataUtils.fromHalfFloat(tex.image.data[(v*size+u)*2+1]);
}

/** How likely a 2.5 m cell holds a corn lily: wet ground near water, in clumps, on grass. */
export function cornLilyChance(distance,stand,clump){
  const wet=1-Math.min(1,Math.max(0,(distance-10)/170));
  return Math.min(1,wet*wet*Math.max(0,(stand-.35)*2.6)*Math.max(0,(clump-.3)*2.4));
}

export function buildCornLilies(cover,ground,{range=120,pitch=2.5,capacity=2400}={}){
  const geometry=cornLilyGeometry();
  const material=toonMaterial({name:'corn_lily',vertexColors:true,side:DoubleSide},{meadow:true,meadowRange:[range*.8,range]});
  const mesh=new InstancedMesh(geometry,material,capacity);mesh.name='corn_lilies';mesh.count=0;mesh.receiveShadow=true;mesh.castShadow=false;
  const tint=new Float32Array(capacity*3).fill(1),traits=new Float32Array(capacity*3);
  geometry.setAttribute('flowerTint',new InstancedBufferAttribute(tint,3));geometry.setAttribute('meadowTraits',new InstancedBufferAttribute(traits,3));
  const matrix=new Matrix4(),q=new Quaternion(),up=new Vector3(0,1,0),position=new Vector3(),scale=new Vector3();
  let lastX=Infinity,lastY=Infinity;const stats={plants:0};
  function update(camera,focus){
    const cx=Math.round(focus.x/10)*10,cy=Math.round(-focus.z/10)*10;
    const agl=camera.position.y-(ground.height(camera.position.x,-camera.position.z)??0);
    mesh.visible=agl<200;if(!mesh.visible||cx===lastX&&cy===lastY)return;
    lastX=cx;lastY=cy;let count=0;const span=Math.ceil(range/pitch),gx0=Math.round(cx/pitch),gy0=Math.round(cy/pitch);
    for(let j=-span;j<=span&&count<capacity;j++)for(let i=-span;i<=span&&count<capacity;i++){
      if(i*i+j*j>span*span)continue;
      const gx=gx0+i,gy=gy0+j,x=(gx+.2+fraction(gx,gy)*.6)*pitch,y=(gy+.2+fraction(gx+13,gy-7)*.6)*pitch;
      const d=waterDistance(x,y);if(d<3)continue;
      const s=meadowStandAt(x,-y),clump=fraction(Math.floor(x/9),Math.floor(y/9))*.5+fraction(Math.floor(x/23)+5,Math.floor(y/23)-3)*.5;
      if(fraction(gx-31,gy+17)>cornLilyChance(d,s.stand,clump))continue;
      if(coverAmount(cover,x,y)<.5||onRock(ground,x,y,.5))continue;
      const h=ground.height(x,y);if(h===null)continue;
      const size=.85+fraction(gx+3,gy+9)*.5;
      position.set(x,h-.02,-y);q.setFromAxisAngle(up,deterministicTurn(gx,gy));scale.set(size,size*(.9+fraction(gx,gy+1)*.35),size);
      mesh.setMatrixAt(count,matrix.compose(position,q,scale));traits.set([1,.9+fraction(gx-5,gy)*.2,deterministicTurn(gx+91,gy-13)],count*3);count++;
    }
    mesh.count=stats.plants=count;mesh.instanceMatrix.needsUpdate=true;geometry.attributes.meadowTraits.needsUpdate=true;
    mesh.computeBoundingSphere();if(mesh.boundingSphere)mesh.boundingSphere.radius+=2;
  }
  return {mesh,update,stats,dispose(){geometry.dispose();material.dispose();}};
}

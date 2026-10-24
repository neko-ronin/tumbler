/** Coast-redwood foliage: connected limbs, secondary boughs and flattened
 * two-ranked needle sprays. Engine-neutral, seeded, metres and Y-up.
 * The same contours become folded leaves at LOD 0 and curved cutout cards at
 * LOD 1. No radial scales, closed clumps or camera-facing near foliage.
 */
const TAU=Math.PI*2;
const add=(a,b)=>a.map((n,i)=>n+b[i]),sub=(a,b)=>a.map((n,i)=>n-b[i]),mul=(a,s)=>a.map(n=>n*s);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=a=>mul(a,1/(Math.hypot(...a)||1));
const rnd=(seed,id)=>{const n=Math.sin(seed*17.137+id*127.13)*43758.5453;return n-Math.floor(n);};
export const SPRAY_ATLAS={variants:16,columns:4,rows:4,tile:512};

/** Shared silhouettes, in local UV coordinates. Lower pairs are longer;
 * alternating attachment and forward-pointing tips keep this a leafy twig. */
export function sprayContours(variant=0,profile="redwood"){
  if(profile!=="redwood")return coniferContours(variant,profile);
  const leaves=[],pairs=13+variant%3,r=id=>rnd(variant+41,id);
  const stem=t=>.5+Math.sin(t*3.1+variant)*.018*t;
  for(let i=0;i<pairs;i++)for(const flank of [-1,1]){
    const t=.07+i/(pairs-1)*.82+(flank>0?.011:0),x=stem(t);
    const length=(.24+.13*Math.sin(Math.PI*t)**.65)*(.88+r(i*7+flank)*.16)*(1-t*.38);
    const tip=[x+flank*length,t+.085+length*.12];
    const centre=[x+(tip[0]-x)*.43,t+(tip[1]-t)*.43],width=.021+r(i*13)*.011;
    leaves.push([[x,t],[centre[0]-width*.16,centre[1]+width],[...tip],[centre[0]+width*.16,centre[1]-width]]);
  }
  leaves.push([[stem(.8)-.011,.8],[stem(.86)-.022,.87],[stem(1),.985],[stem(.86)+.022,.87]]);
  return {leaves,stem};
}
export const needleTone=(variant,index,count)=>index>=count-5?3:rnd(variant+71,index)<.18?1:2;

/** Nine flat sprays form a secondary bough. Their exact needle outlines are
 * shared between the near hybrid geometry and the middle-distance carrier. */
export function boughSprays(variant){
  const result=[];
  for(let j=0;j<4;j++)for(const flank of [-1,1]){
    const v=.07+j*.16,angle=flank*(.69+rnd(variant,j+flank+30)*.12),length=(.46-v*.14);
    result.push({origin:[.5,v],direction:[Math.sin(angle),Math.cos(angle)],length,variant:(variant+j*3+(flank+1))%8});
  }
  result.push({origin:[.5,.57],direction:[.05,1],length:.42,variant:variant%8});return result;
}
const boughUV=(spray,[u,v])=>{
  const [x,y]=spray.direction,L=spray.length;
  return [spray.origin[0]+(x*v*L+y*(u-.5)*L*.64)/.95,spray.origin[1]+y*v*L-x*(u-.5)*L*.64];
};

/** Original source colors follow individual needles; fresh green is confined
 * to the tips. Mid-green padding avoids dark mip fringes. No reference image
 * or hand-painted palette is baked into the texture. */
export function rasterSprayAtlas(palette=[[41,75,55],[63,106,71],[100,134,88]],profile="redwood"){
  const {tile,columns,rows,variants}=SPRAY_ATLAS,width=tile*columns,height=tile*rows;
  const pixels=new Uint8Array(width*height*4);for(let i=0;i<pixels.length;i+=4)pixels.set([...palette[1],0],i);
  const inside=(x,y,p)=>{let yes=false;for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i][1]>y)!==(p[j][1]>y)&&x<(p[j][0]-p[i][0])*(y-p[i][1])/(p[j][1]-p[i][1])+p[i][0])yes=!yes;return yes;};
  for(let v=0;v<variants;v++){
    const parts=v<8?[{variant:v,transform:uv=>uv}]:boughSprays(v-8).map(s=>({variant:s.variant,transform:uv=>boughUV(s,uv)})),shapes=[];
    for(const part of parts){const {leaves,stem}=sprayContours(part.variant,profile);shapes.push(...leaves.map((p,i)=>({polygon:p.map(part.transform),tone:needleTone(part.variant,i,leaves.length)})));
    // The fine central rachis is green, not a thick woody stick.
    for(let i=0;i<16;i++){const a=i/16,b=(i+1)/16;shapes.push({polygon:[[stem(a)-.004,a],[stem(a)+.004,a],[stem(b)+.003,b],[stem(b)-.003,b]].map(part.transform),tone:2});}}
    const alpha=new Uint8Array(tile*tile),tones=new Uint8Array(tile*tile).fill(2);
    for(const {polygon:shape,tone} of shapes){
      const lo=shape[0].map((_,a)=>Math.max(0,Math.floor(Math.min(...shape.map(p=>p[a]))*tile)-1));
      const hi=shape[0].map((_,a)=>Math.min(tile-1,Math.ceil(Math.max(...shape.map(p=>p[a]))*tile)+1));
      for(let y=lo[1];y<=hi[1];y++)for(let x=lo[0];x<=hi[0];x++){
        let n=0;for(const dy of [.25,.75])for(const dx of [.25,.75])n+=inside((x+dx)/tile,(y+dy)/tile,shape)?1:0;
        if(n){alpha[y*tile+x]=Math.max(alpha[y*tile+x],Math.round(n*255/4));tones[y*tile+x]=tone;}
      }
    }
    for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){const i=((Math.floor(v/columns)*tile+y)*width+v%columns*tile+x)*4;pixels.set([...palette[tones[y*tile+x]-1],alpha[y*tile+x]],i);}
  }
  return {pixels,width,height};
}

function coniferContours(variant,profile){
  const leaves=[],stem=t=>.5+Math.sin(t*4+variant)*.012;
  const pairs=profile==='pine'?24:19+variant%3;
  for(let i=0;i<pairs;i++)for(const flank of [-1,1]){
    const t=profile==='pine'?.12+Math.floor(i/8)*.24:.05+i/(pairs-1)*.85;
    const spread=profile==='pine'?(i%8)*.024:0,base=[stem(t)+flank*.003,t];
    const length=profile==='pine'?.28+rnd(variant+13,i)*.18:.26*(.8+.2*Math.sin(t*Math.PI));
    const tip=[base[0]+flank*(length-spread),t+(profile==='pine'?.19+spread*1.3:.04)],dx=tip[0]-base[0],dy=tip[1]-base[1],l=Math.hypot(dx,dy),width=profile==='pine'?.014:.013;
    const mid=[base[0]+dx*.44,base[1]+dy*.44];leaves.push([base,[mid[0]-dy/l*width,mid[1]+dx/l*width],tip,[mid[0]+dy/l*width,mid[1]-dx/l*width]]);
  }
  return {leaves,stem};
}
export class SprayMesh{
  positions=[];normals=[];colors=[];uv=[];ao=[];kind=[];tone=[];indices=[];
  vertex(p,n,kind,tone,uv=[0,0],ao=1){const i=this.positions.length/3;this.positions.push(...p);this.normals.push(...n);this.colors.push(1,1,1);this.uv.push(...uv);this.ao.push(ao);this.kind.push(kind);this.tone.push(tone);return i;}
  constructor({repairFacing=false,profile='redwood',support=null}={}){this.repairFacing=repairFacing;this.profile=profile;this.support=support;}
  tri(a,b,c){
    if(this.repairFacing){const p=i=>this.positions.slice(i*3,i*3+3),n=i=>this.normals.slice(i*3,i*3+3),face=cross(sub(p(b),p(a)),sub(p(c),p(a))),normal=add(add(n(a),n(b)),n(c));if(face.reduce((s,v,i)=>s+v*normal[i],0)<0)[b,c]=[c,b];}
    this.indices.push(a,b,c);
  }
  tube(points,radius,sides){
    const rings=points.map((p,j)=>{const t=j/(points.length-1),axis=unit(sub(points[Math.min(j+1,points.length-1)],points[Math.max(0,j-1)]));
      const u=unit(cross(axis,Math.abs(axis[1])>.95?[1,0,0]:[0,1,0])),v=cross(u,axis);
      return Array.from({length:sides},(_,k)=>{const a=k/sides*TAU,n=add(mul(u,Math.cos(a)),mul(v,Math.sin(a)));
        return this.vertex(add(p,mul(n,radius*(.025+.975*(1-t)**1.2))),n,0,0,[k/sides,t]);});});
    for(let j=0;j<rings.length-1;j++)for(let k=0;k<sides;k++){const a=rings[j][k],b=rings[j][(k+1)%sides],c=rings[j+1][k],d=rings[j+1][(k+1)%sides];this.tri(a,c,b);this.tri(b,c,d);}
  }
  bough(at,along,normal,length,variant,tone,lod,ao,seed,explicitStride){
    const side=unit(cross(along,normal)),up=unit(cross(side,along)),width=length*.95;
    const point=([u,v])=>add(at,add(mul(along,length*v),add(mul(side,(u-.5)*width),mul(up,length*(-.20*v*v+.08*Math.sin(v*Math.PI))+(u-.5)**2*length*.24))));
    const normalAt=([u,v])=>unit(add(up,add(mul(along,.40*v-.08*Math.PI*Math.cos(v*Math.PI)),mul(side,-(u-.5)*.48/.95))));
    const card=(map,atlasVariant)=>{
      const atlasUV=([u,v])=>[(atlasVariant%4+u)/4,(Math.floor(atlasVariant/4)+v)/4];
      const strips=[];
      for(let j=0;j<=3;j++){const v=j/3;strips.push([0,1].map(u=>this.vertex(point(map([u,v])),normalAt(map([u,v])),2,tone,atlasUV([u,v]),ao)));}
      for(let j=0;j<3;j++){const a=strips[j][0],b=strips[j][1],c=strips[j+1][0],d=strips[j+1][1];this.tri(a,c,b);this.tri(b,c,d);}
    };
    if(this.support)for(const u of [0,.5,1])for(let j=0;j<=12;j++)this.support(point([u,j/12]),length*.02);
    if(lod===1){card(uv=>uv,variant+8);return;}
    boughSprays(variant).forEach((s,index)=>{
      const map=uv=>boughUV(s,uv);
      if((seed+index)%explicitStride){card(map,s.variant);return;}
      const {leaves,stem}=sprayContours(s.variant,this.profile);
      leaves.forEach((leaf,index)=>{const color=needleTone(s.variant,index,leaves.length),ids=leaf.map((uv,i)=>{const b=map(uv),n=unit(add(normalAt(b),mul(side,i===1?.18:i===3?-.18:0)));return this.vertex(add(point(b),mul(up,i===0||i===2?length*.003:0)),n,1,color,[0,0],ao);});this.tri(ids[0],ids[1],ids[2]);this.tri(ids[0],ids[2],ids[3]);});
      const rachis=[[stem(0)-.004,0],[stem(0)+.004,0],[stem(.97)+.003,.97],[stem(.97)-.003,.97]].map(uv=>this.vertex(point(map(uv)),normalAt(map(uv)),1,tone,[0,0],ao));
      this.tri(rachis[0],rachis[1],rachis[2]);this.tri(rachis[0],rachis[2],rachis[3]);
    });
  }
}

export function buildRedwoodSprays(p,lod=0){
  if(![0,1].includes(lod))throw new Error('Redwood spray sources support LOD 0 and 1');
  for(const key of ['heightM','crownWidthM','primaryBranches','secondaryPairs','explicitSprayStride'])if(!Number.isFinite(p[key])||p[key]<=0)throw new Error('Invalid redwood geometry parameter: '+key);
  if(p.primaryBranches>400||p.secondaryPairs>9||p.explicitSprayStride<2)throw new Error('Redwood recipe exceeds the bounded source geometry budget');
  const m=new SprayMesh(),r=id=>rnd(p.seed,id),sprays=[];
  const limbs=Math.round(p.primaryBranches),pairs=Math.round(p.secondaryPairs);
  for(let i=0;i<limbs;i++){
    const f=(i+.35+r(i)*.3)/limbs,a=i*137.507764*Math.PI/180+(r(i+1)-.5)*.43;
    const radial=[Math.cos(a),0,Math.sin(a)],side=[-Math.sin(a),0,Math.cos(a)];
    const reach=p.crownWidthM*.47*(1-f)**p.taper*(.78+r(i+10)*.3),base=p.heightM*(p.crownBase+(1-p.crownBase)*f);
    const branch=t=>add(mul(radial,reach*t),add(mul(side,Math.sin(t*Math.PI)*reach*(r(i+99)-.5)*.22),[0,base+reach*(-.20*t+.43*t*t*t),0]));
    m.tube(Array.from({length:lod===0?7:5},(_,j)=>branch(j/(lod===0?6:4))),(.075+reach*.022)*(1-f*.25),lod===0?7:5);
    for(let j=0;j<pairs;j++)for(const flank of [-1,1]){
      const id=i*137+j*11+(flank+1)*3,t=.12+j/pairs*.82,at=branch(t);
      const len=(.45+reach*.29)*(1-t*.36)*(.8+r(id+22)*.3);
      const direction=unit(add(mul(radial,.32+t*.44),add(mul(side,flank*(.90-.25*t)),[0,-.12-r(id+32)*.28,0])));
      const path=u=>add(at,add(mul(direction,len*u),[0,len*(-.12*Math.sin(u*Math.PI)+.2*u*u*u),0]));
      m.tube(lod===0?[path(0),path(.33),path(.7),path(1)]:[path(0),path(.5),path(1)],.009+len*.010,3);
      const roll=(r(id+45)-.5)*2.8,normal=unit(add([0,Math.cos(roll),0],mul(side,Math.sin(roll))));
      const tone=r(id+93)<.12+f*.15?3:r(id+41)<.35?1:2;
      sprays.push({at,axis:direction,normal,length:len*1.18,variant:id%8,tone,ao:.76+.22*t,seed:id});
    }
  }
  // Branches are emitted before foliage for portable material ranges.
  const woodIndices=[...m.indices];m.indices=[];
  for(const s of sprays)m.bough(s.at,s.axis,s.normal,s.length,s.variant,s.tone,lod,s.ao,s.seed,p.explicitSprayStride);
  const generated=m.indices;const wood=[...woodIndices],leaf=[];
  for(let i=0;i<generated.length;i+=3)(m.kind[generated[i]]?leaf:wood).push(...generated.slice(i,i+3));
  const indices=new Uint32Array([...wood,...leaf]);
  return {positions:new Float32Array(m.positions),normals:new Float32Array(m.normals),colors:new Float32Array(m.colors),
    leafUV:new Float32Array(m.uv),canopyAO:new Float32Array(m.ao),leafKind:new Uint8Array(m.kind),leafTone:new Uint8Array(m.tone),
    indices,crownIndexStart:0,branchIndexCount:wood.length,
    structure:{primaryBranches:limbs,secondaryBoughs:sprays.length,sprays:sprays.length*9,triangles:indices.length/3,lod}};
}

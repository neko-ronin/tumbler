/** Shared data and curve for native WebGL 2, native WebGPU, and the cockpit. */
const fraction=value=>value-Math.floor(value);
const TAU=2*Math.PI;
const SHORT_FIBRE=[[0,-1],[0,1],[1,0]];
const CURVED_FIBRE=[[0,-1],[0,1],[.29,-1],[.29,1],[.64,-1],[.64,1],[1,0]];
const SHORT_INDICES=[0,1,2];
const CURVED_INDICES=[0,1,2,2,1,3,2,3,4,4,3,5,4,5,6];

function scatterPaw(coat,layers){
 const positions=[],normals=[],relief=[],fibres=[],traits=[],indices=[],uv=[];
 const areas=[];
 let total=0;
 for(let i=0;i<coat.indices.length;i+=3){
  const [a,b,c]=coat.indices.slice(i,i+3).map(index=>coat.positions.slice(index*3,index*3+3));
  const [x,y,z]=b.map((value,k)=>value-a[k]),[u,v,w]=c.map((value,k)=>value-a[k]);
  total+=Math.hypot(y*w-z*v,z*u-x*w,x*v-y*u);
  areas.push(total);
 }
 // Stratify roots by triangle area so densely tessellated regions receive
 // the same coverage as the rest of the surface.
 function scatter(count,sequence,profile,faces,dimensions){
  let face=0;
  for(let i=0;i<count;i++){
   const area=(i+.5)*total/count;
   while(areas[face]<area)face++;
   const corners=coat.indices.slice(face*3,face*3+3);
   const vertices=corners.map(index=>coat.positions.slice(index*3,index*3+3));
   const loft=corners.map(index=>coat.relief.slice(index*3,index*3+3));
   const q=i+sequence;
   const seed=fraction(q*.618033989);
   const u=Math.sqrt(fraction(q*.754877666)),v=fraction(q*.569840296);
   const root=vertices[0].map((value,k)=>value*(1-u)+u*(vertices[1][k]*(1-v)+vertices[2][k]*v));
   const normal=root.map(value=>value/Math.hypot(...root));
   const displaced=loft[0].map((value,k)=>value*(1-u)+u*(loft[1][k]*(1-v)+loft[2][k]*v));
   const offset=positions.length/3;
   const [length,width]=dimensions(seed);
   // Nearby roots share a lay, with a little individual variation.
   const direction=.48*Math.sin(root[0]*10+root[1]*6-root[2]*5)+.28*Math.sin(TAU*fraction(q*.325338));
   for(const [t,side] of profile){
    positions.push(...root);
    normals.push(...normal);
    relief.push(...displaced);
    fibres.push(t,side,seed);
    traits.push(length,width,direction);
    uv.push(t,(side+1)*.5);
   }
   for(const local of faces)indices.push(offset+local);
  }
 }
 for(const layer of layers)scatter(...layer);
 return {positions,normals,relief,fibres,traits,indices,uv};
}

// The native comparison studies retain their individual-fibre groom.
export function pawGroom(coat,shortCount=1024){
 return scatterPaw(coat,[
  [shortCount,1,SHORT_FIBRE,SHORT_INDICES,seed=>[.0048+.0068*seed*seed,.00037+.00017*seed]],
  [64,1177,CURVED_FIBRE,CURVED_INDICES,seed=>[.012+.006*seed,.00027+.00010*seed]],
 ]);
}

// One triangle carries a small fan of independently tapered, masked hairs.
function fringeFaces(coat,includesRoot,layer){
 const indices=[];
 for(let i=0;i<coat.indices.length;i+=3){
  const face=coat.indices.slice(i,i+3);
  if(face.every(index=>includesRoot(...coat.positions.slice(index*3,index*3+3))))indices.push(...face);
 }
 return scatterPaw({...coat,indices},[layer]);
}

export function forearmFringe(coat){
 // Local +X faces the midline on both arms.
 return fringeFaces(coat,(x,y,z)=>x>Math.abs(z)*.62&&Math.abs(y)<.93,
  [480,1,SHORT_FIBRE,SHORT_INDICES,seed=>[.006+.008*seed*seed,.0015+.0011*seed]]);
}

export function pawRimFringe(coat){
 // Stay in the narrow sidewall around the paw and the facing toe
 // edges. Keep roots off the broad top faces.
 return fringeFaces(coat,(x,y,z)=>y>-.34&&y<.48&&z>-.60&&(Math.abs(x)>.67||z>.76),
  [168,81,SHORT_FIBRE,SHORT_INDICES,seed=>[.010+.010*seed,.0021+.0014*seed]]);
}

export function coatGrain(){
 const size=32,texels=new Uint8Array(size**3);
 let seed=73829;
 for(let i=0;i<texels.length;i++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  texels[i]=seed>>>24;
 }
 return {texels,size};
}

/** Sample a tileable volume on the unit coat and bake the vector field.
 * Strand roots barycentrically sample these same displacement vectors. */
export function pawCoatSurface(geometry,grain){
 const {size,texels}=grain;
 const read=(x,y,z)=>texels[((z%size+size)%size*size+(y%size+size)%size)*size+(x%size+size)%size]/255;
 const mix=(a,b,t)=>a+(b-a)*t;
 function sample(x,y,z){
  const i=Math.floor(x),j=Math.floor(y),k=Math.floor(z);
  const smooth=t=>t*t*(3-2*t);
  const u=smooth(x-i),v=smooth(y-j),w=smooth(z-k);
  const rows=depth=>mix(mix(read(i,j,depth),read(i+1,j,depth),u),
   mix(read(i,j+1,depth),read(i+1,j+1,depth),u),v);
  return mix(rows(k),rows(k+1),w);
 }
 const relief=[];
 for(let i=0;i<geometry.positions.length;i+=3){
  const [x,y,z]=geometry.positions.slice(i,i+3);
  const wash=.24*Math.sin(3*z+4*y);
  const tuft=sample(x*5.4+11+wash,y*5.4+14,z*3.8+16);
  const height=.022+.26*tuft*tuft;
  relief.push(x*height,y*height,z*height);
 }
 return {...geometry,relief};
}

// Same bend and taper on both APIs. Normals and offsets are in metres in
// the rigid part's parent frame, after applying its nonuniform scale.
export const groomGLSL=`
float groomGripScale(vec3 p){
 vec3 beyond=abs(p)-vec3(.073,.036,.006);
 return mix(.35,1.,smoothstep(0.,.022,max(beyond.x,max(beyond.y,beyond.z))));
}
vec3 groomOffsetAlong(vec3 n,vec3 eye,vec3 air,vec3 fibre,vec3 traits,float scale,vec3 lay){
 float t=fibre.x;
 lay-=n*dot(lay,n);
 vec3 lift=n*(.98-.30*t)+lay*(.25+.71*t)+air*.26*t*t;
 vec3 sideAxis=normalize(cross(lift,eye)+vec3(.00001));
 float width=traits.y*(1.-.84*t*t);
 return scale*(lift*traits.x*t+sideAxis*width*fibre.y)-n*.00024;
}
vec3 groomOffset(vec3 n,vec3 eye,vec3 air,vec3 fibre,vec3 traits,float scale){
 return groomOffsetAlong(n,eye,air,fibre,traits,scale,vec3(traits.z,-.18,1.));
}
`;

export const groomWGSL=`
fn groomGripScale(p:vec3f)->f32{
 let beyond=abs(p)-vec3f(.073,.036,.006);
 return mix(.35,1.,smoothstep(0.,.022,max(beyond.x,max(beyond.y,beyond.z))));
}
fn groomOffset(n:vec3f,eye:vec3f,air:vec3f,fibre:vec3f,traits:vec3f,scale:f32)->vec3f {
 let t=fibre.x;
 var lay=vec3f(traits.z,-.18,1.);
 lay-=n*dot(lay,n);
 let lift=n*(.98-.30*t)+lay*(.25+.71*t)+air*.26*t*t;
 let sideAxis=normalize(cross(lift,eye)+vec3f(.00001));
 let width=traits.y*(1.-.84*t*t);
 return scale*(lift*traits.x*t+sideAxis*width*fibre.y)-n*.00024;
}
`;

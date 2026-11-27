/** Ephemeral local interpretation of the core forest cover declaration.
 * Shared kits, four bounded instanced draws, deterministic world-space cells.
 * High cameras only keep the cached terrain surface; no overhead plant work.
 */
import * as T from '../vendor/three.module.min.js';
import {treeMaterial} from './tree-material.js';
import {style} from './style.js';
const hash=(x,y,s=0)=>{const v=Math.sin(x*127.1+y*311.7+s*74.7)*43758.5453;return v-Math.floor(v);};
/** Ferns grow in thickets off a spreading rhizome: smooth 14 m noise, 0 open to 1 the heart of a stand. */
export function fernThicket(x,y){
 const gx=x/14,gy=y/14,i=Math.floor(gx),j=Math.floor(gy),u=gx-i,v=gy-j,su=u*u*(3-2*u),sv=v*v*(3-2*v);
 const n=(hash(i,j,8)*(1-su)+hash(i+1,j,8)*su)*(1-sv)+(hash(i,j+1,8)*(1-su)+hash(i+1,j+1,8)*su)*sv;
 const t=Math.min(1,Math.max(0,(n-.42)/.16));return t*t*(3-2*t);
}
/** Chance a 0.75 m fern cell holds a crown: a sparse scatter wherever there is forest cover, and in a
 * thicket's heart nearly every cell, packed into one continuous stand a walker can vanish into. */
export function fernChance(field,cover,thicket){
 return field<.04?0:Math.min(.95,field*cover*.5+thicket*Math.min(1,field*5)*1.9);
}
function kit(type){
 const p=[],n=[],c=[],uv=[],leaf=[];
 const colors=(type==='litter'?['#493725','#786144','#342d20']:type==='sorrel'?['#28492c','#487839','#638b42']:['#294b30','#567a3c','#76924b']).map(x=>new T.Color(x));
 function tri(a,b,d,tone){
  const normal=new T.Vector3().crossVectors(new T.Vector3().subVectors(b,a),new T.Vector3().subVectors(d,a)).normalize();
  for(const v of [a,b,d]){p.push(...v.toArray());n.push(...normal.toArray());c.push(...colors[tone].toArray());uv.push(v.x,v.z);leaf.push(type==='litter'?0:1);}
 }
 function blade(a,b,width,tone){
  const side=new T.Vector3(-(b.z-a.z),0,b.x-a.x).normalize().multiplyScalar(width),mid=a.clone().lerp(b,.5);mid.y+=width*.25;
  tri(a,b,mid.clone().sub(side),tone);tri(a,mid.clone().add(side),b,Math.min(2,tone+1));
 }
 if(type==='fern'){
  // A shuttlecock crown of eighteen fronds, a metre and more: six inner ones climbing steep, twelve outer
  // ones arching out and over, so a clump reads as one deep bundle a walker can wade into. Each frond is
  // a curved ribbon carrying the alpha-cut frond texture (fernFrondTexture), as the trees' leaves are.
  for(let f=0;f<18;f++){
   const inner=f<6,angle=f*2.39996+hash(f,7)*.5,dir=new T.Vector3(Math.sin(angle),0,Math.cos(angle)),side=new T.Vector3(dir.z,0,-dir.x);
   const length=(inner?1.25:1.05)+hash(f,1)*.45,width=length*.22,rise=inner?1.2+hash(f,3)*.15:.75+hash(f,3)*.25,droop=inner?.32:.5;
   const root=dir.clone().multiplyScalar(.04+hash(f,5)*.08);
   const point=t=>root.clone().addScaledVector(dir,t*length*Math.cos(rise)).setY(length*(t*Math.sin(rise)-droop*t*t));
   const roll=(hash(f,9)-.5)*.6,rows=[],segments=5;
   for(let j=0;j<=segments;j++){const t=j/segments,c=point(t),tilt=side.clone().multiplyScalar(width*.5);tilt.y=Math.sin(roll)*width*.5;
    rows.push([c.clone().sub(tilt).setY(c.y-tilt.y-width*.06*t),c.clone().add(tilt).setY(c.y+tilt.y-width*.06*t),t]);}
   for(let j=0;j<segments;j++){
    const [a0,a1,t0]=rows[j],[b0,b1,t1]=rows[j+1];
    const quad=[[a0,0,t0],[a1,1,t0],[b0,0,t1],[a1,1,t0],[b1,1,t1],[b0,0,t1]];
    const normal=new T.Vector3().crossVectors(new T.Vector3().subVectors(a1,a0),new T.Vector3().subVectors(b0,a0)).normalize();if(normal.y<0)normal.negate();
    for(const [v,u,t] of quad){p.push(...v.toArray());n.push(...normal.toArray());c.push(...colors[inner?2:1].toArray());uv.push(u,t);leaf.push(2);}
   }
  }
 }else if(type==='sorrel'){
  for(let i=0;i<3;i++){
   const a=i*2.39996,root=new T.Vector3(Math.sin(a)*.18,.10+hash(i,3)*.18,Math.cos(a)*.18);
   for(let j=0;j<3;j++){
    const angle=a+j*Math.PI*2/3,dir=new T.Vector3(Math.sin(angle),0,Math.cos(angle)),side=new T.Vector3(dir.z,0,-dir.x);
    const centre=root.clone().addScaledVector(dir,.075);centre.y-=.012;
    const lobe=[[0,0],[.04,-.05],[.1,-.058],[.14,-.03],[.115,0],[.14,.03],[.1,.058],[.04,.05]].map(([along,across])=>{const v=root.clone().addScaledVector(dir,along*1.15).addScaledVector(side,across*1.15);v.y-=along*.18+Math.abs(across)*.35;return v;});
    const outline=lobe;
    for(let k=0;k<outline.length;k++)tri(centre,outline[k],outline[(k+1)%outline.length],j%2);
   }
  }
 }else if(type==='grass'){
  for(let i=0;i<12;i++){const a=i*2.39996,r=hash(i,2)*.22;blade(new T.Vector3(Math.sin(a)*r,0,Math.cos(a)*r),new T.Vector3(Math.sin(a)*(r+.12),.25+hash(i,4)*.4,Math.cos(a)*(r+.12)),.014,i%2);}
 }else{
  for(let i=0;i<10;i++){const a=i*2.39996,r=hash(i,3)*.48;blade(new T.Vector3(Math.sin(a)*r,.01,Math.cos(a)*r),new T.Vector3(Math.sin(a)*(r+.15),.025,Math.cos(a)*(r+.15)),.012,i%3);}
 }
 const g=new T.BufferGeometry();for(const [name,array,size]of [['position',p,3],['normal',n,3],['color',c,3],['uv',uv,2],['leafKind',leaf,1]])g.setAttribute(name,new T.Float32BufferAttribute(array,size));
 g.setAttribute('canopyAO',new T.Float32BufferAttribute(new Float32Array(leaf.length).fill(.9),1));g.computeBoundingSphere();return g;
}
/** A fern frond's alpha and tone, drawn once (u across, v base to tip): a rachis, 22 pairs of pinnae
 * angled toward the tip, longest mid-frond, each tapering and cut deep into pinnules, darker along its midrib. The green
 * channel is a tone in the tree surface's palette range (tree-surface.js sprayMap). */
let frondTexture=null;
export function fernFrondTexture(){
  if(frondTexture)return frondTexture;
  const W=128,H=512,data=new Uint8Array(W*H*4),pairs=22,v0=.04,dv=(.97-v0)/pairs,smooth=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
   const u=(x+.5)/W,v=(y+.5)/H,off=Math.abs(u-.5),tilt=.55,vv=v-off*tilt,k=Math.round((vv-v0)/dv-.5),vk=v0+(k+.5)*dv;
   let alpha=off<.012&&v<.985?1:0,tone=.25;
   if(k>=0&&k<pairs){
    const reach=.49*Math.pow(Math.sin(Math.PI*Math.min(1,.08+vk*.95)),.75),along=off/Math.max(.001,reach);
    if(along<1){
     const lobes=.3+.7*Math.pow(Math.abs(Math.sin(along*Math.PI*5.5)),.6),half=dv*.52*(1-Math.pow(along,1.8))*lobes,o=Math.abs(vv-vk),edge=1/H*1.5;
     const a=smooth(half+edge,half-edge,o);if(a>alpha){alpha=a;tone=.35+.5*along*(.6+.4*hash(k,u<.5?1:2))-.25*(1-smooth(0,half*.35,o));}
    }
   }
   const at=(y*W+x)*4,g=.0704+Math.max(0,Math.min(1,tone))*(.2384-.0704);
   data[at]=Math.round(g*255);data[at+1]=Math.round(g*255);data[at+2]=Math.round(g*255);data[at+3]=Math.round(alpha*255);
  }
  frondTexture=new T.DataTexture(data,W,H,T.RGBAFormat);frondTexture.generateMipmaps=true;frondTexture.minFilter=T.LinearMipmapLinearFilter;frondTexture.magFilter=T.LinearFilter;frondTexture.needsUpdate=true;
  return frondTexture;
}
export function buildForestFloor(declaration,field,ground,snowAt,bareAt=()=>false){
 const group=new T.Group();group.name='forest_floor';const stats={plants:0,triangles:0,updates:0};
 const definitions=[...declaration.layers,{plant_type:'litter',cover_fraction:.55}];
 const pools=definitions.map(layer=>{
  const type=layer.plant_type,range=type==='sorrel'?30:type==='fern'?46:56,pitch=type==='sorrel'?.55:type==='fern'?.75:2.1,capacity=type==='sorrel'?3000:type==='fern'?3400:1200;
  const geometry=kit(type),material=type==='fern'?treeMaterial({toonBands:4,rimStrength:.25,canopyShade:.8,transmission:.6,leafThickness:.3,sprayCutoff:.42},{sprayMap:fernFrondTexture(),palette:['#1d3820','#3d6a2c','#6f9845'].map(x=>new T.Color(x).toArray())}):treeMaterial({toonBands:4,rimStrength:.25,canopyShade:.8,transmission:.8,leafThickness:.35});
  const base=material.onBeforeCompile;material.onBeforeCompile=shader=>{
   base(shader);shader.uniforms.uFloorRange={value:new T.Vector2(range*.65,range)};shader.uniforms.uFloorTime=style.time;shader.uniforms.uFloorWind=style.wind;shader.uniforms.uFloorPush=style.meadowPush;
   shader.vertexShader='uniform float uFloorTime;uniform vec2 uFloorWind;uniform vec4 uFloorPush[4];\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`transformed.xz+=uFloorWind*position.y*position.y*.035*sin(uFloorTime*1.3+instanceMatrix[3].x*.6+instanceMatrix[3].z*.4);
   ${type==='litter'?'':`// Fronds and leaves pressed aside by a walker and the footholds behind them (style.meadowPush), in
   // world space, brought back into the instance's frame; the higher up the plant, the further they give.
   {vec3 wp=(instanceMatrix*vec4(transformed,1.)).xyz,shove=vec3(0.);
    for(int k=0;k<4;k++){vec4 at=uFloorPush[k];vec2 d=wp.xz-at.xz;float r=length(d);
     shove.xz+=d/max(r,.05)*at.w*(1.-smoothstep(.35,1.6,r))*(1.-smoothstep(1.4,2.2,abs(instanceMatrix[3].y-at.y)));}
    float give=min(1.,position.y*1.4);shove*=give*.85;shove.y=-length(shove.xz)*.5;
    transformed+=transpose(mat3(instanceMatrix))*shove/dot(instanceMatrix[0].xyz,instanceMatrix[0].xyz);}`}
#include <project_vertex>`);
   shader.fragmentShader='uniform vec2 uFloorRange;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
    float floorFade=(1.-smoothstep(uFloorRange.x,uFloorRange.y,distance(cameraPosition.xz,vTreeWorld.xz)))*(1.-smoothstep(9.,23.,abs(cameraPosition.y-vTreeWorld.y)));
    if(fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189)>floorFade)discard;`);
  };material.customProgramCacheKey=()=>`forest-floor-v7-${type}`;
  const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;group.add(mesh);return {mesh,type,layer,range,pitch,capacity};
 });
 const dummy=new T.Object3D(),color=new T.Color();let lastX=Infinity,lastY=Infinity;
 const ferns={at:new Float32Array(3400*4),count:0};
 /** How deep in fern a point stands, 0 open to 1 buried: overlapping crowns (each about 1.1 m across
  * per unit of size) within a metre of the ground there. The ground for a walker to hide in. */
 function coverAt(x,y,z){
  let sum=0;for(let i=0;i<ferns.count;i++){const a=ferns.at,k=i*4,r=1.1*a[k+3],d=Math.hypot(a[k]-x,a[k+1]-y);if(d<r&&Math.abs(a[k+2]-z)<1.2)sum+=1-d/r;}
  return Math.min(1,sum);
 }
 function update(camera){
  const x=camera.position.x,y=-camera.position.z,z=ground.height(x,y);
  if(z===null||camera.position.y-z>23){for(const {mesh}of pools)mesh.count=0;stats.plants=stats.triangles=0;ferns.count=0;lastX=Infinity;return;}
  if(Math.hypot(x-lastX,y-lastY)<2)return;lastX=x;lastY=y;stats.plants=stats.triangles=0;stats.updates++;let triangleBudget=760000;ferns.count=0;
  for(const {mesh,type,layer,range,pitch,capacity}of pools){
   let count=0;const span=Math.ceil(range/pitch),cx=Math.floor(x/pitch),cy=Math.floor(y/pitch);
   for(let row=cy-span;row<=cy+span;row++)for(let col=cx-span;col<=cx+span;col++){
    const px=(col+.1+hash(col,row,1)*.8)*pitch,py=(row+.1+hash(col,row,2)*.8)*pitch;
    if(Math.hypot(px-x,py-y)>range)continue;const forest=field.sampleCover?.(px,py)??field.sample(px,py);
    if(hash(col,row,3)>(type==='fern'?fernChance(forest,layer.cover_fraction,fernThicket(px,py)):forest*layer.cover_fraction))continue;
    const h=ground.height(px,py);if(h===null||bareAt(px,py)||h<24||h<(layer.min_elevation_m??-Infinity)||h>(layer.max_elevation_m??Infinity)||snowAt(px,py)>.03)continue;
    const dx=ground.height(px+.5,py),dy=ground.height(px,py+.5);if(dx===null||dy===null||Math.hypot(dx-h,dy-h)>.48)continue;
    const cost=mesh.geometry.attributes.position.count/3;if(count>=capacity||triangleBudget<cost)continue;triangleBudget-=cost;
    const size=type==='fern'?1.25+hash(col,row,5)*.6:.7+hash(col,row,5)*.65;if(type==='fern')ferns.at.set([px,py,h,size],ferns.count++*4);
    dummy.position.set(px,h+.018,-py);dummy.rotation.set(0,hash(col,row,4)*Math.PI*2,0);dummy.scale.setScalar(size);dummy.updateMatrix();mesh.setMatrixAt(count,dummy.matrix);
    color.setRGB(1,1,1).multiplyScalar(.78+hash(col,row,6)*.35);mesh.setColorAt(count++,color);
   }
   mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
   stats.plants+=count;stats.triangles+=count*mesh.geometry.attributes.position.count/3;
  }
 }
 return {group,stats,update,coverAt,dispose(){for(const {mesh}of pools){mesh.geometry.dispose();mesh.material.dispose();mesh.material.studioMaskMaterial?.dispose();}group.clear();}};
}

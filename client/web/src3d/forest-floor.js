/** Ephemeral local interpretation of the core forest cover declaration.
 * Shared kits, four bounded instanced draws, deterministic world-space cells.
 * High cameras only keep the cached terrain surface; no overhead plant work.
 */
import * as T from '../vendor/three.module.min.js';
import {treeMaterial} from './tree-material.js';
import {style} from './style.js';
const hash=(x,y,s=0)=>{const v=Math.sin(x*127.1+y*311.7+s*74.7)*43758.5453;return v-Math.floor(v);};
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
  for(let f=0;f<6;f++){
   const angle=f*2.39996,dir=new T.Vector3(Math.sin(angle),0,Math.cos(angle)),side=new T.Vector3(dir.z,0,-dir.x),length=.7+hash(f,1)*.7;
   // Fronds rise, then arch over; pinnae shorten toward the tip.
   const point=t=>dir.clone().multiplyScalar(t*length).setY(Math.sin(t*Math.PI*.8)*(.45+length*.3)-t*t*.1);
   for(let j=1;j<9;j++){
    const t=j/9,root=point(t),reach=Math.sin(Math.min(1,t*1.12+.05)*Math.PI)*(.1+length*.1)*(1-t*.35);
    for(const sign of [-1,1]){const tip=root.clone().addScaledVector(side,sign*reach).addScaledVector(dir,reach*.7);tip.y-=reach*(.1+t*.3);blade(root,tip,reach*.17,Math.floor(hash(f,j)*2));}
    blade(point((j-1)/9),root,.006,0);
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
export function buildForestFloor(declaration,field,ground,snowAt,bareAt=()=>false){
 const group=new T.Group();group.name='forest_floor';const stats={plants:0,triangles:0,updates:0};
 const definitions=[...declaration.layers,{plant_type:'litter',cover_fraction:.55}];
 const pools=definitions.map(layer=>{
  const type=layer.plant_type,range=type==='sorrel'?30:56,pitch=type==='sorrel'?.55:type==='fern'?1.5:2.1,capacity=type==='sorrel'?3000:1200;
  const geometry=kit(type),material=treeMaterial({toonBands:4,rimStrength:.25,canopyShade:.8,transmission:.8,leafThickness:.35});
  const base=material.onBeforeCompile;material.onBeforeCompile=shader=>{
   base(shader);shader.uniforms.uFloorRange={value:new T.Vector2(range*.65,range)};shader.uniforms.uFloorTime=style.time;shader.uniforms.uFloorWind=style.wind;
   shader.vertexShader='uniform float uFloorTime;uniform vec2 uFloorWind;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`transformed.xz+=uFloorWind*position.y*position.y*.035*sin(uFloorTime*1.3+instanceMatrix[3].x*.6+instanceMatrix[3].z*.4);\n#include <project_vertex>`);
   shader.fragmentShader='uniform vec2 uFloorRange;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`#include <alphatest_fragment>
    float floorFade=(1.-smoothstep(uFloorRange.x,uFloorRange.y,distance(cameraPosition.xz,vTreeWorld.xz)))*(1.-smoothstep(9.,23.,abs(cameraPosition.y-vTreeWorld.y)));
    if(fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189)>floorFade)discard;`);
  };material.customProgramCacheKey=()=>`forest-floor-v2-${type}`;
  const mesh=new T.InstancedMesh(geometry,material,capacity);mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);mesh.frustumCulled=false;mesh.count=0;group.add(mesh);return {mesh,type,layer,range,pitch,capacity};
 });
 const dummy=new T.Object3D(),color=new T.Color();let lastX=Infinity,lastY=Infinity;
 function update(camera){
  const x=camera.position.x,y=-camera.position.z,z=ground.height(x,y);
  if(z===null||camera.position.y-z>23){for(const {mesh}of pools)mesh.count=0;stats.plants=stats.triangles=0;lastX=Infinity;return;}
  if(Math.hypot(x-lastX,y-lastY)<2)return;lastX=x;lastY=y;stats.plants=stats.triangles=0;stats.updates++;let triangleBudget=340000;
  for(const {mesh,type,layer,range,pitch,capacity}of pools){
   let count=0;const span=Math.ceil(range/pitch),cx=Math.floor(x/pitch),cy=Math.floor(y/pitch);
   for(let row=cy-span;row<=cy+span;row++)for(let col=cx-span;col<=cx+span;col++){
    const px=(col+.1+hash(col,row,1)*.8)*pitch,py=(row+.1+hash(col,row,2)*.8)*pitch;
    if(Math.hypot(px-x,py-y)>range||hash(col,row,3)>(field.sampleCover?.(px,py)??field.sample(px,py))*layer.cover_fraction)continue;
    const h=ground.height(px,py);if(h===null||bareAt(px,py)||h<24||h<(layer.min_elevation_m??-Infinity)||h>(layer.max_elevation_m??Infinity)||snowAt(px,py)>.03)continue;
    const dx=ground.height(px+.5,py),dy=ground.height(px,py+.5);if(dx===null||dy===null||Math.hypot(dx-h,dy-h)>.48)continue;
    const cost=mesh.geometry.attributes.position.count/3;if(count>=capacity||triangleBudget<cost)continue;triangleBudget-=cost;
    dummy.position.set(px,h+.018,-py);dummy.rotation.set(0,hash(col,row,4)*Math.PI*2,0);dummy.scale.setScalar(.7+hash(col,row,5)*.65);dummy.updateMatrix();mesh.setMatrixAt(count,dummy.matrix);
    color.setRGB(1,1,1).multiplyScalar(.78+hash(col,row,6)*.35);mesh.setColorAt(count++,color);
   }
   mesh.count=count;mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
   stats.plants+=count;stats.triangles+=count*mesh.geometry.attributes.position.count/3;
  }
 }
 return {group,stats,update,dispose(){for(const {mesh}of pools){mesh.geometry.dispose();mesh.material.dispose();mesh.material.studioMaskMaterial?.dispose();}group.clear();}};
}

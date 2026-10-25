/** Browser granite surface: metre-scale joint sets and mip-filtered mineral grain.
 * Texture pixels are generated here; no downloaded texture or new world geometry.
 */
import {DataTexture,RGBAFormat,RepeatWrapping,LinearFilter,LinearMipmapLinearFilter,SRGBColorSpace} from '../vendor/three.module.min.js';
let minerals;
const fract=x=>x-Math.floor(x);
const random=(x,y)=>fract(Math.sin(x*127.1+y*311.7)*43758.5453);
export function graniteMinerals(){
 if(minerals)return minerals;
 const size=256,cells=72,data=new Uint8Array(size*size*4),wrap=n=>(n%cells+cells)%cells;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const px=x/size*cells,py=y/size*cells,cx=Math.floor(px),cy=Math.floor(py);let best=Infinity,kind=0,facet=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
   const a=cx+i,b=cy+j,ax=wrap(a),by=wrap(b),dx=px-a-random(ax,by),dy=py-b-random(ax+19,by+7),d=dx*dx+dy*dy;
   if(d<best){best=d;kind=random(ax+71,by-43);facet=random(ax-23,by+59);}
  }
  // Feldspar and quartz with sparse biotite, rather than uniform grey paint.
  const color=kind<.13?[63,67,65]:kind<.46?[177,168,155]:[193,195,187];
  const grit=.91+random(x,y)*.14+facet*.08,offset=(y*size+x)*4;
  for(let c=0;c<3;c++)data[offset+c]=Math.min(255,Math.round(color[c]*grit));
  data[offset+3]=Math.round(255*(.3+facet*.42-Math.min(1,best)*.13));
 }
 minerals=new DataTexture(data,size,size,RGBAFormat);minerals.wrapS=minerals.wrapT=RepeatWrapping;
 minerals.colorSpace=SRGBColorSpace;minerals.generateMipmaps=true;minerals.minFilter=LinearMipmapLinearFilter;minerals.magFilter=LinearFilter;minerals.anisotropy=4;minerals.needsUpdate=true;
 return minerals;
}
export const GRANITE_GLSL=`
uniform sampler2D uGraniteMinerals;
float graniteHash(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float graniteNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
 return mix(mix(mix(graniteHash(i),graniteHash(i+vec3(1,0,0)),f.x),mix(graniteHash(i+vec3(0,1,0)),graniteHash(i+vec3(1,1,0)),f.x),f.y),
 mix(mix(graniteHash(i+vec3(0,0,1)),graniteHash(i+vec3(1,0,1)),f.x),mix(graniteHash(i+vec3(0,1,1)),graniteHash(i+1.),f.x),f.y),f.z);}
float graniteJoint(float p,float width){
 float d=abs(fract(p)-.5),aa=max(fwidth(p),.00001);
 // Conserve line coverage as it becomes subpixel; a growing AA width must
 // not turn distant hairline joints into a dark wire grid.
 return (1.-smoothstep(max(0.,width-aa*.5),width+aa*.5,d))*min(1.,width*2./aa);
}
struct GraniteSurface{vec3 color;float relief;float roughness;float joints;};
GraniteSurface graniteSurface(vec3 p,vec3 up,float footprint){
 vec3 w=pow(abs(up),vec3(6.));w/=max(.0001,w.x+w.y+w.z);
 vec4 mineral=textureGrad(uGraniteMinerals,p.yz*.8,dFdx(p.yz)*.8,dFdy(p.yz)*.8)*w.x
  +textureGrad(uGraniteMinerals,p.xz*.8,dFdx(p.xz)*.8,dFdy(p.xz)*.8)*w.y
  +textureGrad(uGraniteMinerals,p.xy*.8,dFdx(p.xy)*.8,dFdy(p.xy)*.8)*w.z;
 float body=graniteNoise(p*.013),weather=graniteNoise(p*.16),slab=graniteNoise(p*.048);
 // Intersecting, gently warped joint planes and curved exfoliation sheets.
 // All lengths are metres; pixel derivatives filter lines before they alias.
 float crossJoint=graniteJoint(dot(p,vec3(.017,.004,.006))+slab*.53,.0018);
 float upright=graniteJoint(dot(p,vec3(-.006,.003,.014))+body*.85,.0014);
 float sheet=graniteJoint(p.y*.022+slab*1.6+body*2.1,.0024);
 crossJoint*=smoothstep(.40,.64,weather);
 upright*=smoothstep(.46,.68,slab);
 sheet*=smoothstep(.25,.6,body);
 float resolved=1.-smoothstep(.65,3.5,footprint);
 float joints=max(crossJoint*.82,upright*.68)*resolved;
 float sheets=sheet*resolved;
 vec3 pale=vec3(.49,.49,.445),warm=vec3(.39,.357,.307);
 vec3 stone=mix(pale,warm,smoothstep(.48,.8,body)*.44);
 stone*=.84+slab*.30+(weather-.5)*.13;
 // Mips integrate the salt/pepper grain into the same average at flight scale.
 stone*=mix(vec3(1.),mineral.rgb/vec3(.405,.400,.369),.57);
 stone*=1.-joints*.22-sheets*.12;
 GraniteSurface g;g.color=stone;
 g.relief=(slab-.5)*.72+(weather-.5)*.085-joints*.018-sheets*.014+(mineral.a-.5)*.009;
 g.roughness=clamp(.87+weather*.11-mineral.a*.07,.78,.98);g.joints=max(joints,sheets);return g;
}
`;

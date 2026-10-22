/** Periodic, client-only cloud detail. The core still supplies every cell's bounds.
 * Packed value/Worley noise follows the broad-shape/detail-erosion approach in
 * Guerrilla's Nubis presentations; this is our small implementation, not Nubis.
 */
const wrap=(n,p)=>((n%p)+p)%p;
function hash(x,y,z,p){
 let n=Math.imul(wrap(x,p),73856093)^Math.imul(wrap(y,p),19349663)^Math.imul(wrap(z,p),83492791);
 n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);
 return ((n^(n>>>16))>>>0)/4294967296;
}
// Reuse the periodic lattice instead of rehashing its same few thousand
// corners/features millions of times during the synchronous texture build.
const lattices=new Map();
function lattice(p){
 if(lattices.has(p))return lattices.get(p);
 const values=new Float64Array(p**3),features=new Float64Array(p**3*3);
 for(let z=0;z<p;z++)for(let y=0;y<p;y++)for(let x=0;x<p;x++){
  const index=(z*p+y)*p+x,h=hash(x,y,z,p);values[index]=h;
  const f=h*65536;features[index*3]=(f*13.37)%1;features[index*3+1]=(f*7.19)%1;features[index*3+2]=(f*3.71)%1;
 }
 const result={values,features};lattices.set(p,result);return result;
}
function value(x,y,z,p){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
 const sx=fx*fx*(3-2*fx),sy=fy*fy*(3-2*fy),sz=fz*fz*(3-2*fz),data=lattice(p).values;
 let sum=0;
 for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)sum+=data[(wrap(iz+k,p)*p+wrap(iy+j,p))*p+wrap(ix+i,p)]*(i?sx:1-sx)*(j?sy:1-sy)*(k?sz:1-sz);
 return sum;
}
function worley(x,y,z,p){
 const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz,data=lattice(p).features;let distance=3;
 for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
  const n=((wrap(iz+k,p)*p+wrap(iy+j,p))*p+wrap(ix+i,p))*3;
  const dx=i+data[n]-fx,dy=j+data[n+1]-fy,dz=k+data[n+2]-fz;
  distance=Math.min(distance,dx*dx+dy*dy+dz*dz);
 }
 return 1.-Math.min(1,Math.sqrt(distance));
}
export function cloudNoiseAt(x,y,z){
 return [value(x*4,y*4,z*4,4)*.58+value(x*8,y*8,z*8,8)*.28+value(x*16,y*16,z*16,16)*.14,
  worley(x*6,y*6,z*6,6),worley(x*12,y*12,z*12,12)];
}
export function buildCloudNoise(size=48){
 const data=new Uint8Array(size**3*4);
 for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  // Texel centres preserve the periodic interpolation across each texture seam.
  const c=cloudNoiseAt((x+.5)/size,(y+.5)/size,(z+.5)/size),i=((z*size+y)*size+x)*4;
  data[i]=Math.round(c[0]*255);data[i+1]=Math.round(c[1]*255);data[i+2]=Math.round(c[2]*255);data[i+3]=255;
 }
 return data;
}
export const CLOUD_DENSITY_GLSL=`
float cloudDensity(vec3 world, bool detail) {
 vec3 p=(world-uCentre)/uExtent;
 float edge=.5-max(max(abs(p.x),abs(p.y)),abs(p.z));
 if(edge<=0.)return 0.;
 // Seed variation rotates the billows, never the core-owned box or the wind.
 float angle=uSeed*2.39996;mat2 turn=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));
 p.xz=turn*p.xz;
 // A broad, flat-bottomed body supports unequal rounded rising turrets.
 float lift=.04*sin(uSeed*1.91);
 float shape=1.20-length((p-vec3(0.,-.13,0.))*vec3(2.15,4.2,2.2));
 shape=max(shape,.97-length((p-vec3(-.17,.04-lift,.02))*vec3(3.6,2.7,3.6)));
 shape=max(shape,.93-length((p-vec3(.15,.09+lift,-.03))*vec3(3.8,3.1,3.6)));
 shape=max(shape,.60-length((p-vec3(-.26,-.04,-.13))*vec3(4.3,4.2,4.5)));
 shape=max(shape,.65-length((p-vec3(.25,-.03,.12))*vec3(4.3,4.3,4.4)));
 shape=max(shape,.70-length((p-vec3(.03,.17,.10))*vec3(4.7,4.4,4.8)));
 shape=max(shape,.55-length((p-vec3(-.08,.11,.26))*vec3(5.3,4.8,5.3)));
 shape=max(shape,.56-length((p-vec3(.08,.15,-.20))*vec3(5.3,4.8,5.3)));
 vec3 drift=vec3(uWind.x,0.,uWind.y)*uTime*.6/uExtent;drift.xz=turn*drift.xz;
 vec3 q=(p-drift)*1.15+vec3(uSeed*.137,uSeed*.071,0.);
 vec3 n=texture(uNoise,q).rgb;
 shape+=(n.r-.5)*.82-(1.-n.g)*.30;
 if(detail)shape-=(1.-texture(uNoise,q*2.7).b)*.26;
 return smoothstep(-.09,.14,shape)*smoothstep(-.45,-.30,p.y)*smoothstep(0.,.06,edge);
}
float cloudSunDepth(vec3 p) {
 float depth=0.,stride=10.;
 for(int j=0;j<5;j++){
  depth+=cloudDensity(p+uSun*stride*.5,false)*stride;p+=uSun*stride;stride*=2.2;
 }
 return depth;
}
`;

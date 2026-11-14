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
export const CLOUD_BILLOWS=25;
// The westerly leans each cloud downwind with height and draws out a thinner trail on its
// downwind side. LEAN is how far the crown shifts and TRAIL how strongly the far side
// stretches, both in cell widths; SMEAR is the extra reach the marched span must allow:
// the lean plus the stretch of the farthest cloud (half a cell out) past TRAIL_START.
export const CLOUD_LEAN=.06,CLOUD_TRAIL=.3,CLOUD_TRAIL_START=.12;
export const CLOUD_SMEAR=CLOUD_LEAN+CLOUD_TRAIL*(.5-CLOUD_TRAIL_START)/(1-CLOUD_TRAIL)+.005;
/** Where one cell's billows sit, from its seed and box alone, so the view, light
 * and ground-shadow shaders march the same cloud. Positions are in u-space: x and
 * z span -.5 to .5 across the cell, and y is height in mean cell widths, from
 * -aspect/2 at the base to aspect/2. A billow therefore keeps its proportions
 * however tall the core makes the cell. A flat cell gets a body with bumps; a
 * tall one gets three unequal stacks of rising turrets.
 * Each turret then carries a smaller lobe on its upper side, so a tower reads as
 * plumes of many sizes, not one size of ball.
 * Returns billows as [x,y,z,gradient]*25 (the first is the body, whose gradient is
 * vertical only), form [aspect,noise frequency,noise gain,mean width m], the
 * steepest shape gradient per unit of box-normalised travel, for empty skipping,
 * and support: how far past a turret's unit radius the noise can still leave cloud.
 */
export function cloudForm(seed,extent){
 const width=(extent[0]+extent[2])*.5,aspect=extent[1]/width,top=aspect*.93;
 const rnd=i=>{const v=Math.sin(seed*12.9898+i*78.233)*43758.5453;return v-Math.floor(v);};
 const lerp=(a,b,t)=>a+(b-a)*t,billows=[],lean=rnd(0)*Math.PI*2;
 // The body's widest section sits just above the base, so the base cut leaves it flat.
 const bodyRise=Math.min(.36,top-.05);billows.push(0,.05-aspect*.5,0,1.2/bodyRise);
 // [turrets, share of the cell height reached, bearing from the lean, distance out, low radius, high radius]
 // The two lesser stacks vary in height and bearing with the seed, so no two towers share a silhouette.
 for(const [count,reach,bearing,out,r0,r1]of [[6,1,0,.04,.36,.20],[4,.56+.28*rnd(40),1.6+1.2*rnd(41),.24,.30,.18],[2,.32+.26*rnd(42),3.7+1.2*rnd(43),.27,.25,.19]]){
  for(let j=0;j<count;j++){
   // A turret no taller than the height its stack may reach: a flat cell gets bumps, never a clipped dome.
   // Radii spread widely within a stack: some turrets dominate, others are small knobs.
   const t=count>1?j/(count-1):0,i=billows.length,r=Math.min(lerp(r0,r1,t)*(.62+.7*rnd(i)**1.5),top*reach*.5,.44);
   const crown=top*reach-r,rise=lerp(Math.min(.30,crown),crown,t);
   // Each turret steps off the stack's axis, so a tower is a cluster and never a column.
   const angle=lean+bearing+(rnd(i+1)-.5)*(out<.1?6.28:1.6),far=Math.max(0,Math.min(.44-r,out+.05+.13*rnd(i+2)));
   billows.push(Math.cos(angle)*far,rise-aspect*.5,Math.sin(angle)*far,1/r);
  }
 }
 // A smaller lobe on each turret's upper side, leaning outward: the next size down of plume.
 // Kept inside the cell like its parent, and no smaller than .09 so empty skipping stays useful.
 const turrets=billows.length/4;
 for(let j=1;j<turrets;j++){
  const [px,py,pz,pw]=billows.slice(j*4,j*4+4),r=1/pw,i=100+j*3;
  const rc=Math.max(.09,r*(.36+.26*rnd(i))),up=.35+.8*rnd(i+1),az=rnd(i+2)*6.283,reach=r*(.72+.2*rnd(i+3));
  let x=px+Math.cos(az)*Math.cos(up)*reach,z=pz+Math.sin(az)*Math.cos(up)*reach,y=py+Math.sin(up)*reach;
  const out=Math.hypot(x,z),room=.44-rc;if(out>room){x*=room/out;z*=room/out;}
  y=Math.min(y,top-aspect*.5-rc);billows.push(x,y,z,1/rc);
 }
 // Wider cells carry more, shallower billows: a big cloud must not read as a small one seen close.
 const frequency=1.15*Math.min(1.9,Math.max(1,Math.sqrt(width/750)));
 // Bound the values the shader receives: single precision can round a gradient up.
 const packed=new Float32Array(billows);let gradient=2.3;for(let i=3;i<packed.length;i+=4)gradient=Math.max(gradient,packed[i]);
 const gain=Math.sqrt(1.15/frequency);
 // Density needs shape above -.09 and noise adds at most .41 of the gain: see CLOUD_DENSITY_GLSL.
 // The lean tilts the shape a little, steepening it by under 1%; 2% covers it.
 return {billows:packed,form:[aspect,frequency,gain,width],rate:gradient*Math.max(1,aspect)*1.02,support:1.09+.41*gain};
}
export const CLOUD_DENSITY_GLSL=`
uniform vec4 uBillow[${CLOUD_BILLOWS}];uniform vec4 uForm;
#ifdef CLOUD_EMPTY_SKIP
float cloudEmptySteps=0.;float cloudDensityRate=0.;
#endif
float cloudDensity(vec3 world, bool detail) {
 vec3 p=(world-uCentre)/uExtent;
 float edge=.5-max(max(abs(p.x),abs(p.y)),abs(p.z));
 if(edge<=0.)return 0.;
 // Mean-width units keep every billow round in metres; see cloudForm.
 vec3 u=p*vec3(1.,uForm.x,1.);
 // Height in the cell, 0 at the base and 1 at the top.
 float rise=clamp(p.y+.5,0.,1.);
 vec2 wind=uWind/max(length(uWind),.0001);
 // The crown leans downwind of the base...
 u.xz-=wind*${CLOUD_LEAN}*rise*rise;
 // ...and the downwind side draws out into a thinner trail.
 float trail=max(0.,dot(u.xz,wind)-${CLOUD_TRAIL_START});
 u.xz-=wind*trail*${CLOUD_TRAIL};
 // A broad, flat-bottomed body supports unequal stacks of rounded rising turrets.
 float shape=1.20-length((u-vec3(0.,uBillow[0].y,0.))*vec3(2.25,uBillow[0].w,2.3));
 for(int j=1;j<${CLOUD_BILLOWS};j++)shape=max(shape,1.-length(u-uBillow[j].xyz)*uBillow[j].w);
#ifdef CLOUD_EMPTY_SKIP
 // Positive noise contributes at most .41, and density starts at -.09.
 // cloudDensityRate carries cloudForm's gradient bound. Advance only past sample
 // indices that cannot reach that support; occupied sample positions remain unchanged.
 if(shape<-.501){cloudEmptySteps=max(0.,floor((-.501-shape)/max(cloudDensityRate,.000001))-1.);return 0.;}
#endif
 vec3 drift=vec3(uWind.x,0.,uWind.y)*uTime*.6/uForm.w;
 vec3 q=(u-drift)*uForm.y+vec3(uSeed*.137,uSeed*.071,0.);
 vec3 n=texture(uNoise,q).rgb;
 shape+=((n.r-.5)*.82-(1.-n.g)*.30)*uForm.z;
 // A second, larger lobe scale carves the body unevenly, so puffs come in several sizes.
 shape-=(1.-texture(uNoise,q*.43+vec3(.31,.17,.53)).g)*.18*uForm.z;
 // Lobes come at three scales (this, the larger one above and the turrets), each smaller one
 // weaker, so the surface reads as plumes on plumes rather than one size of ball.
 shape-=(1.-texture(uNoise,q*1.6+vec3(.71,.29,.13)).g)*.12*uForm.z;
 // Fine texture only softly frays thin, low cloud and the trail; crowns keep the edge their lobes give them.
 float smear=smoothstep(0.,.25,trail);
 if(detail)shape-=(1.-texture(uNoise,q*2.7).b)*.10*uForm.z*(1.4-.9*rise+1.6*smear);
 // The same optical edge in metres: a wider cell would otherwise wear a wider, woollier rim.
 shape*=1.5*uForm.y/1.15;
 // The base undulates with the broad noise and fades over a wider band: a flat base, not a ruled line.
 // Crowns sharpen: the edge ramp narrows toward the top of the cloud.
 return smoothstep(-.09,.14-.11*rise,shape)*(1.-.45*smear)*smoothstep(0.,.05,u.y+.5*uForm.x-(n.r-.5)*.05)*smoothstep(0.,.06,edge);
}
// Cloud exists only within its billows' support (cloudForm), a small part of a tall
// cell. Narrow a ray's stretch [entry,exit] in metres to where it crosses any of
// them; a ray that crosses none comes back empty. Exact: no density lies outside.
vec2 cloudSpan(vec3 origin,vec3 ray,float entry,float exit,float support){
 vec3 scale=vec3(1.,uForm.x,1.)/uExtent,o=(origin-uCentre)*scale,d=ray*scale;
 float near=exit,far=entry;
 vec3 squash=vec3(2.25,uBillow[0].w,2.3),oc=(o-vec3(0.,uBillow[0].y,0.))*squash,dc=d*squash;
 // The lean and trail can carry cloud up to CLOUD_SMEAR cell widths past a billow's own support.
 float bodyReach=support+.2+${(CLOUD_SMEAR*2.3).toFixed(4)};
 float a=dot(dc,dc),b=dot(oc,dc),h=b*b-a*(dot(oc,oc)-bodyReach*bodyReach);
 if(h>0.){h=sqrt(h);near=min(near,(-b-h)/a);far=max(far,(-b+h)/a);}
 a=dot(d,d);
 for(int j=1;j<${CLOUD_BILLOWS};j++){
  oc=o-uBillow[j].xyz;float reach=support/uBillow[j].w+${CLOUD_SMEAR.toFixed(4)};
  b=dot(oc,d);h=b*b-a*(dot(oc,oc)-reach*reach);
  if(h>0.){h=sqrt(h);near=min(near,(-b-h)/a);far=max(far,(-b+h)/a);}
 }
 return vec2(max(entry,near),min(exit,far));
}
float cloudSunDepth(vec3 p) {
 // Taller cells reach proportionally farther, so one tower shades the next.
 float depth=0.,stride=max(10.,uExtent.y/62.);
 for(int j=0;j<5;j++){
  depth+=cloudDensity(p+uSun*stride*.5,false)*stride;p+=uSun*stride;stride*=2.2;
 }
 return depth;
}
`;

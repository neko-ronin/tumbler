/** A seamless linear RG tile. Each curved stroke deposits its lower shaft in
 * red and its flexible end in green, so the renderer can bend only the tips. */
export function paintUndercoat(){
 const size=1024,mask=size-1;
 const texels=new Uint8Array(size*size*2).fill(128);
 let seed=0xcab17;
 function random(){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;
  return seed/4294967296;
 }
 // Fine underfur runs continuously under the longer guard hairs. Long
 // interpolation along Y avoids little islands of unrelated pigment.
 const comb=new Uint8Array(512*12);
 for(let i=0;i<comb.length;i++)comb[i]=random()*255;
 for(let y=0;y<size;y++){
  const v=y*12/size,j=Math.floor(v),fy=v-j;
  const sweep=2.8*Math.sin(2*Math.PI*y/size)+1.25*Math.sin(6*Math.PI*y/size);
  for(let x=0;x<size;x++){
   const u=x*.5+sweep,i=Math.floor(u),fx=u-i;
   const a=comb[j*512+(i&511)]*(1-fx)+comb[j*512+((i+1)&511)]*fx;
   const b=comb[((j+1)%12)*512+(i&511)]*(1-fx)+comb[((j+1)%12)*512+((i+1)&511)]*fx;
   const tone=(a+(b-a)*fy-128);
   const at=2*(y*size+x);
   texels[at]=128+tone*.72;
   texels[at+1]=128+tone*.28;
  }
 }
 // Stagger tapered shafts across two depths. Each hair keeps one pigment
 // from root to tip. Neighbours share a shallow comb direction, not a color.
 for(let layer=0;layer<2;layer++){
  for(let lane=0;lane<160;lane++){
   const x=(lane+.5*layer)*size/160;
   const shift=random()*size;
   for(let segment=0;segment<10;segment++){
    const y=Math.floor(shift+segment*size/10+random()*26);
    const root=x+(random()-.5)*6;
    const length=76+Math.floor(random()*112);
    const phase=2*Math.PI*(x+2*y)/size;
    const slope=.12*Math.sin(phase)+(random()-.5)*.12;
    const curve=(random()-.5)*7;
    const shade=random();
    const pigment=shade<.28?-110:shade>.73?115:(random()-.5)*115;
    const width=1.12+random()*1.20;
    for(let row=0;row<length;row++){
     const t=row/length;
     const at=root+row*slope+curve*t*t;
     const radius=width*(1.-.72*t);
     const tip=t*t*(3.-2.*t);
     const envelope=Math.min(1,(row+1)/5,(1.-t)*12);
     for(let column=Math.floor(at-radius);column<=Math.ceil(at+radius);column++){
      const coverage=.88*envelope*Math.max(0,Math.min(1,radius+.40-Math.abs(column+.5-at)));
      const index=2*(((y+row)&mask)*size+(column&mask));
      texels[index]+=(128+pigment*(1-tip)-texels[index])*coverage;
      texels[index+1]+=(128+pigment*tip-texels[index+1])*coverage;
     }
    }
   }
  }
 }
 return {size,texels};
}

// Eight masks for the individual locks seen against the sky. Texture Y runs
// from root to tip. Unpainted texels outside the strands remain transparent.
export function paintFringe(){
 const cell=64,variants=8,width=cell*variants,texels=new Uint8Array(width*cell*2);
 for(let i=1;i<texels.length;i+=2)texels[i]=128;
 for(let variant=0;variant<variants;variant++){
  const phase=variant*2.39996;
  for(let hair=0;hair<6;hair++){
   const seed=(hair*.618034+variant*.414214)%1;
   const root=(hair+.65+.2*Math.sin(phase+hair))/6.4;
   const length=.41+.57*seed;
   for(let y=0;y<cell*length;y++){
    const t=(y+.5)/cell,along=t/length;
    const curl=Math.sin(phase+hair*1.6)*t*(1.-t)*.44;
    const x=cell*(.5+(root-.5)*(1.-t)+curl);
    const radius=(1.1+.65*seed)*(1.-.64*along);
    for(let k=Math.max(0,Math.floor(x-radius));k<=Math.min(cell-1,Math.ceil(x+radius));k++){
     const coverage=Math.max(0,Math.min(1,radius+.45-Math.abs(k+.5-x)));
     const at=2*(y*width+variant*cell+k);
     const opacity=coverage*Math.min(1,12*(1.-along));
     if(opacity*255>texels[at]){
      texels[at]=255*opacity;
      texels[at+1]=128+(seed<.27?-110:seed>.76?116:8)*opacity;
     }
    }
   }
  }
 }
 return {texels,width,height:cell};
}

// The projections overlap across the ellipsoid. Texture space is fixed to
// each rigid part. Different physical scales have the same fibre width.
export const undercoatFragment=`
uniform sampler2D uUndercoat;
varying vec3 vNapAt;
varying vec3 vNapNormal;
varying vec3 vNapBend;
vec2 napPlane(vec2 at,vec2 bend,float time){
 // A gust crosses neighbouring locks with a phase lag. In still air the
 // offset is zero at every phase, including on the fine tip markings.
 float ripple=1.+.30*sin(dot(at,vec2(17.,-11.))-time*6.5);
 return vec2(texture(uUndercoat,at).r,texture(uUndercoat,at-bend*ripple).g)-.5;
}
vec2 coatDetail(float time){
 vec3 w=vNapNormal*vNapNormal;
 w*=w; w*=w;
 w/=max(dot(w,vec3(1.)),.0001);
 return w.x*napPlane(vNapAt.yz,vNapBend.yz,time)+w.y*napPlane(vNapAt.xz,vNapBend.xz,time)+w.z*napPlane(vNapAt.xy,vNapBend.xy,time);
}`;

/** The snowmelt falls: the side stream over its rock lip into the lake's north bay.
 * Everything is placed from the map and the published ground: the lip is the stream's last
 * point (`water.form.stream_xy_m`), its height the lake surface plus `lip_above_water_m`; the
 * plunge is the first open water down the stream's line from the lip, in the pool at the face's
 * foot. The sheet falls the way the stream runs and hugs the face a metre or two off the rock, scrolling streaks at free-fall speed; a foam plume spreads from the plunge out over
 * the bay and mist drifts around it. Above the lip the stream tumbles white down its bed for
 * `cascade_run_m`, a ribbon laid on the published ground that widens into the sheet's top. Four draws,
 * all animated on the GPU from the shared clock, no per-frame CPU.
 * `width` scales the sheet's width profile, the foam and the mist's spread (4 = the shipped falls);
 * `setWidth(f)` rebuilds at another scale and reports where the slot walls push the sheet off the rock.
 * Mist is soft camera-facing puffs with view-aligned noise. The scene draws into a target whose
 * depth it cannot read back mid-pass, so instead of depth-fading, each puff is placed and sized
 * at build time so the rock never comes within its visible core (`clearance`).
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';

const G=9.81;
// Water over the lip stands this deep over the bed the map cuts (`stream_cut_m`).
const OVER_LIP_M=1.5;
// The sheet's gap to the rock: enough that the drawn terrain, coarser than the sampled ground, never pokes through.
const CLEAR_M=2;
// The plunge stands this far into the pool past the first open water on the stream's line.
const PLUNGE_IN_M=6;

/** Least distance (m) from world point (x, y, z) to the ground within `reach`; negative when buried. */
export function clearance(height,x,y,z,reach=7,step=.25){
  const under=height(x,y);if(under!=null&&z<under)return z-under;
  let best=reach;
  for(let dy=-reach;dy<=reach;dy+=step)for(let dx=-reach;dx<=reach;dx+=step){
    if(dx*dx+dy*dy>=best*best)continue;
    const h=height(x+dx,y+dy);if(h==null)continue;
    const d=Math.hypot(dx,dy,h-z);if(d<best)best=d;
  }
  return best;
}

/** The falls' path, in world metres (x east, y north, z up). */
export function fallsPath(worldmap,height,{rows=44,columns=10,width:scale=4}={}){
  const form=worldmap.water.form,lake=worldmap.water.bodies.find(b=>b.kind==='lake');
  const stream=form.stream_xy_m,[lx,ly]=stream.at(-1),[px,py]=stream.at(-2);
  const surface=lake.surface_z_m,lipZ=surface+form.lip_above_water_m;
  let rx=lx-px,ry=ly-py;const rn=Math.hypot(rx,ry);rx/=rn;ry/=rn;
  // The plunge: the first open water down the stream's own line from the lip, a few metres in, so the
  // sheet falls the way the stream runs and lands in the pool at the face's foot rather than on its rim.
  const wet=(x,y)=>{const h=height(x,y);return h!=null&&h<surface-.3;};
  let first=null;
  for(let a=2;a<200&&first==null;a+=.5)if(wet(lx+rx*a,ly+ry*a))first=a;
  if(first==null)throw new Error('falls: no lake water below the lip');
  const fx=rx,fy=ry,fn=first+PLUNGE_IN_M,plunge=[lx+fx*fn,ly+fy*fn];
  // The drawn ground (8 m quads) cannot hold the stream's narrow cut, so the water stands its depth over the drawn lip.
  const top=Math.max(lipZ-OVER_LIP_M,height(lx,ly)+OVER_LIP_M),bottom=surface+.3,drop=top-bottom;
  // Face profile on the fall line: the first point, walking out from the lip (never behind it), where the ground is below z.
  const faceAt=(ox,oy,z)=>{for(let a=0;a<fn+30;a+=.25){const h=height(ox+fx*a,oy+fy*a);if(h!=null&&h<z)return a;}return null;};
  const points=[],sheet=[],pushed=[],buried=[];
  for(let i=0;i<=rows;i++){
    const k=i/rows,d=drop*Math.pow(k,1.35),z=top-d;   // rows closer together at the lip, where the curve is
    const width=(7+14*Math.pow(k,.8))*scale,want=1.2+(CLEAR_M-1.2)*Math.min(k/.08,1);
    const row=[];
    for(let j=0;j<=columns;j++){
      const u=j/columns*2-1,s=u*width/2,ox=lx-fy*s,oy=ly+fx*s;
      let a=faceAt(ox,oy,z);if(a==null)a=fn;
      // Walk out from the face until the water clears the rock.
      let x=ox+fx*a,y=oy+fy*a,best=-Infinity,walked=0;
      for(let c=.5;c<8&&best<want;c+=.25){const cx=ox+fx*(a+c),cy=oy+fy*(a+c),gap=clearance(height,cx,cy,z,4,.25);if(gap>best){best=gap;x=cx;y=cy;walked=c;}}
      // Where the slot's side walls stand in the curtain's way the walk-out goes far past the face:
      // the sheet stands proud of the rock there instead of hugging it. Never hidden, always reported.
      if(best<.3)buried.push({i,j,gap:best});else if(walked>4&&k>.1&&k<.95)pushed.push({i,j,walked});  // the lip and the foot walk out by design
      row.push({x,y,z,u,d});
    }
    sheet.push(row);
  }
  for(const row of sheet)points.push(row[columns>>1]);
  return {width:scale,pushed,buried,lip:[lx,ly,lipZ],plunge:[plunge[0],plunge[1],surface],direction:[fx,fy],stream:[rx,ry],surface,top,drop,face:points,sheet,rows,columns};
}

// The cascade's water stands this far over the bed it runs on, rising to the sheet's top at the lip.
const CASCADE_OVER_M=.6;
// How far either side of the stream's line the cascade looks for its bed.
const BED_SEEK_M=12;

/** The cascade above the lip: rows across the stream every `step` metres up its line from the lip, in world metres. */
export function cascadePath(worldmap,height,path,{step=2.5,columns=8}={}){
  const form=worldmap.water.form,line=form.stream_xy_m,run=form.cascade_run_m;
  // Point and direction (downstream) `d` metres up the stream's line from the lip.
  const at=d=>{let left=d;for(let i=line.length-1;i>0;i--){const [ax,ay]=line[i],[bx,by]=line[i-1],l=Math.hypot(bx-ax,by-ay);
    if(left<=l||i===1){const t=left/l;return [ax+(bx-ax)*t,ay+(by-ay)*t];}left-=l;}};
  const rows=Math.round(run/step),grid=[],frames=[];
  for(let i=0;i<=rows;i++){
    const d=run*(1-i/rows),[x,y]=at(d),[ux,uy]=at(d+6),[dx,dy]=at(Math.max(0,d-6));
    let fx=dx-ux,fy=dy-uy;const fn=Math.hypot(fx,fy);fx/=fn;fy/=fn;
    // The map's control points are joined straight here, but the ground's gorge follows a spline through
    // them: find the bed (the lowest ground across the line, nearest the line on a tie) within BED_SEEK_M.
    let shift=0,low=Infinity;
    for(let s=-BED_SEEK_M;s<=BED_SEEK_M;s+=.5){const h=height(x-fy*s,y+fx*s)+Math.abs(s)*.01;if(h<low){low=h;shift=s;}}
    frames.push({d,x,y,fx,fy,shift});
  }
  // Smooth the bed's line over five rows, so the ribbon follows it without kinks.
  const shifts=frames.map((_,i)=>{let sum=0,n=0;for(let k=Math.max(0,i-2);k<=Math.min(rows,i+2);k++){sum+=frames[k].shift;n++;}return sum/n;});
  // Within 12 m of the lip the ribbon eases back onto the stream's line, which the falls' sheet starts from.
  for(let i=0;i<=rows;i++){
    const {d,fx,fy}=frames[i],shift=shifts[i]*Math.min(1,d/12),x=frames[i].x-fy*shift,y=frames[i].y+fx*shift;
    // Narrow up the bed, opening over the last 40 m to the sheet's lit core at the lip.
    const half=5+1.25*path.width*Math.pow(Math.max(0,1-d/40),1.5);
    // Steepness of the bed over the next few metres down: steps tumble whiter.
    const back=Math.min(3,d),fall=(height(x-fx*3,y-fy*3)-height(x+fx*back,y+fy*back))/Math.max(1,3+back);
    const over=CASCADE_OVER_M+(Math.min(path.top,height(x,y)+1.45)-height(x,y)-CASCADE_OVER_M)*Math.max(0,1-d/12);
    const row=[];
    for(let j=0;j<=columns;j++){
      const u=j/columns*2-1,vx=x-fy*u*half,vy=y+fx*u*half;
      row.push({x:vx,y:vy,z:height(vx,vy)+over,u,d,fall});
    }
    grid.push(row);
  }
  return {rows,columns,run,drop:form.cascade_drop_m,grid};
}

const NOISE=`float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
 float vnoise(vec2 x){vec2 i=floor(x),f=fract(x),u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x),mix(hash(i+vec2(0,1)),hash(i+1.),u.x),u.y);}
 float fbm(vec2 x){return vnoise(x)*.5+vnoise(x*2.03+7.1)*.3+vnoise(x*4.11-3.7)*.2;}
`;
// White water lit by the sun and the sky; shade keeps it pale and cool, never grey.
const LIGHT=`vec3 waterLight(vec3 n,float sunny){float d=max(dot(n,uSun),0.);
  return mix(vec3(.62,.72,.76),vec3(1.,.99,.95),.35+.65*d*sunny);}`;
const OUT=`#include <tonemapping_fragment>
 #include <colorspace_fragment>
 #include <fog_fragment>`;

function sheetMesh(path){
  const {sheet,rows,columns,drop}=path,count=(rows+1)*(columns+1);
  const position=new Float32Array(count*3),fall=new Float32Array(count*2),normal=new Float32Array(count*3);
  sheet.flat().forEach((v,i)=>{position.set([v.x,v.z,-v.y],i*3);fall.set([v.u,v.d],i*2);});
  const geometry=new T.BufferGeometry(),index=[];
  for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=i*(columns+1)+j,b=a+columns+1;index.push(a,b,a+1,a+1,b,b+1);}
  geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setAttribute('aFall',new T.BufferAttribute(fall,2));
  geometry.setIndex(index);geometry.computeVertexNormals();
  const material=new T.ShaderMaterial({name:'falls_sheet',transparent:true,depthWrite:false,side:T.DoubleSide,fog:true,
    uniforms:{uTime:style.time,uSun:style.sun,uDrop:{value:drop},...T.UniformsUtils.merge([T.UniformsLib.fog])},
    vertexShader:`attribute vec2 aFall;varying vec2 vFall;varying vec3 vNormal;varying vec3 vView;
     #include <fog_pars_vertex>
     void main(){vFall=aFall;vNormal=normal;vec4 world=modelMatrix*vec4(position,1.);vView=cameraPosition-world.xyz;
      vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
     }`,
    fragmentShader:`uniform float uTime,uDrop;uniform vec3 uSun;varying vec2 vFall;varying vec3 vNormal;varying vec3 vView;
     #include <fog_pars_fragment>
     ${NOISE}${LIGHT}
     void main(){
      float u=vFall.x,d=vFall.y,k=d/uDrop;
      // Seconds since the water left the lip: streaks scroll by it, so they fall at sqrt(2 g d) and stretch as they go.
      float t=sqrt(2.*max(d,0.)/${G.toFixed(2)});
      float jets=fbm(vec2(u*4.5,t*1.2-uTime*1.2))*.6+fbm(vec2(u*12.+3.,t*3.-uTime*3.))*.4;
      float fine=vnoise(vec2(u*40.,t*9.-uTime*9.));
      // Surges: brighter lumps of water riding down the sheet, the motion that reads from afar.
      float surge=smoothstep(.35,.8,vnoise(vec2(u*2.+11.,t*1.5-uTime*1.5)));
      float broken=smoothstep(.25,.95,k);
      float cover=smoothstep(.3+.25*broken,.62+.2*broken,jets+.2*fine+.2*surge);
      float edge=smoothstep(1.,.45-.2*broken,abs(u)+(jets-.5)*.5*broken);
      float alpha=edge*mix(.3,.97,cover)*(1.-.2*broken);
      // Spray near the foot: the sheet turns into a white haze before it reaches the pool.
      alpha=mix(alpha,edge*.7*(.55+.45*jets),smoothstep(.85,1.,k));
      vec3 n=normalize(vNormal);if(dot(n,vView)<0.)n=-n;
      vec3 col=mix(vec3(.42,.58,.60),waterLight(n,1.)*(1.+.08*surge),.3+.7*cover);
      gl_FragColor=vec4(col,alpha);
      ${OUT}
     }`});
  const mesh=new T.Mesh(geometry,material);mesh.name='falls_sheet';mesh.renderOrder=6;return mesh;
}

// White water down the stream's bed above the lip: lumps of foam riding down at a few metres a
// second, whiter over the bed's steps, the bed's own dark water between them, ragged at the banks.
function cascadeMesh(cascade){
  const {grid,rows,columns,run}=cascade,count=(rows+1)*(columns+1);
  const position=new Float32Array(count*3),fall=new Float32Array(count*3);
  grid.flat().forEach((v,i)=>{position.set([v.x,v.z,-v.y],i*3);fall.set([v.u,v.d,v.fall],i*3);});
  const geometry=new T.BufferGeometry(),index=[];
  for(let i=0;i<rows;i++)for(let j=0;j<columns;j++){const a=i*(columns+1)+j,b=a+columns+1;index.push(a,b,a+1,a+1,b,b+1);}
  geometry.setAttribute('position',new T.BufferAttribute(position,3));geometry.setAttribute('aFall',new T.BufferAttribute(fall,3));
  geometry.setIndex(index);geometry.computeVertexNormals();
  const material=new T.ShaderMaterial({name:'falls_cascade',transparent:true,depthWrite:false,side:T.DoubleSide,fog:true,
    uniforms:{uTime:style.time,uSun:style.sun,uRun:{value:run},...T.UniformsUtils.merge([T.UniformsLib.fog])},
    vertexShader:`attribute vec3 aFall;varying vec3 vFall;varying vec3 vNormal;
     #include <fog_pars_vertex>
     void main(){vFall=aFall;vNormal=normal;vec4 mvPosition=viewMatrix*modelMatrix*vec4(position,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
     }`,
    fragmentShader:`uniform float uTime,uRun;uniform vec3 uSun;varying vec3 vFall;varying vec3 vNormal;
     #include <fog_pars_fragment>
     ${NOISE}${LIGHT}
     void main(){
      float u=vFall.x,d=vFall.y,steps=smoothstep(.05,.25,vFall.z);
      // Metres down the bed the water has come: the pattern rides down toward the lip at 4 m/s.
      float a=d+uTime*4.;
      // The fine octave fades before a pixel spans it, so the far cascade never shimmers.
      float near=1.-smoothstep(.25,.7,fwidth(a)*.5);
      float lumps=fbm(vec2(u*2.5,a*.12));
      float froth=mix(.5,vnoise(vec2(u*7.,a*.5)),near);
      float cover=smoothstep(.38,.72,lumps*.7+froth*.3+.22*steps);
      float edge=smoothstep(1.,.5,abs(u)+(lumps-.5)*.4);
      float alpha=edge*smoothstep(uRun,uRun-30.,d)*mix(.3,.95,cover);
      vec3 n=normalize(vNormal);if(n.y<0.)n=-n;
      vec3 col=mix(vec3(.28,.42,.42),waterLight(n,1.),.3+.7*cover);
      gl_FragColor=vec4(col,alpha);
      ${OUT}
     }`});
  const mesh=new T.Mesh(geometry,material);mesh.name='falls_cascade';mesh.renderOrder=6;return mesh;
}

// Foam on the water: a churning pool at the plunge and a plume carried out over the bay, past the
// bench that hides the pool itself from the shore. Drawn wherever the ground is below the water;
// the bench and shores cover the rest.
const PLUME_M=75;
function foamMesh(path){
  const [x,y,z]=path.plunge,[fx,fy]=path.direction,radius=22*(.5+.5*path.width),side=PLUME_M+radius;
  const geometry=new T.PlaneGeometry(2*side,2*side);geometry.rotateX(-Math.PI/2);geometry.translate(x+fx*PLUME_M*.5,z+.06,-(y+fy*PLUME_M*.5));
  const material=new T.ShaderMaterial({name:'falls_foam',transparent:true,depthWrite:false,fog:true,
    uniforms:{uTime:style.time,uSun:style.sun,uCentre:{value:new T.Vector2(x,-y)},uRadius:{value:radius},uOut:{value:new T.Vector2(fx,-fy)},...T.UniformsUtils.merge([T.UniformsLib.fog])},
    vertexShader:`varying vec2 vPlace;
     #include <fog_pars_vertex>
     void main(){vec4 world=modelMatrix*vec4(position,1.);vPlace=world.xz;vec4 mvPosition=viewMatrix*world;gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
     }`,
    fragmentShader:`uniform float uTime,uRadius;uniform vec2 uCentre,uOut;uniform vec3 uSun;varying vec2 vPlace;
     #include <fog_pars_fragment>
     ${NOISE}${LIGHT}
     void main(){vec2 p=vPlace-uCentre;float r=length(p)/uRadius;vec2 dir=p/max(length(p),.001);
      // Foam drifts out from the plunge: sample the noise along a radius that grows with time.
      float a=atan(p.y,p.x);
      float churn=fbm(vec2(a*6.,length(p)*.35-uTime*1.1))*.6+fbm(p*.45+dir*uTime*.9)*.4;
      float lace=smoothstep(.45,.75,fbm(p*1.3-dir*uTime*1.4));
      float body=smoothstep(1.,.15,r+(churn-.5)*.5);
      float alpha=clamp(body*(.55+.45*churn)+lace*.35*smoothstep(1.,.4,r),0.,1.)*.9;
      // The plume: foam streaks carried out from the plunge, spreading and thinning with distance.
      float along=dot(p,uOut),across=abs(dot(p,vec2(-uOut.y,uOut.x)));
      float reach=clamp(along/${PLUME_M.toFixed(1)},0.,1.),spread=uRadius*(.6+1.4*reach);
      float plume=smoothstep(1.,.3,across/spread+(churn-.5)*.6)*smoothstep(1.,.55,reach)*step(0.,along);
      float streaks=smoothstep(.4,.7,fbm(vec2(across*.25,along*.08-uTime*.6)+dir*.5));
      alpha=max(alpha,plume*(.35+.6*streaks)*(1.-.5*reach));
      gl_FragColor=vec4(waterLight(vec3(0,1,0),1.),alpha);
      ${OUT}
     }`});
  const mesh=new T.Mesh(geometry,material);mesh.name='falls_foam';mesh.renderOrder=5;return mesh;
}

/** Mist puffs around the plunge, each placed where the rock stays outside its visible core. */
export function mistPuffs(path,height,count=110){
  const w=path.width??1;
  const [px,py,pz]=path.plunge,[fx,fy]=path.direction;let seed=4271;
  // Under water is no wall: the surface fade already hides what dips below it.
  const above=(x,y)=>{const h=height(x,y);return h!=null&&h<pz?null:h;};
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const puffs=[];
  for(let tries=0;tries<count*40&&puffs.length<count;tries++){
    // Most mist hangs over the pool; some is carried out into the bay and up the face.
    const out=next()**1.2*(70+15*w)-4,side=(next()*2-1)*(6*w+out*.9),rise=next()**2.5*45,size=5+next()*7+rise*.15+out*.1;
    const x=px+fx*out-fy*side,y=py+fy*out+fx*side,z=pz+1.5+rise*.25,climb=6+rise*.6;
    // The puff rises `climb` over its life; the rock must stay out of its core the whole way.
    let ok=true;for(const f of [0,.5,1]){if(clearance(above,x,y,z+climb*f,size,1)<size*.8){ok=false;break;}}
    if(ok)puffs.push({x,y,z,size,climb,phase:next(),drift:next()});
  }
  return puffs;
}

function mistMesh(puffs){
  const corners=[[-1,-1],[1,-1],[1,1],[-1,1]],count=puffs.length;
  const centre=new Float32Array(count*12),corner=new Float32Array(count*8),info=new Float32Array(count*16),index=[];
  puffs.forEach((p,i)=>{for(let c=0;c<4;c++){centre.set([p.x,p.z,-p.y],(i*4+c)*3);corner.set(corners[c],(i*4+c)*2);info.set([p.size,p.climb,p.phase,p.drift],(i*4+c)*4);}
    index.push(i*4,i*4+1,i*4+2,i*4,i*4+2,i*4+3);});
  const geometry=new T.BufferGeometry();
  geometry.setAttribute('position',new T.BufferAttribute(centre,3));geometry.setAttribute('aCorner',new T.BufferAttribute(corner,2));geometry.setAttribute('aInfo',new T.BufferAttribute(info,4));
  geometry.setIndex(index);geometry.computeBoundingSphere();geometry.boundingSphere.radius+=60;
  const material=new T.ShaderMaterial({name:'falls_mist',transparent:true,depthWrite:false,fog:true,
    uniforms:{uTime:style.time,uSun:style.sun,uWind:style.wind,uSurface:{value:0},...T.UniformsUtils.merge([T.UniformsLib.fog])},
    vertexShader:`attribute vec2 aCorner;attribute vec4 aInfo;uniform float uTime;uniform vec2 uWind;
     varying vec2 vCorner;varying float vLife;varying float vSeed;varying float vHeight;
     #include <fog_pars_vertex>
     void main(){float life=fract(uTime/9.+aInfo.z);vLife=sin(3.14159*life);vSeed=aInfo.z*37.+aInfo.w*11.;vCorner=aCorner;
      vec3 c=position+vec3(0.,aInfo.y*life,0.)+vec3(uWind.x,0.,uWind.y)*life*(3.+5.*aInfo.w);
      float size=aInfo.x*(.75+.5*life);
      vec3 right=vec3(viewMatrix[0][0],viewMatrix[1][0],viewMatrix[2][0]),up=vec3(viewMatrix[0][1],viewMatrix[1][1],viewMatrix[2][1]);
      vec3 world=c+(right*aCorner.x+up*aCorner.y)*size;vHeight=world.y;
      vec4 mvPosition=viewMatrix*vec4(world,1.);gl_Position=projectionMatrix*mvPosition;
      #include <fog_vertex>
     }`,
    fragmentShader:`uniform float uTime,uSurface;uniform vec3 uSun;varying vec2 vCorner;varying float vLife;varying float vSeed;varying float vHeight;
     #include <fog_pars_fragment>
     ${NOISE}${LIGHT}
     void main(){float r=length(vCorner);
      // View-aligned noise, churned over time, eats the round edge so no puff reads as a disc.
      float n=fbm(vCorner*1.6+vSeed+vec2(uTime*.05,-uTime*.12))*.65+fbm(vCorner*3.7-vSeed+vec2(0.,-uTime*.25))*.35;
      float density=smoothstep(1.,.05,r+(n-.5)*1.1)*smoothstep(.3,.75,n+.15*(1.-r));
      float alpha=density*vLife*.12*smoothstep(uSurface,uSurface+2.5,vHeight);
      gl_FragColor=vec4(waterLight(vec3(0,1,0),.55),alpha);
      ${OUT}
     }`});
  material.uniforms.uSurface.value=0;
  const mesh=new T.Mesh(geometry,material);mesh.name='falls_mist';mesh.renderOrder=7;return mesh;
}

/** The falls' meshes from the map and the ground the client draws; `setWidth(f)` rebuilds them wider or narrower. */
export function buildFalls(worldmap,ground,{width=4}={}){
  const height=(x,y)=>ground.height(x,y),group=new T.Group();group.name='falls';
  const falls={group,path:null,cascade:null,setWidth(f){
    for(const mesh of [...group.children]){group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
    const path=fallsPath(worldmap,height,{width:f});falls.path=path;
    const mist=mistMesh(mistPuffs(path,height));mist.material.uniforms.uSurface.value=path.surface;
    falls.cascade=cascadePath(worldmap,height,path);
    group.add(sheetMesh(path),cascadeMesh(falls.cascade),foamMesh(path),mist);
    const cells=(path.rows+1)*(path.columns+1);
    if(path.pushed.length||path.buried.length)console.warn(`falls width ${f}: ${path.pushed.length}/${cells} face vertices stand more than 4 m proud of the rock, ${path.buried.length} cut into the rock (slot walls)`);
    return {pushed:path.pushed.length,buried:path.buried.length,vertices:cells};
  }};
  falls.setWidth(width);
  return falls;
}

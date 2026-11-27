/** Layered lake reflections (card 085): the planar mirror's picture (mirror.js) without redrawing
 * the world upside down. The result fills the same texture slot the mirror does, at the same size,
 * and the water shader samples it the same way (bent by the ripples); only how it is made differs.
 * Each texel of that texture names a reflected ray; three layers answer it with a colour and a
 * distance along the ray, and the nearest wins (composeLayers is the reference):
 *
 * 1. Screen space. A marker drawn after the static opaque world and before the movers copies the
 *    main pass's colour and depth (one blit) and, there and then, runs the composite pass, which
 *    marches each ray through that copy. Movers draw after the copy, so nothing reflects twice.
 * 2. Baked probes. Where the ray leaves the screen or passes behind something, a march against the
 *    water's ground grid and panoramas baked per time of day at points on the lake
 *    (client/web/tools/bake-reflections.cjs): the grid fixes where, the probes what colour.
 * 3. Live: a small sky-and-clouds pass (the mirror's own; clouds billow) and a planar pass of the
 *    movers only, drawn as cheap stand-ins (MOVERS_LAYER) with their own depth.
 *
 * The pass is skipped by the mirror's rules (no lake on screen, eye under water, too steep).
 */
import * as T from '../vendor/three.module.min.js';
import {style} from './style.js';
import {mirrorView,mirrorWorthDrawing} from './mirror.js';

export const MOVERS_LAYER=5,SKY_LAYER=6,DEPTH_LAYER=7;
// The snapshot marker sorts after the static world (renderOrder 0) and before the movers.
export const SNAPSHOT_ORDER=999,MOVER_ORDER=1000;
// Probe panoramas: azimuth across, sin(elevation) from PROBE_SIN_MIN to 1 down each probe's
// rows (equal area: rows crowd toward the horizon, where the shores are). Probes stand a hand
// over the water, so every point a reflected ray reaches lies at or above their horizon. Distance is coded
// as 12 bits of log(metres) between PROBE_LOG_RANGE (0.28% steps), 4095 meaning open sky, packed
// high 8 bits in red and low 4 in the top of green so the PNG stays small.
export const PROBE_SIN_MIN=-.02,PROBE_LOG_RANGE=[Math.log(.5),Math.log(40000)],PROBE_MAX=8;
export const PROBE_FILE='client/web/data/reflections/probes.json';
// The world data a bake depends on: a change to any of them stales the probes.
export const BAKE_INPUTS=['shared/world/worldmap.json','shared/world/out/placement.json','client/web/data/heightmap.f32','client/web/data/farfield.f32',
  'shared/world/out/horizon_range.json','shared/world/out/horizon_map.png','shared/world/out/river_granite.json','shared/world/out/landscape_transition.json',
  'shared/geometry/granite/geology.json','shared/geometry/tree-design/adopted-redwoods.json'];

export function probeUv(x,y,z){return [Math.atan2(z,x)/(2*Math.PI)+.5,(y-PROBE_SIN_MIN)/(1-PROBE_SIN_MIN)];}
export function probeDirection(u,v){const y=PROBE_SIN_MIN+v*(1-PROBE_SIN_MIN),a=(u-.5)*2*Math.PI,r=Math.sqrt(Math.max(0,1-y*y));return [r*Math.cos(a),y,r*Math.sin(a)];}
export function encodeDistance(metres){
  if(!(metres<Math.exp(PROBE_LOG_RANGE[1])))return 4095;
  const x=(Math.log(Math.max(metres,Math.exp(PROBE_LOG_RANGE[0])))-PROBE_LOG_RANGE[0])/(PROBE_LOG_RANGE[1]-PROBE_LOG_RANGE[0]);
  return Math.min(4094,Math.round(x*4095));
}
export function decodeDistance(code){return code>=4095?Infinity:Math.exp(PROBE_LOG_RANGE[0]+code/4095*(PROBE_LOG_RANGE[1]-PROBE_LOG_RANGE[0]));}
/** The two bytes (red, green) a distance code is stored as, and back. */
export const packDistance=code=>[code>>4,(code&15)<<4],unpackDistance=(r,g)=>(r<<4)|(g>>4);

/** The composite pass's rule, for tests and reading (layeredReflection in COMPOSITE_GLSL follows it).
 * Distances are metres along the reflected ray beyond the water; Infinity is open sky.
 * ssr: {state:'hit'|'sky'|'unknown', colour, t, hidden (it passed behind something first), edge (1 well inside the screen), slack (its depth uncertainty)}
 * probe: {hit, colour, t} (consulted only where screen space cannot be sure); movers: {colour (premultiplied), alpha, t}. */
export function composeLayers({ssr,probe,movers,sky}){
  let colour=sky,t=Infinity;
  if(ssr.state==='hit'){colour=ssr.colour;t=ssr.t;}
  const needProbe=ssr.state==='unknown'||(ssr.state==='hit'&&(ssr.hidden||ssr.edge<1));
  if(needProbe){
    const pc=probe.hit?probe.colour:sky,pt=probe.hit?probe.t:Infinity;
    if(ssr.state==='unknown'){colour=pc;t=pt;}
    else{
      // The screen hid part of the ray: a surface the probe sees clearly nearer there wins.
      if(ssr.hidden&&pt<.85*t-(ssr.slack??0)){colour=pc;t=pt;}
      // Near the screen's edge the screen's answer fades into the probe's.
      else if(ssr.edge<1){colour=colour.map((c,i)=>pc[i]+(c-pc[i])*ssr.edge);}
    }
  }
  // A screen hit's distance is only as sure as the ray's depth change across a pixel (slack), a
  // probe's as its 12 bits and parallax: a mover must be clearly behind to be hidden.
  if(movers.alpha>0&&movers.t<t+(ssr.state==='hit'?ssr.slack??0:0)+Math.max(2,.02*t)){colour=colour.map((c,i)=>c*(1-movers.alpha)+movers.colour[i]);t=movers.t;}
  return {colour,t};
}

/** Vertex clustering: an index over `geometry`'s own vertices, one vertex standing for each
 * `cell`-sized cube it occupies, dropping triangles that collapse. The stand-in shares every
 * attribute (and so skinning, cloth and instance updates) with the original. */
export function clusterIndex(geometry,cell){
  const position=geometry.attributes.position,n=position.count,stand=new Int32Array(n),seen=new Map();
  for(let i=0;i<n;i++){
    const key=`${Math.floor(position.getX(i)/cell)},${Math.floor(position.getY(i)/cell)},${Math.floor(position.getZ(i)/cell)}`;
    let s=seen.get(key);if(s===undefined){s=i;seen.set(key,i);}stand[i]=s;
  }
  const index=geometry.index,count=index?index.count:n,out=[],faces=new Set();
  for(let i=0;i+2<count;i+=3){
    const a=stand[index?index.getX(i):i],b=stand[index?index.getX(i+1):i+1],c=stand[index?index.getX(i+2):i+2];
    if(a===b||b===c||a===c)continue;
    const key=[a,b,c].sort((x,y)=>x-y).join(',');if(faces.has(key))continue;faces.add(key);out.push(a,b,c);
  }
  return out;
}

/** A stand-in for `mesh` (at most `most` triangles) on the movers layer only, a child of it so it follows its transform,
 * visibility, skeleton and instances. Null when the clustering leaves nothing. */
export function standIn(mesh,cell,most=400){
  // A stand-in has at most `most` triangles: the cell doubles until it fits.
  let triangles=clusterIndex(mesh.geometry,cell);
  while(triangles.length/3>most){cell*=2;triangles=clusterIndex(mesh.geometry,cell);}
  if(!triangles.length)return null;
  const geometry=new T.BufferGeometry();
  for(const [name,attribute] of Object.entries(mesh.geometry.attributes))geometry.setAttribute(name,attribute);
  geometry.setIndex(triangles);
  if(!mesh.geometry.boundingSphere)mesh.geometry.computeBoundingSphere();
  geometry.boundingSphere=mesh.geometry.boundingSphere;geometry.boundingBox=mesh.geometry.boundingBox;
  let proxy;
  if(mesh.isSkinnedMesh){proxy=new T.SkinnedMesh(geometry,mesh.material);proxy.bindMode=mesh.bindMode;proxy.bind(mesh.skeleton,mesh.bindMatrix);}
  else if(mesh.isInstancedMesh){proxy=new T.InstancedMesh(geometry,mesh.material,mesh.instanceMatrix.count);proxy.instanceMatrix=mesh.instanceMatrix;proxy.instanceColor=mesh.instanceColor;proxy.count=mesh.count;}
  else proxy=new T.Mesh(geometry,mesh.material);
  proxy.name=`${mesh.name}_reflection`;proxy.layers.set(MOVERS_LAYER);proxy.frustumCulled=mesh.frustumCulled;
  proxy.receiveShadow=mesh.receiveShadow;proxy.userData.reflectionProxy=true;
  mesh.add(proxy);
  return proxy;
}

const sizeOf=(object)=>new T.Box3().setFromObject(object).getSize(new T.Vector3()).length();
const SKIP=/fur\d|hair|catchlight|iris|pupil|lid|eye|^Sphere|katana|blade|sheath/i;

/** Movers: each figure (`figures`, the cats) gets stand-ins for its larger parts, clustered at a
 * 22nd of its size; each wing (`wings`) a cloth stand-in at a 30th of its span; `instanced` meshes
 * (bees) an instanced stand-in; `live` objects, cheap already (cabins, butterflies, motes, the
 * falls, glass), are drawn as they are. Every opaque mesh under `roots` sorts after the snapshot.
 * `scan` picks up movers made later (the folk's wings) and is run every 60th frame. */
export function createMovers({figures=()=>[],wings=()=>[],live=[],instanced=()=>[],roots=()=>[]}){
  const done=new WeakSet(),proxies=[],forced=new Set(),stats={proxies:0,triangles:0,scans:0};
  const add=p=>{if(!p)return;proxies.push(p);stats.proxies++;stats.triangles+=p.geometry.index.count/3;};
  function scan(){
    stats.scans++;
    for(const figure of figures()){
      if(done.has(figure))continue;done.add(figure);
      const size=sizeOf(figure)||1,meshes=[];
      figure.traverse(o=>{if(o.isMesh&&!o.userData.reflectionProxy&&!o.material.transparent&&!SKIP.test(o.name))meshes.push(o);});
      for(const mesh of meshes){
        const s=sizeOf(mesh);if(s<size*.12)continue;
        const scale=mesh.isSkinnedMesh?mesh.bindMatrix.getMaxScaleOnAxis():mesh.matrixWorld.getMaxScaleOnAxis()||1;
        add(standIn(mesh,size*.045/scale));
      }
    }
    for(const mesh of wings()){if(done.has(mesh))continue;done.add(mesh);mesh.geometry.computeBoundingBox();add(standIn(mesh,mesh.geometry.boundingBox.getSize(new T.Vector3()).length()/30,800));}
    for(const mesh of instanced()){if(done.has(mesh))continue;done.add(mesh);mesh.geometry.computeBoundingBox();add(standIn(mesh,mesh.geometry.boundingBox.getSize(new T.Vector3()).length()/5));}
    for(const object of live){if(!object||done.has(object))continue;done.add(object);object.traverse(o=>{if(o.isMesh||o.isPoints||o.isLine){o.layers.enable(MOVERS_LAYER);if(o.material.transparent&&!o.material.depthWrite){o.layers.enable(DEPTH_LAYER);forced.add(o.material);}}});}
    for(const root of roots())root?.traverse(o=>{if((o.isMesh||o.isLine)&&!o.userData.reflectionProxy&&!o.material.transparent)o.renderOrder=MOVER_ORDER;});
  }
  return {scan,proxies,stats,
    /** Before the movers pass: instance counts follow the originals. */
    prepare(){for(const p of proxies)if(p.isInstancedMesh)p.count=p.parent?.count??0;},
    /** Transparent movers blend without writing depth; afterwards they are drawn again
     * (DEPTH_LAYER) into depth alone, so the composite can place them. Returns the undo. */
    depthOnly(){
      const undo=[...forced];for(const m of undo){m.depthWrite=true;m.colorWrite=false;}
      return ()=>{for(const m of undo){m.depthWrite=false;m.colorWrite=true;}};
    }};
}

/** The composite pass's fragment shader: one texel per reflected ray (its mirror uv, vUv). */
export const COMPOSITE_GLSL=`
  uniform sampler2D uSsrColor,uSsrDepth,uMovers,uMoversDepth,uProbeColour,uProbeDistance,uSky,uHeights;
  uniform mat4 uSsrViewProjection,uReflectVirtualInverse,uMoversInverse;uniform vec4 uSsrNearFar,uGrid,uBounds;uniform vec2 uProbeRange;
  uniform vec3 uReflectEye,uReflectForward,uReflectLayers,uFogColor;uniform vec3 uProbePoints[8];uniform vec4 uProbeInfo;uniform float uLevel,uFog;
  varying vec2 vUv;
  // The ground under a point, over the same two triangles per cell the terrain draws (the water's own grid).
  float bed(vec2 world){
    vec2 g=(world-uGrid.xy)/uGrid.z,c=floor(g),f=g-c;
    float r=uGrid.w,a=texture2D(uHeights,(c+.5)/r).r,b=texture2D(uHeights,(c+vec2(1.5,.5))/r).r,
      e=texture2D(uHeights,(c+vec2(.5,1.5))/r).r,d=texture2D(uHeights,(c+1.5)/r).r;
    return f.x>=f.y?a+(b-a)*f.x+(d-b)*f.y:a+(e-a)*f.y+(d-e)*f.x;}
  const float NONE=1e9;
  float ssrDepthAt(vec2 uv){float d=texture2D(uSsrDepth,uv).r;return uSsrNearFar.x*uSsrNearFar.y/(uSsrNearFar.y-d*(uSsrNearFar.y-uSsrNearFar.x));}
  // March the screen between q and the ray's far end. Returns 1 hit, 0 open sky all the way on
  // screen, 2 unknown (left the screen, or passed behind something and found nothing after).
  float ssrTrace(vec3 q,vec3 d,float jitter,out vec3 colour,out float t,out float hidden,out float edge,out float slack){
    colour=vec3(0.);t=NONE;hidden=0.;edge=1.;slack=0.;
    if(uReflectLayers.x<.5)return 2.;
    vec4 c0=uSsrViewProjection*vec4(q,1.),dc=uSsrViewProjection*vec4(d,0.);
    float near=2.*uSsrNearFar.x,tEnd=40000.;
    if(dc.w<0.)tEnd=min(tEnd,(c0.w-near)/-dc.w);
    if(c0.w<near||tEnd<=1.)return 2.;
    vec4 c1=c0+dc*tEnd;
    vec2 s0=c0.xy/c0.w*.5+.5,s1=c1.xy/c1.w*.5+.5,ds=s1-s0;
    float sEnd=1.;
    if(ds.x>0.)sEnd=min(sEnd,(1.-s0.x)/ds.x);else if(ds.x<0.)sEnd=min(sEnd,-s0.x/ds.x);
    if(ds.y>0.)sEnd=min(sEnd,(1.-s0.y)/ds.y);else if(ds.y<0.)sEnd=min(sEnd,-s0.y/ds.y);
    float k0=1./c0.w,k1=1./c1.w,prev=0.,front=1.,s=0.,hiddenPx=0.;
    // The ray's depth changes fastest near its vanishing point: a surface can only be told
    // apart from the ray to within the ray's own change of depth across a pixel or so.
    float pixels=max(1.,length(ds*sEnd*uSsrNearFar.zw));
    // Each step goes the shorter of a 32nd of the way across the screen and a third farther
    // along the ray: the far kilometres crowd into the last few pixels before the vanishing point.
    float grow=1.3+.1*jitter;
    for(int i=0;i<80;i++){
      float tr=s*tEnd*k1/mix(k0,k1,s),tn=max(tr*grow,1.+jitter);
      s=min(sEnd,min(tn*c1.w/(tEnd*(c0.w+dc.w*tn)),s+sEnd*(1.+jitter)/32.));
      vec2 uv=s0+ds*s;float rayZ=1./mix(k0,k1,s),sceneZ=ssrDepthAt(uv);
      if(rayZ>sceneZ){
        if(front>.5){
          float a=prev,b=s;
          for(int j=0;j<8;j++){float m=.5*(a+b);if(1./mix(k0,k1,m)>ssrDepthAt(s0+ds*m))b=m;else a=m;}
          vec2 at=s0+ds*b;float rz=1./mix(k0,k1,b),sz=ssrDepthAt(at);
          float k=mix(k0,k1,b);slack=1.5*abs(k0-k1)/(k*k)*sEnd/pixels;
          // A crossing close to the surface is a hit; a wide gap is the ray passing behind a silhouette.
          if(rz-sz<max(1.5,.03*sz)+slack){
            colour=texture2D(uSsrColor,at).rgb;t=b*tEnd*k1/k;hidden=step(16.,hiddenPx);
            vec2 e=min(at,1.-at);edge=smoothstep(0.,.06,min(e.x,e.y));
            return 1.;
          }
        }
        // Behind something without crossing its face. Within a crown's depth of it the ray is
        // inside it (it entered through a side the eye cannot see): a hit. Farther behind it is
        // passing behind; a thin thing hides only a few pixels and is taken as passed, a long
        // hidden stretch leaves the answer to the probes.
        float k=mix(k0,k1,s),slackHere=1.5*abs(k0-k1)/(k*k)*sEnd/pixels;
        if(rayZ-sceneZ<max(6.,.04*sceneZ)+slackHere){
          colour=texture2D(uSsrColor,uv).rgb;t=s*tEnd*k1/k;slack=slackHere;hidden=step(16.,hiddenPx);
          vec2 e=min(uv,1.-uv);edge=smoothstep(0.,.06,min(e.x,e.y));
          return 1.;
        }
        hiddenPx+=(s-prev)/sEnd*pixels;front=0.;
      }else front=1.;
      prev=s;
      if(s>=sEnd)break;
    }
    hidden=step(16.,hiddenPx);
    return s<1.||hidden>.5?2.:0.;
  }
  vec2 probeUv(vec3 dir,float i){
    float v=clamp((dir.y-uProbeInfo.z)/(1.-uProbeInfo.z),.5/uProbeInfo.y,1.-.5/uProbeInfo.y);
    return vec2(atan(dir.z,dir.x)*.15915494+.5,(i+v)/uProbeInfo.x);
  }
  float probeDistanceAt(vec2 uv){vec4 e=texture2D(uProbeDistance,uv);float x=(e.r*4080.+e.g*15.9375)/4095.;return x>.99999?NONE:exp(mix(uProbeRange.x,uProbeRange.y,x));}
  // The ground from the water's own height grid (bed), where the grid covers it: >0 above.
  float aboveGround(vec3 x){vec2 w=vec2(x.x,-x.z),g=(w-uGrid.xy)/uGrid.z;
    return min(g.x,g.y)>=0.&&max(g.x,g.y)<=uGrid.w-1.?x.y-bed(w):1e5;}
  // Whether probe i sees point x itself (nothing nearer along its line), and its colour there.
  float probeSees(int i,vec3 x,out vec3 colour){
    vec3 v=x-uProbePoints[i];float l=length(v);vec2 uv=probeUv(v/l,float(i));
    colour=texture2D(uProbeColour,uv).rgb*uProbeInfo.w;
    return l<=probeDistanceAt(uv)*1.04+4.?1.:0.;
  }
  // One step of probe i's surface test at x: a crossing from in front of what it sees to behind,
  // close to that surface (not a far point merely hidden from the probe), is a hit; the bisection
  // between a and b finds it.
  float probeStep(int i,vec3 q,vec3 d,float a,float b,inout float front,out float th,out vec3 colour){
    vec3 c=uProbePoints[i],v=q+d*b-c;float l=length(v);vec3 dir=v/l;float fi=float(i);th=NONE;colour=vec3(0.);
    if(dir.y<uProbeInfo.z)return 0.;
    float dd=probeDistanceAt(probeUv(dir,fi));
    if(l<dd){front=1.;return 0.;}
    float was=front;front=0.;
    if(was<.5)return 0.;
    for(int j=0;j<5;j++){float m=.5*(a+b);vec3 w=q+d*m-c;float lw=length(w);if(lw>=probeDistanceAt(probeUv(w/lw,fi)))b=m;else a=m;}
    vec3 w=q+d*b-c;float lw=length(w);vec2 uv=probeUv(w/lw,fi);
    if(lw-probeDistanceAt(uv)>max(4.,.05*lw))return 0.;
    th=b;colour=texture2D(uProbeColour,uv).rgb*uProbeInfo.w;return 1.;
  }
  // Static world off the screen: one march out to 40 km (64 steps of 18%) against the ground grid and the two
  // nearest probes' surfaces, nearest first. A ground hit takes its colour from a probe that
  // sees that very point (the nearer probe first); the ground fixes where, the probes what.
  float probes(vec3 q,vec3 d,vec3 sky,out vec3 colour,out float t){
    colour=sky;t=NONE;int n=int(uProbeInfo.x);if(n==0||uReflectLayers.y<.5)return 0.;
    int i0=0,i1=0;float d0=NONE,d1=NONE;
    for(int i=0;i<8;i++){if(i>=n)break;vec2 o=uProbePoints[i].xz-q.xz;float dd=dot(o,o);
      if(dd<d0){i1=i0;d1=d0;i0=i;d0=dd;}else if(dd<d1){i1=i;d1=dd;}}
    // Each step looks for both kinds of hit and keeps the nearer: a tree on the shore stands in
    // front of the ground the same step finds.
    float a=0.,b=1.,f0=1.,f1=1.,th;vec3 c;
    for(int k=0;k<64;k++){
      if(probeStep(i0,q,d,a,b,f0,th,c)>.5){t=th;colour=c;}
      if(n>1&&probeStep(i1,q,d,a,b,f1,th,c)>.5&&th<t){t=th;colour=c;}
      if(aboveGround(q+d*b)<0.){
        float lo=a,hi=b;
        for(int j=0;j<6;j++){float m=.5*(lo+hi);if(aboveGround(q+d*m)<0.)hi=m;else lo=m;}
        if(hi<t){
          vec3 x=q+d*hi,c0,c1;t=hi;
          if(probeSees(i0,x,c0)>.5)colour=c0;else if(n>1&&probeSees(i1,x,c1)>.5)colour=c1;else colour=c0;
        }
      }
      if(t<NONE)break;
      a=b;b*=1.18;
    }
    if(t>=NONE)return 0.;
    // Baked without fog: the reflected path's own air, as the mirror's world gets it (style.js fog_fragment).
    if(uFog>.5)colour=mix(colour,uFogColor,1.-exp(-max(0.,dot(q+d*t-uReflectEye,uReflectForward))/22000.));
    return 1.;
  }
  vec3 layeredReflection(vec2 mb){
    vec4 far=uReflectVirtualInverse*vec4(mb*2.-1.,1.,1.);
    vec3 d=normalize(far.xyz/far.w-uReflectEye);
    vec3 sky=texture2D(uSky,mb).rgb;
    // Texels whose ray never reaches the water, or reaches it far from the lake, are never looked up.
    if(d.y<1e-4)return sky;
    float base=(uLevel-uReflectEye.y)/d.y;
    vec3 q=uReflectEye+d*base;
    if(q.x<uBounds.x||q.z<uBounds.y||q.x>uBounds.z||q.z>uBounds.w)return sky;
    float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
    vec3 cs;float ts,hidden,edge,slack;float state=ssrTrace(q,d,jitter,cs,ts,hidden,edge,slack);
    if(uReflectLayers.x>1.5&&uReflectLayers.x<2.5)return vec3(state>.5&&state<1.5?1.:0.,state<.5?1.:0.,state>1.5?1.:0.)*(1.-.5*hidden);
    vec3 colour=sky;float t=NONE;
    if(state>.5&&state<1.5){colour=cs;t=ts;}
    if(state>1.5||(state>.5&&(hidden>.5||edge<1.))){
      vec3 cp;float tp;float hit=probes(q,d,sky,cp,tp);
      if(state>1.5){colour=cp;t=tp;}
      // The screen hid part of the ray: a surface the probe sees clearly nearer there wins.
      else if(hidden>.5&&tp<.85*t-slack){colour=cp;t=tp;}
      else if(edge<1.)colour=mix(cp,colour,edge);
    }
    vec4 mover=texture2D(uMovers,mb);
    if(mover.a>.002&&uReflectLayers.z>.5){
      vec4 w=uMoversInverse*vec4(mb*2.-1.,texture2D(uMoversDepth,mb).r*2.-1.,1.);
      float tm=length(w.xyz/w.w-uReflectEye)-base;
      // A screen hit's distance is only as sure as the ray's change of depth across a pixel, a probe's
      // as its 12 bits and parallax: a mover must be clearly behind to be hidden.
      if(tm<t+(state>.5&&state<1.5?slack:0.)+max(2.,.02*t))colour=colour*(1.-mover.a)+mover.rgb;
    }
    return colour;
  }
  void main(){gl_FragColor=vec4(layeredReflection(vUv),1.);}
`;

/** A copy of `source`'s colour and depth taken mid-pass, when `marker` (add it to the scene) is
 * drawn: after the static opaque world, before anything with renderOrder above SNAPSHOT_ORDER.
 * `then` runs right after the copy, still inside the pass (three nests renders, as its Reflector does). */
export function createSnapshot(renderer,source,then=()=>{}){
  // The depth blit below needs the source's own depth format (it carries stencil, clouds.js); a mismatch fails silently.
  const depth=new T.DepthTexture(1,1,source.depthTexture?.type??T.UnsignedIntType);depth.format=source.depthTexture?.format??T.DepthFormat;
  const target=new T.WebGLRenderTarget(1,1,{stencilBuffer:source.stencilBuffer,depthTexture:depth});
  target.texture.colorSpace=source.texture.colorSpace;target.texture.minFilter=target.texture.magFilter=T.LinearFilter;target.texture.generateMipmaps=false;
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute([0,0,0,0,0,0,0,0,0],3));
  const marker=new T.Mesh(geometry,new T.MeshBasicMaterial({colorWrite:false,depthWrite:false,depthTest:false}));
  marker.name='reflection_snapshot';marker.frustumCulled=false;marker.renderOrder=SNAPSHOT_ORDER;
  const state={armed:false,taken:0};
  marker.onBeforeRender=()=>{
    if(!state.armed||renderer.getRenderTarget()!==source||source.width!==target.width||source.height!==target.height)return;
    state.armed=false;
    const gl=renderer.getContext(),props=renderer.properties.get(source),from=props.__webglMultisampledFramebuffer??props.__webglFramebuffer;
    const to=renderer.properties.get(target).__webglFramebuffer;
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER,from);renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER,to);
    gl.blitFramebuffer(0,0,target.width,target.height,0,0,target.width,target.height,gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT,gl.NEAREST);
    renderer.state.bindFramebuffer(gl.READ_FRAMEBUFFER,null);renderer.state.bindFramebuffer(gl.DRAW_FRAMEBUFFER,from);
    state.taken++;
    then();
  };
  return {target,marker,state,
    arm(width,height){if(target.width!==width||target.height!==height)target.setSize(width,height);renderer.initRenderTarget(target);state.armed=true;},
    dispose(){target.dispose();geometry.dispose();marker.material.dispose();}};
}

/** The layered reflection. `opaque`: the main pass's target (clouds.js); `sky`: the painted sky;
 * `clouds`: the cloud volumes' scene; `lake`: the lake mesh (its bounds decide the skip, its
 * material's grid is the ground the probes march against); `movers`: createMovers(). Add
 * `snapshot.marker` to the scene. `scale`: the result's size against the drawing buffer (the mirror's). */
export function createReflections(renderer,{level,lake,sky,clouds=null,opaque,movers,scale=.5}){
  const make=(options={})=>{const t=new T.WebGLRenderTarget(1,1,{type:T.HalfFloatType,...options});t.texture.colorSpace=T.LinearSRGBColorSpace;return t;};
  const back=make({depthBuffer:false}),live=make({depthTexture:new T.DepthTexture(1,1,T.FloatType)}),result=make({depthBuffer:false});
  const virtual=new T.PerspectiveCamera(),oblique=new T.Matrix4(),size=new T.Vector2(),frustum=new T.Frustum(),viewProjection=new T.Matrix4(),savedColor=new T.Color();
  const far=new T.DataTexture(new Float32Array([1]),1,1,T.RedFormat,T.FloatType);far.needsUpdate=true;
  lake.geometry.computeBoundingBox();
  const bounds=lake.geometry.boundingBox.clone().applyMatrix4(lake.matrixWorld);
  const corners=[[bounds.min.x,bounds.min.z],[bounds.min.x,bounds.max.z],[bounds.max.x,bounds.min.z],[bounds.max.x,bounds.max.z]];
  sky.layers.enable(SKY_LAYER);
  const u={uSsrColor:{value:null},uSsrDepth:{value:null},uMovers:{value:live.texture},uMoversDepth:{value:live.depthTexture},uSky:{value:back.texture},
    uProbeColour:style.probeColour,uProbeDistance:style.probeDistance,uHeights:lake.material.uniforms.uHeights,uGrid:lake.material.uniforms.uGrid,
    uSsrViewProjection:{value:viewProjection},uReflectVirtualInverse:{value:new T.Matrix4()},uMoversInverse:{value:new T.Matrix4()},
    uSsrNearFar:{value:new T.Vector4()},uBounds:{value:new T.Vector4(bounds.min.x-60,bounds.min.z-60,bounds.max.x+60,bounds.max.z+60)},uProbeRange:{value:new T.Vector2(...PROBE_LOG_RANGE)},
    uReflectEye:{value:new T.Vector3()},uReflectForward:{value:new T.Vector3()},uReflectLayers:{value:new T.Vector3(1,1,1)},uFogColor:{value:new T.Color()},
    uProbePoints:style.probePoints,uProbeInfo:style.probeInfo,uLevel:{value:level},uFog:{value:0}};
  const pass=new T.Scene(),quadCamera=new T.OrthographicCamera(-1,1,1,-1,0,1);
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:u,
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',fragmentShader:COMPOSITE_GLSL}));
  quad.frustumCulled=false;pass.add(quad);
  // Inside the main pass, right after the snapshot: the composite fills the mirror's slot.
  const snapshot=createSnapshot(renderer,opaque,()=>{
    const previous=renderer.getRenderTarget();
    renderer.setRenderTarget(result);renderer.render(pass,quadCamera);renderer.setRenderTarget(previous);
  });
  u.uSsrColor.value=snapshot.target.texture;u.uSsrDepth.value=snapshot.target.depthTexture;
  const stats={drawn:false,width:0,height:0,calls:0,triangles:0,snapshots:0,probes:0};
  let probes=null,time='golden';
  function setProbes(loaded){probes=loaded;stats.probes=loaded?loaded.count:0;applyProbes();}
  function setTime(name){time=name;applyProbes();}
  function applyProbes(){
    const colour=probes?.colour[time]??null;
    u.uProbeColour.value=colour;u.uProbeDistance.value=colour?probes.distance:null;
    u.uProbeInfo.value.set(colour?probes.count:0,probes?.height??1,PROBE_SIN_MIN,probes?.scale[time]??1);
    probes?.points.forEach((p,i)=>u.uProbePoints.value[i].fromArray(p));
  }
  function update(scene,camera,enabled){
    stats.drawn=false;snapshot.state.armed=false;
    if(!enabled)return false;
    const eye=camera.position,farthest=Math.max(...corners.map(([x,z])=>Math.hypot(x-eye.x,z-eye.z)));
    if(!mirrorWorthDrawing(eye.y,level,farthest))return false;
    frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));
    if(!frustum.intersectsBox(bounds))return false;
    renderer.getDrawingBufferSize(size);
    const width=Math.max(1,Math.round(size.x*api.scale)),height=Math.max(1,Math.round(size.y*api.scale));
    if(live.width!==width||live.height!==height){live.setSize(width,height);result.setSize(width,height);back.setSize(Math.ceil(width*.5),Math.ceil(height*.5));}
    mirrorView(camera,level,virtual,style.mirrorMatrix.value);
    oblique.copy(virtual.projectionMatrix);
    // The composite turns a mirror uv back into the reflected ray with the plain projection, and a
    // movers depth back into a point with the oblique one.
    u.uReflectVirtualInverse.value.multiplyMatrices(camera.projectionMatrix,virtual.matrixWorldInverse).invert();
    u.uMoversInverse.value.multiplyMatrices(oblique,virtual.matrixWorldInverse).invert();
    u.uReflectEye.value.copy(virtual.position);virtual.getWorldDirection(u.uReflectForward.value);
    u.uSsrNearFar.value.set(camera.near,camera.far,size.x,size.y);
    u.uFog.value=scene.fog&&scene.fog.far>1000?1:0;if(scene.fog)u.uFogColor.value.copy(scene.fog.color);
    const before={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles};
    let shadowUpdate=false,undo=null;const autoClear=renderer.autoClear,previous=renderer.getRenderTarget(),color=renderer.getClearColor(savedColor),alpha=renderer.getClearAlpha();
    // A colour background makes every render clear its target; the passes clear their own.
    const background=scene.background,layers=virtual.layers.mask;
    try{
      // The sun's shadow update belongs to the main pass.
      shadowUpdate=renderer.shadowMap.needsUpdate;renderer.shadowMap.needsUpdate=false;
      renderer.autoClear=false;scene.background=null;
      // Sky and cloud volumes, unlit, with the plain projection (the oblique one skews the far
      // plane through the sky dome): what every ray that meets nothing shows.
      virtual.projectionMatrix.copy(camera.projectionMatrix);virtual.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      renderer.setRenderTarget(back);renderer.setClearColor(0,1);renderer.clear();
      virtual.layers.set(SKY_LAYER);renderer.render(scene,virtual);
      if(clouds){
        const depths=clouds.children.map(box=>box.material.uniforms.uDepth.value);
        for(const box of clouds.children)box.material.uniforms.uDepth.value=far;
        virtual.layers.set(0);renderer.render(clouds,virtual);
        clouds.children.forEach((box,i)=>{box.material.uniforms.uDepth.value=depths[i];});
      }
      // The movers' stand-ins, clipped at the water by the oblique near plane, with their depth.
      if((stats.frames=(stats.frames??0)+1)%60===1)movers.scan();
      movers.prepare();
      virtual.projectionMatrix.copy(oblique);virtual.projectionMatrixInverse.copy(oblique).invert();
      renderer.setRenderTarget(live);renderer.setClearColor(0,0);renderer.clear();
      virtual.layers.set(MOVERS_LAYER);renderer.render(scene,virtual);
      undo=movers.depthOnly();virtual.layers.set(DEPTH_LAYER);renderer.render(scene,virtual);
    }finally{
      undo?.();virtual.layers.mask=layers;
      scene.background=background;renderer.shadowMap.needsUpdate=shadowUpdate;renderer.setRenderTarget(previous);renderer.autoClear=autoClear;renderer.setClearColor(color,alpha);
    }
    snapshot.arm(size.x,size.y);
    stats.snapshots=snapshot.state.taken;
    stats.calls=renderer.info.render.calls-before.calls;stats.triangles=renderer.info.render.triangles-before.triangles;
    stats.width=width;stats.height=height;stats.drawn=true;
    style.mirror.value=result.texture;style.mirrorLevel.value=level;style.mirrorOn.value=1;
    return true;
  }
  const api={scale,update,stats,snapshot,setProbes,setTime,layers:u.uReflectLayers.value,result,get time(){return time;},get probes(){return probes;},virtual,
    dispose(){back.dispose();live.dispose();result.dispose();snapshot.dispose();far.dispose();quad.geometry.dispose();quad.material.dispose();}};
  return api;
}

/** Load the baked probes: their manifest, one colour atlas per time of day and the shared
 * distance atlas, through `fetchBytes` (main.js's fetchData, which checks them against the
 * viewer manifest). `stale` lists inputs whose bytes no longer match the bake. */
export async function loadProbes(manifest,fetchBytes,currentHashes){
  const decode=async(path,colourSpace)=>{
    const bitmap=await createImageBitmap(new Blob([await fetchBytes(path)]),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
    const texture=new T.Texture(bitmap);texture.colorSpace=colourSpace;texture.flipY=false;texture.generateMipmaps=false;
    texture.wrapS=T.RepeatWrapping;texture.wrapT=T.ClampToEdgeWrapping;
    texture.minFilter=texture.magFilter=colourSpace===T.SRGBColorSpace?T.LinearFilter:T.NearestFilter;texture.needsUpdate=true;return texture;};
  const dir=PROBE_FILE.replace(/[^/]+$/,'');
  const stale=Object.entries(manifest.inputs).filter(([path,hash])=>currentHashes.get(path)!==hash).map(([path])=>path);
  const colour={};
  for(const [name,file] of Object.entries(manifest.colour))colour[name]=await decode(dir+file,T.SRGBColorSpace);
  return {count:manifest.points.length,points:manifest.points,height:manifest.height,width:manifest.width,scale:manifest.scale,colour,distance:await decode(dir+manifest.distance,T.NoColorSpace),stale};
}

// ---- Baking (client/web/tools/bake-reflections.cjs drives these in the page) ----

/** Directions of the five cube faces a probe needs (the four sides and up), with the up vector
 * each face camera uses. */
export const PROBE_FACES=[[[1,0,0],[0,1,0]],[[-1,0,0],[0,1,0]],[[0,0,1],[0,1,0]],[[0,0,-1],[0,1,0]],[[0,1,0],[0,0,-1]]];

/** Render one face of a probe at `position` (scene metres): only `keep` scene children (and
 * lights) drawn, less anything see-through, no fog, no sky; colour as linear float RGBA and distance in metres per pixel
 * (Infinity where nothing was drawn). Rows bottom-up. */
export function renderProbeFace(renderer,scene,keep,position,face,size){
  const camera=new T.PerspectiveCamera(90,1,.5,40000);camera.position.copy(position);camera.up.fromArray(PROBE_FACES[face][1]);
  camera.lookAt(position.clone().add(new T.Vector3().fromArray(PROBE_FACES[face][0])));camera.updateMatrixWorld();
  const target=new T.WebGLRenderTarget(size,size,{type:T.FloatType,depthTexture:new T.DepthTexture(size,size,T.FloatType)});
  const distance=new T.WebGLRenderTarget(size,size,{type:T.FloatType,depthBuffer:false});
  const quad=new T.Mesh(new T.PlaneGeometry(2,2),new T.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{uDepth:{value:target.depthTexture},uNearFar:{value:new T.Vector2(camera.near,camera.far)}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D uDepth;uniform vec2 uNearFar;varying vec2 vUv;void main(){float d=texture2D(uDepth,vUv).r;
      if(d>=1.){gl_FragColor=vec4(-1.);return;}
      float z=uNearFar.x*uNearFar.y/(uNearFar.y-d*(uNearFar.y-uNearFar.x));vec2 n=vUv*2.-1.;gl_FragColor=vec4(z*sqrt(1.+dot(n,n)));}`}));
  const quadScene=new T.Scene();quadScene.add(quad);
  const shown=new Map(),kept=new Set(keep.filter(Boolean)),background=scene.background,fog=scene.fog,previous=renderer.getRenderTarget();
  const shadowUpdate=renderer.shadowMap.needsUpdate,color=renderer.getClearColor(new T.Color()),alpha=renderer.getClearAlpha();
  const colour=new Float32Array(size*size*4),metres=new Float32Array(size*size);
  const glass=[];
  try{
    renderer.shadowMap.needsUpdate=false;
    for(const child of scene.children)shown.set(child,child.visible);
    for(const child of scene.children)child.visible=shown.get(child)===true&&(kept.has(child)||child.isLight===true);
    // Glass and other see-through things are the live pass's (createMovers `live`), not the bake's.
    for(const child of kept)child.traverse(o=>{if(o.isMesh&&o.visible&&o.material.transparent){glass.push(o);o.visible=false;}});
    scene.background=null;scene.fog=null;
    renderer.setRenderTarget(target);renderer.setClearColor(0,0);renderer.clear();renderer.render(scene,camera);
    renderer.readRenderTargetPixels(target,0,0,size,size,colour);
    renderer.setRenderTarget(distance);renderer.render(quadScene,new T.OrthographicCamera(-1,1,1,-1,0,1));
    const rgba=new Float32Array(size*size*4);
    renderer.readRenderTargetPixels(distance,0,0,size,size,rgba);for(let i=0;i<size*size;i++)metres[i]=rgba[i*4];
  }finally{
    for(const o of glass)o.visible=true;
    for(const [child,visible] of shown)child.visible=visible;
    scene.background=background;scene.fog=fog;renderer.shadowMap.needsUpdate=shadowUpdate;renderer.setRenderTarget(previous);renderer.setClearColor(color,alpha);
    target.dispose();distance.dispose();quad.geometry.dispose();quad.material.dispose();
  }
  for(let i=0;i<metres.length;i++)if(metres[i]<0)metres[i]=Infinity;
  return {colour,metres,view:camera.matrixWorldInverse.clone(),size};
}

/** Resample five faces into the probe's panorama (width x height): colour averaged over a 2x2
 * subsample, distance from the texel's centre direction. */
export function assembleProbe(faces,width,height){
  const colour=new Float32Array(width*height*3),metres=new Float32Array(width*height),v=new T.Vector3();
  const look=(dir,face)=>{v.fromArray(dir).transformDirection(face.view);if(v.z>=0)return null;const x=v.x/-v.z,y=v.y/-v.z;if(Math.abs(x)>1||Math.abs(y)>1)return null;return [(x*.5+.5)*face.size-.5,(y*.5+.5)*face.size-.5];};
  const sample=(dir)=>{
    for(const face of faces){const p=look(dir,face);if(!p)continue;
      const s=face.size,x0=Math.max(0,Math.min(s-1,Math.floor(p[0]))),y0=Math.max(0,Math.min(s-1,Math.floor(p[1]))),x1=Math.min(s-1,x0+1),y1=Math.min(s-1,y0+1),fx=Math.max(0,Math.min(1,p[0]-x0)),fy=Math.max(0,Math.min(1,p[1]-y0));
      const c=[0,0,0];for(const [x,y,w] of [[x0,y0,(1-fx)*(1-fy)],[x1,y0,fx*(1-fy)],[x0,y1,(1-fx)*fy],[x1,y1,fx*fy]])for(let k=0;k<3;k++)c[k]+=face.colour[(y*s+x)*4+k]*w;
      const near=face.metres[Math.round(Math.max(0,Math.min(s-1,p[1])))*s+Math.round(Math.max(0,Math.min(s-1,p[0])))];
      return {c,near};}
    return {c:[0,0,0],near:Infinity};};
  for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const at=row*width+col;let r=0,g=0,b=0;
    for(const [dx,dy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){const s=sample(probeDirection((col+dx)/width,(row+dy)/height));r+=s.c[0];g+=s.c[1];b+=s.c[2];}
    colour[at*3]=r/4;colour[at*3+1]=g/4;colour[at*3+2]=b/4;
    metres[at]=sample(probeDirection((col+.5)/width,(row+.5)/height)).near;
  }
  return {colour,metres};
}

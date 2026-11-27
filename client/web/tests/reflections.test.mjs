import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import * as T from '../vendor/three.module.min.js';
import {composeLayers,clusterIndex,encodeDistance,decodeDistance,packDistance,unpackDistance,probeUv,probeDirection,assembleProbe,PROBE_FACES,PROBE_FILE,BAKE_INPUTS,createSnapshot} from '../src3d/reflections.js';

const root=new URL('../../../',import.meta.url);
const SKY=[.5,.6,.9],CLIFF=[.4,.4,.38],TREE=[.05,.2,.08],RIDGE=[.6,.6,.62],WING=[.9,.2,.1];
const ssr=(state,colour=CLIFF,t=Infinity,more={})=>({state,colour,t,hidden:false,edge:1,...more});
const probe=(colour=RIDGE,t=Infinity)=>({hit:t<Infinity,colour,t});
const none={colour:[0,0,0],alpha:0,t:Infinity},mover=t=>({colour:WING,alpha:1,t});
const compose=(s,p,m)=>composeLayers({ssr:s,probe:p,movers:m,sky:SKY});

test('a mover nearer than the reflected cliff shows; one behind it is hidden',()=>{
 assert.deepEqual(compose(ssr('hit',CLIFF,600),probe(),mover(400)).colour,WING);
 assert.deepEqual(compose(ssr('hit',CLIFF,600),probe(),mover(900)).colour,CLIFF);
});

test('a mover against the probe layer: the nearer wins both ways',()=>{
 assert.deepEqual(compose(ssr('unknown'),probe(RIDGE,2000),mover(1200)).colour,WING);
 assert.deepEqual(compose(ssr('unknown'),probe(RIDGE,2000),mover(2600)).colour,RIDGE);
});

test('a mover in open sky always shows, and the sky shows where nothing is',()=>{
 assert.deepEqual(compose(ssr('sky'),probe(),mover(5000)).colour,WING);
 assert.deepEqual(compose(ssr('sky'),probe(),none).colour,SKY);
 assert.deepEqual(compose(ssr('unknown'),probe(),none).colour,SKY);
});

test('screen against probe: a seen near tree hides the far ridge texel; a hidden stretch lets a clearly nearer probe surface win',()=>{
 assert.deepEqual(compose(ssr('hit',TREE,300),probe(RIDGE,2400),none).colour,TREE);
 assert.deepEqual(compose(ssr('hit',RIDGE,2400,{hidden:true}),probe(TREE,300),none).colour,TREE);
 assert.deepEqual(compose(ssr('hit',RIDGE,2400,{hidden:true}),probe(RIDGE,2380),none).colour,RIDGE);
 // Off the screen the probe is all there is.
 assert.deepEqual(compose(ssr('unknown'),probe(RIDGE,2400),none).colour,RIDGE);
});

test('at the screen edge the screen fades into the probe instead of cutting',()=>{
 const half=compose(ssr('hit',[1,1,1],500,{edge:.5}),probe([0,0,0],520),none).colour;
 assert.deepEqual(half,[.5,.5,.5]);
});

test('a translucent mover is laid over what it is in front of',()=>{
 const out=compose(ssr('hit',[1,1,1],600),probe(),{colour:[.2,.2,.2],alpha:.4,t:500}).colour;
 out.forEach(v=>assert.ok(Math.abs(v-(.6+.2))<1e-9));
});

test('clustering keeps a coarse surface over the original vertices',()=>{
 const g=new T.SphereGeometry(1,64,32),index=clusterIndex(g,.25);
 assert.ok(index.length/3<g.index.count/3/7,'several times fewer triangles');
 assert.ok(index.length/3>40,'still a surface');
 assert.ok(index.every(i=>i>=0&&i<g.attributes.position.count));
});

test('distance codes round-trip within 0.3 percent and pack into two bytes',()=>{
 for(const m of [.5,3,47,610,2400,18000]){
  const back=decodeDistance(unpackDistance(...packDistance(encodeDistance(m))));
  assert.ok(Math.abs(back/m-1)<.003,`${m} -> ${back}`);
 }
 assert.equal(decodeDistance(encodeDistance(Infinity)),Infinity);
});

test('panorama coordinates invert',()=>{
 for(const [u,v] of [[.1,.05],[.5,.5],[.93,.9]]){const d=probeDirection(u,v),[u2,v2]=probeUv(...d);assert.ok(Math.abs(u2-u)<1e-9&&Math.abs(v2-v)<1e-9);}
});

test('the five faces resample into the panorama in the right directions',()=>{
 const size=8,faces=PROBE_FACES.map(([dir,up],i)=>{
  const c=new T.PerspectiveCamera(90,1,.5,100);c.up.fromArray(up);c.lookAt(...dir);c.updateMatrixWorld();
  const colour=new Float32Array(size*size*4).fill(i/10),metres=new Float32Array(size*size).fill(10*(i+1));
  return {colour,metres,view:c.matrixWorldInverse.clone(),size};
 });
 const w=32,h=16,{colour,metres}=assembleProbe(faces,w,h);
 const at=(x,y,z)=>{const [u,v]=probeUv(x,y,z);return Math.min(h-1,Math.floor(v*h))*w+Math.floor(u*w)%w;};
 for(const [i,[dir]] of PROBE_FACES.entries()){
  const k=at(...dir.map((c,j)=>j===1&&i<4?c+.05:c));
  if(i===4)continue;  // straight up is the panorama's top row, all azimuths
  assert.equal(metres[k],10*(i+1),`face ${i}`);assert.ok(Math.abs(colour[k*3]-i/10)<1e-6);
 }
 assert.equal(metres[(h-1)*w],50,'the top row sees the up face');
});

test('the baked probes match the world data they were baked from',()=>{
 const file=new URL(PROBE_FILE,root);
 assert.ok(fs.existsSync(file),'probes baked (client/web/tools/bake-reflections.cjs)');
 const manifest=JSON.parse(fs.readFileSync(file,'utf8'));
 assert.deepEqual(Object.keys(manifest.inputs).sort(),[...BAKE_INPUTS].sort(),'the bake records every input');
 for(const [path,hash] of Object.entries(manifest.inputs))
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(new URL(path,root))).digest('hex'),hash,`${path} changed since the bake: rerun bake-reflections.cjs`);
 for(const name of [...Object.values(manifest.colour),manifest.distance])assert.ok(fs.existsSync(new URL(name,file)),name);
 assert.deepEqual(Object.keys(manifest.colour).sort(),['day','dusk','golden']);
});

test('the mid-pass snapshot copies depth in the main pass\'s own depth-stencil format (a mismatched blit fails silently)',()=>{
  const depth=new T.DepthTexture(1,1,T.UnsignedInt248Type);depth.format=T.DepthStencilFormat;
  const source=new T.WebGLRenderTarget(1,1,{stencilBuffer:true,depthTexture:depth});
  const {target}=createSnapshot({},source);
  assert.equal(target.depthTexture.type,T.UnsignedInt248Type);
  assert.equal(target.depthTexture.format,T.DepthStencilFormat);
  assert.equal(target.stencilBuffer,true);
});

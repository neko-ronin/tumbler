// The tree village is walked, not only looked at: from each trunk's foot up its helix in stair
// mode, off at every gallery spur, round to every balcony, and across every skybridge to the next
// tree's deck. Plus the three ways off the treads: a vault, a jump and the handrail slide.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {instanceMatrix} from '../src3d/world.js';
import {buildWorldCollision} from '../src3d/collision.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {stairPoint} from '../../../shared/activities/stairs.js';

const json=p=>JSON.parse(readFileSync(new URL('../../../'+p,import.meta.url)));
const placement=json('shared/world/out/placement.json'),stairData=json('shared/geometry/arboreal/village_stairs.json'),walk=json('shared/characters/player.json').walk;
const glb=p=>{const b=readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url));return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const village=placement.instances.filter(i=>i.asset.startsWith('arboreal/'));
const hitTest=buildWorldCollision({instances:village},Object.fromEntries([...new Set(village.map(i=>i.asset))].map(a=>[a,glb(a)])),null,null,stairData);
const trees=village.filter(i=>i.kind==='arboreal_tree'),bridges=village.filter(i=>i.kind==='arboreal_skybridge');
// Terrain stands in as each trunk's own seat: the village's floors are what is under test.
const height=(x,y)=>trees.reduce((a,t)=>Math.hypot(x-t.position_m[0],y-t.position_m[1])<Math.hypot(x-a.position_m[0],y-a.position_m[1])?t:a).position_m[2]-.15;
const world={height,hitTest},dt=1/60;

// The recipe's geometry (build_village_tree.py, build_tree_dwelling.py), to aim at, not to walk on.
const RB=3.6,H=82,PITCH=2.07,OFF=225*Math.PI/180,FLOORS=[8.0,13.0,17.8,23.1,28.2,33.0,38.3,43.2,48.3];
const VARIANTS={village_tree:[0,1,2,3,4,5,6,7,8],village_tree_low:[0,1,2,3],village_tree_mid:[2,4,6],village_tree_high:[4,5,6,7,8]};
const R=y=>RB*(1-.62*(Math.max(y,0)/H)**2.5);
const bark=(th,y)=>R(y)*(1+.04*Math.cos(9*th+.7))+(y<9?1.3*(1-Math.max(y,0)/9)**2*Math.max(0,Math.cos(6*th))**3:0);
const SCENE_TO_CORE=new T.Matrix4().set(1,0,0,0, 0,0,-1,0, 0,1,0,0, 0,0,0,1);
const place=(inst,p)=>{const v=new T.Vector3(...p).applyMatrix4(SCENE_TO_CORE.clone().multiply(instanceMatrix(inst.position_m,inst.yaw_deg,inst.scale)));return [v.x,v.y,v.z];};
const variant=t=>t.asset.split('/')[1].replace('.glb','');
function inDwelling(tree,i,[x,y,z]){
  const floor=FLOORS[i],psi=-(floor-.46-.6)/PITCH-OFF,r=R(floor)*.97,c=Math.cos(psi),s=Math.sin(psi);
  return place(tree,[x*c+z*s+r*Math.sin(psi),y+floor,-x*s+z*c+r*Math.cos(psi)]);
}
/** Spur → gallery → stub → walkway → balcony, in world points. */
function toBalcony(tree,i){
  const floor=FLOORS[i],psi=-(floor-.46-.6)/PITCH-OFF,r=R(floor)*.97,h=floor-.46,foot=[-4.9,-.46,.2];
  const begin=Math.atan2(foot[0],r+foot[2]),arrival=OFF-2*Math.PI,out0=Math.hypot(foot[0],r+foot[2]),path=[];
  for(let j=16;j>=0;j--){const t=j/16,a=begin+(arrival-begin)*t,k=Math.min(1,t/.35),radial=out0+(bark(psi+a,h)+2.3-out0)*k*k*(3-2*k);path.push([radial*Math.sin(a),-.46,radial*Math.cos(a)-r]);}
  // Along the box's front: a docked bridge's end landing covers the balcony's outer metre.
  return [...path,foot,[-3.4,.3,.2],[-3.1,.3,2.0],[-3.1,.3,3.95],[0,.3,3.95]].map(p=>inDwelling(tree,i,p));
}
const stairOf=tree=>hitTest.stairs.find(r=>Math.hypot(r.matrix[12]-tree.position_m[0],r.matrix[13]-tree.position_m[1])<.01);

function follow(s,points,{reach=.35,limit=60}={}){
  let i=0,t=0,best=Infinity,since=0;
  while(i<points.length){
    const p=points[i],dx=p[0]-s.x,dy=p[1]-s.y,d=Math.hypot(dx,dy);
    if(d<reach){i++;best=Infinity;since=0;continue;}
    s=stepMoves(s,{x:dx/d,y:dy/d,stick:[0,1]},dt,walk,world);t+=dt;
    if(d<best-.01){best=d;since=0;}else since+=dt;
    if(since>2||t>limit)return {s,stuck:`waypoint ${i}/${points.length} at ${[s.x,s.y,s.z].map(v=>v.toFixed(2))} (${s.mode??'walk'})`};
  }
  return {s};
}
const toward=(s,p)=>{const dx=p[0]-s.x,dy=p[1]-s.y,d=Math.hypot(dx,dy)||1;return {x:dx/d,y:dy/d,stick:[0,1]};};
const outward=(s,rec)=>{const dx=s.x-rec.matrix[12],dy=s.y-rec.matrix[13],d=Math.hypot(dx,dy);return {x:dx/d,y:dy/d,stick:[0,1]};};
const footOf=(tree,rec)=>{const p=place(tree,[0,0,rec.landing.rho_m+1]);return {x:p[0],y:p[1],z:height(p[0],p[1]),heading:0,speed:0};};
function onStair(tree){
  const rec=stairOf(tree);let {s,stuck}=follow(footOf(tree,rec),[stairPoint(rec,0)],{reach:.05,limit:6});
  assert.equal(stuck,undefined,`${variant(tree)}: ${stuck}`);assert.equal(s.mode,'stair',`${variant(tree)} took his feet onto the helix`);
  return {s,rec};
}
function climb(s,rec,tread,input=toward){
  for(let t=0;s.mode==='stair'&&s.u<tread&&t<90;t+=dt)s=stepMoves(s,input(s,stairPoint(rec,s.u+1)),dt,walk,world);
  return s;
}

test('every dwelling is reached on foot from its trunk\'s foot',()=>{
  const failures=[];
  for(const tree of trees){
    const rec=stairOf(tree);
    VARIANTS[variant(tree)].forEach((i,k)=>{
      let {s}=onStair(tree);
      s=climb(s,rec,rec.exits[k].tread);
      assert.equal(s.mode,'stair');
      for(let n=0;n<30&&s.mode==='stair';n++)s=stepMoves(s,outward(s,rec),dt,walk,world);
      assert.notEqual(s.mode,'stair',`${variant(tree)} dwelling ${i}: stepped off at the spur`);
      assert.ok(s.deck,'onto the spur, not the air');
      const r=follow(s,toBalcony(tree,i)),deck=inDwelling(tree,i,[0,.3,3.95])[2];
      if(r.stuck)failures.push(`${variant(tree)}@${tree.position_m.slice(0,2)} dwelling ${i}: ${r.stuck}`);
      else if(!(Math.abs(r.s.z-deck)<.05&&r.s.deck))failures.push(`${variant(tree)}@${tree.position_m.slice(0,2)} dwelling ${i}: at ${r.s.z.toFixed(2)}, balcony ${deck.toFixed(2)}`);
    });
  }
  assert.deepEqual(failures,[]);
});

// One balcony takes two bridges: the solved arrangement docks B1-B2 and B2-B3 at the same dwelling of the
// low tree at (-695, 423), about 40 degrees apart, and each bridge's glazed wall crosses the other's passage.
// No other dwelling pair of those two trees faces level, so it needs the arrangement re-solved (one bridge per
// dwelling) or a bridge dropped: held for the human, not decided here.
const sharedBalcony=b=>['B1-B2','B2-B3'].includes(placement.instances.find(i=>i===b)?.tags?.[1]);
const crossings=(list)=>{
  const failures=[];
  for(const b of list){
    const half=b.asset.includes('_8')?4:b.asset.includes('_20')?10:7,ends=[-1,1].map(k=>place(b,[0,0,k*(half+.6)]));
    // The dwelling each end docks to: nearest balcony centre.
    const decks=ends.map(e=>{let best=null;for(const t of trees)for(const i of VARIANTS[variant(t)]){const p=inDwelling(t,i,[0,.3,3.95]),d=Math.hypot(p[0]-e[0],p[1]-e[1]);if(!best||d<best.d)best={d,p};}return best.p;});
    for(const [from,way,to] of [[decks[0],ends,decks[1]],[decks[1],[...ends].reverse(),decks[0]]]){
      const r=follow({x:from[0],y:from[1],z:from[2],heading:0,speed:0},[...way,to]);
      if(r.stuck)failures.push(`${b.asset} at ${b.position_m.slice(0,2)}: ${r.stuck}`);
      else if(Math.abs(r.s.z-to[2])>=.05)failures.push(`${b.asset} at ${b.position_m.slice(0,2)}: ended at ${r.s.z.toFixed(2)}, far deck ${to[2].toFixed(2)}`);
    }
  }
  return failures;
};
test('every skybridge carries him from one balcony to the other, both ways',()=>{
  assert.equal(bridges.filter(sharedBalcony).length,2,'the shared balcony is still B1-B2 and B2-B3');
  assert.deepEqual(crossings(bridges.filter(b=>!sharedBalcony(b))),[]);
});
test('the two bridges sharing a balcony both carry him',{todo:'arrangement docks two bridges on one dwelling'},()=>{
  assert.deepEqual(crossings(bridges.filter(sharedBalcony)),[]);
});

test('walking down the flight hands him back to the ground at its foot',()=>{
  const tree=trees[0];let {s,rec}=onStair(tree);
  s=climb(s,rec,12);
  for(let t=0;s.mode==='stair'&&t<20;t+=dt)s=stepMoves(s,toward(s,stairPoint(rec,s.u-1)),dt,walk,world);
  assert.equal(s.mode,undefined);assert.ok(s.grounded&&s.deck,'standing on the foot landing');
  for(let t=0;t<.5;t+=dt)s=stepMoves(s,{x:0,y:0},dt,walk,world);
  assert.equal(s.mode,undefined,'and stays off the stair');
});

test('a jump tap across the handrail vaults it; a held press or a press up the flight jumps',()=>{
  const tree=trees.find(t=>variant(t)==='village_tree');const rec=stairOf(tree);
  const ready=()=>{let {s}=onStair(tree);s=climb(s,rec,10);for(let k=0;k<20;k++)s=stepMoves(s,{x:0,y:0},dt,walk,world);return s;};
  // Tap: three frames of press with the stick out over the rail.
  let s=ready();const u=s.u,out=outward(s,rec);
  for(let k=0;k<3;k++)s=stepMoves(s,{...out,jump:true},dt,walk,world);
  s=stepMoves(s,{...out,jump:false},dt,walk,world);
  assert.equal(s.stairPhase,'vault');
  const rho0=Math.hypot(s.x-rec.matrix[12],s.y-rec.matrix[13]);let peak=s.z;
  for(let t=0;s.mode==='stair'&&t<2;t+=dt){s=stepMoves(s,out,dt,walk,world);peak=Math.max(peak,s.z);}
  const [,,,ro]=rec.treads[Math.round(u)];
  assert.equal(s.mode,undefined);assert.equal(s.grounded,false,'over the rail and falling');
  assert.ok(Math.hypot(s.x-rec.matrix[12],s.y-rec.matrix[13])>ro+.5&&rho0<ro,'from the treads to beyond the handrail');
  assert.ok(peak>stairPoint(rec,u)[2]+.6,'the body clears the 1 m rail at the hips');
  // Held: the same direction, held past tap_s, is an ordinary jump.
  s=ready();
  for(let k=0;k<Math.ceil(walk.stair.tap_s/dt)+2&&s.mode==='stair';k++)s=stepMoves(s,{...out,jump:true},dt,walk,world);
  assert.equal(s.mode,undefined);assert.equal(s.jumpPhase,'airborne');assert.ok(s.vz>0&&s.stairPhase===undefined,'a jump, not a vault');
  // A press with the stick up the flight jumps at once, and he lands back on the treads.
  s=ready();
  s=stepMoves(s,{...toward(s,stairPoint(rec,s.u+2)),jump:true},dt,walk,world);
  assert.equal(s.jumpPhase,'airborne');
  for(let t=0;t<2&&s.mode!=='stair';t+=dt)s=stepMoves(s,{x:0,y:0},dt,walk,world);
  assert.equal(s.mode,'stair','back on the flight');
});

test('the tuck slides him down the handrail while held',()=>{
  const tree=trees.find(t=>variant(t)==='village_tree');let {s,rec}=onStair(tree);
  // A run of rail that ends at a gallery spur's opening, not at the foot (where he would walk off).
  const span=rec.rail.spans[1];s=climb(s,rec,span[1]-1);
  const start=s.u;s=stepMoves(s,{x:0,y:0,tuck:true},dt,walk,world);
  assert.equal(s.stairPhase,'rail');
  let fastest=0;
  for(let t=0;t<.6;t+=dt){s=stepMoves(s,{x:0,y:0,tuck:true},dt,walk,world);fastest=Math.max(fastest,s.railV??0);}
  const [,,,ro]=rec.treads[Math.round(s.u)],rho=Math.hypot(s.x-rec.matrix[12],s.y-rec.matrix[13]);
  assert.ok(s.u<start-2,'down the flight');assert.ok(Math.abs(rho-(ro-rec.rail.inset_m))<.05,'on the handrail');
  assert.ok(s.z>stairPoint(rec,s.u)[2]+.3,'sitting up on it');assert.ok(fastest>walk.stair.rail_start_mps,'gathering speed');
  s=stepMoves(s,{x:0,y:0,tuck:false},dt,walk,world);
  assert.equal(s.stairPhase,'walk');assert.ok(s.stairV<0,'off onto the treads, still going down');
  // Held to the rail's end, he lands on the treads where it stops.
  s=stepMoves(s,{x:0,y:0,tuck:true},dt,walk,world);
  for(let t=0;t<15&&s.stairPhase==='rail';t+=dt)s=stepMoves(s,{x:0,y:0,tuck:true},dt,walk,world);
  assert.equal(s.mode,'stair');assert.equal(s.stairPhase,'walk');assert.ok(Math.abs(s.u-span[0])<.5);
});

test('every skybridge docks through a balcony gate',()=>{
  // build_village_tree.py GATES opens a dwelling's front where arrangement.py lands a bridge: a re-solve
  // that moves a bridge onto a closed balcony fails here, not in a player's hands.
  const gates={village_tree:[3,5,6,7],village_tree_low:[0,1,3],village_tree_mid:[2,4],village_tree_high:[7]};
  for(const b of bridges){
    const half=b.asset.includes('_8')?4:b.asset.includes('_20')?10:7;
    for(const k of [-1,1]){
      const e=place(b,[0,0,k*half]);let best=null;
      for(const t of trees)for(const i of VARIANTS[variant(t)]){const p=inDwelling(t,i,[0,.3,5.6]),d=Math.hypot(p[0]-e[0],p[1]-e[1]);if(!best||d<best.d)best={d,t,i};}
      assert.ok(best.d<1,`${b.asset} portal ${k} is ${best.d.toFixed(2)} m from a balcony front`);
      assert.ok(gates[variant(best.t)].includes(best.i),`${b.asset} docks at ${variant(best.t)} dwelling ${best.i}, which has no gate`);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stepWalk} from '../../../shared/activities/walk.js';
import {stepMoves} from '../../../shared/activities/moves.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {chooseCut} from '../../../shared/activities/combat.js';
const c=JSON.parse(readFileSync(new URL('../../../shared/characters/player.json',import.meta.url))).walk;
const flat=()=>0;
function fall(vx,drop){let s={x:0,y:0,z:drop,heading:0,speed:vx,vx,vy:0,vz:0,grounded:false,jumpPhase:'airborne',jumpVz:13.4};let bounce;
 for(let i=0;i<900;i++){s=stepWalk(s,{},1/120,c,flat);if(s.jumpPhase==='bounce'&&!bounce)bounce={...s};if(bounce&&s.jumpPhase==='grounded')return {bounce,final:s};}
 throw Error('fall did not recover');}

test('rebound height and rotation respond to incoming momentum and recover without residual rotation',()=>{
 const still=fall(0,30),moving=fall(9,30),higher=fall(9,45);
 assert.equal(still.bounce.fallSpin,0,'vertical impact invents no forward rotation');
 assert.ok(moving.bounce.fallSpin>still.bounce.fallSpin);assert.ok(higher.bounce.fallSpin>moving.bounce.fallSpin);
 assert.ok(higher.bounce.vz>moving.bounce.vz);assert.ok(moving.bounce.vx<9,'contact dissipates horizontal momentum');
 for(const {final}of [still,moving,higher]){assert.equal(final.z,0);assert.equal(final.fallPitch,0);assert.equal(final.fallRoll,0);}
});

test('slide retains momentum, ignores a reverse stick, loses energy, and requires a fresh press',()=>{
 for(const hz of [30,60,120]){
  let s={x:0,y:0,z:0,heading:0,grounded:true,jumpPhase:'grounded',vx:9,vy:0,speed:9};
  s=stepWalk(s,{slide:true,x:-1},1/hz,c,flat);assert.equal(s.sliding,true);assert.ok(s.vx>8);
  let last=s.vx;while(s.sliding){s=stepWalk(s,{slide:true},1/hz,c,flat);assert.ok(s.vx<=last+1e-8);last=s.vx;}
  assert.ok(s.x>5&&s.x<7,'a full-speed slide travels a bounded distance');
  s=stepWalk({...s,vx:9,speed:9},{slide:true},1/hz,c,flat);assert.equal(s.sliding,false,'held R3 cannot restart it');
  s=stepWalk(s,{slide:false},1/hz,c,flat);s=stepWalk(s,{slide:true},1/hz,c,flat);assert.equal(s.sliding,true);
 }
});

test('wall jumps require a fresh press, steer tangentially, and a held jump cannot add another',()=>{
 const box={type:'trunk',min:[-.75,-.75,0],max:[.75,.75,30],trunk:{x:0,y:0,base_z:0,top_z:30,profile:[[0,.75],[30,.5]]}},world={height:flat,hitTest:createCollisionIndex([box])};
 let start={x:-1.08,y:0,z:7,grounded:false,jumpPhase:'airborne',jumpHeld:false,vz:-1,vx:1,vy:0,speed:1,heading:0};
 const s=stepMoves(start,{jump:true,x:0,y:1},1/60,c,world);
 assert.equal(s.jumpStyle,'wall');assert.ok(s.vx<0&&s.vy>0&&s.vz>0);assert.equal(s.mode,'ground');
 const held=stepMoves(s,{jump:true},1/60,c,world);assert.ok(held.vz<s.vz,'holding jump cannot add another impulse');
 // The bark is now proximity's to judge: coming back to it takes hold without a press.
 let returned={...s,x:-1.08,y:0,z:7,climbCooldown:0,jumpHeld:false,vz:-1,vx:0,vy:0};
 returned=stepMoves(returned,{},1/60,c,world);assert.equal(returned.mode,'climb','airborne contact takes hold again');
});

test('cut choice responds to the live side and travel, without an attack sequence',()=>{
 assert.equal(chooseCut({side:-.3}),'forehand');assert.equal(chooseCut({side:.3}),'backhand');
 assert.equal(chooseCut({side:-.1,lateralSpeed:4}),'backhand');
 assert.equal(chooseCut({side:.3}),'backhand','another fresh click still uses the live side');
});

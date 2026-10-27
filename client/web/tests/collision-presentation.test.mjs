import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as T from '../vendor/three.module.min.js';
import {parseGLB} from '../src3d/glb.js';
import {createFlightRig} from '../src3d/flight-rig.js';
import {createCharacter} from '../src3d/character.js';
import {createNavigation} from '../src3d/navigation.js';
import {launchFlight} from '../../../shared/activities/flight.js';
import {createCollisionIndex} from '../../../shared/activities/collision.js';
import {crownShape} from '../../../shared/activities/colliders.js';
const read=p=>JSON.parse(readFileSync(new URL(p,import.meta.url)));
const glb=p=>{const b=readFileSync(new URL('../../../shared/geometry/'+p,import.meta.url));return parseGLB(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));};
const flight=read('../../../shared/activities/flight.json'),ride=read('../../../shared/activities/ride.json'),worldmap=read('../../../shared/world/worldmap.json');
const player=read('../../../shared/characters/player.json');

// The game's navigation in node, as climb.test.mjs builds it: flat ground at 0, a crown over the first launch site.
function game(t){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget();
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.tagName='CANVAS';canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const camera=new T.PerspectiveCamera(),cat=createCharacter(glb(player.asset),player),calls=[],update=cat.update;
 cat.update=(...a)=>{calls.push(a);return update(...a);};
 const [x,y]=flight.launches[0].xy_m,hitTest=createCollisionIndex([crownShape({id:'c',x,y,base_z:0,scale:1,profile:[[3,5],[12,5]]})]);
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height:()=>0},flight,worldmap,new T.Group(),hitTest,
  {config:ride,rig:new T.Group(),meshes:{ski:new T.Group(),bike:new T.Group()},height:()=>0,snowAt:()=>1,surfaceAt:()=>'snow'},cat,player);
 const key=(type,code)=>{const e=new Event(type);Object.defineProperties(e,{code:{value:code},target:{value:canvas}});win.dispatchEvent(e);};
 t.after(()=>{nav.dispose();cat.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 return {nav,cat,calls,key};
}

test('a collapsed flight presents the fall clip',t=>{
 const {nav,calls}=game(t);nav.select('paraglider');
 Object.assign(nav.state,{collapsed:true,vx:5,vy:0,vertical:-3});
 calls.length=0;nav.update(1/60);
 assert.ok(calls.length,'the character was drawn');
 assert.equal(calls.at(-1)[3].bodyClip,'fall_tumble');
});

test('after a collapsed landing he tumbles, then sits beside the wing',t=>{
 const {nav,calls}=game(t);nav.select('paraglider');
 Object.assign(nav.state,{collapsed:true,grounded:true,z:flight.landing_clearance_m,speed:0,vertical:0,vario:0,landingSpeed:14});
 calls.length=0;nav.update(1/60);
 assert.equal(calls.at(-1)[3].bodyClip,'fall_tumble','first the tumble');
 for(let i=0;i<120;i++)nav.update(1/60);
 assert.equal(calls.at(-1)[3].bodyClip,'sit','then he sits');
});

test('the wing deflates in the air after a collapse',()=>{
 const assets=Object.fromEntries([flight.wing_asset,flight.motor_asset,flight.modes.parakite.wing_asset].map(p=>[p,glb(p)]));
 const rig=createFlightRig(assets,flight),w=rig.wings.paraglider;
 const s={...launchFlight(flight,'paraglider',{xy_m:[0,0],heading_deg:0},()=>0),z:500,collapsed:true,grounded:false};
 for(let i=0;i<120;i++)rig.update(.05,s,{});
 assert.ok(Math.abs(w.inflation-.15)<.02,`inflation ${w.inflation.toFixed(3)}`);
});

test('a refused relaunch says why',t=>{
 const {nav,key}=game(t);nav.select('paraglider');
 Object.assign(nav.state,{grounded:true,z:flight.landing_clearance_m,speed:0,vertical:0,vario:0});
 nav.update(1/60);key('keydown','Space');nav.update(1/60);
 assert.equal(nav.message,'No room for the wing here');
});

test('a knock leans him away, easing back',()=>{
 const cat=createCharacter(glb(player.asset),player),model=cat.object.children[0];
 for(let i=0;i<6;i++)cat.update(1/60,'walk',3,{knock:2,knockSide:1});
 const leaned=model.rotation.z;
 assert.ok(Math.abs(leaned)>.05&&Math.abs(leaned)<=.25+1e-9,`leaned ${leaned.toFixed(3)} rad`);
 for(let i=0;i<120;i++)cat.update(1/60,'walk',3,{knock:0});
 assert.ok(Math.abs(model.rotation.z)<.01,'and eased back');
 cat.dispose();
});

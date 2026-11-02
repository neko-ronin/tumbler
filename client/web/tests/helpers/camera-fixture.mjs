/** Real navigation/input/core movement, without GLB parsing, rendering or audio. */
import {readFileSync} from 'node:fs';
import * as T from '../../vendor/three.module.min.js';
import {forestSpacing} from '../../../../shared/activities/forest-spacing.js';
import {createNavigation} from '../../src3d/navigation.js';
export const read=path=>JSON.parse(readFileSync(new URL('../../../../'+path,import.meta.url)));
export const policy=read('shared/activities/camera.json'),player=read('shared/characters/player.json'),world=read('shared/world/worldmap.json');
export const spacing=forestSpacing([...read('shared/world/out/placement.json').instances,...read('shared/world/out/landscape_transition.json').instances]);
const flight=read('shared/activities/flight.json'),ride=read('shared/activities/ride.json');
export function cameraFixture(t,{height=()=>0,hitTest=()=>null,walkHeight=height}={}){
 const saved=new Map(['window','document','navigator'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
 const win=new EventTarget(),doc=new EventTarget(),pad={connected:true,axes:[0,0,0,0],buttons:Array.from({length:16},()=>({pressed:false,value:0}))};
 for(const [k,v]of Object.entries({window:win,document:doc,navigator:{getGamepads:()=>[pad]}}))Object.defineProperty(globalThis,k,{value:v,configurable:true});
 const canvas=new EventTarget();canvas.focus=()=>{};canvas.setPointerCapture=()=>{};
 const camera=new T.PerspectiveCamera(62,16/9,.15,30000),character={object:new T.Group(),update(){}};
 const nav=createNavigation(camera,canvas,{target:new T.Vector3(),setTarget(){},update(){}},{height},flight,world,new T.Group(),hitTest,{config:ride,rig:new T.Group(),meshes:{}},character,player,{cameraPolicy:policy,forestSpacingM:spacing.meanNearestM,walkHeight,floorHeight:height});
 const start=(x=0,y=0,heading=Math.PI/2,warmup=90)=>{
  nav.select('orbit');camera.position.set(x,height(x,y)+5,-y);camera.lookAt(x+Math.cos(heading),height(x,y)+5,-y-Math.sin(heading));nav.select('walk');
  for(let i=0;i<warmup;i++)nav.update(1/30);
 };
 t.after(()=>{nav.dispose();for(const [k,v]of saved)v?Object.defineProperty(globalThis,k,v):delete globalThis[k];});
 return {nav,camera,pad,win,canvas,character,start};
}
export function viewYaw(camera){const d=camera.getWorldDirection(new T.Vector3());return Math.atan2(-d.x,-d.z);}
export const angle=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));

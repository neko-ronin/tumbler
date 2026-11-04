import test from 'node:test';
import assert from 'node:assert/strict';
import {createParaGuide} from '../src3d/para-guide.js';
const course={label:'Weave',landmarks:[{label:'Start',position_m:[0,0,100]},{label:'Shoulder',position_m:[100,0,90]},{label:'Return',position_m:[0,-100,80]}]};
const fixture=()=>{const element={hidden:false,textContent:'',setAttribute(k,v){this[k]=v;}};return {element,guide:createParaGuide(element,{getWorldDirection(v){v.set(1,0,0);}})};};
test('near a shoulder the guide previews the next authored turn without changing flight state',()=>{
 const {element,guide}=fixture(),state={x:20,y:0,z:90,speed:24},before=structuredClone(state);
 guide.update(course,{index:1},state);assert.match(element.textContent,/then ↷ Return/);assert.match(element['aria-label'],/right toward Return/);assert.deepEqual(state,before);
 guide.update(course,{index:1},{...state,x:-500});assert.doesNotMatch(element.textContent,/then/);
});
test('completion replaces stale accessible direction and hidden states stay hidden',()=>{
 const {element,guide}=fixture(),state={x:100,y:0,z:90};guide.update(course,{index:1},state);guide.update(course,{index:3},state);assert.equal(element['aria-label'],'Weave: Valley reached');
 for(const [s,on]of [[{...state,grounded:true},true],[{...state,collapsed:true},true],[state,false]]){guide.update(course,{index:1},s,on);assert.equal(element.hidden,true);}
});
test('arrival points toward the authored meadow and leaves truthful terminal feedback visible',()=>{
 const {element,guide}=fixture(),c={...course,arrival:{entry_xy_m:[200,0],landing_xy_m:[200,-500],label:'Meadow landing'}},s={mode:'parakite',x:200,y:-400,z:20};
 guide.update(c,{index:3,phase:'approach'},s);assert.match(element.textContent,/Meadow landing/);assert.equal(element.hidden,false);
 guide.update(c,{index:3,phase:'landed'},{...s,grounded:true,landingQuality:'hard'});assert.equal(element.hidden,false);assert.match(element.textContent,/hard touchdown/);
 guide.update(c,{index:3,phase:'retry'},{...s,collapsed:true});assert.equal(element.hidden,false);assert.match(element.textContent,/Run ended/);
 guide.update(c,{index:3,phase:'landed'},{...s,grounded:true},false);assert.equal(element.hidden,true);
});

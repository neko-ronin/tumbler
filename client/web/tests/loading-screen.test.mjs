import test from 'node:test';
import assert from 'node:assert/strict';
import {createLoadingScreen,warmScene} from '../src3d/loading.js';

class Element extends EventTarget {
  constructor(){super();this.dataset={};this.hidden=false;this.disabled=false;this.textContent='';this.attributes={};this.max=0;this.value=0;}
  setAttribute(name,value){this.attributes[name]=value;}
  getAttribute(name){return this.attributes[name];}
  focus(){this.focused=true;}
}
function page(){
  const ids=['loading-screen','world','loading-message','loading-progress','loading-percent','loading-footnote','loading-begin','loading-title','loading-retry'];
  const elements=Object.fromEntries(ids.map(id=>[id,new Element()]));
  const previous={document:globalThis.document,window:globalThis.window};
  const classes=new Set();
  globalThis.document={getElementById:id=>elements[id],body:{dataset:{},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)}},hidden:false};
  globalThis.window=new EventTarget();
  const restore=()=>{
    if(previous.document===undefined)delete globalThis.document;else globalThis.document=previous.document;
    if(previous.window===undefined)delete globalThis.window;else globalThis.window=previous.window;
  };
  return {elements,classes,restore};
}

test('the journal meter is the preparation: it never rewinds and ready is a real finish',t=>{
  const {elements,restore}=page();t.after(restore);
  const loading=createLoadingScreen();
  assert.equal(elements['loading-begin'].hidden,true,'the entry button does not exist while the world is being prepared');
  loading.phase('Unpacking…',1);
  assert.equal(elements['loading-progress'].max,1);
  assert.equal(elements['loading-progress'].value,.2);
  assert.equal(elements['loading-percent'].textContent,'20%');
  loading.meter(.55,'Rendering the village…');
  assert.equal(elements['loading-progress'].value,.55);
  loading.meter(.4,'A step that settled again');
  assert.equal(elements['loading-progress'].value,.55,'a re-settling step must not move the bar backwards');
  assert.equal(elements['loading-message'].textContent,'A step that settled again');
});

test('the ready state holds the world and one gesture enters it exactly once',t=>{
  const {elements,restore}=page();t.after(restore);
  const loading=createLoadingScreen();
  let entered=0;
  loading.ready('The valley is ready.',()=>entered++);
  assert.equal(elements['loading-progress'].value,1);
  assert.equal(elements['loading-percent'].textContent,'100%');
  assert.equal(elements['loading-message'].textContent,'The valley is ready.');
  assert.equal(elements['loading-begin'].hidden,false);
  assert.equal(elements['loading-footnote'].textContent,'Sound begins when you step in.');
  assert.equal(elements['loading-screen'].hidden,false,'ready is not entered: the world stays covered until the gesture');
  assert.equal(elements['world'].attributes['aria-busy'],undefined,'ready alone does not touch world busy state');
  elements['loading-begin'].dispatchEvent(new Event('click'));
  assert.equal(entered,1);
  elements['loading-begin'].dispatchEvent(new Event('click'));
  assert.equal(entered,1,'the entry gesture is spent once');
  loading.reveal();
  assert.equal(elements['loading-screen'].hidden,true);
  assert.equal(elements['world'].attributes['aria-busy'],'false');
});

test('a failure or reload takes the entry away again',t=>{
  const {elements,restore}=page();t.after(restore);
  const loading=createLoadingScreen();
  let entered=0;
  loading.ready('The valley is ready.',()=>entered++);
  loading.show('The light slipped away. Preparing it again…');
  assert.equal(elements['loading-begin'].hidden,true);
  assert.equal(elements['loading-progress'].value,0);
  assert.equal(elements['loading-footnote'].textContent,'Take a breath. We’re getting the whole place ready.');
  elements['loading-begin'].dispatchEvent(new Event('click'));
  assert.equal(entered,0,'a stale ready handler cannot enter the world');
});

test('warm progress reports the stable draws the completion rule requires',async()=>{
  let frame=0;
  const seen=[];
  const result=await warmScene({
    prepare(){},compile:async()=>{},render(){frame++;},
    signature:()=>frame<3?'first':'settled',pending:()=>false,
    finish:async()=>{},paint:async()=>{},stableFrames:3,
    onProgress(state){seen.push(state);},
  });
  assert.equal(result.frames,6);
  assert.deepEqual(seen.map(s=>s.frames),[1,2,3,4,5,6]);
  assert.deepEqual(seen.map(s=>s.stable),[0,1,0,1,2,3],'a changed signature restarts the stable count');
  assert.ok(seen.every(s=>s.stableFrames===3));
});

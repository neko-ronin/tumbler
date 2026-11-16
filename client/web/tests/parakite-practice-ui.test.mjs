import test from 'node:test';
import assert from 'node:assert/strict';
import {createParakitePractice} from '../src3d/parakite-practice.js';

function controls(t){
  const saved=Object.getOwnPropertyDescriptor(globalThis,'Option');
  Object.defineProperty(globalThis,'Option',{configurable:true,value:class {
    constructor(text,value){Object.assign(this,{text,value});}
  }});
  t.after(()=>saved?Object.defineProperty(globalThis,'Option',saved):delete globalThis.Option);
  const nodes=new Map();
  for(const selector of ['select','label','[data-practice-title]','[data-practice-prompt]',
    '[data-tutorial-readings]','[data-practice-action]','[data-practice-leave]','[data-practice-next]']){
    nodes.set(selector,Object.assign(new EventTarget(),{hidden:false,dataset:{},replaceChildren(){}}));
  }
  const details={},world={dataset:{}};
  const open=Object.assign(new EventTarget(),{closest:selector=>selector==='details'?details:world});
  const navigation={
    prepareFlightLesson(id,guided){
      this.flightLesson={progress:{id,phase:'pull'},ready:true,guided};
      return true;
    },
    beginFlightLesson(){this.flightLesson.ready=false;},
    endFlightLesson(){this.flightLesson=null;},
  };
  const practice=createParakitePractice({panel:{dataset:{},querySelector:selector=>nodes.get(selector)},open,navigation,
    canvas:{focus(){}},challenge:{}});
  return {nodes,navigation,practice};
}

test('Next stays visible and advances an uncredited stall recovery',t=>{
  const {nodes,navigation,practice}=controls(t);
  assert.ok(practice.startSequence(['stall','spiral'],()=>{},()=>{}));
  practice.render();
  const next=nodes.get('[data-practice-next]');
  assert.equal(next.textContent,'Next');
  assert.equal(next.hidden,false,'offer a way forward before the stall is credited');
  navigation.beginFlightLesson();
  navigation.flightLesson.progress.phase='settle';
  practice.render();
  assert.equal(next.hidden,false,'recovering flight still has a Next button');
  assert.equal(practice.advance(),false,'controller A still uses the drill retry while incomplete');
  next.dispatchEvent(new Event('click'));
  assert.equal(navigation.flightLesson.progress.id,'spiral');
});

test('completing a drill still advances with the default action',t=>{
  const {navigation,practice}=controls(t);
  let finished=false;
  practice.startSequence(['stall'],()=>{finished=true;},()=>{});
  navigation.beginFlightLesson();
  navigation.flightLesson.progress.phase='passed';
  assert.equal(practice.advance(),true);
  assert.equal(finished,true);
  assert.equal(navigation.flightLesson,null);
});

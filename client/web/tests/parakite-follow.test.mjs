import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createParakiteFollow,followInput,stepParakiteFollowFlight} from '../../../shared/activities/parakite-follow.js';

const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const dt=1/120,wind=275,height=()=>0;

function beforeSpiral(){
  const flight={...config,parakite_practice_launch:{...config.parakite_practice_launch,clearance_m:650}};
  const follow=createParakiteFollow({config:flight,wind,height});
  const {player:initial,guide}=follow.retry();
  assert.ok(Math.hypot(guide.x-initial.x,guide.y-initial.y,guide.z-initial.z)>15);
  let player=initial;
  for(let tick=0;tick<1919;tick++){
    assert.equal(follow.advance(dt,player),'flying');
    player=stepParakiteFollowFlight(player,followInput(tick*dt),dt,flight,wind,height);
  }
  return {follow,player};
}

test('only an airborne player with the guide earns the next parakite checkpoint',()=>{
  const {follow,player}=beforeSpiral();
  assert.equal(follow.advance(dt,{...player,grounded:true,impact:'tree'}),'lost');
  assert.equal(follow.retry().player.followStep,0);
});

test('rewind returns both pilots to separated solver states',()=>{
  const {follow,player}=beforeSpiral();
  assert.equal(follow.advance(dt,player),'flying');
  assert.equal(follow.checkpointTime,16);
  const restored=follow.retry();
  assert.equal(restored.player.followStep,1920);
  assert.equal(restored.guide.followStep-restored.player.followStep,108);
  assert.ok(Math.hypot(restored.guide.x-restored.player.x,restored.guide.y-restored.player.y)>15);
  assert.ok(restored.player.rotation.pressure.every(p=>p>.8));
  assert.equal(follow.advance(dt,restored.player),'flying');
});


test('precomputed guide states match live steps and are reused on rewind',()=>{
  let heightReads=0;
  const warm=createParakiteFollow({config,wind,height:()=>{heightReads++;return 0;}});
  const lazy=createParakiteFollow({config,wind,height});
  const {player}=warm.retry();
  for(let tick=0;tick<72;tick++)assert.ok(warm.warmNext());
  const warmedHeightReads=heightReads;
  for(let pass=0;pass<2;pass++){
    warm.retry();
    lazy.retry();
    for(let tick=0;tick<72;tick++){
      assert.equal(warm.advance(dt,player),lazy.advance(dt,player));
      assert.deepEqual(warm.guide,lazy.guide);
    }
  }
  assert.equal(heightReads,warmedHeightReads);
});

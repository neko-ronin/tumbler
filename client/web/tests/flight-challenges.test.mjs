import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {launchFlight,stepFlight,startFlightChallenge} from '../../../shared/activities/flight.js';
const config=JSON.parse(readFileSync(new URL('../../../shared/activities/flight.json',import.meta.url)));
const still={...config,thermals:[],wind:{speed_mps:0,gust_mps:0},weather:{soaring:{wind_scale:0,gust_scale:0,thermal_scale:0,turbulence_mps:0}}};
const flat=()=>0,start=()=>({...launchFlight(still,'paraglider',{xy_m:[0,0],heading_deg:0},flat),z:1000});
test('linked turns require real reversals and challenge scoring cannot alter physics',()=>{
 let a=startFlightChallenge(start(),'linked-turns',still),b=start();
 for(let i=0;i<1080;i++){
  const input={turn:i<360?1:i<720?-1:1};
  const before=structuredClone(a.challenge);
  const next=stepFlight(a,input,1/120,i/120,still,270,flat);
  assert.deepEqual(a.challenge,before,'scoring does not mutate earlier simulation snapshots');a=next;
  b=stepFlight(b,input,1/120,i/120,still,270,flat);
  const {challenge:_,...physicalA}=a,{challenge:__,...physicalB}=b;assert.deepEqual(physicalA,physicalB);
  if(i<360)assert.equal(a.challenge.status,'active','holding one side is not three turns');
 }
 assert.equal(a.challenge.status,'complete');assert.equal(a.challenge.turns,2);
 assert.equal(startFlightChallenge(a,'',still).challenge,null);
 assert.throws(()=>startFlightChallenge(a,'missing',still),/Unknown flight challenge/);
});
test('a landing goal judges actual touchdown and rejects hard contact or a collapsed wing',()=>{
 for(const [vertical,speed,status] of [[-1,8,'complete'],[-6,8,'retry'],[-1,11.5,'retry']]){
  const brake=speed<10?.9:0;
  const s=startFlightChallenge({...start(),z:config.landing_clearance_m+.001,vertical,vario:vertical,speed,brakeLeft:brake,brakeRight:brake},'smooth-landing',still);
  const landed=stepFlight(s,{brake},1/120,0,still,270,flat);
  assert.ok(landed.grounded);assert.equal(landed.challenge.status,status);
 }
 const collapsed=startFlightChallenge({...start(),collapsed:true},'smooth-landing',still);
 assert.equal(stepFlight(collapsed,{},1/120,0,still,270,flat).challenge.status,'retry');
});

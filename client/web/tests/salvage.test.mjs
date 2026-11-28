import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSalvage,equipmentAction,equipmentPowered,salvageProgress,stepSalvage,strikeSalvage,useEquipment} from '../../../shared/activities/salvage.js';

const yard=JSON.parse(readFileSync(new URL('../../../shared/activities/salvage.json',import.meta.url)));
const world={height:()=>0};
const beside=(target,extra={})=>({x:target.x-.9,y:target.y,z:target.z,heading:0,grounded:true,...extra});

test('forward, clear strikes interrupt a windup and award one collectible per defeat',()=>{
  const state=createSalvage(yard,world),robot=state.robots[0],player=beside(robot);
  stepSalvage(state,player,world,1/60);
  assert.equal(robot.phase,'windup');
  assert.equal(strikeSalvage(state,{...player,heading:Math.PI},world),0);
  assert.equal(strikeSalvage(state,player,{...world,hitTest:()=>true}),0);
  assert.equal(strikeSalvage(state,{...player,z:3},world),0);
  assert.equal(strikeSalvage(state,player,world,true),1);
  assert.equal(robot.phase,'stagger');
  assert.equal(robot.hp,1);
  assert.equal(strikeSalvage(state,player,world),1);
  assert.equal(strikeSalvage(state,player,world),0);
  assert.equal(state.drops.length,1);
  assert.equal(state.parts,0);
  stepSalvage(state,player,world,1/60);
  assert.equal(state.drops.length,0);
  assert.equal(state.parts,2);
});

test('telegraphed attacks can connect, whiff or be dodged',()=>{
  for(const [extra,damage] of [[{},1],[{dodging:true},0],[{y:-510},0]]){
    const state=createSalvage(yard,world),robot=state.robots[0],player=beside(robot);
    stepSalvage(state,player,world,.05);
    for(let i=0;i<14;i++)stepSalvage(state,{...player,...extra},world,.05);
    assert.equal(state.health,3-damage);
    assert.equal(state.stun>0,!!damage);
  }
});

test('building and servicing fixtures consume parts exactly once and survive reload',()=>{
  const state=createSalvage(yard,world,{parts:5}),[solar,pump]=state.equipment;
  assert.equal(useEquipment(state,beside(pump)),true);
  assert.equal(equipmentPowered(state,pump),false);
  assert.equal(useEquipment(state,beside(solar)),true);
  assert.equal(equipmentPowered(state,pump),true);
  assert.equal(useEquipment(state,beside(solar)),false);
  assert.equal(equipmentAction(state,beside(solar,{grounded:false})),null);
  solar.integrity=0;
  assert.equal(equipmentPowered(state,pump),false);
  assert.equal(useEquipment(state,beside(solar)),true);
  assert.equal(equipmentPowered(state,pump),true);
  assert.equal(state.parts,0);
  assert.deepEqual(salvageProgress(createSalvage(yard,world,salvageProgress(state))),salvageProgress(state));
});

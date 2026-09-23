'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {ALLOWED_CAPABILITIES,FORBIDDEN_CAPABILITIES,buildHermesMaintainerModeFoundation,validateHermesMaintainerModeFoundation}=require('../src/core/hermes-maintainer-mode-foundation');

test('maintainer foundation allows only development preparation capabilities',()=>{
 const c=buildHermesMaintainerModeFoundation();
 assert.equal(validateHermesMaintainerModeFoundation(c).valid,true);
 for(const x of ALLOWED_CAPABILITIES) assert.equal(c.capabilities[x],true);
 for(const x of FORBIDDEN_CAPABILITIES) assert.equal(c.capabilities[x],false);
 assert.equal(c.production_allowed,false);
 assert.equal(c.simulation_first,true);
});

test('merge and operational boundaries remain explicit human gates',()=>{
 const c=buildHermesMaintainerModeFoundation();
 for(const value of Object.values(c.human_gates)) assert.equal(value,'explicit_authorization_required');
});

test('fails closed if an operational capability is granted',()=>{
 for(const capability of FORBIDDEN_CAPABILITIES){
  const c=buildHermesMaintainerModeFoundation();
  const candidate={...c,capabilities:{...c.capabilities,[capability]:true}};
  assert.equal(validateHermesMaintainerModeFoundation(candidate).valid,false,capability);
 }
});

test('fails closed on production, non-development mode or unknown capability',()=>{
 const c=buildHermesMaintainerModeFoundation();
 assert.equal(validateHermesMaintainerModeFoundation({...c,production_allowed:true}).valid,false);
 assert.equal(validateHermesMaintainerModeFoundation({...c,environment:'staging'}).valid,false);
 assert.equal(validateHermesMaintainerModeFoundation({...c,capabilities:{...c.capabilities,magic:true}}).valid,false);
});

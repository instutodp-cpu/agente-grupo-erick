'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {buildHermesMaintainerScmWriteIntent}=require('../src/core/hermes-maintainer-scm-write-intent');

test('prepares only a non-executable approved-prefix branch creation intent',()=>{
 const v=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:'hermes/example-change'});
 assert.equal(v.status,'SCM_WRITE_INTENT_PREPARED');assert.equal(v.intent_valid,true);
 assert.equal(v.approval_required,true);assert.equal(v.approval_present,false);assert.equal(v.execution_authorized,false);
 assert.equal(v.network_call_performed,false);assert.equal(v.write_performed,false);assert.deepEqual(v.blockers,[]);
});

test('blocks repository, base, operation, and branch scope drift',()=>{
 for(const input of [
  {provider:'GITHUB',operation:'delete_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:'hermes/x'},
  {provider:'GITHUB',operation:'create_branch',repository:'other/repo',base_ref:'main',branch_name:'hermes/x'},
  {provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'dev',branch_name:'hermes/x'},
  {provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:'feature/x'}
 ])assert.equal(buildHermesMaintainerScmWriteIntent(input).intent_valid,false);
});

test('never grants execution or performs side effects',()=>{
 const v=buildHermesMaintainerScmWriteIntent({provider:'GITHUB',operation:'create_branch',repository:'instutodp-cpu/agente-grupo-erick',base_ref:'main',branch_name:'hermes/safe'});
 assert.equal(v.approval_present,false);assert.equal(v.execution_authorized,false);
 assert.equal(v.credential_material_present,false);assert.equal(v.network_call_performed,false);assert.equal(v.write_performed,false);assert.equal(v.production_used,false);
});

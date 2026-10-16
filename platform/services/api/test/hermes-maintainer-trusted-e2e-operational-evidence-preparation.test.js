'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {CONTRACT_VERSION,prepareHermesMaintainerTrustedE2eOperationalEvidence}=require('../src/runtime/hermes-maintainer-trusted-e2e-operational-evidence-preparation');

function valid(){
 return {
  branch_name:'hermes/canary/e2e',
  base_sha:'a'.repeat(40),
  execution_reference:'canary:e2e:001',
  a3_eligibility_input:{contract_version:'hermes_a3_scoped_external_action_eligibility_v2',marker:'same-a3-input'},
  repository_read:{r:1},
  branch:{controlled_execution:{c:1}},
  edit:{controlled_execution:{c:2},path:'docs/hermes-canary.md',current_blob_sha:'b'.repeat(40),content:'canary\n',message:'test(hermes): trusted e2e canary'},
  pull_request:{controlled_execution:{c:3},title:'test(hermes): trusted e2e canary',body:'Automated staging canary.'}
 };
}

test('prepares coherent unique operational evidence and preserves exact A3 input without consuming authority',()=>{
 const input=valid();
 const x=prepareHermesMaintainerTrustedE2eOperationalEvidence(input);
 assert.equal(CONTRACT_VERSION,'hermes_maintainer_trusted_e2e_operational_evidence_preparation_v2');
 assert.equal(x.prepared,true);
 assert.equal(x.operational_evidence.branch.canary.canary_valid,true);
 assert.equal(x.operational_evidence.branch.canary.execution_authorized,false);
 assert.equal(x.operational_evidence.branch.a3_eligibility_input,input.a3_eligibility_input);
 const refs=[x.operational_evidence.branch.operational_input.consumption_reference,x.operational_evidence.edit.operational_input.consumption_reference,x.operational_evidence.pull_request.operational_input.consumption_reference];
 assert.equal(new Set(refs).size,3);
 assert.equal(x.production_used,false);
 assert.equal(x.merge_authority,false);
 assert.equal(x.human_merge_required,true);
});

test('rejects missing A3 eligibility input before operational evidence can be prepared',()=>{
 const input=valid();
 delete input.a3_eligibility_input;
 const x=prepareHermesMaintainerTrustedE2eOperationalEvidence(input);
 assert.equal(x.prepared,false);
 assert.equal(x.blockers[0],'A3_ELIGIBILITY_INPUT_MISSING');
 assert.equal(x.operational_evidence,null);
});

test('rejects branch outside dedicated canary scope',()=>{
 const input=valid();
 input.branch_name='hermes/feature';
 const x=prepareHermesMaintainerTrustedE2eOperationalEvidence(input);
 assert.equal(x.prepared,false);
 assert.equal(x.blockers[0],'BRANCH_SCOPE_INVALID');
});

test('rejects missing pre-existing workflow evidence',()=>{
 const input=valid();
 delete input.edit.controlled_execution;
 const x=prepareHermesMaintainerTrustedE2eOperationalEvidence(input);
 assert.equal(x.prepared,false);
 assert.equal(x.blockers[0],'WORKFLOW_EVIDENCE_MISSING');
});

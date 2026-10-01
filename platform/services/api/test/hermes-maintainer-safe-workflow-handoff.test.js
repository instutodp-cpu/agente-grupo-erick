'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { prepareHermesMaintainerSafeWorkflowHandoff, validateHermesMaintainerSafeWorkflowHandoff } = require('../src/core/hermes-maintainer-safe-workflow-handoff');
const { buildHermesMaintainerSafeWorkflowFingerprint } = require('../src/core/hermes-maintainer-safe-workflow-fingerprint');

const actions=['repository_read','repository_code_search','ci_read','test_execution','branch_prepare','code_edit_prepare','pull_request_prepare'];
function workflow(overrides={}) {
  return {contract_version:'hermes_maintainer_safe_workflow_contract_v1',mission_id:'mission-safe',status:'MAINTAINER_SAFE_WORKFLOW_PREPARED_SIMULATION',ready:true,actions,merge_authority:false,human_merge_required:true,simulation:true,production_allowed:false,executed:false,runtime_mutated:false,network_used:false,provider_called:false,secret_accessed:false,operational_authority_consumed:false,blockers:[],...overrides};
}

test('prepares a fingerprint-bound handoff without operational authority',()=>{
  const source=workflow();
  const fingerprint=buildHermesMaintainerSafeWorkflowFingerprint(source).fingerprint;
  const handoff=prepareHermesMaintainerSafeWorkflowHandoff(source,fingerprint);
  assert.equal(handoff.handoff_prepared,true);
  assert.equal(handoff.workflow_digest,fingerprint.workflow_digest);
  assert.equal(handoff.execution_eligible,false);
  assert.equal(handoff.execution_authorized,false);
  assert.equal(handoff.operational_authority_consumed,false);
  assert.equal(handoff.merge_authority,false);
  assert.equal(handoff.human_merge_required,true);
  assert.deepEqual(validateHermesMaintainerSafeWorkflowHandoff(handoff),{valid:true,errors:[]});
});

test('fails closed when workflow changes after fingerprint',()=>{
  const source=workflow();
  const fingerprint=buildHermesMaintainerSafeWorkflowFingerprint(source).fingerprint;
  const changed=workflow({mission_id:'mission-mutated'});
  const handoff=prepareHermesMaintainerSafeWorkflowHandoff(changed,fingerprint);
  assert.equal(handoff.handoff_prepared,false);
  assert.equal(handoff.workflow_digest,null);
  assert.ok(handoff.blockers.includes('fingerprint::mission_id_mismatch'));
  assert.ok(handoff.blockers.includes('fingerprint::workflow_digest_mismatch'));
});

test('fails closed for a blocked workflow and never grants merge authority',()=>{
  const source=workflow({status:'MAINTAINER_SAFE_WORKFLOW_BLOCKED',ready:false,blockers:['blocked']});
  const handoff=prepareHermesMaintainerSafeWorkflowHandoff(source,null);
  assert.equal(handoff.handoff_prepared,false);
  assert.equal(handoff.execution_eligible,false);
  assert.equal(handoff.merge_authority,false);
  assert.equal(handoff.human_merge_required,true);
});

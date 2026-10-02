'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerRevisionBoundE2eOrchestrator } = require('../src/core/hermes-maintainer-revision-bound-e2e-orchestrator');

const SHA = 'a'.repeat(40);
const editReceipt = () => ({
  contract_version: 'hermes_maintainer_github_update_file_durable_finalization_receipt_v1',
  status: 'GITHUB_UPDATE_FILE_DURABLE_FINALIZATION_CONFIRMED',
  receipt_valid: true,
  durable: true,
  repository: 'instutodp-cpu/agente-grupo-erick',
  operation: 'update_file',
  provider_status: 200,
  branch: 'hermes/e2e-test',
  commit_sha: SHA,
  production_used: false,
  write_performed: false
});
const mutation = (operation, receipt = {}) => ({ execute: async () => ({ status: 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED', completed: true, operation, receipt, merge_authority: false }) });
const read = { execute: async () => ({ outcome: 'SUCCEEDED', read_only: true, write_performed: false, production_used: false }) };

test('tests the exact durable edited revision before creating a Draft PR', async () => {
  let testedBinding;
  let prCalls = 0;
  const orchestrator = createHermesMaintainerRevisionBoundE2eOrchestrator({
    repositoryRead: read,
    branchMutation: mutation('create_branch'),
    editMutation: mutation('update_file', editReceipt()),
    revisionTest: { execute: async binding => { testedBinding = binding; return { status: 'MAINTAINER_REVISION_BOUND_TEST_PASSED', passed: true, test_id: 'hermes_core_smoke', revision_sha: binding.revision_sha, receipt: 'test_process_passed', network_authorized_for_test: false, secrets_authorized_for_test: false, write_authorized_for_test: false, production_allowed: false, merge_authority: false, human_merge_required: true }; } },
    pullRequestMutation: { execute: async () => { prCalls += 1; return { status: 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED', completed: true, operation: 'create_pull_request', merge_authority: false, receipt: { receipt_valid: true, draft: true } }; } }
  });
  const result = await orchestrator.execute({});
  assert.equal(testedBinding.contract_version, 'hermes_maintainer_test_revision_binding_v1');
  assert.equal(testedBinding.binding_valid, true);
  assert.equal(testedBinding.revision_sha, SHA);
  assert.equal(result.status, 'MAINTAINER_REVISION_BOUND_E2E_COMPLETED');
  assert.equal(result.tested_revision_sha, SHA);
  assert.equal(result.draft_pull_request_created, true);
  assert.equal(prCalls, 1);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});

test('invalid edit receipt blocks before test and Draft PR mutation', async () => {
  let testCalls = 0; let prCalls = 0;
  const bad = editReceipt(); bad.durable = false;
  const orchestrator = createHermesMaintainerRevisionBoundE2eOrchestrator({
    repositoryRead: read,
    branchMutation: mutation('create_branch'),
    editMutation: mutation('update_file', bad),
    revisionTest: { execute: async () => { testCalls += 1; } },
    pullRequestMutation: { execute: async () => { prCalls += 1; } }
  });
  const result = await orchestrator.execute({});
  assert.equal(result.status, 'MAINTAINER_REVISION_BOUND_E2E_BLOCKED');
  assert.equal(result.stage, 'revision_binding');
  assert.equal(testCalls, 0);
  assert.equal(prCalls, 0);
});

test('failed or mismatched revision test blocks Draft PR creation', async () => {
  let prCalls = 0;
  const orchestrator = createHermesMaintainerRevisionBoundE2eOrchestrator({
    repositoryRead: read,
    branchMutation: mutation('create_branch'),
    editMutation: mutation('update_file', editReceipt()),
    revisionTest: { execute: async () => ({ status: 'MAINTAINER_REVISION_BOUND_TEST_PASSED', passed: true, test_id: 'hermes_core_smoke', revision_sha: 'b'.repeat(40), network_authorized_for_test: false, secrets_authorized_for_test: false, write_authorized_for_test: false, production_allowed: false, merge_authority: false, human_merge_required: true }) },
    pullRequestMutation: { execute: async () => { prCalls += 1; } }
  });
  const result = await orchestrator.execute({});
  assert.equal(result.stage, 'test_execution');
  assert.equal(result.completed, false);
  assert.equal(prCalls, 0);
  assert.equal(result.draft_pull_request_created, false);
});


test('passed test with unexpected test authority fails closed before Draft PR creation', async () => {
  let prCalls = 0;
  const orchestrator = createHermesMaintainerRevisionBoundE2eOrchestrator({
    repositoryRead: read,
    branchMutation: mutation('create_branch'),
    editMutation: mutation('update_file', editReceipt()),
    revisionTest: { execute: async () => ({ status: 'MAINTAINER_REVISION_BOUND_TEST_PASSED', passed: true, test_id: 'hermes_core_smoke', revision_sha: SHA, network_authorized_for_test: true, secrets_authorized_for_test: false, write_authorized_for_test: false, production_allowed: false, merge_authority: false, human_merge_required: true }) },
    pullRequestMutation: { execute: async () => { prCalls += 1; } }
  });
  const result = await orchestrator.execute({});
  assert.equal(result.stage, 'test_execution');
  assert.equal(result.completed, false);
  assert.equal(prCalls, 0);
});

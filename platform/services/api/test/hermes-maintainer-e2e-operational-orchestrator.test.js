'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHermesMaintainerE2eOperationalOrchestrator } = require('../src/core/hermes-maintainer-e2e-operational-orchestrator');

const mutation = operation => ({ execute: async () => ({ status: 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED', completed: true, operation, receipt: operation + '_receipt', production_used: false, merge_authority: false, human_merge_required: true }) });

test('runs read branch edit test draft-pr in strict order and never grants merge authority', async () => {
  const order = [];
  const wrap = (name, value) => ({ execute: async () => { order.push(name); return value; } });
  const orchestrator = createHermesMaintainerE2eOperationalOrchestrator({
    repositoryRead: wrap('read', { outcome: 'SUCCEEDED', read_only: true, write_performed: false, production_used: false }),
    branchMutation: wrap('branch', await mutation('create_branch').execute()),
    editMutation: wrap('edit', await mutation('update_file').execute()),
    testExecution: wrap('test', { status: 'MAINTAINER_TEST_EXECUTION_PASSED', passed: true, receipt: 'test_receipt', production_allowed: false, merge_authority: false, human_merge_required: true }),
    pullRequestMutation: wrap('pr', await mutation('create_pull_request').execute())
  });
  const result = await orchestrator.execute({});
  assert.deepEqual(order, ['read', 'branch', 'edit', 'test', 'pr']);
  assert.equal(result.status, 'MAINTAINER_E2E_OPERATIONAL_ORCHESTRATION_COMPLETED');
  assert.equal(result.draft_pull_request_created, true);
  assert.equal(result.production_used, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});

test('fails closed and does not execute later stages after a failed test', async () => {
  const calls = [];
  const orchestrator = createHermesMaintainerE2eOperationalOrchestrator({
    repositoryRead: { execute: async () => { calls.push('read'); return { outcome: 'SUCCEEDED', read_only: true, write_performed: false, production_used: false }; } },
    branchMutation: { execute: async () => { calls.push('branch'); return mutation('create_branch').execute(); } },
    editMutation: { execute: async () => { calls.push('edit'); return mutation('update_file').execute(); } },
    testExecution: { execute: async () => { calls.push('test'); return { status: 'MAINTAINER_TEST_EXECUTION_FAILED', passed: false, production_allowed: false, merge_authority: false }; } },
    pullRequestMutation: { execute: async () => { calls.push('pr'); throw new Error('must not run'); } }
  });
  const result = await orchestrator.execute({});
  assert.deepEqual(calls, ['read', 'branch', 'edit', 'test']);
  assert.equal(result.status, 'MAINTAINER_E2E_OPERATIONAL_ORCHESTRATION_BLOCKED');
  assert.equal(result.stage, 'test_execution');
  assert.equal(result.draft_pull_request_created, false);
  assert.equal(result.merge_authority, false);
  assert.equal(result.human_merge_required, true);
});

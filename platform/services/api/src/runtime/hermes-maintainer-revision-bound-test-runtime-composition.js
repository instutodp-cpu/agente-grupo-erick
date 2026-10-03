'use strict';

const { createHermesMaintainerTestExecutionBoundary } = require('../core/hermes-maintainer-test-execution-boundary');
const { createHermesMaintainerTestExecutionProcessRuntime } = require('./hermes-maintainer-test-execution-process-runtime');
const { createHermesMaintainerTestRevisionWorkspaceRuntime, ROOT } = require('./hermes-maintainer-test-revision-workspace-runtime');

const COMPOSITION_VERSION = 'hermes_maintainer_revision_bound_test_runtime_composition_v1';
const TEST_ID = 'hermes_core_smoke';
const WORKSPACE_RUNTIME_VERSION = 'hermes_maintainer_test_revision_workspace_runtime_v1';

function blocked(reason, revisionSha = null) {
  return Object.freeze({
    composition_version: COMPOSITION_VERSION,
    status: 'MAINTAINER_REVISION_BOUND_TEST_BLOCKED',
    executed: false,
    passed: false,
    test_id: TEST_ID,
    revision_sha: revisionSha,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([reason])
  });
}

function createHermesMaintainerRevisionBoundTestRuntimeComposition({ workspaceSpawnImpl, testSpawnImpl, workspaceTimeoutMs, testTimeoutMs } = {}) {
  const workspaceRuntime = createHermesMaintainerTestRevisionWorkspaceRuntime({ spawnImpl: workspaceSpawnImpl, timeoutMs: workspaceTimeoutMs });

  return Object.freeze({
    composition_version: COMPOSITION_VERSION,
    test_id: TEST_ID,
    environment: 'staging',
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    async execute(revisionBinding = {}) {
      const workspace = await workspaceRuntime.materialize(revisionBinding);
      if (
        workspace.runtime_version !== WORKSPACE_RUNTIME_VERSION ||
        workspace.status !== 'MAINTAINER_TEST_REVISION_WORKSPACE_READY' ||
        workspace.workspace_ready !== true
      ) return blocked('workspace_not_ready', revisionBinding.revision_sha || null);

      const expectedPath = ROOT + '/' + revisionBinding.revision_sha;
      if (
        workspace.workspace_path !== expectedPath ||
        workspace.revision_sha !== revisionBinding.revision_sha ||
        workspace.test_id !== TEST_ID ||
        workspace.test_execution_authorized !== false ||
        workspace.production_used !== false ||
        workspace.merge_authority !== false ||
        workspace.human_merge_required !== true
      ) return blocked('workspace_receipt_invalid', revisionBinding.revision_sha || null);

      const runner = createHermesMaintainerTestExecutionProcessRuntime({
        cwd: workspace.workspace_path + '/platform/services/api',
        spawnImpl: testSpawnImpl,
        timeoutMs: testTimeoutMs
      });
      const boundary = createHermesMaintainerTestExecutionBoundary({ runner });
      const result = await boundary.execute(Object.freeze({
        action: 'test_execution',
        environment: 'staging',
        test_id: TEST_ID
      }));
      if (
        result.test_id !== TEST_ID ||
        result.production_allowed !== false ||
        result.merge_authority !== false ||
        result.human_merge_required !== true
      ) return blocked('test_result_invalid', revisionBinding.revision_sha);

      return Object.freeze({
        composition_version: COMPOSITION_VERSION,
        status: result.passed ? 'MAINTAINER_REVISION_BOUND_TEST_PASSED' : 'MAINTAINER_REVISION_BOUND_TEST_FAILED',
        executed: result.executed === true,
        passed: result.passed === true,
        test_id: TEST_ID,
        revision_sha: revisionBinding.revision_sha,
        workspace_path: workspace.workspace_path,
        receipt: result.receipt || null,
        network_authorized_for_test: false,
        secrets_authorized_for_test: false,
        write_authorized_for_test: false,
        production_allowed: false,
        merge_authority: false,
        human_merge_required: true,
        blockers: Object.freeze([])
      });
    }
  });
}

module.exports = { COMPOSITION_VERSION, TEST_ID, createHermesMaintainerRevisionBoundTestRuntimeComposition };

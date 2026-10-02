'use strict';

const { bindHermesMaintainerTestRevision } = require('./hermes-maintainer-test-revision-binding');

const CONTRACT_VERSION = 'hermes_maintainer_revision_bound_e2e_orchestrator_v1';
const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';
const TEST_ID = 'hermes_core_smoke';

function blocked(stage, value) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MAINTAINER_REVISION_BOUND_E2E_BLOCKED',
    completed: false,
    stage,
    value: value || null,
    tested_revision_sha: null,
    draft_pull_request_created: false,
    production_used: false,
    merge_authority: false,
    human_merge_required: true
  });
}

function createHermesMaintainerRevisionBoundE2eOrchestrator({ repositoryRead, branchMutation, editMutation, revisionTest, pullRequestMutation } = {}) {
  if (typeof repositoryRead?.execute !== 'function') throw new TypeError('repositoryRead_required');
  if (typeof branchMutation?.execute !== 'function') throw new TypeError('branchMutation_required');
  if (typeof editMutation?.execute !== 'function') throw new TypeError('editMutation_required');
  if (typeof revisionTest?.execute !== 'function') throw new TypeError('revisionTest_required');
  if (typeof pullRequestMutation?.execute !== 'function') throw new TypeError('pullRequestMutation_required');

  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    async execute(input = {}) {
      const read = await repositoryRead.execute(input.repository_read);
      if (read?.outcome !== 'SUCCEEDED' || read?.read_only !== true || read?.write_performed !== false || read?.production_used !== false) return blocked('repository_read', read);

      const branch = await branchMutation.execute(input.branch_prepare);
      if (branch?.status !== 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED' || branch?.completed !== true || branch?.operation !== 'create_branch' || branch?.merge_authority !== false) return blocked('branch_prepare', branch);

      const edit = await editMutation.execute(input.code_edit_prepare);
      if (edit?.status !== 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED' || edit?.completed !== true || edit?.operation !== 'update_file' || edit?.merge_authority !== false) return blocked('code_edit_prepare', edit);

      const editReceipt = edit.receipt;
      const revisionBinding = bindHermesMaintainerTestRevision({
        repository: REPOSITORY,
        ref: editReceipt?.branch,
        revision_sha: editReceipt?.commit_sha,
        test_id: TEST_ID,
        edit_receipt: editReceipt
      });
      if (revisionBinding.binding_valid !== true) return blocked('revision_binding', revisionBinding);

      const tested = await revisionTest.execute(revisionBinding);
      if (
        tested?.status !== 'MAINTAINER_REVISION_BOUND_TEST_PASSED' ||
        tested?.passed !== true ||
        tested?.revision_sha !== revisionBinding.revision_sha ||
        tested?.test_id !== TEST_ID ||
        tested?.production_allowed !== false ||
        tested?.merge_authority !== false ||
        tested?.human_merge_required !== true
      ) return blocked('test_execution', tested);

      const pullRequest = await pullRequestMutation.execute(input.pull_request_prepare);
      if (
        pullRequest?.status !== 'MAINTAINER_SAFE_WORKFLOW_AUTHORIZED_MUTATION_FLOW_COMPLETED' ||
        pullRequest?.completed !== true ||
        pullRequest?.operation !== 'create_pull_request' ||
        pullRequest?.merge_authority !== false ||
        pullRequest?.receipt?.receipt_valid !== true ||
        pullRequest?.receipt?.draft !== true
      ) return blocked('pull_request_prepare', pullRequest);

      return Object.freeze({
        contract_version: CONTRACT_VERSION,
        status: 'MAINTAINER_REVISION_BOUND_E2E_COMPLETED',
        completed: true,
        stage: 'completed',
        read,
        branch_receipt: branch.receipt || null,
        edit_receipt: editReceipt,
        test_receipt: tested.receipt || null,
        tested_revision_sha: revisionBinding.revision_sha,
        pull_request_receipt: pullRequest.receipt,
        draft_pull_request_created: true,
        production_used: false,
        merge_authority: false,
        human_merge_required: true
      });
    }
  });
}

module.exports = { CONTRACT_VERSION, createHermesMaintainerRevisionBoundE2eOrchestrator };

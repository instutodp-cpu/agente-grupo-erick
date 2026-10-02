'use strict';

const CONTRACT_VERSION = 'hermes_maintainer_test_revision_binding_v1';
const REPOSITORY = 'instutodp-cpu/agente-grupo-erick';

function blocked(reason) {
  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MAINTAINER_TEST_REVISION_BINDING_BLOCKED',
    binding_valid: false,
    repository: REPOSITORY,
    ref: null,
    revision_sha: null,
    test_id: null,
    checkout_authorized: false,
    test_execution_authorized: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([reason])
  });
}

function bindHermesMaintainerTestRevision(input = {}) {
  if (input.repository !== REPOSITORY) return blocked('repository_invalid');
  if (typeof input.ref !== 'string' || !/^hermes\/[a-z0-9][a-z0-9._/-]{0,99}$/.test(input.ref) || input.ref.includes('..')) return blocked('ref_invalid');
  if (typeof input.revision_sha !== 'string' || !/^[a-f0-9]{40}$/.test(input.revision_sha)) return blocked('revision_sha_invalid');
  if (input.test_id !== 'hermes_core_smoke') return blocked('test_id_invalid');
  if (input.edit_receipt?.contract_version !== 'hermes_maintainer_github_update_file_durable_finalization_receipt_v1' || input.edit_receipt?.status !== 'GITHUB_UPDATE_FILE_DURABLE_FINALIZATION_CONFIRMED' || input.edit_receipt?.receipt_valid !== true || input.edit_receipt?.durable !== true) return blocked('edit_receipt_invalid');
  if (input.edit_receipt?.repository !== REPOSITORY || input.edit_receipt?.operation !== 'update_file' || input.edit_receipt?.provider_status !== 200 || input.edit_receipt?.branch !== input.ref) return blocked('edit_receipt_scope_mismatch');
  if (input.edit_receipt?.commit_sha !== input.revision_sha) return blocked('edit_receipt_revision_mismatch');
  if (input.edit_receipt?.production_used !== false || input.edit_receipt?.write_performed !== false) return blocked('edit_receipt_finalization_state_invalid');

  return Object.freeze({
    contract_version: CONTRACT_VERSION,
    status: 'MAINTAINER_TEST_REVISION_BOUND',
    binding_valid: true,
    repository: REPOSITORY,
    ref: input.ref,
    revision_sha: input.revision_sha,
    test_id: input.test_id,
    checkout_authorized: false,
    test_execution_authorized: false,
    production_allowed: false,
    merge_authority: false,
    human_merge_required: true,
    blockers: Object.freeze([])
  });
}

module.exports = { CONTRACT_VERSION, REPOSITORY, bindHermesMaintainerTestRevision };

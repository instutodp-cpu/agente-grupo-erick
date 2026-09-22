'use strict';

const VERSION = 'public_web_third_canary_durable_atomic_resource_state_v1';
const REQUIRED_CAPABILITIES = Object.freeze([
  'atomic_compare_and_set',
  'transactional_rollback',
  'durable_replay_protection',
  'unique_resource_constraints'
]);

function blocked(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_DURABLE_ATOMIC_RESOURCE_STATE_BLOCKED',
    reason,
    durable_state_ready: false,
    transaction_started: false,
    state_written: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    version: VERSION
  });
}

function preparePublicWebThirdCanaryDurableAtomicResourceState(input = {}) {
  const prior = input.single_use_transaction_contract || {};
  const contract = prior.transaction_contract || {};

  if (
    prior.ok !== true ||
    prior.status !== 'THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_READY_NOT_STARTED_NOT_EXECUTED' ||
    prior.transaction_contract_ready !== true ||
    prior.transaction_started !== false ||
    prior.execution_started !== false ||
    prior.external_network_called !== false
  ) return blocked('single_use_transaction_contract_required');

  const ids = ['trial_id', 'official_authorization_id', 'preparatory_authorization_id', 'grant_id', 'reservation_id'];
  for (const id of ids) {
    if (!input[id] || contract[id] !== input[id]) return blocked('resource_identity_mismatch');
  }

  if (
    contract.single_atomic_boundary_required !== true ||
    contract.rollback_on_any_mutation_failure !== true ||
    contract.commit_only_after_all_mutations_succeed !== true ||
    contract.durable_replay_state_required !== true ||
    contract.partial_commit_forbidden !== true ||
    contract.retry_after_partial_failure_forbidden !== true ||
    contract.execution_start_forbidden !== true ||
    contract.external_network_forbidden !== true
  ) return blocked('transaction_contract_guarantees_required');

  const adapter = input.durable_store_adapter || {};
  if (
    adapter.kind !== 'durable_transactional_store' ||
    adapter.durable !== true ||
    adapter.shared_across_runtime_instances !== true ||
    adapter.production_backed !== true ||
    !Array.isArray(adapter.capabilities) ||
    REQUIRED_CAPABILITIES.some((capability) => !adapter.capabilities.includes(capability))
  ) return blocked('durable_transactional_store_capabilities_required');

  if (input.production_allowed !== false) return blocked('production_must_remain_blocked');
  if (
    input.begin_transaction === true ||
    input.write_state === true ||
    input.commit_transaction === true ||
    input.consume_resources === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return blocked('state_mutation_forbidden_in_readiness_layer');

  if (
    input.provider_invoked === true ||
    input.transport_invoked === true ||
    input.external_network_called === true
  ) return blocked('network_activity_forbidden');

  const stateContract = Object.freeze({
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    store_kind: adapter.kind,
    required_capabilities: REQUIRED_CAPABILITIES,
    atomic_compare_and_set_required: true,
    transactional_rollback_required: true,
    durable_replay_protection_required: true,
    unique_resource_constraints_required: true,
    shared_across_runtime_instances_required: true,
    production_backed_store_required: true,
    mutation_in_this_layer: false,
    execution_in_this_layer: false,
    external_network_in_this_layer: false
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_DURABLE_ATOMIC_RESOURCE_STATE_READY_NOT_WRITTEN_NOT_EXECUTED',
    trial_id: input.trial_id,
    durable_state_contract: stateContract,
    durable_state_ready: true,
    transaction_started: false,
    state_written: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'IMPLEMENT_ATOMIC_RESOURCE_TRANSACTION_AND_EXECUTION_RESERVATION',
    version: VERSION
  });
}

module.exports = {
  REQUIRED_CAPABILITIES,
  VERSION,
  preparePublicWebThirdCanaryDurableAtomicResourceState
};

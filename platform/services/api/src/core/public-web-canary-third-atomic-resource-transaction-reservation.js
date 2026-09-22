'use strict';

const VERSION = 'public_web_third_canary_atomic_resource_transaction_reservation_v1';

function blocked(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_RESERVATION_BLOCKED',
    reason,
    transaction_plan_ready: false,
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

function preparePublicWebThirdCanaryAtomicResourceTransactionReservation(input = {}) {
  const prior = input.durable_atomic_resource_state || {};
  const contract = prior.durable_state_contract || {};
  const ids = ['trial_id', 'official_authorization_id', 'preparatory_authorization_id', 'grant_id', 'reservation_id'];

  if (
    prior.ok !== true ||
    prior.status !== 'THIRD_CANARY_DURABLE_ATOMIC_RESOURCE_STATE_READY_NOT_WRITTEN_NOT_EXECUTED' ||
    prior.durable_state_ready !== true ||
    prior.transaction_started !== false ||
    prior.state_written !== false ||
    prior.resources_consumed !== false ||
    prior.execution_reserved !== false ||
    prior.execution_started !== false ||
    prior.external_network_called !== false
  ) return blocked('durable_atomic_resource_state_required');

  for (const id of ids) {
    if (!input[id] || contract[id] !== input[id]) return blocked('resource_identity_mismatch');
  }

  if (
    contract.atomic_compare_and_set_required !== true ||
    contract.transactional_rollback_required !== true ||
    contract.durable_replay_protection_required !== true ||
    contract.unique_resource_constraints_required !== true ||
    contract.shared_across_runtime_instances_required !== true ||
    contract.production_backed_store_required !== true ||
    contract.mutation_in_this_layer !== false ||
    contract.execution_in_this_layer !== false ||
    contract.external_network_in_this_layer !== false
  ) return blocked('durable_state_guarantees_required');

  if (input.production_allowed !== false) return blocked('production_must_remain_blocked');

  if (
    input.transaction_client != null ||
    input.authorization_registry != null ||
    input.grant_registry != null ||
    input.reservation_registry != null ||
    input.begin_transaction === true ||
    input.write_state === true ||
    input.commit_transaction === true ||
    input.consume_authorization === true ||
    input.consume_grant === true ||
    input.consume_reservation === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return blocked('mutation_forbidden_in_transaction_plan_layer');

  if (
    input.provider_invoked === true ||
    input.transport_invoked === true ||
    input.external_network_called === true
  ) return blocked('network_activity_forbidden');

  const transactionPlan = Object.freeze({
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    preconditions: Object.freeze([
      'ALL_RESOURCE_IDENTITIES_MATCH',
      'ALL_SINGLE_USE_RESOURCES_CURRENTLY_UNUSED',
      'ALL_RESOURCE_EXPIRIES_VALID',
      'DURABLE_REPLAY_STATE_AVAILABLE'
    ]),
    atomic_mutations: Object.freeze([
      'MARK_OFFICIAL_AUTHORIZATION_CONSUMED',
      'MARK_GRANT_CONSUMED',
      'MARK_RESERVATION_EXECUTION_RESERVED',
      'WRITE_DURABLE_REPLAY_COMMIT'
    ]),
    commit_condition: 'ALL_ATOMIC_MUTATIONS_SUCCEEDED',
    rollback_condition: 'ANY_ATOMIC_MUTATION_FAILED',
    replay_result: 'FAIL_CLOSED_ALREADY_CONSUMED_OR_RESERVED',
    execution_after_commit: false,
    external_network_after_commit: false
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_RESERVATION_PLAN_READY_NOT_COMMITTED_NOT_EXECUTED',
    trial_id: input.trial_id,
    atomic_resource_transaction_plan: transactionPlan,
    transaction_plan_ready: true,
    transaction_started: false,
    state_written: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'IMPLEMENT_ATOMIC_RESOURCE_TRANSACTION_COMMIT',
    version: VERSION
  });
}

module.exports = {
  VERSION,
  preparePublicWebThirdCanaryAtomicResourceTransactionReservation
};

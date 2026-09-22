'use strict';

const THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_VERSION =
  'public_web_third_canary_single_use_transaction_contract_v1';

const REQUIRED_STEPS = Object.freeze([
  'VALIDATE_ALL_SINGLE_USE_RESOURCES',
  'BEGIN_ATOMIC_BOUNDARY',
  'CONSUME_OFFICIAL_AUTHORIZATION',
  'CONSUME_GRANT',
  'RESERVE_RESERVATION_FOR_EXECUTION',
  'COMMIT_ATOMIC_BOUNDARY'
]);

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_BLOCKED',
    reason,
    transaction_contract_ready: false,
    transaction_started: false,
    official_authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_VERSION
  });
}

function preparePublicWebThirdCanarySingleUseTransactionContract(input = {}) {
  const gate = input.atomic_resource_gate || {};
  if (
    gate.ok !== true ||
    gate.status !== 'THIRD_CANARY_ATOMIC_RESOURCE_GATE_READY_NOT_CONSUMED_NOT_RESERVED_NOT_EXECUTED' ||
    gate.official_authorization_consumed !== false ||
    gate.grant_consumed !== false ||
    gate.reservation_consumed !== false ||
    gate.execution_reserved !== false ||
    gate.execution_started !== false
  ) return fail('atomic_resource_gate_required');

  const plan = gate.atomic_resource_plan || {};
  if (
    !input.trial_id ||
    gate.trial_id !== input.trial_id ||
    plan.trial_id !== input.trial_id ||
    plan.official_authorization_id !== input.official_authorization_id ||
    plan.preparatory_authorization_id !== input.preparatory_authorization_id ||
    plan.grant_id !== input.grant_id ||
    plan.reservation_id !== input.reservation_id
  ) return fail('atomic_resource_identity_mismatch');

  if (
    !Array.isArray(plan.required_order) ||
    plan.required_order.length !== REQUIRED_STEPS.length ||
    plan.required_order.some((step, index) => step !== REQUIRED_STEPS[index]) ||
    plan.rollback_required_on_any_failure !== true ||
    plan.same_runtime_registry_lifecycle_required !== true ||
    plan.durable_replay_state_required_before_external_execution !== true ||
    plan.start_execution_in_this_gate !== false ||
    plan.external_network_in_this_gate !== false
  ) return fail('atomic_resource_plan_contract_mismatch');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (
    input.begin_transaction === true ||
    input.commit_transaction === true ||
    input.rollback_transaction === true ||
    input.consume_authorization === true ||
    input.consume_grant === true ||
    input.consume_reservation === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return fail('transaction_mutation_forbidden_in_contract_layer');

  if (
    input.authorization_registry != null ||
    input.grant_registry != null ||
    input.reservation_registry != null ||
    input.persistence_client != null
  ) return fail('mutable_dependency_forbidden_in_contract_layer');

  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  const transactionContract = Object.freeze({
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    required_steps: REQUIRED_STEPS,
    prevalidate_all_before_begin: true,
    single_atomic_boundary_required: true,
    rollback_on_any_mutation_failure: true,
    commit_only_after_all_mutations_succeed: true,
    durable_replay_state_required: true,
    same_runtime_registry_lifecycle_required: true,
    partial_commit_forbidden: true,
    retry_after_partial_failure_forbidden: true,
    execution_start_forbidden: true,
    external_network_forbidden: true
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_READY_NOT_STARTED_NOT_EXECUTED',
    trial_id: input.trial_id,
    transaction_contract: transactionContract,
    transaction_contract_ready: true,
    transaction_started: false,
    official_authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'IMPLEMENT_DURABLE_ATOMIC_SINGLE_USE_RESOURCE_STATE',
    version: THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_VERSION
  });
}

module.exports = {
  REQUIRED_STEPS,
  THIRD_CANARY_SINGLE_USE_TRANSACTION_CONTRACT_VERSION,
  preparePublicWebThirdCanarySingleUseTransactionContract
};

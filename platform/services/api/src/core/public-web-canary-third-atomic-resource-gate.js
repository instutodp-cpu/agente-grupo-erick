'use strict';

const THIRD_CANARY_ATOMIC_RESOURCE_GATE_VERSION =
  'public_web_third_canary_atomic_resource_gate_v1';

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_GATE_BLOCKED',
    reason,
    official_authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_ATOMIC_RESOURCE_GATE_VERSION
  });
}

function preparePublicWebThirdCanaryAtomicResourceGate(input = {}, options = {}) {
  const issuance = input.official_authorization_issuance || {};
  if (
    issuance.ok !== true ||
    issuance.status !== 'THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED' ||
    issuance.official_execution_authorization_issued !== true ||
    issuance.authorization_consumed !== false ||
    issuance.grant_consumed !== false ||
    issuance.reservation_consumed !== false ||
    issuance.execution_reserved !== false ||
    issuance.execution_started !== false
  ) return fail('official_authorization_issuance_required');

  const auth = issuance.official_execution_authorization || {};
  if (
    !input.trial_id ||
    issuance.trial_id !== input.trial_id ||
    issuance.preparatory_authorization_id !== input.preparatory_authorization_id ||
    issuance.grant_id !== input.grant_id ||
    issuance.reservation_id !== input.reservation_id ||
    auth.trial_id !== input.trial_id ||
    !auth.authorization_id ||
    auth.used !== false ||
    auth.environment !== 'staging'
  ) return fail('single_use_resource_binding_mismatch');

  const now = Date.parse(String(typeof options.clock === 'function' ? options.clock() : new Date(0).toISOString()));
  const expiresAt = Date.parse(String(auth.expires_at || ''));
  if (!Number.isFinite(now) || !Number.isFinite(expiresAt) || expiresAt <= now || expiresAt - now > 120000) {
    return fail('official_authorization_must_be_fresh');
  }

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (
    input.consume_authorization === true ||
    input.consume_grant === true ||
    input.consume_reservation === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return fail('resource_mutation_forbidden_in_preparation_gate');
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  if (
    options.authorization_registry != null ||
    options.grant_registry != null ||
    options.reservation_registry != null
  ) return fail('mutable_registry_access_forbidden_in_preparation_gate');

  const atomicPlan = Object.freeze({
    trial_id: input.trial_id,
    official_authorization_id: auth.authorization_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    required_order: Object.freeze([
      'VALIDATE_ALL_SINGLE_USE_RESOURCES',
      'BEGIN_ATOMIC_BOUNDARY',
      'CONSUME_OFFICIAL_AUTHORIZATION',
      'CONSUME_GRANT',
      'RESERVE_RESERVATION_FOR_EXECUTION',
      'COMMIT_ATOMIC_BOUNDARY'
    ]),
    rollback_required_on_any_failure: true,
    same_runtime_registry_lifecycle_required: true,
    durable_replay_state_required_before_external_execution: true,
    start_execution_in_this_gate: false,
    external_network_in_this_gate: false
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_GATE_READY_NOT_CONSUMED_NOT_RESERVED_NOT_EXECUTED',
    trial_id: input.trial_id,
    atomic_resource_plan: atomicPlan,
    official_authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'IMPLEMENT_ATOMIC_SINGLE_USE_RESOURCE_TRANSACTION',
    version: THIRD_CANARY_ATOMIC_RESOURCE_GATE_VERSION
  });
}

module.exports = {
  THIRD_CANARY_ATOMIC_RESOURCE_GATE_VERSION,
  preparePublicWebThirdCanaryAtomicResourceGate
};

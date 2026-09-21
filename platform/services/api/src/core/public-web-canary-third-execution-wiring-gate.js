'use strict';

const EXECUTION_WIRING_GATE_VERSION = 'public_web_third_canary_execution_wiring_gate_v1';

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_EXECUTION_WIRING_BLOCKED',
    reason,
    wiring_ready: false,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: EXECUTION_WIRING_GATE_VERSION
  });
}

function preparePublicWebThirdCanaryExecutionWiring(input = {}) {
  const step = input.reservation_materialization || {};
  if (step.ok !== true || step.status !== 'THIRD_CANARY_RESERVATION_MATERIALIZED_NOT_RESERVED_FOR_EXECUTION') {
    return fail('reservation_materialization_required');
  }
  const reservation = step.reservation || {};
  if (
    !input.trial_id ||
    step.trial_id !== input.trial_id ||
    reservation.trial_id !== input.trial_id ||
    reservation.authorization_id !== input.authorization_id ||
    reservation.grant_id !== input.grant_id ||
    reservation.reservation_id !== input.reservation_id
  ) return fail('resource_binding_mismatch');

  if (
    reservation.environment !== 'staging' ||
    reservation.target_origin !== 'https://example.com' ||
    reservation.target_path !== '/' ||
    reservation.method !== 'GET' ||
    reservation.port !== 443 ||
    reservation.maximum_requests !== 1 ||
    reservation.rollout_percentage !== 1 ||
    reservation.single_use !== true ||
    reservation.used !== false ||
    reservation.execution_reserved !== false
  ) return fail('approved_reservation_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.explicit_human_execution_authorized === true || input.human_authorized === true) {
    return fail('human_execution_authorization_belongs_to_next_gate');
  }
  if (
    input.issue_execution_authorization === true ||
    input.consume_authorization === true ||
    input.consume_grant === true ||
    input.consume_reservation === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return fail('runtime_action_forbidden');
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  const wiring = Object.freeze({
    trial_id: input.trial_id,
    authorization_id: input.authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    environment: 'staging',
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    execution_authorization_required: true,
    execution_reservation_required: true,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    state: 'ready_for_explicit_human_execution_authorization',
    version: 1,
    contract_version: EXECUTION_WIRING_GATE_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_EXECUTION_WIRING_READY_NOT_AUTHORIZED',
    trial_id: input.trial_id,
    wiring,
    wiring_ready: true,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_FOR_REAL_THIRD_CANARY_EXECUTION',
    version: EXECUTION_WIRING_GATE_VERSION
  });
}

module.exports = {
  EXECUTION_WIRING_GATE_VERSION,
  preparePublicWebThirdCanaryExecutionWiring
};

'use strict';

const THIRD_CANARY_OPERATIONAL_ADAPTER_VERSION = 'public_web_third_canary_operational_adapter_v1';

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_OPERATIONAL_ADAPTER_BLOCKED',
    reason,
    adapter_ready: false,
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
    version: THIRD_CANARY_OPERATIONAL_ADAPTER_VERSION
  });
}

function preparePublicWebThirdCanaryOperationalAdapter(input = {}) {
  const step = input.execution_wiring || {};
  if (step.ok !== true || step.status !== 'THIRD_CANARY_EXECUTION_WIRING_READY_NOT_AUTHORIZED') {
    return fail('execution_wiring_ready_required');
  }
  const wiring = step.wiring || {};
  if (
    !input.trial_id ||
    step.trial_id !== input.trial_id ||
    wiring.trial_id !== input.trial_id ||
    wiring.authorization_id !== input.authorization_id ||
    wiring.grant_id !== input.grant_id ||
    wiring.reservation_id !== input.reservation_id
  ) return fail('execution_wiring_binding_mismatch');

  if (
    wiring.environment !== 'staging' ||
    wiring.target_origin !== 'https://example.com' ||
    wiring.target_path !== '/' ||
    wiring.method !== 'GET' ||
    wiring.port !== 443 ||
    wiring.maximum_requests !== 1 ||
    wiring.rollout_percentage !== 1 ||
    wiring.execution_authorization_required !== true ||
    wiring.execution_reservation_required !== true ||
    wiring.execution_authorized !== false ||
    wiring.execution_reserved !== false ||
    wiring.execution_started !== false
  ) return fail('approved_execution_wiring_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.explicit_human_execution_authorized === true || input.human_authorized === true) {
    return fail('human_execution_authorization_forbidden_in_offline_adapter');
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

  const adapter = Object.freeze({
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
    state: 'offline_adapter_ready_for_separate_human_authorization_layer',
    contract_version: THIRD_CANARY_OPERATIONAL_ADAPTER_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_OPERATIONAL_ADAPTER_READY_OFFLINE_NOT_AUTHORIZED',
    trial_id: input.trial_id,
    adapter,
    adapter_ready: true,
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
    next_gate: 'SEPARATE_EXPLICIT_HUMAN_EXECUTION_AUTHORIZATION_LAYER',
    version: THIRD_CANARY_OPERATIONAL_ADAPTER_VERSION
  });
}

module.exports = {
  THIRD_CANARY_OPERATIONAL_ADAPTER_VERSION,
  preparePublicWebThirdCanaryOperationalAdapter
};

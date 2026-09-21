'use strict';

const THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_VERSION =
  'public_web_third_canary_execution_authorization_readiness_v1';

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_BLOCKED',
    reason,
    authorization_readiness: false,
    human_authorization_accepted: false,
    execution_authorization_issued: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_VERSION
  });
}

function preparePublicWebThirdCanaryExecutionAuthorizationReadiness(input = {}) {
  const step = input.operational_adapter || {};
  if (step.ok !== true || step.status !== 'THIRD_CANARY_OPERATIONAL_ADAPTER_READY_OFFLINE_NOT_AUTHORIZED') {
    return fail('operational_adapter_ready_required');
  }
  const adapter = step.adapter || {};
  if (
    !input.trial_id ||
    step.trial_id !== input.trial_id ||
    adapter.trial_id !== input.trial_id ||
    adapter.authorization_id !== input.authorization_id ||
    adapter.grant_id !== input.grant_id ||
    adapter.reservation_id !== input.reservation_id
  ) return fail('operational_adapter_binding_mismatch');

  if (
    adapter.environment !== 'staging' ||
    adapter.target_origin !== 'https://example.com' ||
    adapter.target_path !== '/' ||
    adapter.method !== 'GET' ||
    adapter.port !== 443 ||
    adapter.maximum_requests !== 1 ||
    adapter.rollout_percentage !== 1 ||
    adapter.execution_authorization_required !== true ||
    adapter.execution_reservation_required !== true ||
    adapter.execution_authorized !== false ||
    adapter.execution_reserved !== false ||
    adapter.execution_started !== false
  ) return fail('approved_operational_adapter_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');

  // This layer prepares the exact freshness requirements only. It deliberately
  // refuses the human confirmation itself so that reviewing/merging this PR
  // cannot authorize a real side effect.
  if (
    input.operator_confirmation != null ||
    input.explicit_human_execution_authorized === true ||
    input.human_authorized === true
  ) return fail('human_execution_authorization_belongs_to_next_gate');

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

  const requirements = Object.freeze({
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
    exact_human_confirmation_required: true,
    official_execution_authorization_required: true,
    maximum_execution_authorization_age_ms: 120000,
    fresh_grant_required: true,
    fresh_reservation_required: true,
    single_use_required: true,
    replay_forbidden: true,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    contract_version: THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_EXECUTION_AUTHORIZATION_REQUIREMENTS_READY_NOT_AUTHORIZED',
    trial_id: input.trial_id,
    requirements,
    authorization_readiness: true,
    human_authorization_accepted: false,
    execution_authorization_issued: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'FRESH_EXPLICIT_HUMAN_EXECUTION_AUTHORIZATION',
    version: THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_VERSION
  });
}

module.exports = {
  THIRD_CANARY_EXECUTION_AUTHORIZATION_READINESS_VERSION,
  preparePublicWebThirdCanaryExecutionAuthorizationReadiness
};

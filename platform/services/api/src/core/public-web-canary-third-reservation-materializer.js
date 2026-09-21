'use strict';

const RESERVATION_MATERIALIZER_VERSION = 'public_web_third_canary_reservation_materializer_v1';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_RESERVATION_MATERIALIZATION_BLOCKED',
    reason,
    reservation_materialized: false,
    grant_consumed: false,
    authorization_consumed: false,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: RESERVATION_MATERIALIZER_VERSION
  });
}

function materializePublicWebThirdCanaryReservation(input = {}) {
  const authStep = input.authorization_materialization || {};
  if (authStep.ok !== true || authStep.status !== 'THIRD_CANARY_AUTHORIZATION_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION') {
    return fail('authorization_materialization_required');
  }
  if (!isNonEmptyString(input.trial_id) || authStep.trial_id !== input.trial_id) return fail('trial_binding_mismatch');

  const authorization = authStep.authorization || {};
  if (!isNonEmptyString(authorization.authorization_id) || !isNonEmptyString(authorization.grant_id)) {
    return fail('authorization_bindings_required');
  }
  if (input.authorization_id !== authorization.authorization_id) return fail('authorization_binding_mismatch');
  if (input.grant_id !== authorization.grant_id) return fail('grant_binding_mismatch');
  if (!isNonEmptyString(input.reservation_candidate_id)) return fail('reservation_candidate_id_required');

  if (
    authorization.trial_id !== input.trial_id ||
    authorization.environment !== 'staging' ||
    authorization.target_origin !== 'https://example.com' ||
    authorization.target_path !== '/' ||
    authorization.method !== 'GET' ||
    authorization.port !== 443 ||
    authorization.maximum_requests !== 1 ||
    authorization.rollout_percentage !== 1 ||
    authorization.single_use !== true ||
    authorization.used !== false ||
    authorization.execution_authorized !== false
  ) return fail('approved_authorization_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.explicit_human_execution_authorized === true || input.human_authorized === true) {
    return fail('execution_authority_forbidden_during_reservation_materialization');
  }
  if (input.execute === true || input.start === true || input.consume === true || input.reserve_execution === true) {
    return fail('execution_action_forbidden');
  }
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  const reservation = Object.freeze({
    reservation_id: input.reservation_candidate_id,
    trial_id: input.trial_id,
    authorization_id: input.authorization_id,
    grant_id: input.grant_id,
    environment: 'staging',
    target_origin: 'https://example.com',
    target_path: '/',
    method: 'GET',
    port: 443,
    maximum_requests: 1,
    rollout_percentage: 1,
    single_use: true,
    used: false,
    execution_reserved: false,
    state: 'materialized_pending_explicit_human_execution_authorization',
    version: 1,
    contract_version: RESERVATION_MATERIALIZER_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_RESERVATION_MATERIALIZED_NOT_RESERVED_FOR_EXECUTION',
    trial_id: input.trial_id,
    reservation,
    reservation_materialized: true,
    grant_consumed: false,
    authorization_consumed: false,
    execution_authorized: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_BEFORE_EXECUTION_WIRING',
    version: RESERVATION_MATERIALIZER_VERSION
  });
}

module.exports = {
  RESERVATION_MATERIALIZER_VERSION,
  materializePublicWebThirdCanaryReservation
};

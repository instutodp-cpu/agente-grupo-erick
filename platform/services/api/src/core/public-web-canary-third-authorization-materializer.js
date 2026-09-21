'use strict';

const AUTHORIZATION_MATERIALIZER_VERSION = 'public_web_third_canary_authorization_materializer_v1';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_AUTHORIZATION_MATERIALIZATION_BLOCKED',
    reason,
    authorization_materialized: false,
    grant_consumed: false,
    reservation_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: AUTHORIZATION_MATERIALIZER_VERSION
  });
}

function materializePublicWebThirdCanaryAuthorization(input = {}) {
  const grantStep = input.grant_materialization || {};
  if (grantStep.ok !== true || grantStep.status !== 'THIRD_CANARY_GRANT_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION') {
    return fail('grant_materialization_required');
  }
  if (!isNonEmptyString(input.trial_id) || grantStep.trial_id !== input.trial_id) return fail('trial_binding_mismatch');

  const grant = grantStep.grant || {};
  if (!isNonEmptyString(grant.grant_id) || !isNonEmptyString(grant.authorization_candidate_id)) {
    return fail('grant_candidate_bindings_required');
  }
  if (input.authorization_candidate_id !== grant.authorization_candidate_id) {
    return fail('authorization_candidate_binding_mismatch');
  }
  if (input.grant_id !== grant.grant_id) return fail('grant_binding_mismatch');
  if (
    grant.trial_id !== input.trial_id ||
    grant.environment !== 'staging' ||
    grant.target_origin !== 'https://example.com' ||
    grant.target_path !== '/' ||
    grant.method !== 'GET' ||
    grant.port !== 443 ||
    grant.maximum_requests !== 1 ||
    grant.rollout_percentage !== 1 ||
    grant.single_use !== true ||
    grant.used !== false ||
    grant.revoked !== false
  ) return fail('approved_grant_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.explicit_human_execution_authorized === true || input.human_authorized === true) {
    return fail('execution_authority_forbidden_during_authorization_materialization');
  }
  if (input.execute === true || input.start === true || input.consume === true || input.reserve === true) {
    return fail('execution_action_forbidden');
  }
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  const authorization = Object.freeze({
    authorization_id: input.authorization_candidate_id,
    trial_id: input.trial_id,
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
    execution_authorized: false,
    state: 'materialized_pending_explicit_human_execution_authorization',
    version: 1,
    contract_version: AUTHORIZATION_MATERIALIZER_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_AUTHORIZATION_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION',
    trial_id: input.trial_id,
    authorization,
    authorization_materialized: true,
    grant_consumed: false,
    reservation_materialized: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'SEPARATE_RESERVATION_MATERIALIZATION_LAYER',
    version: AUTHORIZATION_MATERIALIZER_VERSION
  });
}

module.exports = {
  AUTHORIZATION_MATERIALIZER_VERSION,
  materializePublicWebThirdCanaryAuthorization
};

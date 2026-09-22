'use strict';

const THIRD_CANARY_HUMAN_AUTHORIZATION_GATE_VERSION =
  'public_web_third_canary_human_authorization_gate_v1';
const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';
const MAX_AUTHORIZATION_AGE_MS = 120000;

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_HUMAN_AUTHORIZATION_BLOCKED',
    reason,
    human_authorization_accepted: false,
    execution_authorization_issued: false,
    execution_authorized: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_HUMAN_AUTHORIZATION_GATE_VERSION
  });
}

function preparePublicWebThirdCanaryHumanAuthorization(input = {}, options = {}) {
  const step = input.authorization_readiness || {};
  if (
    step.ok !== true ||
    step.status !== 'THIRD_CANARY_EXECUTION_AUTHORIZATION_REQUIREMENTS_READY_NOT_AUTHORIZED'
  ) return fail('execution_authorization_readiness_required');

  const requirements = step.requirements || {};
  if (
    !input.trial_id ||
    step.trial_id !== input.trial_id ||
    requirements.trial_id !== input.trial_id ||
    requirements.authorization_id !== input.authorization_id ||
    requirements.grant_id !== input.grant_id ||
    requirements.reservation_id !== input.reservation_id
  ) return fail('authorization_readiness_binding_mismatch');

  if (
    requirements.environment !== 'staging' ||
    requirements.target_origin !== 'https://example.com' ||
    requirements.target_path !== '/' ||
    requirements.method !== 'GET' ||
    requirements.port !== 443 ||
    requirements.maximum_requests !== 1 ||
    requirements.rollout_percentage !== 1 ||
    requirements.exact_human_confirmation_required !== true ||
    requirements.official_execution_authorization_required !== true ||
    requirements.maximum_execution_authorization_age_ms !== MAX_AUTHORIZATION_AGE_MS ||
    requirements.fresh_grant_required !== true ||
    requirements.fresh_reservation_required !== true ||
    requirements.single_use_required !== true ||
    requirements.replay_forbidden !== true ||
    requirements.execution_authorized !== false ||
    requirements.execution_reserved !== false ||
    requirements.execution_started !== false
  ) return fail('approved_authorization_requirements_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.operator_confirmation !== REQUIRED_CONFIRMATION) return fail('exact_human_confirmation_required');

  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const now = Date.parse(String(clock()));
  const authorizedAt = Date.parse(String(input.authorized_at || ''));
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(authorizedAt) ||
    authorizedAt > now ||
    now - authorizedAt > MAX_AUTHORIZATION_AGE_MS
  ) return fail('human_authorization_freshness_required');

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

  const authorizationIntent = Object.freeze({
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
    authorized_at: new Date(authorizedAt).toISOString(),
    maximum_age_ms: MAX_AUTHORIZATION_AGE_MS,
    single_use: true,
    used: false,
    official_execution_authorization_issued: false,
    execution_reserved: false,
    execution_started: false,
    contract_version: THIRD_CANARY_HUMAN_AUTHORIZATION_GATE_VERSION
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_HUMAN_AUTHORIZATION_ACCEPTED_NOT_ISSUED_NOT_EXECUTED',
    trial_id: input.trial_id,
    authorization_intent: authorizationIntent,
    human_authorization_accepted: true,
    execution_authorization_issued: false,
    execution_authorized: false,
    grant_consumed: false,
    authorization_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'ISSUE_FRESH_OFFICIAL_EXECUTION_AUTHORIZATION_WITHOUT_EXECUTION',
    version: THIRD_CANARY_HUMAN_AUTHORIZATION_GATE_VERSION
  });
}

module.exports = {
  MAX_AUTHORIZATION_AGE_MS,
  REQUIRED_CONFIRMATION,
  THIRD_CANARY_HUMAN_AUTHORIZATION_GATE_VERSION,
  preparePublicWebThirdCanaryHumanAuthorization
};

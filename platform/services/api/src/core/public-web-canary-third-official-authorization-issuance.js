'use strict';

const {
  createPublicWebCanaryTrialExecutionAuthorization
} = require('./public-web-canary-trial-execution-authorization');

const THIRD_CANARY_OFFICIAL_AUTHORIZATION_ISSUANCE_VERSION =
  'public_web_third_canary_official_authorization_issuance_v1';
const REQUIRED_CONFIRMATION = 'EXECUTAR CANARY PUBLIC WEB';
const MAX_AGE_MS = 120000;

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_OFFICIAL_AUTHORIZATION_ISSUANCE_BLOCKED',
    reason,
    official_execution_authorization_issued: false,
    execution_authorized: false,
    authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: THIRD_CANARY_OFFICIAL_AUTHORIZATION_ISSUANCE_VERSION
  });
}

function issuePublicWebThirdCanaryOfficialAuthorization(input = {}, options = {}) {
  const step = input.runtime_authorization_bindings || {};
  if (
    step.ok !== true ||
    step.status !== 'THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_READY_NOT_ISSUED_NOT_EXECUTED' ||
    step.official_execution_authorization_issued !== false ||
    step.execution_authorized !== false
  ) return fail('runtime_authorization_bindings_required');

  if (
    !input.trial_id ||
    step.trial_id !== input.trial_id ||
    step.preparatory_authorization_id !== input.preparatory_authorization_id ||
    step.grant_id !== input.grant_id ||
    step.reservation_id !== input.reservation_id
  ) return fail('runtime_authorization_binding_mismatch');

  const prepared = step.official_authorization_input || {};
  const trial = prepared.trial || {};
  if (
    trial.trial_id !== input.trial_id ||
    trial.environment !== 'staging' ||
    trial.target_origin !== 'https://example.com' ||
    !trial.canary_session_id ||
    !trial.plan_hash ||
    !trial.target_path_hash ||
    !trial.operation ||
    !prepared.preflight_evidence_hash ||
    !prepared.dry_run_evidence_hash ||
    prepared.maximum_authorization_age_ms !== MAX_AGE_MS
  ) return fail('approved_official_authorization_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.operator_confirmation !== REQUIRED_CONFIRMATION) return fail('fresh_exact_human_confirmation_required');

  if (
    input.consume_authorization === true ||
    input.consume_grant === true ||
    input.consume_reservation === true ||
    input.reserve_execution === true ||
    input.start_execution === true ||
    input.execute === true
  ) return fail('execution_action_forbidden_during_issuance');

  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden');
  }

  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const now = Date.parse(String(clock()));
  const confirmedAt = Date.parse(String(input.confirmed_at || ''));
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(confirmedAt) ||
    confirmedAt > now ||
    now - confirmedAt > MAX_AGE_MS
  ) return fail('fresh_human_confirmation_timestamp_required');

  const expiresAt = new Date(now + MAX_AGE_MS).toISOString();
  const registry = options.authorization_registry ||
    createPublicWebCanaryTrialExecutionAuthorization({ clock });
  if (!registry || typeof registry.issueAuthorization !== 'function') {
    return fail('official_authorization_registry_required');
  }

  const issued = registry.issueAuthorization({
    ...prepared,
    operator_confirmation: input.operator_confirmation,
    expires_at: expiresAt
  });
  if (!issued || issued.ok !== true || issued.authorized !== true || !issued.authorization) {
    return fail('official_execution_authorization_issue_failed');
  }

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED',
    trial_id: input.trial_id,
    preparatory_authorization_id: input.preparatory_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    official_execution_authorization: Object.freeze({ ...issued.authorization }),
    official_execution_authorization_issued: true,
    execution_authorized: false,
    authorization_consumed: false,
    grant_consumed: false,
    reservation_consumed: false,
    execution_reserved: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    next_gate: 'ATOMIC_SINGLE_USE_RESOURCE_CONSUMPTION_AND_EXECUTION_RESERVATION',
    version: THIRD_CANARY_OFFICIAL_AUTHORIZATION_ISSUANCE_VERSION
  });
}

module.exports = {
  MAX_AGE_MS,
  REQUIRED_CONFIRMATION,
  THIRD_CANARY_OFFICIAL_AUTHORIZATION_ISSUANCE_VERSION,
  issuePublicWebThirdCanaryOfficialAuthorization
};

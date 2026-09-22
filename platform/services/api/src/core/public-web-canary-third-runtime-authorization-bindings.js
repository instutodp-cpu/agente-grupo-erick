'use strict';

const THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_VERSION =
  'public_web_third_canary_runtime_authorization_bindings_v1';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_BLOCKED',
    reason,
    official_execution_authorization_issued: false,
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
    version: THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_VERSION
  });
}

function preparePublicWebThirdCanaryRuntimeAuthorizationBindings(input = {}, options = {}) {
  const step = input.human_authorization_gate || {};
  if (
    step.ok !== true ||
    step.status !== 'THIRD_CANARY_HUMAN_AUTHORIZATION_ACCEPTED_NOT_ISSUED_NOT_EXECUTED' ||
    step.human_authorization_accepted !== true ||
    step.execution_authorization_issued !== false ||
    step.execution_authorized !== false
  ) return fail('fresh_human_authorization_gate_required');

  const intent = step.authorization_intent || {};
  if (
    !nonEmpty(input.trial_id) ||
    step.trial_id !== input.trial_id ||
    intent.trial_id !== input.trial_id ||
    intent.authorization_id !== input.authorization_id ||
    intent.grant_id !== input.grant_id ||
    intent.reservation_id !== input.reservation_id
  ) return fail('human_authorization_binding_mismatch');

  if (
    intent.environment !== 'staging' ||
    intent.target_origin !== 'https://example.com' ||
    intent.target_path !== '/' ||
    intent.method !== 'GET' ||
    intent.port !== 443 ||
    intent.maximum_requests !== 1 ||
    intent.rollout_percentage !== 1 ||
    intent.maximum_age_ms !== 120000 ||
    intent.single_use !== true ||
    intent.used !== false ||
    intent.official_execution_authorization_issued !== false ||
    intent.execution_reserved !== false ||
    intent.execution_started !== false
  ) return fail('approved_human_authorization_scope_required');

  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const now = Date.parse(String(clock()));
  const authorizedAt = Date.parse(String(intent.authorized_at || ''));
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(authorizedAt) ||
    authorizedAt > now ||
    now - authorizedAt > 120000
  ) return fail('human_authorization_expired');

  const runtime = input.runtime_bindings || {};
  const requiredStrings = [
    'canary_session_id',
    'plan_hash',
    'preflight_evidence_hash',
    'dry_run_evidence_hash',
    'target_path_hash',
    'operation',
    'canary_session_version',
    'target_policy_version',
    'lifecycle_version',
    'configuration_version',
    'readiness_evidence_id'
  ];
  if (requiredStrings.some((key) => !nonEmpty(runtime[key]))) {
    return fail('complete_runtime_authorization_bindings_required');
  }
  if (
    runtime.trial_id !== input.trial_id ||
    runtime.environment !== 'staging' ||
    runtime.target_origin !== 'https://example.com' ||
    runtime.target_path !== '/'
  ) return fail('runtime_authorization_scope_mismatch');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
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

  const officialAuthorizationInput = Object.freeze({
    trial: Object.freeze({
      trial_id: input.trial_id,
      canary_session_id: runtime.canary_session_id,
      plan_hash: runtime.plan_hash,
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path_hash: runtime.target_path_hash,
      operation: runtime.operation,
      canary_session_version: runtime.canary_session_version,
      target_policy_version: runtime.target_policy_version,
      lifecycle_version: runtime.lifecycle_version,
      configuration_version: runtime.configuration_version,
      readiness_evidence_id: runtime.readiness_evidence_id
    }),
    preflight_evidence_hash: runtime.preflight_evidence_hash,
    dry_run_evidence_hash: runtime.dry_run_evidence_hash,
    canary_session_version: runtime.canary_session_version,
    target_policy_version: runtime.target_policy_version,
    lifecycle_version: runtime.lifecycle_version,
    configuration_version: runtime.configuration_version,
    readiness_evidence_id: runtime.readiness_evidence_id,
    maximum_authorization_age_ms: 120000
  });

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_READY_NOT_ISSUED_NOT_EXECUTED',
    trial_id: input.trial_id,
    preparatory_authorization_id: input.authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    official_authorization_input: officialAuthorizationInput,
    official_execution_authorization_issued: false,
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
    next_gate: 'ISSUE_FRESH_OFFICIAL_EXECUTION_AUTHORIZATION',
    version: THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_VERSION
  });
}

module.exports = {
  THIRD_CANARY_RUNTIME_AUTHORIZATION_BINDINGS_VERSION,
  preparePublicWebThirdCanaryRuntimeAuthorizationBindings
};

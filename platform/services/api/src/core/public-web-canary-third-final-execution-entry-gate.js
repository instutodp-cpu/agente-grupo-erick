'use strict';

const FINAL_EXECUTION_ENTRY_GATE_VERSION = 'public_web_third_canary_final_execution_entry_gate_v1';
const MAX_RESOURCE_AGE_MS = 120000;

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function fail(reason) {
  return Object.freeze({
    ok: false,
    status: 'THIRD_CANARY_FINAL_EXECUTION_ENTRY_BLOCKED',
    reason,
    execution_entry_ready: false,
    execution_authorized: false,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    version: FINAL_EXECUTION_ENTRY_GATE_VERSION
  });
}

function preparePublicWebThirdCanaryFinalExecutionEntry(input = {}, options = {}) {
  const step = input.atomic_commit || {};
  if (
    step.ok !== true ||
    step.status !== 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_COMMITTED_EXECUTION_RESERVED_NOT_EXECUTED' ||
    step.transaction_committed !== true ||
    step.resources_consumed !== true ||
    step.execution_reserved !== true ||
    step.execution_started !== false ||
    step.external_network_called !== false ||
    step.production_allowed !== false
  ) return fail('durable_atomic_resource_commit_required');

  if (
    !nonEmpty(input.trial_id) ||
    step.trial_id !== input.trial_id ||
    step.official_authorization_id !== input.official_authorization_id ||
    step.grant_id !== input.grant_id ||
    step.reservation_id !== input.reservation_id
  ) return fail('atomic_commit_binding_mismatch');

  const scope = input.execution_scope || {};
  if (
    scope.environment !== 'staging' ||
    scope.target_origin !== 'https://example.com' ||
    scope.target_path !== '/' ||
    scope.method !== 'GET' ||
    scope.port !== 443 ||
    scope.maximum_requests !== 1 ||
    scope.rollout_percentage !== 1
  ) return fail('approved_execution_scope_required');

  if (input.production_allowed !== false) return fail('production_must_remain_blocked');
  if (input.execute === true || input.start_execution === true) return fail('execution_action_forbidden_in_gate');
  if (input.provider_invoked === true || input.transport_invoked === true || input.external_network_called === true) {
    return fail('network_activity_forbidden_in_gate');
  }

  const official = input.official_execution_authorization || {};
  if (
    official.authorization_id !== input.official_authorization_id ||
    official.trial_id !== input.trial_id ||
    official.environment !== 'staging' ||
    official.used !== false
  ) return fail('fresh_official_authorization_evidence_required');

  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();
  const now = Date.parse(String(clock()));
  const expiresAt = Date.parse(String(official.expires_at || ''));
  const issuedAt = Date.parse(String(official.issued_at || official.created_at || ''));
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_RESOURCE_AGE_MS ||
    (Number.isFinite(issuedAt) && (issuedAt > now || now - issuedAt > MAX_RESOURCE_AGE_MS))
  ) return fail('official_authorization_not_fresh');

  return Object.freeze({
    ok: true,
    status: 'THIRD_CANARY_FINAL_EXECUTION_ENTRY_READY_NOT_STARTED',
    trial_id: input.trial_id,
    official_authorization_id: input.official_authorization_id,
    grant_id: input.grant_id,
    reservation_id: input.reservation_id,
    execution_scope: Object.freeze({
      environment: 'staging',
      target_origin: 'https://example.com',
      target_path: '/',
      method: 'GET',
      port: 443,
      maximum_requests: 1,
      rollout_percentage: 1
    }),
    execution_entry_ready: true,
    execution_authorized: true,
    execution_started: false,
    provider_invoked: false,
    transport_invoked: false,
    external_network_called: false,
    production_allowed: false,
    requires_fresh_explicit_human_execution_authorization_at_side_effect_boundary: true,
    required_confirmation: 'EXECUTAR CANARY PUBLIC WEB',
    next_gate: 'EXPLICIT_HUMAN_AUTHORIZATION_AT_REAL_EXECUTION_BOUNDARY',
    version: FINAL_EXECUTION_ENTRY_GATE_VERSION
  });
}

module.exports = {
  FINAL_EXECUTION_ENTRY_GATE_VERSION,
  MAX_RESOURCE_AGE_MS,
  preparePublicWebThirdCanaryFinalExecutionEntry
};

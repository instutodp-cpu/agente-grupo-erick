'use strict';

const {
  buildSafeTrialError,
  hashTrialEvidence,
  sanitizeTrialData
} = require('./public-web-canary-trial-contract');
const { hashValue } = require('./public-web-transport-contract');

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value));
}

function createPublicWebCanaryTrialExecutionAuthorization(options = {}) {
  const authorizations = new Map();
  const used = new Set();
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date(0).toISOString();

  function nowMs() {
    const value = clock();
    const parsed = Date.parse(value instanceof Date ? value.toISOString() : String(value));
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function fail(code, reason) {
    return {
      ok: false,
      authorized: false,
      used: false,
      error: buildSafeTrialError(code, reason),
      simulated: true,
      executed: false,
      real_provider_called: false,
      can_trigger_real_execution: false
    };
  }

  function issueAuthorization(input = {}) {
    const trial = input.trial || {};
    const confirmation = String(input.operator_confirmation || '');
    const now = nowMs();
    const expiresMs = Date.parse(input.expires_at || new Date(now + 120000).toISOString());
    if (!Number.isFinite(now) || !Number.isFinite(expiresMs) || expiresMs <= now || expiresMs - now > 120000) {
      return fail('TRIAL_AUTHORIZATION_BLOCKED', 'authorization_window_invalid');
    }
    if (confirmation !== 'EXECUTAR CANARY PUBLIC WEB') {
      return fail('TRIAL_CONFIRMATION_REQUIRED', 'operator_confirmation_required');
    }
    const authorization = Object.freeze(sanitizeTrialData({
      authorization_id: input.authorization_id || `trial_auth_${hashTrialEvidence({ trial_id: trial.trial_id, now }).slice(0, 24)}`,
      trial_id: trial.trial_id,
      canary_session_id: trial.canary_session_id,
      plan_hash: trial.plan_hash,
      preflight_evidence_hash: input.preflight_evidence_hash,
      dry_run_evidence_hash: input.dry_run_evidence_hash,
      operator_confirmation_hash: hashValue(confirmation),
      environment: trial.environment,
      target_origin_hash: hashValue(trial.target_origin),
      target_path_hash: trial.target_path_hash,
      operation: trial.operation,
      canary_session_version: input.canary_session_version,
      target_policy_version: input.target_policy_version,
      lifecycle_version: input.lifecycle_version,
      configuration_version: input.configuration_version,
      readiness_evidence_id: input.readiness_evidence_id,
      expires_at: new Date(expiresMs).toISOString(),
      used: false,
      version: 1
    }));
    authorizations.set(authorization.authorization_id, authorization);
    return { ok: true, authorized: true, authorization: clone(authorization) };
  }

  function consumeAuthorization(authorizationId, context = {}) {
    const authorization = typeof authorizationId === 'object' ? authorizationId : authorizations.get(authorizationId);
    if (!authorization || !authorization.authorization_id) return fail('TRIAL_AUTHORIZATION_BLOCKED', 'authorization_not_found');
    if (used.has(authorization.authorization_id) || authorization.used === true) return fail('TRIAL_REPLAY_DETECTED', 'authorization_replayed');
    const now = nowMs();
    if (!Number.isFinite(now) || Date.parse(authorization.expires_at) <= now) return fail('TRIAL_AUTHORIZATION_BLOCKED', 'authorization_expired');
    const trial = context.trial || {};
    if (
      trial.trial_id !== authorization.trial_id ||
      trial.canary_session_id !== authorization.canary_session_id ||
      trial.plan_hash !== authorization.plan_hash ||
      hashValue(trial.target_origin) !== authorization.target_origin_hash ||
      trial.target_path_hash !== authorization.target_path_hash ||
      trial.operation !== authorization.operation ||
      (authorization.canary_session_version != null && trial.canary_session_version !== authorization.canary_session_version) ||
      (authorization.target_policy_version != null && trial.target_policy_version !== authorization.target_policy_version) ||
      (authorization.lifecycle_version != null && trial.lifecycle_version !== authorization.lifecycle_version) ||
      (authorization.configuration_version != null && trial.configuration_version !== authorization.configuration_version) ||
      (authorization.readiness_evidence_id != null && trial.readiness_evidence_id !== authorization.readiness_evidence_id)
    ) {
      return fail('TRIAL_AUTHORIZATION_BLOCKED', 'authorization_scope_mismatch');
    }
    used.add(authorization.authorization_id);
    const next = Object.freeze({ ...authorization, used: true, version: authorization.version + 1 });
    authorizations.set(next.authorization_id, next);
    return { ok: true, authorized: true, authorization: clone(next) };
  }

  function revokeAuthorization(authorizationId) {
    if (authorizationId) used.add(authorizationId);
    return { ok: true, revoked: true };
  }

  function getAuthorization(authorizationId) {
    return clone(authorizations.get(authorizationId)) || null;
  }

  return Object.freeze({
    issueAuthorization,
    consumeAuthorization,
    revokeAuthorization,
    getAuthorization
  });
}

module.exports = {
  createPublicWebCanaryTrialExecutionAuthorization
};

'use strict';

const {
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  buildSafeTranscriptionError,
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionBlockedReason,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const TRANSCRIPTION_CANARY_SESSION_STATUSES = Object.freeze([
  'created',
  'preflight_passed',
  'authorized',
  'running_simulation',
  'completed',
  'blocked',
  'expired',
  'cancelled',
  'rolled_back',
  'cleaned_up'
]);

const TRANSCRIPTION_CANARY_TERMINAL_STATUSES = Object.freeze([
  'completed',
  'blocked',
  'expired',
  'cancelled',
  'rolled_back',
  'cleaned_up'
]);

const TRANSCRIPTION_CANARY_ALLOWED_OPERATIONS = Object.freeze([
  'simulate_transcription_canary',
  'evaluate_transcription_canary'
]);

const REQUIRED_SESSION_FIELDS = Object.freeze([
  'session_id',
  'session_version',
  'candidate_id',
  'readiness_evaluation_id',
  'transcription_id',
  'consent_id',
  'approval_id',
  'retention_policy_id',
  'budget_policy_id',
  'provider_id',
  'adapter_id',
  'connector_id',
  'configuration_id',
  'secret_reference_id',
  'tenant_id',
  'workspace_type',
  'environment',
  'requested_by',
  'approved_by',
  'requested_at',
  'starts_at',
  'expires_at',
  'session_status',
  'operation',
  'rollout_percentage',
  'simulated',
  'executed',
  'real_provider_called',
  'external_network_called',
  'can_trigger_real_execution',
  'production_blocked'
]);

const MAX_TRANSCRIPTION_CANARY_SESSION_MS = 15 * 60 * 1000;

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function nowIso(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : context.now;
  return value instanceof Date ? value.toISOString() : String(value || new Date(0).toISOString());
}

function nowMs(context = {}) {
  return Date.parse(nowIso(context));
}

function durationMs(session) {
  if (!isIso(session.starts_at) || !isIso(session.expires_at)) return NaN;
  return Date.parse(session.expires_at) - Date.parse(session.starts_at);
}

function isTranscriptionCanarySessionExpired(session, context = {}) {
  return isPlainObject(session) && isIso(session.expires_at) && Date.parse(session.expires_at) <= nowMs(context);
}

function validateSafetyFlags(record, errors) {
  if (record.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (record[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (record.production_blocked !== true) errors.push('production_blocked_must_be_true');
}

function validateTranscriptionCanarySession(session, context = {}) {
  const errors = [];
  if (!isPlainObject(session)) return { valid: false, errors: ['session_must_be_object'] };
  for (const field of REQUIRED_SESSION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(session, field)) errors.push(`missing_${field}`);
  }
  for (const field of [
    'session_id',
    'candidate_id',
    'readiness_evaluation_id',
    'transcription_id',
    'consent_id',
    'approval_id',
    'retention_policy_id',
    'budget_policy_id',
    'provider_id',
    'adapter_id',
    'connector_id',
    'configuration_id',
    'secret_reference_id',
    'tenant_id',
    'workspace_type',
    'environment',
    'requested_by',
    'approved_by',
    'requested_at',
    'starts_at',
    'expires_at',
    'session_status',
    'operation'
  ]) {
    if (!isNonEmptyString(session[field])) errors.push(`invalid_${field}`);
  }
  if (!Number.isInteger(session.session_version) || session.session_version < 1) errors.push('session_version_invalid');
  if (session.candidate_id !== TRANSCRIPTION_READINESS_CANDIDATE_ID) errors.push('candidate_id_mismatch');
  if (session.provider_id !== TRANSCRIPTION_PROVIDER_ID) errors.push('provider_id_mismatch');
  if (session.adapter_id !== TRANSCRIPTION_ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (session.connector_id !== TRANSCRIPTION_CONNECTOR_ID) errors.push('connector_id_mismatch');
  if (session.configuration_id !== TRANSCRIPTION_CONFIGURATION_ID) errors.push('configuration_id_mismatch');
  if (session.secret_reference_id !== TRANSCRIPTION_SECRET_REFERENCE_ID) errors.push('secret_reference_id_mismatch');
  if (!TRANSCRIPTION_CANARY_SESSION_STATUSES.includes(session.session_status)) errors.push('session_status_not_allowed');
  if (!TRANSCRIPTION_CANARY_ALLOWED_OPERATIONS.includes(session.operation)) errors.push(`operation_not_allowed::${session.operation}`);
  if (!['local_test', 'non_production'].includes(session.environment)) errors.push('environment_not_allowed');
  if (session.environment === 'production') errors.push('production_blocked');
  if (session.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (!isIso(session.requested_at)) errors.push('requested_at_invalid');
  if (!isIso(session.starts_at)) errors.push('starts_at_invalid');
  if (!isIso(session.expires_at)) errors.push('expires_at_invalid');
  const sessionDuration = durationMs(session);
  if (Number.isFinite(sessionDuration)) {
    if (sessionDuration <= 0) errors.push('session_expiration_window_invalid');
    if (sessionDuration > MAX_TRANSCRIPTION_CANARY_SESSION_MS) errors.push('session_duration_exceeds_limit');
  }
  if (isTranscriptionCanarySessionExpired(session, context)) errors.push('session_expired');
  validateSafetyFlags(session, errors);
  for (const field of ['candidate_id', 'transcription_id', 'tenant_id', 'workspace_type']) {
    if (context[field] && session[field] !== context[field]) errors.push(`${field}_mismatch`);
  }
  errors.push(...findTranscriptionForbiddenFields(session));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildTranscriptionCanaryAuditEvent(input = {}) {
  return sanitizeTranscriptionData({
    event_name: input.event_name || 'transcription_canary_event',
    session_id: input.session_id || input.session && input.session.session_id || 'session_not_available',
    session_version: Number.isInteger(input.session_version) ? input.session_version : input.session && input.session.session_version || 0,
    candidate_id: input.candidate_id || input.session && input.session.candidate_id || 'candidate_not_available',
    readiness_evaluation_id: input.readiness_evaluation_id || input.session && input.session.readiness_evaluation_id || 'readiness_not_available',
    transcription_id: input.transcription_id || input.session && input.session.transcription_id || 'transcription_not_available',
    tenant_id: input.tenant_id || input.session && input.session.tenant_id || 'tenant_not_available',
    workspace_type: input.workspace_type || input.session && input.session.workspace_type || 'workspace_not_available',
    status: input.status || input.session && input.session.session_status || 'status_not_available',
    decision: input.decision || null,
    transition_id: input.transition_id || null,
    blocked_reason: sanitizeTranscriptionBlockedReason(input.blocked_reason) || null,
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

function safeTranscriptionCanaryResponse(fields = {}) {
  const ok = fields.ok === true;
  const blockedReason = fields.blocked_reason || (ok ? null : 'transcription_canary_blocked');
  return sanitizeTranscriptionData({
    ok,
    allowed: fields.allowed === true,
    applied: fields.applied === true,
    status: fields.status || (ok ? 'transcription_canary_ok' : 'transcription_canary_blocked'),
    session: fields.session ? deepClone(fields.session) : null,
    audit_event_candidate: fields.audit_event_candidate || buildTranscriptionCanaryAuditEvent({
      session: fields.session,
      event_name: fields.event_name,
      status: fields.status,
      transition_id: fields.transition_id,
      blocked_reason: blockedReason,
      occurred_at: fields.occurred_at
    }),
    blocking_reasons: uniqueSorted(fields.blocking_reasons || (blockedReason ? [blockedReason] : [])),
    error: ok ? null : buildSafeTranscriptionError(fields.error_code || 'INVALID_ADAPTER_REQUEST', blockedReason),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    production_blocked: true
  });
}

function freezeSanitized(value) {
  return Object.freeze(sanitizeTranscriptionData(value));
}

module.exports = {
  MAX_TRANSCRIPTION_CANARY_SESSION_MS,
  REQUIRED_SESSION_FIELDS,
  TRANSCRIPTION_CANARY_ALLOWED_OPERATIONS,
  TRANSCRIPTION_CANARY_SESSION_STATUSES,
  TRANSCRIPTION_CANARY_TERMINAL_STATUSES,
  buildTranscriptionCanaryAuditEvent,
  durationMs,
  freezeSanitized,
  isIso,
  isTranscriptionCanarySessionExpired,
  nowIso,
  nowMs,
  safeTranscriptionCanaryResponse,
  validateSafetyFlags,
  validateTranscriptionCanarySession
};

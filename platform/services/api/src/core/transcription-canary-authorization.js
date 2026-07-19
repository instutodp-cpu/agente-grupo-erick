'use strict';

const {
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');
const {
  buildTranscriptionCanaryAuditEvent,
  isIso,
  nowIso,
  nowMs,
  safeTranscriptionCanaryResponse
} = require('./transcription-canary-session-contract');

const TRANSCRIPTION_CANARY_AUTHORIZATION_STATUSES = Object.freeze(['issued', 'consumed', 'revoked', 'expired']);
const TRANSCRIPTION_CANARY_AUTHORIZATION_OPERATION = 'simulate_transcription_canary';
const MAX_TRANSCRIPTION_CANARY_AUTHORIZATION_MS = 5 * 60 * 1000;
const REQUIRED_AUTHORIZATION_FIELDS = Object.freeze([
  'authorization_id',
  'session_id',
  'candidate_id',
  'tenant_id',
  'requested_by',
  'approved_by',
  'issued_at',
  'expires_at',
  'operation',
  'single_use',
  'consumed_at',
  'authorization_status',
  'simulated'
]);

function validateAuthorizationRecord(record, context = {}) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['authorization_missing'] };
  for (const field of REQUIRED_AUTHORIZATION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['authorization_id', 'session_id', 'candidate_id', 'tenant_id', 'requested_by', 'approved_by', 'issued_at', 'expires_at', 'operation', 'authorization_status']) {
    if (!isNonEmptyString(record[field])) errors.push(`invalid_${field}`);
  }
  if (record.requested_by === record.approved_by) errors.push('authorization_self_approval_blocked');
  if (!TRANSCRIPTION_CANARY_AUTHORIZATION_STATUSES.includes(record.authorization_status)) errors.push('authorization_status_not_allowed');
  if (record.authorization_status !== 'issued') errors.push(`authorization_${record.authorization_status || 'missing'}`);
  if (record.operation !== TRANSCRIPTION_CANARY_AUTHORIZATION_OPERATION) errors.push(`authorization_operation_not_allowed::${record.operation}`);
  if (record.single_use !== true) errors.push('single_use_must_be_true');
  if (record.consumed_at !== null) errors.push('authorization_already_consumed');
  if (!isIso(record.issued_at)) errors.push('issued_at_invalid');
  if (!isIso(record.expires_at)) errors.push('expires_at_invalid');
  if (isIso(record.issued_at) && isIso(record.expires_at)) {
    const windowMs = Date.parse(record.expires_at) - Date.parse(record.issued_at);
    if (windowMs <= 0) errors.push('authorization_window_invalid');
    if (windowMs > MAX_TRANSCRIPTION_CANARY_AUTHORIZATION_MS) errors.push('authorization_window_exceeds_limit');
  }
  if (isIso(record.expires_at) && Date.parse(record.expires_at) <= nowMs(context)) errors.push('authorization_expired');
  if (context.session_id && record.session_id !== context.session_id) errors.push('authorization_session_mismatch');
  if (context.candidate_id && record.candidate_id !== context.candidate_id) errors.push('authorization_candidate_mismatch');
  if (context.tenant_id && record.tenant_id !== context.tenant_id) errors.push('authorization_tenant_mismatch');
  if (context.environment === 'production') errors.push('production_blocked');
  if (record.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(record));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function createTranscriptionCanaryAuthorizationRegistry(options = {}) {
  const authorizations = new Map();
  const consumed = new Set();

  function now(context = {}) {
    return nowIso({ ...options.context, ...context, clock: context.clock || options.clock });
  }

  function blocked(record, reason, errors = [reason]) {
    return safeTranscriptionCanaryResponse({
      ok: false,
      allowed: false,
      status: 'transcription_canary_authorization_blocked',
      blocked_reason: reason,
      blocking_reasons: errors,
      audit_event_candidate: buildTranscriptionCanaryAuditEvent({
        ...(record || {}),
        event_name: 'authorization_blocked',
        status: 'authorization_blocked',
        blocked_reason: reason,
        occurred_at: now()
      })
    });
  }

  function issueAuthorization(record, context = {}) {
    const validation = validateAuthorizationRecord(record, { ...options.context, ...context, clock: context.clock || options.clock });
    if (!validation.valid) return blocked(record, validation.errors[0], validation.errors);
    if (authorizations.has(record.authorization_id)) return blocked(record, 'authorization_replay_duplicate');
    const stored = Object.freeze(sanitizeTranscriptionData(record));
    authorizations.set(stored.authorization_id, stored);
    return Object.freeze({
      ok: true,
      authorized: true,
      authorization: deepClone(stored),
      audit_event_candidate: buildTranscriptionCanaryAuditEvent({
        ...stored,
        event_name: 'authorization_issued',
        status: 'authorization_issued',
        occurred_at: now(context)
      }),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true
    });
  }

  function consumeAuthorization({ authorization_id, session_id, candidate_id, tenant_id, consumed_at } = {}, context = {}) {
    const current = authorizations.get(authorization_id);
    if (!current) return blocked({ authorization_id, session_id, candidate_id, tenant_id }, 'authorization_not_found');
    if (consumed.has(authorization_id) || current.consumed_at !== null) return blocked(current, 'authorization_reuse_blocked');
    const validation = validateAuthorizationRecord(current, { ...options.context, ...context, session_id, candidate_id, tenant_id, clock: context.clock || options.clock });
    if (!validation.valid) return blocked(current, validation.errors[0], validation.errors);
    if (!isIso(consumed_at)) return blocked(current, 'consumed_at_invalid');
    if (Date.parse(consumed_at) < Date.parse(current.issued_at)) return blocked(current, 'consumed_at_before_issued_at');
    if (Date.parse(consumed_at) > Date.parse(current.expires_at)) return blocked(current, 'consumption_after_expiration');
    const next = Object.freeze(sanitizeTranscriptionData({
      ...current,
      authorization_status: 'consumed',
      consumed_at
    }));
    authorizations.set(authorization_id, next);
    consumed.add(authorization_id);
    return Object.freeze({
      ok: true,
      authorized: true,
      consumed: true,
      authorization: deepClone(next),
      audit_event_candidate: buildTranscriptionCanaryAuditEvent({
        ...next,
        event_name: 'authorization_consumed',
        status: 'authorization_consumed',
        occurred_at: now(context)
      }),
      simulated: true,
      executed: false,
      real_provider_called: false,
      external_network_called: false,
      can_trigger_real_execution: false,
      production_blocked: true
    });
  }

  function revokeAuthorization(authorizationId) {
    const current = authorizations.get(authorizationId);
    if (!current) return { ok: false, revoked: false, blocked_reason: 'authorization_not_found', simulated: true, executed: false, real_provider_called: false };
    if (current.authorization_status === 'consumed') return { ok: true, revoked: false, authorization: deepClone(current), simulated: true, executed: false, real_provider_called: false };
    const next = Object.freeze(sanitizeTranscriptionData({ ...current, authorization_status: 'revoked' }));
    authorizations.set(authorizationId, next);
    consumed.add(authorizationId);
    return { ok: true, revoked: true, authorization: deepClone(next), simulated: true, executed: false, real_provider_called: false };
  }

  return Object.freeze({
    issueAuthorization,
    consumeAuthorization,
    revokeAuthorization,
    getAuthorization(authorizationId) {
      return authorizations.has(authorizationId) ? deepClone(authorizations.get(authorizationId)) : null;
    }
  });
}

module.exports = {
  MAX_TRANSCRIPTION_CANARY_AUTHORIZATION_MS,
  REQUIRED_AUTHORIZATION_FIELDS,
  TRANSCRIPTION_CANARY_AUTHORIZATION_OPERATION,
  TRANSCRIPTION_CANARY_AUTHORIZATION_STATUSES,
  createTranscriptionCanaryAuthorizationRegistry,
  validateAuthorizationRecord
};

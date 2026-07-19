'use strict';

const {
  buildSafeTranscriptionError,
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionBlockedReason,
  sanitizeTranscriptionData
} = require('./transcription-contract');
const {
  isBlockedOperation,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const CONSENT_STATUSES = Object.freeze(['requested', 'granted', 'denied', 'expired', 'revoked']);
const ALLOWED_CONSENT_PURPOSES = Object.freeze([
  'training_summary',
  'customer_service_review',
  'internal_meeting_summary',
  'development_test'
]);
const ALLOWED_CONSENT_OPERATIONS = Object.freeze([
  'evaluate_transcription_candidate',
  'simulate_transcription_readiness',
  'summarize_transcription',
  'analyze_transcription'
]);

const REQUIRED_CONSENT_FIELDS = Object.freeze([
  'consent_id',
  'transcription_id',
  'tenant_id',
  'workspace_type',
  'subject_type',
  'purpose',
  'capture_source',
  'requested_at',
  'granted_at',
  'expires_at',
  'consent_status',
  'consent_version',
  'granted_by',
  'revocation_status',
  'revoked_at',
  'revocation_reason',
  'allowed_operations',
  'data_classification',
  'simulated'
]);

const REGISTRY_STORAGE = new WeakMap();

function isIso(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function nowMs(context = {}) {
  const value = typeof context.clock === 'function' ? context.clock() : context.now;
  return Date.parse(value || new Date(0).toISOString());
}

function hashRecord(record) {
  return JSON.stringify(record, Object.keys(record || {}).sort());
}

function safeResult(consent, blockingReasons, fields = {}) {
  const reasons = uniqueSorted(blockingReasons);
  const allowed = reasons.length === 0;
  return sanitizeTranscriptionData({
    consent_id: consent && consent.consent_id ? consent.consent_id : 'consent_not_available',
    transcription_id: consent && consent.transcription_id ? consent.transcription_id : fields.transcription_id || 'transcription_not_available',
    tenant_id: consent && consent.tenant_id ? consent.tenant_id : fields.tenant_id || 'tenant_not_available',
    status: allowed ? 'transcription_consent_granted' : 'transcription_consent_blocked',
    allowed,
    consent_status: consent && consent.consent_status ? consent.consent_status : 'missing',
    consent_version: Number.isInteger(consent && consent.consent_version) ? consent.consent_version : 0,
    blocking_reasons: reasons,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: buildTranscriptionConsentAuditEvent({
      consent,
      event_name: allowed ? 'transcription_consent_evaluated' : fields.event_name || 'transcription_consent_denied',
      blocked_reason: reasons[0] || null,
      occurred_at: fields.occurred_at
    }),
    error: allowed ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', reasons[0] || 'transcription_consent_blocked')
  });
}

function validateTranscriptionConsentRecord(consent, context = {}) {
  const errors = [];
  if (!isPlainObject(consent)) return { valid: false, errors: ['consent_missing'] };
  for (const field of REQUIRED_CONSENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(consent, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['consent_id', 'transcription_id', 'tenant_id', 'workspace_type', 'subject_type', 'purpose', 'capture_source', 'consent_status', 'revocation_status', 'data_classification']) {
    if (!isNonEmptyString(consent[field])) errors.push(`invalid_${field}`);
  }
  if (!CONSENT_STATUSES.includes(consent.consent_status)) errors.push('consent_status_not_allowed');
  if (!ALLOWED_CONSENT_PURPOSES.includes(consent.purpose)) errors.push('consent_purpose_not_allowed');
  if (!Number.isInteger(consent.consent_version) || consent.consent_version < 1) errors.push('consent_version_invalid');
  if (!isIso(consent.requested_at)) errors.push('requested_at_invalid');
  if (!isIso(consent.expires_at)) errors.push('expires_at_invalid');
  if (consent.granted_at !== null && consent.granted_at !== undefined && !isIso(consent.granted_at)) errors.push('granted_at_invalid');
  if (isIso(consent.granted_at) && isIso(consent.expires_at) && Date.parse(consent.granted_at) > Date.parse(consent.expires_at)) {
    errors.push('granted_at_after_expires_at');
  }
  if (consent.consent_status === 'revoked' || consent.revocation_status === 'revoked') {
    if (!isIso(consent.revoked_at)) errors.push('revoked_at_required');
  }
  if (consent.consent_status !== 'revoked' && consent.revocation_status === 'revoked') errors.push('revocation_status_mismatch');
  if (consent.consent_status === 'revoked' && consent.revocation_status !== 'revoked') errors.push('revocation_status_required');
  if (consent.consent_status === 'granted' && !isIso(consent.granted_at)) errors.push('granted_at_invalid');
  if (consent.consent_status === 'granted' && !isNonEmptyString(consent.granted_by)) errors.push('granted_by_required');
  if (!Array.isArray(consent.allowed_operations) || consent.allowed_operations.length === 0) {
    errors.push('allowed_operations_required');
  } else {
    for (const operation of consent.allowed_operations) {
      if (!ALLOWED_CONSENT_OPERATIONS.includes(operation)) errors.push(`consent_operation_not_allowed::${operation}`);
      if (isBlockedOperation(operation)) errors.push(`blocked_operation::${operation}`);
    }
  }
  if (context.tenant_id && consent.tenant_id !== context.tenant_id) errors.push('consent_tenant_mismatch');
  if (context.workspace_type && consent.workspace_type !== context.workspace_type) errors.push('consent_workspace_mismatch');
  if (context.transcription_id && consent.transcription_id !== context.transcription_id) errors.push('consent_transcription_id_mismatch');
  if (context.operation && !consent.allowed_operations.includes(context.operation)) errors.push('consent_operation_scope_mismatch');
  if (consent.simulated !== true) errors.push('simulated_must_be_true');
  if (consent.implicit_consent === true || consent.presumed_consent === true || consent.created_by_adapter === true) {
    errors.push('implicit_or_adapter_created_consent_blocked');
  }
  errors.push(...findTranscriptionForbiddenFields(consent));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTranscriptionConsent(consent, context = {}) {
  const recordValidation = validateTranscriptionConsentRecord(consent, context);
  const errors = [...recordValidation.errors];
  if (!isPlainObject(consent)) return { valid: false, errors: uniqueSorted(errors) };
  if (consent.consent_status !== 'granted') errors.push(`consent_${consent.consent_status || 'missing'}`);
  if (isIso(consent.expires_at) && Date.parse(consent.expires_at) <= nowMs(context)) errors.push('consent_expired');
  if (consent.consent_status === 'revoked' || consent.revocation_status === 'revoked') errors.push('consent_revoked');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateTranscriptionConsent(consent, context = {}) {
  const validation = validateTranscriptionConsent(consent, context);
  return safeResult(consent, validation.valid ? [] : validation.errors, {
    tenant_id: context.tenant_id,
    transcription_id: context.transcription_id,
    event_name: validation.errors.includes('consent_expired') ? 'transcription_consent_expired' :
      validation.errors.includes('consent_revoked') ? 'transcription_consent_revoked' : 'transcription_consent_denied',
    occurred_at: context.now
  });
}

function buildTranscriptionConsentAuditEvent(input = {}) {
  const consent = input.consent || {};
  return sanitizeTranscriptionData({
    event_name: input.event_name || 'transcription_consent_evaluated',
    consent_id: consent.consent_id || 'consent_not_available',
    transcription_id: consent.transcription_id || 'transcription_not_available',
    tenant_id: consent.tenant_id || 'tenant_not_available',
    workspace_type: consent.workspace_type || 'workspace_not_available',
    consent_status: consent.consent_status || 'unknown',
    consent_version: Number.isInteger(consent.consent_version) ? consent.consent_version : 0,
    purpose: consent.purpose || 'purpose_not_available',
    blocked_reason: sanitizeTranscriptionBlockedReason(input.blocked_reason) || null,
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

function createTranscriptionConsentRegistry(options = {}) {
  const consents = new Map();
  const payloadHashes = new Map();
  const consumedConsentIds = new Set();
  function registerConsent(consent, context = {}) {
    const validation = validateTranscriptionConsentRecord(consent, { ...options.context, ...context });
    if (!validation.valid) return { ok: false, blocked_reason: validation.errors[0] || 'consent_invalid', errors: validation.errors, simulated: true, executed: false, real_provider_called: false };
    const existing = consents.get(consent.consent_id);
    const nextHash = hashRecord(consent);
    if (existing) {
      if (payloadHashes.get(consent.consent_id) !== nextHash) return { ok: false, blocked_reason: 'consent_replay_payload_mismatch', simulated: true, executed: false, real_provider_called: false };
      return { ok: false, blocked_reason: 'consent_replay_duplicate', simulated: true, executed: false, real_provider_called: false };
    }
    consents.set(consent.consent_id, sanitizeTranscriptionData(consent));
    payloadHashes.set(consent.consent_id, nextHash);
    return Object.freeze({ ok: true, consent_id: consent.consent_id, consent_version: consent.consent_version, simulated: true, executed: false, real_provider_called: false });
  }
  function getConsent(consentId) {
    return consents.has(consentId) ? deepClone(consents.get(consentId)) : null;
  }
  function revokeConsent({ consent_id, expected_version, revoked_at, revocation_reason } = {}) {
    const current = consents.get(consent_id);
    if (!current) return { ok: false, blocked_reason: 'consent_not_found', simulated: true, executed: false, real_provider_called: false };
    if (current.consent_status === 'revoked') return { ok: false, blocked_reason: 'consent_revoked_cannot_return_to_granted', simulated: true, executed: false, real_provider_called: false };
    if (current.consent_status === 'expired') return { ok: false, blocked_reason: 'expired_consent_cannot_be_renewed_silently', simulated: true, executed: false, real_provider_called: false };
    if (current.consent_version !== expected_version) return { ok: false, blocked_reason: 'consent_version_conflict', simulated: true, executed: false, real_provider_called: false };
    const next = sanitizeTranscriptionData({
      ...current,
      consent_status: 'revoked',
      consent_version: current.consent_version + 1,
      revocation_status: 'revoked',
      revoked_at,
      revocation_reason
    });
    consents.set(consent_id, next);
    payloadHashes.set(consent_id, hashRecord(next));
    return Object.freeze({ ok: true, consent_id, consent_version: next.consent_version, simulated: true, executed: false, real_provider_called: false });
  }
  const registry = { registerConsent, getConsent, revokeConsent, consumedConsentIds };
  REGISTRY_STORAGE.set(registry, { consents, payloadHashes, consumedConsentIds });
  return Object.freeze({
    registerConsent,
    getConsent,
    revokeConsent
  });
}

module.exports = {
  ALLOWED_CONSENT_OPERATIONS,
  ALLOWED_CONSENT_PURPOSES,
  CONSENT_STATUSES,
  buildTranscriptionConsentAuditEvent,
  createTranscriptionConsentRegistry,
  evaluateTranscriptionConsent,
  validateTranscriptionConsentRecord,
  validateTranscriptionConsent
};

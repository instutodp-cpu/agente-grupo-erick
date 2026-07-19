'use strict';

const {
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

const MAX_METADATA_RETENTION_DAYS = 90;
const MAX_TRANSCRIPT_RETENTION_DAYS = 30;
const ALLOWED_RETENTION_MODES = Object.freeze(['sanitized_metadata_only', 'sanitized_transcript_temporary']);

const REQUIRED_RETENTION_FIELDS = Object.freeze([
  'retention_policy_id',
  'tenant_id',
  'workspace_type',
  'data_classification',
  'retention_mode',
  'metadata_retention_days',
  'transcript_retention_days',
  'raw_media_retention_days',
  'deletion_required',
  'legal_hold',
  'policy_version',
  'effective_at',
  'expires_at',
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

function validateIntegerRange(value, min, max, field, errors) {
  if (!Number.isInteger(value)) {
    errors.push(`${field}_must_be_integer`);
    return;
  }
  if (value < min) errors.push(`${field}_negative`);
  if (value > max) errors.push(`${field}_exceeds_limit`);
}

function validateTranscriptionRetentionPolicy(policy, context = {}) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['retention_policy_missing'] };
  for (const field of REQUIRED_RETENTION_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(policy, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['retention_policy_id', 'tenant_id', 'workspace_type', 'data_classification', 'retention_mode']) {
    if (!isNonEmptyString(policy[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_RETENTION_MODES.includes(policy.retention_mode)) errors.push('retention_mode_not_allowed');
  if (policy.retention_mode === 'indefinite' || policy.indefinite === true) errors.push('retention_indefinite_blocked');
  validateIntegerRange(policy.metadata_retention_days, 0, MAX_METADATA_RETENTION_DAYS, 'metadata_retention_days', errors);
  validateIntegerRange(policy.transcript_retention_days, 0, MAX_TRANSCRIPT_RETENTION_DAYS, 'transcript_retention_days', errors);
  if (policy.raw_media_retention_days !== 0) errors.push('raw_media_retention_must_be_zero');
  if (policy.raw_audio_storage_allowed === true || policy.raw_media_storage_allowed === true) errors.push('raw_media_storage_blocked');
  if (policy.legal_hold !== false) errors.push('legal_hold_must_be_false');
  if (policy.deletion_required !== true) errors.push('deletion_required_must_be_true');
  if (!Number.isInteger(policy.policy_version) || policy.policy_version < 1) errors.push('policy_version_invalid');
  if (!isIso(policy.effective_at)) errors.push('effective_at_invalid');
  if (!isIso(policy.expires_at)) errors.push('expires_at_invalid');
  if (isIso(policy.expires_at) && Date.parse(policy.expires_at) <= nowMs(context)) errors.push('retention_policy_expired');
  if (context.tenant_id && policy.tenant_id !== context.tenant_id) errors.push('retention_tenant_mismatch');
  if (context.workspace_type && policy.workspace_type !== context.workspace_type) errors.push('retention_workspace_mismatch');
  if (policy.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateTranscriptionRetentionPolicy(policy, context = {}) {
  const validation = validateTranscriptionRetentionPolicy(policy, context);
  const blockingReasons = validation.valid ? [] : validation.errors;
  return sanitizeTranscriptionData({
    retention_policy_id: policy && policy.retention_policy_id ? policy.retention_policy_id : 'retention_policy_not_available',
    tenant_id: policy && policy.tenant_id ? policy.tenant_id : context.tenant_id || 'tenant_not_available',
    status: validation.valid ? 'transcription_retention_policy_allowed' : 'transcription_retention_policy_blocked',
    allowed: validation.valid,
    raw_media_retention_days: Number.isInteger(policy && policy.raw_media_retention_days) ? policy.raw_media_retention_days : null,
    policy_version: Number.isInteger(policy && policy.policy_version) ? policy.policy_version : 0,
    deletion_required: policy && policy.deletion_required === true,
    blocking_reasons: blockingReasons,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: buildTranscriptionRetentionAuditEvent({
      policy,
      blocked_reason: blockingReasons[0] || null,
      occurred_at: context.now
    }),
    error: validation.valid ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', blockingReasons[0] || 'retention_policy_blocked')
  });
}

function buildTranscriptionRetentionAuditEvent(input = {}) {
  const policy = input.policy || {};
  return sanitizeTranscriptionData({
    event_name: 'transcription_retention_policy_evaluated',
    retention_policy_id: policy.retention_policy_id || 'retention_policy_not_available',
    tenant_id: policy.tenant_id || 'tenant_not_available',
    workspace_type: policy.workspace_type || 'workspace_not_available',
    policy_version: Number.isInteger(policy.policy_version) ? policy.policy_version : 0,
    retention_mode: policy.retention_mode || 'retention_mode_not_available',
    raw_media_retention_days: Number.isInteger(policy.raw_media_retention_days) ? policy.raw_media_retention_days : null,
    deletion_required: policy.deletion_required === true,
    blocked_reason: sanitizeTranscriptionBlockedReason(input.blocked_reason) || null,
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

function createTranscriptionRetentionPolicyRegistry() {
  const policies = new Map();
  function registerPolicy(policy, context = {}) {
    const validation = validateTranscriptionRetentionPolicy(policy, context);
    if (!validation.valid) return { ok: false, blocked_reason: validation.errors[0], errors: validation.errors, simulated: true, executed: false, real_provider_called: false };
    const current = policies.get(policy.retention_policy_id);
    if (current) {
      if (current.tenant_id !== policy.tenant_id) return { ok: false, blocked_reason: 'retention_tenant_mutation_blocked', simulated: true, executed: false, real_provider_called: false };
      if (policy.policy_version <= current.policy_version) return { ok: false, blocked_reason: 'retention_policy_version_regression', simulated: true, executed: false, real_provider_called: false };
    }
    policies.set(policy.retention_policy_id, sanitizeTranscriptionData(policy));
    return Object.freeze({ ok: true, retention_policy_id: policy.retention_policy_id, policy_version: policy.policy_version, simulated: true, executed: false, real_provider_called: false });
  }
  function getPolicy(policyId) {
    return policies.has(policyId) ? deepClone(policies.get(policyId)) : null;
  }
  const registry = { registerPolicy, getPolicy };
  REGISTRY_STORAGE.set(registry, { policies });
  return Object.freeze(registry);
}

module.exports = {
  ALLOWED_RETENTION_MODES,
  MAX_METADATA_RETENTION_DAYS,
  MAX_TRANSCRIPT_RETENTION_DAYS,
  buildTranscriptionRetentionAuditEvent,
  createTranscriptionRetentionPolicyRegistry,
  evaluateTranscriptionRetentionPolicy,
  validateTranscriptionRetentionPolicy
};

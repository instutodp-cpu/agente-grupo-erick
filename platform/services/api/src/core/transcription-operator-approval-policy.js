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

const ALLOWED_APPROVAL_OPERATIONS = Object.freeze([
  'evaluate_transcription_candidate',
  'simulate_transcription_readiness'
]);
const APPROVAL_STATUSES = Object.freeze(['requested', 'approved', 'denied', 'expired', 'consumed']);
const REQUIRED_APPROVAL_FIELDS = Object.freeze([
  'approval_id',
  'candidate_id',
  'tenant_id',
  'environment',
  'requested_by',
  'approved_by',
  'requested_at',
  'approved_at',
  'expires_at',
  'approval_status',
  'allowed_operation',
  'single_use',
  'consumed_at',
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

function validateTranscriptionOperatorApproval(approval, context = {}) {
  const errors = [];
  if (!isPlainObject(approval)) return { valid: false, errors: ['operator_approval_missing'] };
  for (const field of REQUIRED_APPROVAL_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(approval, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['approval_id', 'candidate_id', 'tenant_id', 'environment', 'requested_by', 'approved_by', 'requested_at', 'approved_at', 'expires_at', 'approval_status', 'allowed_operation']) {
    if (!isNonEmptyString(approval[field])) errors.push(`invalid_${field}`);
  }
  if (!APPROVAL_STATUSES.includes(approval.approval_status)) errors.push('approval_status_not_allowed');
  if (approval.approval_status !== 'approved') errors.push(`approval_${approval.approval_status || 'missing'}`);
  if (approval.requested_by === approval.approved_by) errors.push('operator_self_approval_blocked');
  if (!ALLOWED_APPROVAL_OPERATIONS.includes(approval.allowed_operation)) errors.push(`approval_operation_not_allowed::${approval.allowed_operation}`);
  if (approval.environment === 'production' || context.environment === 'production') errors.push('production_blocked');
  if (!['local_test', 'non_production'].includes(approval.environment)) errors.push('approval_environment_not_allowed');
  if (!isIso(approval.requested_at)) errors.push('requested_at_invalid');
  if (!isIso(approval.approved_at)) errors.push('approved_at_invalid');
  if (!isIso(approval.expires_at)) errors.push('expires_at_invalid');
  if (isIso(approval.approved_at) && isIso(approval.expires_at) && Date.parse(approval.approved_at) > Date.parse(approval.expires_at)) errors.push('approved_at_after_expires_at');
  if (isIso(approval.expires_at) && Date.parse(approval.expires_at) <= nowMs(context)) errors.push('operator_approval_expired');
  if (approval.single_use !== true) errors.push('single_use_must_be_true');
  if (approval.consumed_at !== null) errors.push('operator_approval_consumed');
  if (context.candidate_id && approval.candidate_id !== context.candidate_id) errors.push('approval_candidate_mismatch');
  if (context.tenant_id && approval.tenant_id !== context.tenant_id) errors.push('approval_tenant_mismatch');
  if (context.operation && approval.allowed_operation !== context.operation) errors.push('approval_operation_scope_mismatch');
  if (approval.simulated !== true) errors.push('simulated_must_be_true');
  errors.push(...findTranscriptionForbiddenFields(approval));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateTranscriptionOperatorApproval(approval, context = {}) {
  const validation = validateTranscriptionOperatorApproval(approval, context);
  const blockingReasons = validation.valid ? [] : validation.errors;
  return sanitizeTranscriptionData({
    approval_id: approval && approval.approval_id ? approval.approval_id : 'approval_not_available',
    candidate_id: approval && approval.candidate_id ? approval.candidate_id : context.candidate_id || 'candidate_not_available',
    tenant_id: approval && approval.tenant_id ? approval.tenant_id : context.tenant_id || 'tenant_not_available',
    status: validation.valid ? 'transcription_operator_approval_allowed' : 'transcription_operator_approval_blocked',
    allowed: validation.valid,
    approval_status: approval && approval.approval_status ? approval.approval_status : 'missing',
    single_use: approval && approval.single_use === true,
    blocking_reasons: blockingReasons,
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false,
    audit_event_candidate: buildTranscriptionOperatorApprovalAuditEvent({
      approval,
      blocked_reason: blockingReasons[0] || null,
      occurred_at: context.now
    }),
    error: validation.valid ? null : buildSafeTranscriptionError('INVALID_ADAPTER_REQUEST', blockingReasons[0] || 'operator_approval_blocked')
  });
}

function buildTranscriptionOperatorApprovalAuditEvent(input = {}) {
  const approval = input.approval || {};
  return sanitizeTranscriptionData({
    event_name: 'transcription_operator_approval_evaluated',
    approval_id: approval.approval_id || 'approval_not_available',
    candidate_id: approval.candidate_id || 'candidate_not_available',
    tenant_id: approval.tenant_id || 'tenant_not_available',
    environment: approval.environment || 'environment_not_available',
    approval_status: approval.approval_status || 'unknown',
    allowed_operation: approval.allowed_operation || 'operation_not_available',
    single_use: approval.single_use === true,
    consumed: approval.consumed_at !== null && approval.consumed_at !== undefined,
    blocked_reason: sanitizeTranscriptionBlockedReason(input.blocked_reason) || null,
    occurred_at: input.occurred_at || new Date(0).toISOString(),
    simulated: true,
    executed: false,
    real_provider_called: false,
    external_network_called: false,
    can_trigger_real_execution: false
  });
}

function createTranscriptionOperatorApprovalRegistry(options = {}) {
  const approvals = new Map();
  const consumedApprovalIds = new Set();
  function registerApproval(approval, context = {}) {
    const validation = validateTranscriptionOperatorApproval(approval, { ...options.context, ...context });
    if (!validation.valid) return { ok: false, blocked_reason: validation.errors[0], errors: validation.errors, simulated: true, executed: false, real_provider_called: false };
    if (approvals.has(approval.approval_id)) return { ok: false, blocked_reason: 'operator_approval_replay_duplicate', simulated: true, executed: false, real_provider_called: false };
    approvals.set(approval.approval_id, sanitizeTranscriptionData(approval));
    return Object.freeze({ ok: true, approval_id: approval.approval_id, simulated: true, executed: false, real_provider_called: false });
  }
  function getApproval(approvalId) {
    return approvals.has(approvalId) ? deepClone(approvals.get(approvalId)) : null;
  }
  function consumeApproval({ approval_id, candidate_id, tenant_id, consumed_at } = {}) {
    const current = approvals.get(approval_id);
    if (!current) return { ok: false, consumed: false, blocked_reason: 'operator_approval_not_found', simulated: true, executed: false, real_provider_called: false };
    if (consumedApprovalIds.has(approval_id) || current.consumed_at !== null) return { ok: false, consumed: false, blocked_reason: 'operator_approval_reuse_blocked', simulated: true, executed: false, real_provider_called: false };
    if (current.candidate_id !== candidate_id) return { ok: false, consumed: false, blocked_reason: 'approval_candidate_mismatch', simulated: true, executed: false, real_provider_called: false };
    if (current.tenant_id !== tenant_id) return { ok: false, consumed: false, blocked_reason: 'approval_tenant_mismatch', simulated: true, executed: false, real_provider_called: false };
    const next = sanitizeTranscriptionData({ ...current, approval_status: 'consumed', consumed_at });
    approvals.set(approval_id, next);
    consumedApprovalIds.add(approval_id);
    return Object.freeze({ ok: true, consumed: true, approval_id, simulated: true, executed: false, real_provider_called: false });
  }
  const registry = { registerApproval, getApproval, consumeApproval };
  REGISTRY_STORAGE.set(registry, { approvals, consumedApprovalIds });
  return Object.freeze(registry);
}

module.exports = {
  ALLOWED_APPROVAL_OPERATIONS,
  APPROVAL_STATUSES,
  buildTranscriptionOperatorApprovalAuditEvent,
  createTranscriptionOperatorApprovalRegistry,
  evaluateTranscriptionOperatorApproval,
  validateTranscriptionOperatorApproval
};

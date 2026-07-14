'use strict';

const {
  buildSafeConfigurationError,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  sanitizeConfigurationData,
  uniqueSorted,
  validateInitialSecretReferenceState,
  validateSecretReference
} = require('./provider-configuration-contract');

const REGISTRY_STORAGE = new WeakMap();
const DEFAULT_MAX_HISTORY_PER_REFERENCE = 100;
const MAX_HISTORY_PER_REFERENCE = 1000;
const SECRET_REFERENCE_STATUS_TRANSITIONS = Object.freeze({
  reference_pending: ['reference_registered', 'revoked', 'disabled'],
  reference_registered: ['structurally_ready', 'rotation_required', 'revoked', 'disabled'],
  structurally_ready: ['rotation_required', 'expired', 'revoked', 'disabled'],
  rotation_required: ['revoked', 'disabled'],
  expired: ['revoked', 'disabled'],
  revoked: [],
  disabled: []
});

function cloneValue(value) {
  return value ? deepClone(value) : value;
}

function normalizeMaxHistory(value) {
  const configured = value === undefined ? DEFAULT_MAX_HISTORY_PER_REFERENCE : value;
  if (!Number.isInteger(configured) || configured < 1 || configured > MAX_HISTORY_PER_REFERENCE) {
    throw new Error('INVALID_REFERENCE_HISTORY_LIMIT');
  }
  return configured;
}

function validateReferenceChangeRequest(request, expectedOperation) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['reference_change_request_must_be_object'] };
  for (const field of ['trace_id', 'change_id', 'reference_id', 'operation', 'expected_version', 'actor_id', 'actor_role', 'reason', 'requested_at', 'simulated', 'executed', 'real_provider_called']) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['trace_id', 'change_id', 'reference_id', 'operation', 'actor_id', 'actor_role', 'reason', 'requested_at']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (request.operation !== expectedOperation) errors.push('reference_operation_mismatch');
  if (!Number.isInteger(request.expected_version) || request.expected_version < 1) errors.push('invalid_expected_version');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildHistoryEvent(reference, request, status, applied, errorCode, blockedReason, occurredAt) {
  return sanitizeConfigurationData({
    event_name: 'provider_secret_reference_change_evaluated',
    event_id: `${request && request.change_id ? request.change_id : 'change_not_available'}::${reference && reference.reference_id ? reference.reference_id : 'reference_not_available'}`,
    trace_id: request && request.trace_id ? request.trace_id : 'trace_not_available',
    change_id: request && request.change_id ? request.change_id : 'change_not_available',
    reference_id: reference && reference.reference_id ? reference.reference_id : 'reference_not_available',
    provider_id: reference && reference.provider_id ? reference.provider_id : 'provider_not_available',
    previous_status: reference && reference.status ? reference.status : 'unknown',
    current_status: status,
    operation: request && request.operation ? request.operation : 'unknown',
    applied: applied === true,
    error_code: errorCode || null,
    blocked_reason: blockedReason || null,
    occurred_at: occurredAt,
    simulated: true,
    executed: false,
    real_provider_called: false
  });
}

function buildReferenceAuditEvent(reference, request, currentStatus, applied, errorCode, blockedReason, occurredAt, expectedOperation) {
  return buildHistoryEvent(reference || {
    reference_id: request && request.reference_id,
    provider_id: 'provider_not_available',
    status: 'unknown'
  }, request || { operation: expectedOperation }, currentStatus || 'unknown', applied, errorCode, blockedReason, occurredAt);
}

function appendHistory(histories, referenceId, event, maxHistory) {
  if (!(histories instanceof Map) || !isNonEmptyString(referenceId) || !event) return;
  const current = histories.get(referenceId) || [];
  const next = current.concat([event]);
  histories.set(referenceId, next.slice(Math.max(0, next.length - maxHistory)));
}

function canTransitionReferenceStatus(fromStatus, toStatus) {
  return Array.isArray(SECRET_REFERENCE_STATUS_TRANSITIONS[fromStatus]) &&
    SECRET_REFERENCE_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

function validateReferenceStateConsistency(reference) {
  const errors = [];
  if (!reference || !SECRET_REFERENCE_STATUS_TRANSITIONS[reference.status]) return ['secret_reference_status_not_allowed'];
  if (['reference_pending', 'reference_registered', 'structurally_ready', 'rotation_required', 'expired'].includes(reference.status)) {
    if (reference.revoked !== false) errors.push(`${reference.status}_revoked_must_be_false`);
    if (reference.disabled !== false) errors.push(`${reference.status}_disabled_must_be_false`);
  }
  if (reference.status === 'revoked' && reference.revoked !== true) errors.push('revoked_status_requires_revoked_true');
  if (reference.status === 'disabled' && reference.disabled !== true) errors.push('disabled_status_requires_disabled_true');
  return uniqueSorted(errors);
}

function registerSecretReferenceInternal(references, histories, reference, context = {}) {
  if (!(references instanceof Map) || !(histories instanceof Map)) {
    return { ok: false, error_code: 'INTERNAL_CONFIGURATION_ERROR', blocked_reason: 'registry_storage_invalid' };
  }
  const validation = validateSecretReference(reference, context);
  if (!validation.valid) {
    return { ok: false, error_code: 'INVALID_SECRET_REFERENCE', blocked_reason: 'secret_reference_invalid', errors: validation.errors };
  }
  const initial = validateInitialSecretReferenceState(reference);
  if (initial.length > 0) {
    return { ok: false, error_code: 'INVALID_SECRET_REFERENCE', blocked_reason: 'initial_secret_reference_state_not_allowed', errors: initial };
  }
  if (references.has(reference.reference_id)) {
    return { ok: false, error_code: 'DUPLICATE_SECRET_REFERENCE', blocked_reason: 'secret_reference_duplicate' };
  }
  references.set(reference.reference_id, sanitizeConfigurationData(reference));
  histories.set(reference.reference_id, []);
  return { ok: true, reference_id: reference.reference_id, status: reference.status };
}

function getSecretReferenceInternal(references, referenceId) {
  if (!(references instanceof Map) || !isNonEmptyString(referenceId)) return null;
  return cloneValue(references.get(referenceId));
}

function listSecretReferencesInternal(references, filters = {}) {
  if (!(references instanceof Map)) return [];
  return Array.from(references.values())
    .filter((reference) => {
      if (isNonEmptyString(filters.provider_id) && reference.provider_id !== filters.provider_id) return false;
      if (isNonEmptyString(filters.tenant_id) && reference.tenant_id !== filters.tenant_id) return false;
      if (isNonEmptyString(filters.workspace_type) && reference.workspace_type !== filters.workspace_type) return false;
      if (isNonEmptyString(filters.status) && reference.status !== filters.status) return false;
      return true;
    })
    .map(cloneValue)
    .sort((a, b) => a.reference_id.localeCompare(b.reference_id));
}

function changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, nextStatus, expectedOperation, flags = {}) {
  const occurredAt = new Date(0).toISOString();
  if (!(references instanceof Map) || !(histories instanceof Map) || !(processedChangeIds instanceof Set)) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('INTERNAL_CONFIGURATION_ERROR', 'Secret reference change blocked safely.', { blocked_reason: 'registry_storage_invalid' }),
      audit_event_candidate: buildReferenceAuditEvent(null, request, 'unknown', false, 'INTERNAL_CONFIGURATION_ERROR', 'registry_storage_invalid', occurredAt, expectedOperation)
    };
  }
  if (isNonEmptyString(request && request.change_id) && processedChangeIds.has(request.change_id)) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('REPLAYED_CONFIGURATION_REQUEST', 'Secret reference change replay blocked.', { blocked_reason: 'replayed_reference_change' }),
      audit_event_candidate: buildReferenceAuditEvent(null, request, 'unknown', false, 'REPLAYED_CONFIGURATION_REQUEST', 'replayed_reference_change', occurredAt, expectedOperation)
    };
  }
  if (isNonEmptyString(request && request.change_id)) processedChangeIds.add(request.change_id);
  const validation = validateReferenceChangeRequest(request, expectedOperation);
  if (!validation.valid) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('INVALID_SECRET_REFERENCE', 'Secret reference change blocked safely.', { blocked_reason: 'reference_change_request_invalid' }),
      audit_event_candidate: buildReferenceAuditEvent(null, request, 'unknown', false, 'INVALID_SECRET_REFERENCE', validation.errors[0] || 'reference_change_request_invalid', occurredAt, expectedOperation)
    };
  }
  const current = references.get(request.reference_id);
  if (!current) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('INVALID_SECRET_REFERENCE', 'Secret reference missing.', { blocked_reason: 'secret_reference_not_found' }),
      audit_event_candidate: buildReferenceAuditEvent(null, request, 'unknown', false, 'INVALID_SECRET_REFERENCE', 'secret_reference_not_found', occurredAt, expectedOperation)
    };
  }
  if (current.reference_version !== request.expected_version) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('VERSION_CONFLICT', 'Secret reference version conflict.', { blocked_reason: 'version_conflict' }),
      audit_event_candidate: buildReferenceAuditEvent(current, request, current.status, false, 'VERSION_CONFLICT', 'version_conflict', occurredAt, expectedOperation)
    };
  }
  if (!canTransitionReferenceStatus(current.status, nextStatus)) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('INVALID_SECRET_REFERENCE', 'Secret reference transition blocked safely.', { blocked_reason: 'secret_reference_transition_not_allowed' }),
      audit_event_candidate: buildReferenceAuditEvent(current, request, current.status, false, 'INVALID_SECRET_REFERENCE', 'secret_reference_transition_not_allowed', occurredAt, expectedOperation)
    };
  }
  const next = sanitizeConfigurationData({
    ...current,
    status: nextStatus,
    reference_version: current.reference_version + 1,
    updated_at: request.requested_at,
    ...flags
  });
  const stateErrors = validateReferenceStateConsistency(next);
  if (stateErrors.length > 0) {
    return {
      ok: false,
      applied: false,
      error: buildSafeConfigurationError('INVALID_SECRET_REFERENCE', 'Secret reference state consistency blocked safely.', { blocked_reason: stateErrors[0] }),
      audit_event_candidate: buildReferenceAuditEvent(current, request, current.status, false, 'INVALID_SECRET_REFERENCE', stateErrors[0], occurredAt, expectedOperation)
    };
  }
  references.set(request.reference_id, next);
  const event = buildHistoryEvent(current, request, nextStatus, true, null, null, occurredAt);
  appendHistory(histories, request.reference_id, event, maxHistory);
  return { ok: true, applied: true, reference: cloneValue(next), audit_event_candidate: event };
}

function createProviderSecretReferenceRegistry(options = {}) {
  const maxHistory = normalizeMaxHistory(options.maxHistoryPerReference);
  const references = new Map();
  const histories = new Map();
  const processedChangeIds = new Set();
  const initialReferences = Array.isArray(options.initialReferences) ? options.initialReferences : [];
  for (const reference of initialReferences) {
    const result = registerSecretReferenceInternal(references, histories, reference, options.context || {});
    if (!result.ok) throw new Error('INVALID_INITIAL_SECRET_REFERENCE');
  }
  const registry = {
    registerSecretReference(reference, context = {}) {
      return registerSecretReferenceInternal(references, histories, reference, context);
    },
    getSecretReference(referenceId) {
      return getSecretReferenceInternal(references, referenceId);
    },
    listSecretReferences(filters = {}) {
      return listSecretReferencesInternal(references, filters);
    },
    hasSecretReference(referenceId) {
      return references.has(referenceId);
    },
    markReferenceRevoked(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'revoked', 'mark_revoked', { revoked: true });
    },
    markReferenceDisabled(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'disabled', 'mark_disabled', { disabled: true });
    },
    markRotationRequired(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'rotation_required', 'mark_rotation_required');
    },
    markReferenceRegistered(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'reference_registered', 'mark_registered');
    },
    markReferenceStructurallyReady(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'structurally_ready', 'mark_structurally_ready');
    },
    markReferenceExpired(request) {
      return changeReferenceStatusInternal(references, histories, processedChangeIds, maxHistory, request, 'expired', 'mark_expired');
    },
    getReferenceHistory(referenceId) {
      return (histories.get(referenceId) || []).map(cloneValue);
    }
  };
  REGISTRY_STORAGE.set(registry, { references, histories, processedChangeIds, maxHistory });
  return Object.freeze(registry);
}

module.exports = {
  createProviderSecretReferenceRegistry,
  SECRET_REFERENCE_STATUS_TRANSITIONS
};

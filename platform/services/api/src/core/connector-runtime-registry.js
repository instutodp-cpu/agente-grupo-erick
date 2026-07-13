'use strict';

const {
  buildSafeLifecycleError,
  buildTransitionAuditEvent,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  sanitizeLifecycleData,
  uniqueSorted,
  validateConnectorRecord,
  validateInitialConnectorState
} = require('./connector-lifecycle-contract');
const {
  applyLifecycleTransition
} = require('./connector-lifecycle-state-machine');

const REGISTRY_STORAGE = new WeakMap();
const DEFAULT_MAX_HISTORY_PER_CONNECTOR = 100;
const MAX_HISTORY_PER_CONNECTOR = 1000;

function cloneRecord(record) {
  return record ? deepClone(record) : null;
}

function cloneHistoryEvent(event) {
  return event ? deepClone(event) : null;
}

function normalizeFilters(filters = {}) {
  if (!isPlainObject(filters)) return {};
  const normalized = {};
  for (const field of ['connector_id', 'lifecycle_state', 'provider_id', 'adapter_id', 'status']) {
    if (isNonEmptyString(filters[field])) normalized[field] = filters[field];
  }
  if (typeof filters.applied === 'boolean') normalized.applied = filters.applied;
  return normalized;
}

function recordMatchesFilters(record, filters) {
  if (filters.connector_id && record.connector_id !== filters.connector_id) return false;
  if (filters.lifecycle_state && record.lifecycle_state !== filters.lifecycle_state) return false;
  if (filters.provider_id && record.provider_id !== filters.provider_id) return false;
  if (filters.adapter_id && record.adapter_id !== filters.adapter_id) return false;
  return true;
}

function historyMatchesFilters(event, filters) {
  if (filters.connector_id && event.connector_id !== filters.connector_id) return false;
  if (filters.status && event.status !== filters.status) return false;
  if (typeof filters.applied === 'boolean' && event.applied !== filters.applied) return false;
  return true;
}

function sortRecords(records) {
  return records.sort((a, b) => a.connector_id.localeCompare(b.connector_id));
}

function sortHistory(history) {
  return history.sort((a, b) => {
    const byTime = String(a.created_at || '').localeCompare(String(b.created_at || ''));
    if (byTime !== 0) return byTime;
    return String(a.event_id || '').localeCompare(String(b.event_id || ''));
  });
}

function normalizeRecord(record) {
  const validation = validateConnectorRecord(record);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors
    };
  }
  return {
    valid: true,
    record: sanitizeLifecycleData(record)
  };
}

function validateRegistrationState(record) {
  const errors = validateInitialConnectorState(record);
  return {
    valid: errors.length === 0,
    errors
  };
}

function registerConnectorInternal(records, record) {
  if (!(records instanceof Map)) {
    return {
      ok: false,
      error_code: 'INTERNAL_LIFECYCLE_ERROR',
      blocked_reason: 'registry_storage_invalid'
    };
  }

  const normalized = normalizeRecord(record);
  if (!normalized.valid) {
    return {
      ok: false,
      error_code: 'INVALID_CONNECTOR_RECORD',
      blocked_reason: 'connector_record_invalid',
      errors: uniqueSorted(normalized.errors)
    };
  }
  const registrationState = validateRegistrationState(normalized.record);
  if (!registrationState.valid) {
    return {
      ok: false,
      error_code: 'INITIAL_STATE_NOT_ALLOWED',
      blocked_reason: 'connector_initial_state_not_allowed',
      errors: uniqueSorted(registrationState.errors)
    };
  }

  const connectorId = normalized.record.connector_id;
  if (records.has(connectorId)) {
    return {
      ok: false,
      error_code: 'DUPLICATE_CONNECTOR',
      blocked_reason: 'connector_duplicate'
    };
  }

  records.set(connectorId, normalized.record);
  return {
    ok: true,
    connector_id: connectorId,
    lifecycle_state: normalized.record.lifecycle_state,
    lifecycle_version: normalized.record.lifecycle_version
  };
}

function unregisterConnectorInternal(records, histories, connectorId) {
  if (!(records instanceof Map) || !isNonEmptyString(connectorId)) {
    return {
      ok: false,
      removed: false,
      error_code: 'INVALID_CONNECTOR_RECORD',
      blocked_reason: 'connector_id_invalid'
    };
  }
  const record = records.get(connectorId);
  if (!record) {
    return {
      ok: false,
      removed: false,
      error_code: 'CONNECTOR_NOT_FOUND',
      blocked_reason: 'connector_not_found'
    };
  }
  if (!['unregistered', 'registered'].includes(record.lifecycle_state) || record.retired === true) {
    return {
      ok: false,
      removed: false,
      error_code: 'INVALID_TRANSITION',
      blocked_reason: 'connector_unregister_not_allowed'
    };
  }
  records.delete(connectorId);
  if (histories instanceof Map) histories.delete(connectorId);
  return {
    ok: true,
    removed: true,
    connector_id: connectorId
  };
}

function getConnectorInternal(records, connectorId) {
  if (!(records instanceof Map) || !isNonEmptyString(connectorId)) return null;
  return cloneRecord(records.get(connectorId));
}

function listConnectorsInternal(records, filters = {}) {
  if (!(records instanceof Map)) return [];
  const normalizedFilters = normalizeFilters(filters);
  return sortRecords(Array.from(records.values())
    .filter((record) => recordMatchesFilters(record, normalizedFilters))
    .map(cloneRecord));
}

function hasConnectorInternal(records, connectorId) {
  return Boolean(records instanceof Map && records.has(connectorId));
}

function appendHistory(histories, connectorId, event, maxHistoryPerConnector) {
  if (!(histories instanceof Map) || !isNonEmptyString(connectorId) || !event) return;
  const current = histories.get(connectorId) || [];
  const next = current.concat([sanitizeLifecycleData(event)]);
  const limit = Number.isInteger(maxHistoryPerConnector) ? maxHistoryPerConnector : DEFAULT_MAX_HISTORY_PER_CONNECTOR;
  histories.set(connectorId, next.slice(Math.max(0, next.length - limit)));
}

function buildRegistrySafeResult(request, fields = {}) {
  const status = fields.status || 'lifecycle_internal_error_safe';
  const blockedReason = fields.blockedReason || 'internal_lifecycle_error';
  const errorCode = fields.errorCode || 'INTERNAL_LIFECYCLE_ERROR';
  return {
    trace_id: request && request.trace_id ? request.trace_id : 'trace_not_available',
    transition_id: request && request.transition_id ? request.transition_id : 'transition_not_available',
    connector_id: request && request.connector_id ? request.connector_id : 'connector_not_available',
    previous_state: fields.previousState || 'unknown',
    new_state: fields.newState || fields.previousState || 'unknown',
    previous_version: Number.isInteger(fields.previousVersion) ? fields.previousVersion : 0,
    new_version: Number.isInteger(fields.newVersion) ? fields.newVersion : Number.isInteger(fields.previousVersion) ? fields.previousVersion : 0,
    transition_event: request && request.transition_event ? request.transition_event : 'unknown',
    status,
    applied: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: [blockedReason],
    warnings: [],
    error: buildSafeLifecycleError(errorCode, 'Connector lifecycle transition blocked safely.', {
      blocked_reason: blockedReason
    }),
    lifecycle_record: null,
    transition_audit_event: buildTransitionAuditEvent({
      trace_id: request && request.trace_id,
      transition_id: request && request.transition_id,
      connector_id: request && request.connector_id,
      provider_id: fields.providerId,
      adapter_id: fields.adapterId,
      previous_state: fields.previousState,
      new_state: fields.newState || fields.previousState,
      previous_version: fields.previousVersion,
      new_version: fields.newVersion,
      transition_event: request && request.transition_event,
      actor_id: request && request.actor_id,
      actor_role: request && request.actor_role,
      status,
      applied: false,
      error_code: errorCode,
      occurred_at: fields.occurredAt,
      blocked_reason: blockedReason
    })
  };
}

function transitionConnectorInternal(records, histories, processedTransitionIds, maxHistoryPerConnector, request, context = {}) {
  if (!(records instanceof Map) || !(histories instanceof Map)) {
    return buildRegistrySafeResult(request, {
      status: 'lifecycle_internal_error_safe',
      blockedReason: 'registry_storage_invalid',
      errorCode: 'INTERNAL_LIFECYCLE_ERROR'
    });
  }
  if (isNonEmptyString(request && request.transition_id) && processedTransitionIds instanceof Set && processedTransitionIds.has(request.transition_id)) {
    return buildRegistrySafeResult(request, {
      status: 'lifecycle_transition_blocked',
      blockedReason: 'replayed_transition',
      errorCode: 'REPLAYED_TRANSITION',
      occurredAt: context && typeof context.clock === 'function' ? context.clock() : new Date().toISOString()
    });
  }

  const connectorId = request && request.connector_id;
  const record = isNonEmptyString(connectorId) ? records.get(connectorId) : null;
  if (!record) {
    return buildRegistrySafeResult(request, {
      status: 'lifecycle_connector_not_found',
      blockedReason: 'connector_not_found',
      errorCode: 'CONNECTOR_NOT_FOUND',
      occurredAt: context && typeof context.clock === 'function' ? context.clock() : new Date().toISOString()
    });
  }

  const result = applyLifecycleTransition(record, request, context);
  if (result.applied === true && result.lifecycle_record) {
    records.set(record.connector_id, sanitizeLifecycleData(result.lifecycle_record));
  }
  if (isNonEmptyString(request && request.transition_id) && processedTransitionIds instanceof Set) {
    processedTransitionIds.add(request.transition_id);
  }
  if (result.history_event) appendHistory(histories, record.connector_id, result.history_event, maxHistoryPerConnector);
  return sanitizeLifecycleData(result);
}

function getConnectorHistoryInternal(histories, connectorId) {
  if (!(histories instanceof Map) || !isNonEmptyString(connectorId)) return [];
  return sortHistory((histories.get(connectorId) || []).map(cloneHistoryEvent));
}

function listTransitionHistoryInternal(histories, filters = {}) {
  if (!(histories instanceof Map)) return [];
  const normalizedFilters = normalizeFilters(filters);
  return sortHistory(Array.from(histories.values())
    .flat()
    .filter((event) => historyMatchesFilters(event, normalizedFilters))
    .map(cloneHistoryEvent));
}

function getStorage(registry) {
  return REGISTRY_STORAGE.get(registry) || null;
}

function registerConnector(registry, record) {
  const storage = getStorage(registry);
  return registerConnectorInternal(storage && storage.records, record);
}

function unregisterConnector(registry, connectorId) {
  const storage = getStorage(registry);
  return unregisterConnectorInternal(storage && storage.records, storage && storage.histories, connectorId);
}

function getConnector(registry, connectorId) {
  const storage = getStorage(registry);
  return getConnectorInternal(storage && storage.records, connectorId);
}

function listConnectors(registry, filters = {}) {
  const storage = getStorage(registry);
  return listConnectorsInternal(storage && storage.records, filters);
}

function hasConnector(registry, connectorId) {
  const storage = getStorage(registry);
  return hasConnectorInternal(storage && storage.records, connectorId);
}

function transitionConnector(registry, request, context = {}) {
  const storage = getStorage(registry);
  return transitionConnectorInternal(storage && storage.records, storage && storage.histories, storage && storage.processedTransitionIds, storage && storage.maxHistoryPerConnector, request, context);
}

function getConnectorHistory(registry, connectorId) {
  const storage = getStorage(registry);
  return getConnectorHistoryInternal(storage && storage.histories, connectorId);
}

function listTransitionHistory(registry, filters = {}) {
  const storage = getStorage(registry);
  return listTransitionHistoryInternal(storage && storage.histories, filters);
}

function prepareInitialRecords(initialRecords) {
  if (!Array.isArray(initialRecords)) throw new Error('INVALID_INITIAL_CONNECTOR_RECORD');
  const records = new Map();
  const histories = new Map();
  for (const record of initialRecords) {
    const result = registerConnectorInternal(records, record);
    if (!result.ok) throw new Error('INVALID_INITIAL_CONNECTOR_RECORD');
    histories.set(record.connector_id, []);
  }
  return { records, histories };
}

function normalizeMaxHistoryPerConnector(value) {
  const configured = value === undefined ? DEFAULT_MAX_HISTORY_PER_CONNECTOR : value;
  if (!Number.isInteger(configured) || configured < 1 || configured > MAX_HISTORY_PER_CONNECTOR) {
    throw new Error('INVALID_HISTORY_LIMIT');
  }
  return configured;
}

function createConnectorRuntimeRegistry(options = {}) {
  const initialRecords = Array.isArray(options.initialRecords) ? options.initialRecords : [];
  const maxHistoryPerConnector = normalizeMaxHistoryPerConnector(options.maxHistoryPerConnector);
  const storage = prepareInitialRecords(initialRecords);
  storage.processedTransitionIds = new Set();
  storage.maxHistoryPerConnector = maxHistoryPerConnector;

  const registry = {
    registerConnector(record) {
      const result = registerConnectorInternal(storage.records, record);
      if (result.ok) storage.histories.set(result.connector_id, []);
      return result;
    },
    unregisterConnector(connectorId) {
      return unregisterConnectorInternal(storage.records, storage.histories, connectorId);
    },
    getConnector(connectorId) {
      return getConnectorInternal(storage.records, connectorId);
    },
    listConnectors(filters = {}) {
      return listConnectorsInternal(storage.records, filters);
    },
    hasConnector(connectorId) {
      return hasConnectorInternal(storage.records, connectorId);
    },
    transitionConnector(request, context = {}) {
      return transitionConnectorInternal(storage.records, storage.histories, storage.processedTransitionIds, storage.maxHistoryPerConnector, request, context);
    },
    getConnectorHistory(connectorId) {
      return getConnectorHistoryInternal(storage.histories, connectorId);
    },
    listTransitionHistory(filters = {}) {
      return listTransitionHistoryInternal(storage.histories, filters);
    }
  };

  REGISTRY_STORAGE.set(registry, storage);
  return Object.freeze(registry);
}

module.exports = {
  createConnectorRuntimeRegistry,
  registerConnector,
  unregisterConnector,
  getConnector,
  listConnectors,
  hasConnector,
  transitionConnector,
  getConnectorHistory,
  listTransitionHistory,
  buildSafeLifecycleError
};

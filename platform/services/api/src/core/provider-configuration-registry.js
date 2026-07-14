'use strict';

const {
  buildConfigurationAuditEventCandidate,
  buildSafeConfigurationError,
  deepClone,
  detectConfigurationIdentityMutation,
  getConfigurationTargetStatus,
  findConfigurationForbiddenFields,
  isNonEmptyString,
  isPlainObject,
  sanitizeConfigurationData,
  uniqueSorted,
  validateConfigurationChangeRequest,
  validateInitialConfigurationState,
  validateProviderConfiguration
} = require('./provider-configuration-contract');

const REGISTRY_STORAGE = new WeakMap();
const DEFAULT_MAX_HISTORY_PER_CONFIGURATION = 100;
const MAX_HISTORY_PER_CONFIGURATION = 1000;

function cloneValue(value) {
  return value ? deepClone(value) : value;
}

function normalizeMaxHistory(value) {
  const configured = value === undefined ? DEFAULT_MAX_HISTORY_PER_CONFIGURATION : value;
  if (!Number.isInteger(configured) || configured < 1 || configured > MAX_HISTORY_PER_CONFIGURATION) {
    throw new Error('INVALID_CONFIGURATION_HISTORY_LIMIT');
  }
  return configured;
}

function normalizeFilters(filters = {}) {
  if (!isPlainObject(filters)) return {};
  const normalized = {};
  for (const field of ['configuration_id', 'provider_id', 'adapter_id', 'connector_id', 'workspace_type', 'tenant_id', 'status']) {
    if (isNonEmptyString(filters[field])) normalized[field] = filters[field];
  }
  if (typeof filters.applied === 'boolean') normalized.applied = filters.applied;
  return normalized;
}

function matchesConfiguration(config, filters) {
  if (filters.configuration_id && config.configuration_id !== filters.configuration_id) return false;
  if (filters.provider_id && config.provider_id !== filters.provider_id) return false;
  if (filters.adapter_id && config.adapter_id !== filters.adapter_id) return false;
  if (filters.connector_id && config.connector_id !== filters.connector_id) return false;
  if (filters.workspace_type && config.workspace_type !== filters.workspace_type) return false;
  if (filters.tenant_id && config.tenant_id !== filters.tenant_id) return false;
  return true;
}

function matchesHistory(event, filters) {
  if (filters.configuration_id && event.configuration_id !== filters.configuration_id) return false;
  if (filters.provider_id && event.provider_id !== filters.provider_id) return false;
  if (filters.status && event.current_status !== filters.status) return false;
  if (typeof filters.applied === 'boolean' && event.applied !== filters.applied) return false;
  return true;
}

function sortConfigurations(configs) {
  return configs.sort((a, b) => a.configuration_id.localeCompare(b.configuration_id));
}

function sortHistory(history) {
  return history.sort((a, b) => {
    const byTime = String(a.occurred_at || '').localeCompare(String(b.occurred_at || ''));
    if (byTime !== 0) return byTime;
    return String(a.change_id || '').localeCompare(String(b.change_id || ''));
  });
}

function normalizeConfiguration(config, context = {}) {
  const validation = validateProviderConfiguration(config, context);
  if (!validation.valid) return { valid: false, errors: validation.errors };
  return { valid: true, configuration: sanitizeConfigurationData(config) };
}

function validateRegistration(config) {
  const stateErrors = validateInitialConfigurationState(config);
  return {
    valid: stateErrors.length === 0,
    errors: stateErrors
  };
}

function buildSafeResult(request, fields = {}) {
  const current = fields.current || {};
  const status = fields.status || 'configuration_blocked';
  const blockedReason = fields.blockedReason || 'configuration_operation_blocked';
  const errorCode = fields.errorCode || 'INTERNAL_CONFIGURATION_ERROR';
  const occurredAt = fields.occurredAt || new Date(0).toISOString();
  const audit = buildConfigurationAuditEventCandidate({
    trace_id: request && request.trace_id,
    change_id: request && request.change_id,
    configuration_id: request && request.configuration_id,
    connector_id: current.connector_id || fields.connectorId,
    provider_id: current.provider_id || fields.providerId,
    adapter_id: current.adapter_id || fields.adapterId,
    previous_status: current.configuration_status || fields.previousStatus,
    current_status: current.configuration_status || fields.currentStatus,
    operation: request && request.operation,
    applied: false,
    error_code: errorCode,
    blocked_reason: blockedReason,
    occurred_at: occurredAt
  });

  return {
    trace_id: request && request.trace_id ? request.trace_id : 'trace_not_available',
    change_id: request && request.change_id ? request.change_id : 'change_not_available',
    configuration_id: request && request.configuration_id ? request.configuration_id : 'configuration_not_available',
    previous_version: Number.isInteger(current.configuration_version) ? current.configuration_version : 0,
    new_version: Number.isInteger(current.configuration_version) ? current.configuration_version : 0,
    previous_status: current.configuration_status || 'unknown',
    current_status: current.configuration_status || 'unknown',
    operation: request && request.operation ? request.operation : 'unknown',
    status,
    applied: false,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: [blockedReason],
    warnings: [],
    error: buildSafeConfigurationError(errorCode, 'Provider configuration change blocked safely.', {
      blocked_reason: blockedReason
    }),
    configuration: null,
    audit_event_candidate: audit
  };
}

function appendHistory(histories, configurationId, event, maxHistory) {
  if (!(histories instanceof Map) || !isNonEmptyString(configurationId) || !event) return;
  const current = histories.get(configurationId) || [];
  const next = current.concat([sanitizeConfigurationData(event)]);
  histories.set(configurationId, next.slice(Math.max(0, next.length - maxHistory)));
}

function registerConfigurationInternal(configurations, histories, config, context = {}) {
  if (!(configurations instanceof Map) || !(histories instanceof Map)) {
    return {
      ok: false,
      error_code: 'INTERNAL_CONFIGURATION_ERROR',
      blocked_reason: 'registry_storage_invalid'
    };
  }
  const normalized = normalizeConfiguration(config, context);
  if (!normalized.valid) {
    return {
      ok: false,
      error_code: 'INVALID_PROVIDER_CONFIGURATION',
      blocked_reason: 'provider_configuration_invalid',
      errors: uniqueSorted(normalized.errors)
    };
  }
  const initial = validateRegistration(normalized.configuration);
  if (!initial.valid) {
    return {
      ok: false,
      error_code: 'INITIAL_CONFIGURATION_STATE_NOT_ALLOWED',
      blocked_reason: 'initial_configuration_state_not_allowed',
      errors: uniqueSorted(initial.errors)
    };
  }
  if (configurations.has(normalized.configuration.configuration_id)) {
    return {
      ok: false,
      error_code: 'DUPLICATE_CONFIGURATION',
      blocked_reason: 'configuration_duplicate'
    };
  }
  configurations.set(normalized.configuration.configuration_id, normalized.configuration);
  histories.set(normalized.configuration.configuration_id, []);
  return {
    ok: true,
    configuration_id: normalized.configuration.configuration_id,
    configuration_version: normalized.configuration.configuration_version,
    status: normalized.configuration.configuration_status
  };
}

function unregisterConfigurationInternal(configurations, histories, configurationId) {
  if (!(configurations instanceof Map) || !isNonEmptyString(configurationId)) {
    return { ok: false, removed: false, error_code: 'INVALID_PROVIDER_CONFIGURATION', blocked_reason: 'configuration_id_invalid' };
  }
  const current = configurations.get(configurationId);
  if (!current) return { ok: false, removed: false, error_code: 'CONFIGURATION_NOT_FOUND', blocked_reason: 'configuration_not_found' };
  const history = histories.get(configurationId) || [];
  if (current.configuration_status !== 'descriptor_registered' || history.length > 0) {
    return { ok: false, removed: false, error_code: 'INVALID_CONFIGURATION_TRANSITION', blocked_reason: 'configuration_unregister_not_allowed' };
  }
  configurations.delete(configurationId);
  histories.delete(configurationId);
  return { ok: true, removed: true, configuration_id: configurationId };
}

function applyPatch(current, request, patch = {}, context = {}) {
  const targetStatus = getConfigurationTargetStatus(current.configuration_status, request.operation);
  if (!targetStatus) {
    return {
      ok: false,
      errorCode: 'INVALID_CONFIGURATION_TRANSITION',
      blockedReason: 'configuration_transition_not_allowed'
    };
  }
  const identityMutations = detectConfigurationIdentityMutation(current, patch);
  if (identityMutations.length > 0) {
    return {
      ok: false,
      errorCode: 'CONFIGURATION_IDENTITY_MUTATION_BLOCKED',
      blockedReason: identityMutations[0],
      errors: identityMutations
    };
  }
  const patchForbiddenFields = findConfigurationForbiddenFields(patch);
  if (patchForbiddenFields.length > 0) {
    return {
      ok: false,
      errorCode: 'FORBIDDEN_FIELD_DETECTED',
      blockedReason: patchForbiddenFields[0],
      errors: patchForbiddenFields
    };
  }
  if (request.operation === 'evaluate_readiness') {
    const readinessValidation = evaluateReadinessBinding(current, request, context);
    if (!readinessValidation.ok) return readinessValidation;
  }
  const candidate = sanitizeConfigurationData({
    ...current,
    ...patch,
    configuration_status: targetStatus,
    readiness_status: targetStatus === 'structurally_ready' ? 'configuration_structurally_ready' : current.readiness_status,
    configuration_version: current.configuration_version + 1,
    updated_at: context.occurredAt || current.updated_at,
    disabled: targetStatus === 'disabled' ? true : current.disabled,
    deprecated: targetStatus === 'deprecated' ? true : current.deprecated
  });
  if (request.operation === 'mark_rotation_required') {
    candidate.configuration_status = 'rotation_required';
  }
  if (request.operation === 'mark_revoked') {
    candidate.configuration_status = 'revoked';
  }
  const validation = validateProviderConfiguration(candidate, context);
  if (!validation.valid) {
    return {
      ok: false,
      errorCode: 'INVALID_PROVIDER_CONFIGURATION',
      blockedReason: 'provider_configuration_invalid',
      errors: validation.errors
    };
  }
  return { ok: true, configuration: candidate };
}

function hasArrayLengthZero(value) {
  return Array.isArray(value) && value.length === 0;
}

function evaluateReadinessBinding(current, request, context = {}) {
  const requiredContext = [
    'lifecycleRegistry',
    'adapterRegistry',
    'secretReferenceRegistry',
    'secretResolver'
  ];
  if (typeof context.readinessEvaluator !== 'function') {
    return {
      ok: false,
      errorCode: 'CONFIGURATION_READINESS_BINDING_INVALID',
      blockedReason: 'configuration_readiness_evaluator_missing'
    };
  }
  for (const field of requiredContext) {
    if (!context[field]) {
      return {
        ok: false,
        errorCode: 'CONFIGURATION_READINESS_BINDING_INVALID',
        blockedReason: `configuration_readiness_${field}_missing`
      };
    }
  }

  let readiness;
  try {
    readiness = context.readinessEvaluator(cloneValue(current), {
      lifecycleRegistry: context.lifecycleRegistry,
      adapterRegistry: context.adapterRegistry,
      secretReferenceRegistry: context.secretReferenceRegistry,
      secretResolver: context.secretResolver,
      clock: context.clock,
      trace_id: request.trace_id,
      change_id: request.change_id
    });
  } catch (_error) {
    return {
      ok: false,
      errorCode: 'CONFIGURATION_READINESS_BINDING_INVALID',
      blockedReason: 'configuration_readiness_evaluator_failed'
    };
  }

  const errors = [];
  if (!isPlainObject(readiness)) errors.push('configuration_readiness_result_invalid');
  if (isPlainObject(readiness)) {
    if (readiness.configuration_id !== current.configuration_id) errors.push('configuration_readiness_configuration_id_mismatch');
    if (readiness.connector_id !== current.connector_id) errors.push('configuration_readiness_connector_id_mismatch');
    if (readiness.provider_id !== current.provider_id) errors.push('configuration_readiness_provider_id_mismatch');
    if (readiness.adapter_id !== current.adapter_id) errors.push('configuration_readiness_adapter_id_mismatch');
    if (readiness.readiness_candidate_id !== current.readiness_candidate_id) errors.push('configuration_readiness_candidate_id_mismatch');
    if (readiness.status !== 'configuration_structurally_ready') errors.push('configuration_readiness_status_invalid');
    if (readiness.readiness_status !== 'configuration_structurally_ready') errors.push('configuration_readiness_readiness_status_invalid');
    if (readiness.ready !== true) errors.push('configuration_readiness_not_ready');
    if (readiness.simulated !== true) errors.push('configuration_readiness_simulated_invalid');
    if (readiness.executed !== false) errors.push('configuration_readiness_executed_invalid');
    if (readiness.real_provider_called !== false) errors.push('configuration_readiness_real_provider_called_invalid');
    if (readiness.can_trigger_real_execution !== false) errors.push('configuration_readiness_can_trigger_real_execution_invalid');
    if (readiness.secret_resolution_performed !== false) errors.push('configuration_readiness_secret_resolution_performed_invalid');
    if (readiness.secret_value_exposed !== false) errors.push('configuration_readiness_secret_value_exposed_invalid');
    if (!hasArrayLengthZero(readiness.blocking_reasons)) errors.push('configuration_readiness_blocking_reasons_present');
    if (readiness.error !== null) errors.push('configuration_readiness_error_present');
    errors.push(...findConfigurationForbiddenFields(readiness).map((field) => `configuration_readiness_${field}`));
  }
  if (errors.length > 0) {
    return {
      ok: false,
      errorCode: 'CONFIGURATION_READINESS_BINDING_INVALID',
      blockedReason: uniqueSorted(errors)[0],
      errors: uniqueSorted(errors)
    };
  }
  return { ok: true };
}

function markProcessed(processedChangeIds, changeId) {
  if (isNonEmptyString(changeId) && processedChangeIds instanceof Set) processedChangeIds.add(changeId);
}

function applyConfigurationChangeInternal(configurations, histories, processedChangeIds, maxHistory, request, patch = {}, context = {}) {
  const occurredAt = typeof context.clock === 'function' ? context.clock() : new Date().toISOString();
  if (!(configurations instanceof Map) || !(histories instanceof Map) || !(processedChangeIds instanceof Set)) {
    return buildSafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'registry_storage_invalid',
      errorCode: 'INTERNAL_CONFIGURATION_ERROR',
      occurredAt
    });
  }
  const changeId = request && request.change_id;
  if (isNonEmptyString(changeId) && processedChangeIds.has(changeId)) {
    return buildSafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'replayed_configuration_request',
      errorCode: 'REPLAYED_CONFIGURATION_REQUEST',
      occurredAt
    });
  }
  markProcessed(processedChangeIds, changeId);
  const requestValidation = validateConfigurationChangeRequest(request);
  if (!requestValidation.valid) {
    return buildSafeResult(request, {
      status: 'configuration_invalid',
      blockedReason: 'configuration_change_request_invalid',
      errorCode: 'INVALID_PROVIDER_CONFIGURATION',
      occurredAt
    });
  }
  const current = configurations.get(request.configuration_id);
  if (!current) {
    return buildSafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'configuration_not_found',
      errorCode: 'CONFIGURATION_NOT_FOUND',
      occurredAt
    });
  }
  if (current.configuration_version !== request.expected_version) {
    return buildSafeResult(request, {
      current,
      status: 'configuration_blocked',
      blockedReason: 'version_conflict',
      errorCode: 'VERSION_CONFLICT',
      occurredAt
    });
  }
  const patched = applyPatch(current, request, patch, { ...context, occurredAt });
  if (!patched.ok) {
    return buildSafeResult(request, {
      current,
      status: 'configuration_blocked',
      blockedReason: patched.blockedReason,
      errorCode: patched.errorCode,
      occurredAt
    });
  }
  configurations.set(request.configuration_id, patched.configuration);
  const audit = buildConfigurationAuditEventCandidate({
    trace_id: request.trace_id,
    change_id: request.change_id,
    configuration_id: request.configuration_id,
    connector_id: current.connector_id,
    provider_id: current.provider_id,
    adapter_id: current.adapter_id,
    previous_status: current.configuration_status,
    current_status: patched.configuration.configuration_status,
    operation: request.operation,
    applied: true,
    occurred_at: occurredAt
  });
  appendHistory(histories, request.configuration_id, audit, maxHistory);
  return {
    trace_id: request.trace_id,
    change_id: request.change_id,
    configuration_id: request.configuration_id,
    previous_version: current.configuration_version,
    new_version: patched.configuration.configuration_version,
    previous_status: current.configuration_status,
    current_status: patched.configuration.configuration_status,
    operation: request.operation,
    status: 'configuration_change_applied',
    applied: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: [],
    warnings: [],
    error: null,
    configuration: cloneValue(patched.configuration),
    audit_event_candidate: audit
  };
}

function getStorage(registry) {
  return REGISTRY_STORAGE.get(registry) || null;
}

function getConfigurationInternal(configurations, configurationId) {
  if (!(configurations instanceof Map) || !isNonEmptyString(configurationId)) return null;
  return cloneValue(configurations.get(configurationId));
}

function listConfigurationsInternal(configurations, filters = {}) {
  if (!(configurations instanceof Map)) return [];
  const normalized = normalizeFilters(filters);
  return sortConfigurations(Array.from(configurations.values()).filter((config) => matchesConfiguration(config, normalized)).map(cloneValue));
}

function getConfigurationHistoryInternal(histories, configurationId) {
  if (!(histories instanceof Map) || !isNonEmptyString(configurationId)) return [];
  return sortHistory((histories.get(configurationId) || []).map(cloneValue));
}

function listConfigurationHistoryInternal(histories, filters = {}) {
  if (!(histories instanceof Map)) return [];
  const normalized = normalizeFilters(filters);
  return sortHistory(Array.from(histories.values()).flat().filter((event) => matchesHistory(event, normalized)).map(cloneValue));
}

function prepareInitialConfigurations(initialConfigurations, context = {}) {
  if (!Array.isArray(initialConfigurations)) throw new Error('INVALID_INITIAL_PROVIDER_CONFIGURATION');
  const configurations = new Map();
  const histories = new Map();
  for (const config of initialConfigurations) {
    const result = registerConfigurationInternal(configurations, histories, config, context);
    if (!result.ok) throw new Error('INVALID_INITIAL_PROVIDER_CONFIGURATION');
  }
  return { configurations, histories };
}

function createProviderConfigurationRegistry(options = {}) {
  const maxHistory = normalizeMaxHistory(options.maxHistoryPerConfiguration);
  const initialConfigurations = Array.isArray(options.initialConfigurations) ? options.initialConfigurations : [];
  const storage = prepareInitialConfigurations(initialConfigurations, options.context || {});
  storage.processedChangeIds = new Set();
  storage.maxHistory = maxHistory;
  const registry = {
    registerConfiguration(config, context = {}) {
      return registerConfigurationInternal(storage.configurations, storage.histories, config, context);
    },
    unregisterConfiguration(configurationId) {
      return unregisterConfigurationInternal(storage.configurations, storage.histories, configurationId);
    },
    getConfiguration(configurationId) {
      return getConfigurationInternal(storage.configurations, configurationId);
    },
    listConfigurations(filters = {}) {
      return listConfigurationsInternal(storage.configurations, filters);
    },
    hasConfiguration(configurationId) {
      return Boolean(storage.configurations.has(configurationId));
    },
    applyConfigurationChange(request, patch = {}, context = {}) {
      return applyConfigurationChangeInternal(storage.configurations, storage.histories, storage.processedChangeIds, storage.maxHistory, request, patch, context);
    },
    getConfigurationHistory(configurationId) {
      return getConfigurationHistoryInternal(storage.histories, configurationId);
    },
    listConfigurationHistory(filters = {}) {
      return listConfigurationHistoryInternal(storage.histories, filters);
    }
  };
  REGISTRY_STORAGE.set(registry, storage);
  return Object.freeze(registry);
}

function registerConfiguration(registry, config, context = {}) {
  const storage = REGISTRY_STORAGE.get(registry);
  return registerConfigurationInternal(storage && storage.configurations, storage && storage.histories, config, context);
}

function unregisterConfiguration(registry, configurationId) {
  const storage = REGISTRY_STORAGE.get(registry);
  return unregisterConfigurationInternal(storage && storage.configurations, storage && storage.histories, configurationId);
}

function getConfiguration(registry, configurationId) {
  const storage = REGISTRY_STORAGE.get(registry);
  return getConfigurationInternal(storage && storage.configurations, configurationId);
}

function listConfigurations(registry, filters = {}) {
  const storage = REGISTRY_STORAGE.get(registry);
  return listConfigurationsInternal(storage && storage.configurations, filters);
}

function hasConfiguration(registry, configurationId) {
  const storage = REGISTRY_STORAGE.get(registry);
  return Boolean(storage && storage.configurations instanceof Map && storage.configurations.has(configurationId));
}

function applyConfigurationChange(registry, request, patch = {}, context = {}) {
  const storage = REGISTRY_STORAGE.get(registry);
  return applyConfigurationChangeInternal(storage && storage.configurations, storage && storage.histories, storage && storage.processedChangeIds, storage && storage.maxHistory, request, patch, context);
}

function getConfigurationHistory(registry, configurationId) {
  const storage = REGISTRY_STORAGE.get(registry);
  return getConfigurationHistoryInternal(storage && storage.histories, configurationId);
}

module.exports = {
  createProviderConfigurationRegistry,
  registerConfiguration,
  unregisterConfiguration,
  getConfiguration,
  listConfigurations,
  hasConfiguration,
  applyConfigurationChange,
  getConfigurationHistory,
  listConfigurationHistory: (registry, filters = {}) => {
    const storage = REGISTRY_STORAGE.get(registry);
    return listConfigurationHistoryInternal(storage && storage.histories, filters);
  },
  buildSafeConfigurationError
};

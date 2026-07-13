'use strict';

const {
  buildConfigurationAuditEventCandidate,
  buildSafeConfigurationError,
  deepClone,
  isNonEmptyString,
  isPlainObject,
  sanitizeConfigurationData,
  uniqueSorted,
  validateConfigurationChangeRequest,
  validateProviderConfiguration
} = require('./provider-configuration-contract');

const REGISTRY_STORAGE = new WeakMap();
const DEFAULT_MAX_HISTORY_PER_CONFIGURATION = 100;
const MAX_HISTORY_PER_CONFIGURATION = 1000;

function cloneConfig(config) {
  return config ? deepClone(config) : null;
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

function configMatchesFilters(config, filters) {
  if (filters.configuration_id && config.configuration_id !== filters.configuration_id) return false;
  if (filters.provider_id && config.provider_id !== filters.provider_id) return false;
  if (filters.adapter_id && config.adapter_id !== filters.adapter_id) return false;
  if (filters.connector_id && config.connector_id !== filters.connector_id) return false;
  if (filters.workspace_type && config.workspace_type !== filters.workspace_type) return false;
  if (filters.tenant_id && config.tenant_id !== filters.tenant_id) return false;
  return true;
}

function historyMatchesFilters(event, filters) {
  if (filters.configuration_id && event.configuration_id !== filters.configuration_id) return false;
  if (filters.provider_id && event.provider_id !== filters.provider_id) return false;
  if (filters.status && event.status !== filters.status) return false;
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
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors
    };
  }
  return {
    valid: true,
    configuration: sanitizeConfigurationData(config)
  };
}

function buildRegistrySafeResult(request, fields = {}) {
  const status = fields.status || 'configuration_blocked';
  const blockedReason = fields.blockedReason || 'configuration_operation_blocked';
  const errorCode = fields.errorCode || 'INTERNAL_CONFIGURATION_ERROR';
  const previousVersion = Number.isInteger(fields.previousVersion) ? fields.previousVersion : 0;
  const newVersion = Number.isInteger(fields.newVersion) ? fields.newVersion : previousVersion;
  const occurredAt = fields.occurredAt || new Date(0).toISOString();
  const audit = buildConfigurationAuditEventCandidate({
    trace_id: request && request.trace_id,
    change_id: request && request.change_id,
    configuration_id: request && request.configuration_id,
    provider_id: fields.providerId,
    adapter_id: fields.adapterId,
    connector_id: fields.connectorId,
    workspace_type: fields.workspaceType,
    tenant_id: fields.tenantId,
    status,
    applied: false,
    previous_version: previousVersion,
    new_version: newVersion,
    actor_id: request && request.actor_id,
    actor_role: request && request.actor_role,
    error_code: errorCode,
    blocked_reason: blockedReason,
    occurred_at: occurredAt
  });

  return {
    trace_id: request && request.trace_id ? request.trace_id : 'trace_not_available',
    change_id: request && request.change_id ? request.change_id : 'change_not_available',
    configuration_id: request && request.configuration_id ? request.configuration_id : 'configuration_not_available',
    previous_version: previousVersion,
    new_version: newVersion,
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

function registerConfigurationInternal(configurations, config, context = {}) {
  if (!(configurations instanceof Map)) {
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
  if (normalized.configuration.configuration_version !== 1) {
    return {
      ok: false,
      error_code: 'INVALID_PROVIDER_CONFIGURATION',
      blocked_reason: 'initial_configuration_version_must_be_1'
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
  return {
    ok: true,
    configuration_id: normalized.configuration.configuration_id,
    configuration_version: normalized.configuration.configuration_version,
    status: normalized.configuration.configuration_status
  };
}

function unregisterConfigurationInternal(configurations, histories, configurationId) {
  if (!(configurations instanceof Map) || !isNonEmptyString(configurationId)) {
    return {
      ok: false,
      removed: false,
      error_code: 'INVALID_PROVIDER_CONFIGURATION',
      blocked_reason: 'configuration_id_invalid'
    };
  }
  if (!configurations.has(configurationId)) {
    return {
      ok: false,
      removed: false,
      error_code: 'CONFIGURATION_NOT_FOUND',
      blocked_reason: 'configuration_not_found'
    };
  }
  configurations.delete(configurationId);
  if (histories instanceof Map) histories.delete(configurationId);
  return {
    ok: true,
    removed: true,
    configuration_id: configurationId
  };
}

function appendHistory(histories, configurationId, event, maxHistory) {
  if (!(histories instanceof Map) || !isNonEmptyString(configurationId) || !event) return;
  const current = histories.get(configurationId) || [];
  const next = current.concat([sanitizeConfigurationData(event)]);
  histories.set(configurationId, next.slice(Math.max(0, next.length - maxHistory)));
}

function applyConfigurationChangeInternal(configurations, histories, processedChangeIds, maxHistory, request, nextConfiguration, context = {}) {
  const occurredAt = typeof context.clock === 'function' ? context.clock() : new Date().toISOString();
  if (!(configurations instanceof Map) || !(histories instanceof Map) || !(processedChangeIds instanceof Set)) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'registry_storage_invalid',
      errorCode: 'INTERNAL_CONFIGURATION_ERROR',
      occurredAt
    });
  }
  const requestValidation = validateConfigurationChangeRequest(request);
  if (!requestValidation.valid) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_invalid',
      blockedReason: 'configuration_change_request_invalid',
      errorCode: 'INVALID_PROVIDER_CONFIGURATION',
      occurredAt
    });
  }
  if (processedChangeIds.has(request.change_id)) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'replayed_configuration_change',
      errorCode: 'REPLAYED_CONFIGURATION_CHANGE',
      occurredAt
    });
  }
  const current = configurations.get(request.configuration_id);
  if (!current) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'configuration_not_found',
      errorCode: 'CONFIGURATION_NOT_FOUND',
      occurredAt
    });
  }
  if (current.configuration_version !== request.expected_version) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_blocked',
      blockedReason: 'version_conflict',
      errorCode: 'VERSION_CONFLICT',
      previousVersion: current.configuration_version,
      newVersion: current.configuration_version,
      providerId: current.provider_id,
      adapterId: current.adapter_id,
      connectorId: current.connector_id,
      workspaceType: current.workspace_type,
      tenantId: current.tenant_id,
      occurredAt
    });
  }

  const candidate = {
    ...sanitizeConfigurationData(nextConfiguration),
    configuration_id: current.configuration_id,
    configuration_version: current.configuration_version + 1
  };
  const normalized = normalizeConfiguration(candidate, context);
  if (!normalized.valid) {
    return buildRegistrySafeResult(request, {
      status: 'configuration_invalid',
      blockedReason: 'provider_configuration_invalid',
      errorCode: 'INVALID_PROVIDER_CONFIGURATION',
      previousVersion: current.configuration_version,
      newVersion: current.configuration_version,
      providerId: current.provider_id,
      adapterId: current.adapter_id,
      connectorId: current.connector_id,
      workspaceType: current.workspace_type,
      tenantId: current.tenant_id,
      occurredAt
    });
  }

  configurations.set(request.configuration_id, normalized.configuration);
  processedChangeIds.add(request.change_id);
  const audit = buildConfigurationAuditEventCandidate({
    trace_id: request.trace_id,
    change_id: request.change_id,
    configuration_id: request.configuration_id,
    provider_id: normalized.configuration.provider_id,
    adapter_id: normalized.configuration.adapter_id,
    connector_id: normalized.configuration.connector_id,
    workspace_type: normalized.configuration.workspace_type,
    tenant_id: normalized.configuration.tenant_id,
    status: 'configuration_registered',
    applied: true,
    previous_version: current.configuration_version,
    new_version: normalized.configuration.configuration_version,
    actor_id: request.actor_id,
    actor_role: request.actor_role,
    occurred_at: occurredAt
  });
  appendHistory(histories, request.configuration_id, audit, maxHistory);

  return {
    trace_id: request.trace_id,
    change_id: request.change_id,
    configuration_id: request.configuration_id,
    previous_version: current.configuration_version,
    new_version: normalized.configuration.configuration_version,
    status: 'configuration_registered',
    applied: true,
    simulated: true,
    executed: false,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocking_reasons: [],
    warnings: [],
    error: null,
    configuration: cloneConfig(normalized.configuration),
    audit_event_candidate: audit
  };
}

function getStorage(registry) {
  return REGISTRY_STORAGE.get(registry) || null;
}

function getConfigurationInternal(configurations, configurationId) {
  if (!(configurations instanceof Map) || !isNonEmptyString(configurationId)) return null;
  return cloneConfig(configurations.get(configurationId));
}

function listConfigurationsInternal(configurations, filters = {}) {
  if (!(configurations instanceof Map)) return [];
  const normalized = normalizeFilters(filters);
  return sortConfigurations(Array.from(configurations.values())
    .filter((config) => configMatchesFilters(config, normalized))
    .map(cloneConfig));
}

function getConfigurationHistoryInternal(histories, configurationId) {
  if (!(histories instanceof Map) || !isNonEmptyString(configurationId)) return [];
  return sortHistory((histories.get(configurationId) || []).map(cloneConfig));
}

function listConfigurationHistoryInternal(histories, filters = {}) {
  if (!(histories instanceof Map)) return [];
  const normalized = normalizeFilters(filters);
  return sortHistory(Array.from(histories.values())
    .flat()
    .filter((event) => historyMatchesFilters(event, normalized))
    .map(cloneConfig));
}

function registerConfiguration(registry, config, context = {}) {
  const storage = getStorage(registry);
  const result = registerConfigurationInternal(storage && storage.configurations, config, context);
  if (result.ok && storage && storage.histories) storage.histories.set(result.configuration_id, []);
  return result;
}

function unregisterConfiguration(registry, configurationId) {
  const storage = getStorage(registry);
  return unregisterConfigurationInternal(storage && storage.configurations, storage && storage.histories, configurationId);
}

function getConfiguration(registry, configurationId) {
  const storage = getStorage(registry);
  return getConfigurationInternal(storage && storage.configurations, configurationId);
}

function listConfigurations(registry, filters = {}) {
  const storage = getStorage(registry);
  return listConfigurationsInternal(storage && storage.configurations, filters);
}

function hasConfiguration(registry, configurationId) {
  const storage = getStorage(registry);
  return Boolean(storage && storage.configurations instanceof Map && storage.configurations.has(configurationId));
}

function applyConfigurationChange(registry, request, nextConfiguration, context = {}) {
  const storage = getStorage(registry);
  return applyConfigurationChangeInternal(
    storage && storage.configurations,
    storage && storage.histories,
    storage && storage.processedChangeIds,
    storage && storage.maxHistory,
    request,
    nextConfiguration,
    context
  );
}

function getConfigurationHistory(registry, configurationId) {
  const storage = getStorage(registry);
  return getConfigurationHistoryInternal(storage && storage.histories, configurationId);
}

function listConfigurationHistory(registry, filters = {}) {
  const storage = getStorage(registry);
  return listConfigurationHistoryInternal(storage && storage.histories, filters);
}

function prepareInitialConfigurations(initialConfigurations, context = {}) {
  if (!Array.isArray(initialConfigurations)) throw new Error('INVALID_INITIAL_PROVIDER_CONFIGURATION');
  const configurations = new Map();
  const histories = new Map();
  for (const config of initialConfigurations) {
    const result = registerConfigurationInternal(configurations, config, context);
    if (!result.ok) throw new Error('INVALID_INITIAL_PROVIDER_CONFIGURATION');
    histories.set(result.configuration_id, []);
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
      const result = registerConfigurationInternal(storage.configurations, config, context);
      if (result.ok) storage.histories.set(result.configuration_id, []);
      return result;
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
      return hasConfiguration(this, configurationId);
    },
    applyConfigurationChange(request, nextConfiguration, context = {}) {
      return applyConfigurationChangeInternal(storage.configurations, storage.histories, storage.processedChangeIds, storage.maxHistory, request, nextConfiguration, context);
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

module.exports = {
  createProviderConfigurationRegistry,
  registerConfiguration,
  unregisterConfiguration,
  getConfiguration,
  listConfigurations,
  hasConfiguration,
  applyConfigurationChange,
  getConfigurationHistory,
  listConfigurationHistory,
  buildSafeConfigurationError
};

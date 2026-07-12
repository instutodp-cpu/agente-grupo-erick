'use strict';

const {
  deepClone,
  isPlainObject,
  isNonEmptyString,
  validateAdapterMetadata
} = require('./read-only-adapter-contract');

function freezeMetadata(metadata) {
  return Object.freeze(deepClone(metadata));
}

function cloneAdapter(adapter) {
  if (!adapter) return null;
  return {
    metadata: deepClone(adapter.metadata),
    validateRequest: adapter.validateRequest,
    execute: adapter.execute,
    sanitizeResponse: adapter.sanitizeResponse,
    buildAuditEvent: adapter.buildAuditEvent
  };
}

function normalizeAdapter(adapter) {
  if (!isPlainObject(adapter) || !isPlainObject(adapter.metadata)) {
    return {
      valid: false,
      errors: ['adapter_must_have_metadata']
    };
  }

  const validation = validateAdapterMetadata(adapter.metadata);
  if (!validation.valid) {
    return {
      valid: false,
      errors: validation.errors
    };
  }

  if (adapter.metadata.adapter_kind === 'mock' && typeof adapter.execute !== 'function') {
    return {
      valid: false,
      errors: ['mock_adapter_execute_required']
    };
  }

  return {
    valid: true,
    adapter: {
      metadata: freezeMetadata(adapter.metadata),
      validateRequest: typeof adapter.validateRequest === 'function' ? adapter.validateRequest : null,
      execute: typeof adapter.execute === 'function' ? adapter.execute : null,
      sanitizeResponse: typeof adapter.sanitizeResponse === 'function' ? adapter.sanitizeResponse : null,
      buildAuditEvent: typeof adapter.buildAuditEvent === 'function' ? adapter.buildAuditEvent : null
    }
  };
}

function registerAdapter(registry, adapter) {
  if (!registry || !(registry._adapters instanceof Map)) {
    return {
      ok: false,
      error_code: 'INVALID_ADAPTER_REGISTRY',
      blocked_reason: 'registry_invalid'
    };
  }

  const normalized = normalizeAdapter(adapter);
  if (!normalized.valid) {
    return {
      ok: false,
      error_code: 'INVALID_ADAPTER_METADATA',
      blocked_reason: 'adapter_metadata_invalid',
      errors: normalized.errors.slice().sort()
    };
  }

  const adapterId = normalized.adapter.metadata.adapter_id;
  if (registry._adapters.has(adapterId)) {
    return {
      ok: false,
      error_code: 'DUPLICATE_ADAPTER',
      blocked_reason: 'adapter_duplicate'
    };
  }

  registry._adapters.set(adapterId, normalized.adapter);
  return {
    ok: true,
    adapter_id: adapterId,
    adapter_kind: normalized.adapter.metadata.adapter_kind
  };
}

function unregisterAdapter(registry, adapterId) {
  if (!registry || !(registry._adapters instanceof Map) || !isNonEmptyString(adapterId)) {
    return { ok: false, removed: false };
  }

  return {
    ok: true,
    removed: registry._adapters.delete(adapterId)
  };
}

function getAdapter(registry, adapterId) {
  if (!registry || !(registry._adapters instanceof Map) || !isNonEmptyString(adapterId)) {
    return null;
  }

  return cloneAdapter(registry._adapters.get(adapterId));
}

function listAdapters(registry) {
  if (!registry || !(registry._adapters instanceof Map)) return [];
  return Array.from(registry._adapters.values())
    .map(cloneAdapter)
    .sort((a, b) => a.metadata.adapter_id.localeCompare(b.metadata.adapter_id));
}

function hasAdapter(registry, adapterId) {
  return Boolean(registry && registry._adapters instanceof Map && registry._adapters.has(adapterId));
}

function createReadOnlyAdapterRegistry(initialAdapters = []) {
  const registry = {
    _adapters: new Map()
  };

  Object.defineProperties(registry, {
    registerAdapter: {
      enumerable: true,
      value: (adapter) => registerAdapter(registry, adapter)
    },
    unregisterAdapter: {
      enumerable: true,
      value: (adapterId) => unregisterAdapter(registry, adapterId)
    },
    getAdapter: {
      enumerable: true,
      value: (adapterId) => getAdapter(registry, adapterId)
    },
    listAdapters: {
      enumerable: true,
      value: () => listAdapters(registry)
    },
    hasAdapter: {
      enumerable: true,
      value: (adapterId) => hasAdapter(registry, adapterId)
    }
  });

  for (const adapter of initialAdapters) {
    registerAdapter(registry, adapter);
  }

  return registry;
}

module.exports = {
  createReadOnlyAdapterRegistry,
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  listAdapters,
  hasAdapter
};

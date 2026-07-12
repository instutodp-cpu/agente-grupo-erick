'use strict';

const {
  deepClone,
  isPlainObject,
  isNonEmptyString,
  validateAdapterMetadata
} = require('./read-only-adapter-contract');

const REGISTRY_STORAGE = new WeakMap();

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

function registerAdapterInternal(adapters, adapter) {
  if (!(adapters instanceof Map)) {
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
  if (adapters.has(adapterId)) {
    return {
      ok: false,
      error_code: 'DUPLICATE_ADAPTER',
      blocked_reason: 'adapter_duplicate'
    };
  }

  adapters.set(adapterId, normalized.adapter);
  return {
    ok: true,
    adapter_id: adapterId,
    adapter_kind: normalized.adapter.metadata.adapter_kind
  };
}

function unregisterAdapterInternal(adapters, adapterId) {
  if (!(adapters instanceof Map) || !isNonEmptyString(adapterId)) {
    return { ok: false, removed: false };
  }

  return {
    ok: true,
    removed: adapters.delete(adapterId)
  };
}

function getAdapterInternal(adapters, adapterId) {
  if (!(adapters instanceof Map) || !isNonEmptyString(adapterId)) {
    return null;
  }

  return cloneAdapter(adapters.get(adapterId));
}

function listAdaptersInternal(adapters) {
  if (!(adapters instanceof Map)) return [];
  return Array.from(adapters.values())
    .map(cloneAdapter)
    .sort((a, b) => a.metadata.adapter_id.localeCompare(b.metadata.adapter_id));
}

function hasAdapterInternal(adapters, adapterId) {
  return Boolean(adapters instanceof Map && adapters.has(adapterId));
}

function getStorage(registry) {
  return REGISTRY_STORAGE.get(registry) || null;
}

function registerAdapter(registry, adapter) {
  return registerAdapterInternal(getStorage(registry), adapter);
}

function unregisterAdapter(registry, adapterId) {
  return unregisterAdapterInternal(getStorage(registry), adapterId);
}

function getAdapter(registry, adapterId) {
  return getAdapterInternal(getStorage(registry), adapterId);
}

function listAdapters(registry) {
  return listAdaptersInternal(getStorage(registry));
}

function hasAdapter(registry, adapterId) {
  return hasAdapterInternal(getStorage(registry), adapterId);
}

function prepareInitialAdapters(initialAdapters) {
  if (!Array.isArray(initialAdapters)) {
    throw new Error('INVALID_INITIAL_ADAPTER');
  }

  const adapters = new Map();
  for (const adapter of initialAdapters) {
    const result = registerAdapterInternal(adapters, adapter);
    if (!result.ok) {
      throw new Error('INVALID_INITIAL_ADAPTER');
    }
  }

  return adapters;
}

function createReadOnlyAdapterRegistry(initialAdapters = []) {
  const adapters = prepareInitialAdapters(initialAdapters);

  const registry = {
    registerAdapter(adapter) {
      return registerAdapterInternal(adapters, adapter);
    },
    unregisterAdapter(adapterId) {
      return unregisterAdapterInternal(adapters, adapterId);
    },
    getAdapter(adapterId) {
      return getAdapterInternal(adapters, adapterId);
    },
    listAdapters() {
      return listAdaptersInternal(adapters);
    },
    hasAdapter(adapterId) {
      return hasAdapterInternal(adapters, adapterId);
    }
  };

  REGISTRY_STORAGE.set(registry, adapters);
  return Object.freeze(registry);
}

module.exports = {
  createReadOnlyAdapterRegistry,
  registerAdapter,
  unregisterAdapter,
  getAdapter,
  listAdapters,
  hasAdapter
};

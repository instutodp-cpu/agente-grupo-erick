'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateAgentMemoryItemContract } = require('./agent-memory-item-contract');

const AGENT_MEMORY_REGISTRY_VALIDATOR_VERSION = 'agent_memory_registry_validator_v1';
const AGENT_MEMORY_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'ITEM_CONFLICT'
]);
const FORBIDDEN_AGENT_MEMORY_REGISTRY_STATUSES = Object.freeze(['STORED_REAL', 'INDEXED_REAL']);
const AGENT_MEMORY_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...AGENT_MEMORY_REGISTRY_SAFE_FLAGS });
}

function createAgentMemoryRegistry() {
  const itemsById = new Map();

  function registerMemoryItem(item, options = {}) {
    const validation = validateAgentMemoryItemContract(item);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    }
    let payload;
    try {
      payload = stablePayload(item);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const itemId = item.memory_item_id;
    const tenantId = item.tenant_id;
    const organizationId = item.organization_id;
    const itemVersion = item.memory_item_version;
    const existing = itemsById.get(itemId);

    if (existing) {
      if (existing.tenant_id !== tenantId) {
        return safe({ ok: false, status: 'TENANT_BLOCKED', errors: ['memory_item_tenant_reassignment_blocked'] });
      }
      if (existing.organization_id !== organizationId) {
        return safe({ ok: false, status: 'ORGANIZATION_BLOCKED', errors: ['memory_item_organization_reassignment_blocked'] });
      }
      if (existing.agent_id !== item.agent_id) {
        return safe({ ok: false, status: 'ITEM_CONFLICT', errors: ['memory_item_agent_identity_conflict'] });
      }
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', memory_item_id: itemId, memory_item_version: existing.memory_item_version, fingerprint: payload });
      }
      if (itemVersion === existing.memory_item_version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['memory_item_payload_mismatch'] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.memory_item_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['memory_item_optimistic_conflict'] });
      }
      if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
        return safe({ ok: false, status: 'FINGERPRINT_CONFLICT', errors: ['memory_item_fingerprint_conflict'] });
      }
      if (itemVersion < existing.memory_item_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['memory_item_version_downgrade'] });
      }
      const stored = cloneFrozen(item);
      itemsById.set(itemId, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, agent_id: item.agent_id, memory_item_version: itemVersion });
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', memory_item_id: itemId, memory_item_version: itemVersion, fingerprint: payload });
    }

    if (options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['memory_item_optimistic_conflict'] });
    }
    const stored = cloneFrozen(item);
    itemsById.set(itemId, { record: stored, fingerprint: payload, tenant_id: tenantId, organization_id: organizationId, agent_id: item.agent_id, memory_item_version: itemVersion });
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', memory_item_id: itemId, memory_item_version: itemVersion, fingerprint: payload });
  }

  function getByMemoryItemId(memoryItemId) {
    if (!isNonEmptyString(memoryItemId)) return null;
    const entry = itemsById.get(memoryItemId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function getByTenantAndMemoryItemId(tenantId, memoryItemId) {
    if (!isNonEmptyString(tenantId) || !isNonEmptyString(memoryItemId)) return null;
    const entry = itemsById.get(memoryItemId);
    if (!entry || entry.tenant_id !== tenantId) return null;
    return cloneFrozen(entry.record);
  }

  function listByTenant(tenantId, filters = {}) {
    if (!isNonEmptyString(tenantId)) return [];
    const organizationId = isPlainObject(filters) && isNonEmptyString(filters.organization_id) ? filters.organization_id : null;
    const agentId = isPlainObject(filters) && isNonEmptyString(filters.agent_id) ? filters.agent_id : null;
    const sessionReferenceId = isPlainObject(filters) && isNonEmptyString(filters.session_reference_id) ? filters.session_reference_id : null;
    const memoryType = isPlainObject(filters) && isNonEmptyString(filters.memory_type) ? filters.memory_type : null;
    const classification = isPlainObject(filters) && isNonEmptyString(filters.classification) ? filters.classification : null;
    const results = [];
    for (const entry of itemsById.values()) {
      if (entry.tenant_id !== tenantId) continue;
      if (organizationId && entry.record.organization_id !== organizationId) continue;
      if (agentId && entry.record.agent_id !== agentId) continue;
      if (sessionReferenceId && entry.record.session_reference_id !== sessionReferenceId) continue;
      if (memoryType && entry.record.memory_type !== memoryType) continue;
      if (classification && entry.record.classification !== classification) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a.memory_item_id < b.memory_item_id ? -1 : a.memory_item_id > b.memory_item_id ? 1 : 0));
  }

  return Object.freeze({
    registerMemoryItem,
    getByMemoryItemId,
    getByTenantAndMemoryItemId,
    listByTenant
  });
}

module.exports = {
  AGENT_MEMORY_REGISTRY_SAFE_FLAGS,
  AGENT_MEMORY_REGISTRY_STATUSES,
  AGENT_MEMORY_REGISTRY_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_MEMORY_REGISTRY_STATUSES,
  MAX_LIST_RESULTS,
  createAgentMemoryRegistry
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateAgentCoreContract } = require('./agent-core-contract');

const AGENT_REGISTRY_VALIDATOR_VERSION = 'agent_registry_validator_v1';
const AGENT_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION',
  'REPLAY_ACCEPTED',
  'PAYLOAD_MISMATCH',
  'VERSION_CONFLICT',
  'VALIDATION_FAILED',
  'TENANT_BLOCKED'
]);
const FORBIDDEN_AGENT_REGISTRY_STATUSES = Object.freeze(['REGISTERED_REAL']);
const AGENT_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...AGENT_REGISTRY_SAFE_FLAGS });
}

function slugKey(tenantId, slug) {
  return `${tenantId}::${slug}`;
}

function createAgentRegistry() {
  const recordsById = new Map();
  const idBySlug = new Map();

  function registerAgentContract(contract, options = {}) {
    const validation = validateAgentCoreContract(contract);
    if (!validation.valid) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: uniqueSorted(validation.errors) });
    }
    if (contract.contract_status !== 'VALIDATED_SIMULATION') {
      const status = contract.contract_status === 'TENANT_BLOCKED' ? 'TENANT_BLOCKED' : 'VALIDATION_FAILED';
      return safe({ ok: false, status, errors: uniqueSorted(contract.validation_summary.validation_errors) });
    }
    let payload;
    try {
      payload = stablePayload(contract);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const agentId = contract.identity.agent_id;
    const tenantId = contract.identity.tenant_id;
    const agentSlug = contract.identity.agent_slug;
    const contractVersion = contract.contract_version;
    const existing = recordsById.get(agentId);

    if (existing) {
      if (existing.fingerprint === payload) {
        return safe({ ok: true, status: 'REPLAY_ACCEPTED', agent_id: agentId, tenant_id: tenantId, contract_version: existing.contract_version, fingerprint: payload });
      }
      if (contractVersion === existing.contract_version) {
        return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['agent_contract_payload_mismatch'] });
      }
      if (options.expected_version !== undefined && options.expected_version !== existing.contract_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_contract_optimistic_conflict'] });
      }
      if (contractVersion < existing.contract_version) {
        return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_contract_version_downgrade'] });
      }
      if (existing.tenant_id !== tenantId) {
        return safe({ ok: false, status: 'TENANT_BLOCKED', errors: ['agent_tenant_reassignment_blocked'] });
      }
      const storedRecord = cloneFrozen(contract);
      recordsById.set(agentId, { record: storedRecord, fingerprint: payload, tenant_id: tenantId, agent_slug: agentSlug, contract_version: contractVersion });
      if (existing.agent_slug !== agentSlug) idBySlug.delete(slugKey(existing.tenant_id, existing.agent_slug));
      idBySlug.set(slugKey(tenantId, agentSlug), agentId);
      return safe({ ok: true, status: 'REGISTERED_SIMULATION', agent_id: agentId, tenant_id: tenantId, contract_version: contractVersion, fingerprint: payload });
    }

    if (options.expected_version !== undefined && options.expected_version !== 0) {
      return safe({ ok: false, status: 'VERSION_CONFLICT', errors: ['agent_contract_optimistic_conflict'] });
    }
    const slugOwner = idBySlug.get(slugKey(tenantId, agentSlug));
    if (slugOwner && slugOwner !== agentId) {
      return safe({ ok: false, status: 'PAYLOAD_MISMATCH', errors: ['agent_slug_already_registered_for_tenant'] });
    }
    const storedRecord = cloneFrozen(contract);
    recordsById.set(agentId, { record: storedRecord, fingerprint: payload, tenant_id: tenantId, agent_slug: agentSlug, contract_version: contractVersion });
    idBySlug.set(slugKey(tenantId, agentSlug), agentId);
    return safe({ ok: true, status: 'REGISTERED_SIMULATION', agent_id: agentId, tenant_id: tenantId, contract_version: contractVersion, fingerprint: payload });
  }

  function getByAgentId(agentId) {
    if (!isNonEmptyString(agentId)) return null;
    const entry = recordsById.get(agentId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function getBySlugAndTenant(agentSlug, tenantId) {
    if (!isNonEmptyString(agentSlug) || !isNonEmptyString(tenantId)) return null;
    const agentId = idBySlug.get(slugKey(tenantId, agentSlug));
    return agentId ? getByAgentId(agentId) : null;
  }

  function listByTenant(tenantId, filters = {}) {
    if (!isNonEmptyString(tenantId)) return [];
    const agentType = isPlainObject(filters) && isNonEmptyString(filters.agent_type) ? filters.agent_type : null;
    const status = isPlainObject(filters) && isNonEmptyString(filters.status) ? filters.status : null;
    const results = [];
    for (const entry of recordsById.values()) {
      if (entry.tenant_id !== tenantId) continue;
      if (agentType && entry.record.identity.agent_type !== agentType) continue;
      if (status && entry.record.identity.status !== status) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a.identity.agent_id < b.identity.agent_id ? -1 : a.identity.agent_id > b.identity.agent_id ? 1 : 0));
  }

  return Object.freeze({
    registerAgentContract,
    getByAgentId,
    getBySlugAndTenant,
    listByTenant
  });
}

module.exports = {
  AGENT_REGISTRY_SAFE_FLAGS,
  AGENT_REGISTRY_STATUSES,
  AGENT_REGISTRY_VALIDATOR_VERSION,
  FORBIDDEN_AGENT_REGISTRY_STATUSES,
  MAX_LIST_RESULTS,
  createAgentRegistry
};

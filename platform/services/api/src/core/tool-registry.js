'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateToolContract } = require('./tool-contract');
const { validateToolCapabilityContract } = require('./tool-capability-contract');
const { validateToolPermissionContract } = require('./tool-permission-contract');
const { validateToolCostContract } = require('./tool-cost-contract');
const { validateToolSideEffectsContract } = require('./tool-side-effects-contract');
const { validateToolDecision } = require('./tool-decision');

const TOOL_REGISTRY_VALIDATOR_VERSION = 'tool_registry_validator_v1';
const TOOL_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const TOOL_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...TOOL_REGISTRY_SAFE_FLAGS });
}

const NO_VERSION_FIELD_SENTINEL = 1;

function resolveRegistration(existing, id, payload, rawVersion, options, idLabel) {
  const hasVersionField = rawVersion !== undefined;
  const version = hasVersionField ? rawVersion : NO_VERSION_FIELD_SENTINEL;
  if (existing) {
    if (existing.tenant_id !== undefined && existing.tenant_id !== payload.tenant_id) {
      return { ok: false, status: 'TENANT_BLOCKED', errors: [`${idLabel}_tenant_reassignment_blocked`] };
    }
    if (existing.organization_id !== undefined && existing.organization_id !== payload.organization_id) {
      return { ok: false, status: 'ORGANIZATION_BLOCKED', errors: [`${idLabel}_organization_reassignment_blocked`] };
    }
    if (existing.fingerprint === payload.fingerprint) {
      return { ok: true, status: 'REPLAY_ACCEPTED', id, version: existing.version, fingerprint: payload.fingerprint };
    }
    if (!hasVersionField) {
      return { ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idLabel}_payload_mismatch`] };
    }
    if (version === existing.version) {
      return { ok: false, status: 'PAYLOAD_MISMATCH', errors: [`${idLabel}_payload_mismatch`] };
    }
    if (options.expected_version !== undefined && options.expected_version !== existing.version) {
      return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_optimistic_conflict`] };
    }
    if (options.expected_fingerprint !== undefined && options.expected_fingerprint !== existing.fingerprint) {
      return { ok: false, status: 'FINGERPRINT_CONFLICT', errors: [`${idLabel}_fingerprint_conflict`] };
    }
    if (version < existing.version) {
      return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_version_downgrade`] };
    }
    return { ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload.fingerprint };
  }
  if (hasVersionField && options.expected_version !== undefined && options.expected_version !== 0) {
    return { ok: false, status: 'VERSION_CONFLICT', errors: [`${idLabel}_optimistic_conflict`] };
  }
  return { ok: true, status: 'REGISTERED_SIMULATION', id, version, fingerprint: payload.fingerprint };
}

function createEntityStore(config) {
  const { idField, tenantField, organizationField, versionField, validate, idLabel } = config;
  const byId = new Map();

  function register(record, options = {}) {
    const validation = validate(record);
    if (!validation.valid) return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    let fingerprint;
    try {
      fingerprint = stablePayload(record);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const id = record[idField];
    const tenantId = tenantField ? record[tenantField] : undefined;
    const organizationId = organizationField ? record[organizationField] : undefined;
    const version = versionField ? record[versionField] : undefined;
    const existing = byId.get(id);
    const resolution = resolveRegistration(
      existing,
      id,
      { tenant_id: tenantId, organization_id: organizationId, fingerprint },
      version,
      options,
      idLabel
    );
    if (resolution.ok) {
      byId.set(id, { record: cloneFrozen(record), fingerprint, tenant_id: tenantId, organization_id: organizationId, version: resolution.version });
    }
    return safe(resolution);
  }

  function getById(id) {
    if (!isNonEmptyString(id)) return null;
    const entry = byId.get(id);
    return entry ? cloneFrozen(entry.record) : null;
  }

  function listAll(predicate) {
    const results = [];
    for (const entry of byId.values()) {
      if (typeof predicate === 'function' && !predicate(entry.record)) continue;
      results.push(cloneFrozen(entry.record));
      if (results.length >= MAX_LIST_RESULTS) break;
    }
    return results.sort((a, b) => (a[idField] < b[idField] ? -1 : a[idField] > b[idField] ? 1 : 0));
  }

  function listByTenant(tenantId, predicate) {
    if (!tenantField || !isNonEmptyString(tenantId)) return [];
    return listAll((record) => record[tenantField] === tenantId && (typeof predicate !== 'function' || predicate(record)));
  }

  function listByOrganization(organizationId, predicate) {
    if (!organizationField || !isNonEmptyString(organizationId)) return [];
    return listAll((record) => record[organizationField] === organizationId && (typeof predicate !== 'function' || predicate(record)));
  }

  return Object.freeze({ register, getById, listAll, listByTenant, listByOrganization });
}

function createToolRegistry() {
  const toolStore = createEntityStore({
    idField: 'tool_id', tenantField: 'tenant_id', organizationField: 'organization_id', versionField: 'tool_version',
    validate: validateToolContract, idLabel: 'tool'
  });
  const capabilityStore = createEntityStore({
    idField: 'capability_set_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateToolCapabilityContract, idLabel: 'capability_set'
  });
  const permissionStore = createEntityStore({
    idField: 'permission_set_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateToolPermissionContract, idLabel: 'permission_set'
  });
  const costStore = createEntityStore({
    idField: 'cost_reference_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateToolCostContract, idLabel: 'cost_reference'
  });
  const sideEffectStore = createEntityStore({
    idField: 'side_effect_reference_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateToolSideEffectsContract, idLabel: 'side_effect_reference'
  });
  const decisionStore = createEntityStore({
    idField: 'decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateToolDecision, idLabel: 'decision'
  });

  return Object.freeze({
    registerTool: toolStore.register,
    getToolById: toolStore.getById,
    listToolsByTenant: toolStore.listByTenant,
    listToolsByOrganization: toolStore.listByOrganization,

    registerCapabilitySet: capabilityStore.register,
    getCapabilitySetById: capabilityStore.getById,
    listCapabilitySetsByTenant: capabilityStore.listByTenant,

    registerPermissionSet: permissionStore.register,
    getPermissionSetById: permissionStore.getById,
    listPermissionSetsByTenant: permissionStore.listByTenant,

    registerCostReference: costStore.register,
    getCostReferenceById: costStore.getById,
    listCostReferencesByTenant: costStore.listByTenant,

    registerSideEffectReference: sideEffectStore.register,
    getSideEffectReferenceById: sideEffectStore.getById,
    listSideEffectReferencesByTenant: sideEffectStore.listByTenant,

    registerDecision: decisionStore.register,
    getDecisionById: decisionStore.getById,
    listDecisionsByTenant: decisionStore.listByTenant,
    listDecisionsByOrganization: decisionStore.listByOrganization
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  TOOL_REGISTRY_SAFE_FLAGS,
  TOOL_REGISTRY_STATUSES,
  TOOL_REGISTRY_VALIDATOR_VERSION,
  createToolRegistry
};

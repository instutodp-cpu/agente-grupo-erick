'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateContextAssemblyRequest } = require('./context-assembly-request');
const { validateContextAssemblySourceReference } = require('./context-assembly-source-reference');
const { validateContextAssemblyPolicy } = require('./context-assembly-policy');
const { validateContextBudget } = require('./context-assembly-budget');
const { validateContextAssemblySection } = require('./context-assembly-section');
const { validateContextAssemblyPlan } = require('./context-assembly-plan');
const { validateContextAssemblyResult } = require('./context-assembly-result');

const CONTEXT_ASSEMBLY_REGISTRY_VALIDATOR_VERSION = 'context_assembly_registry_validator_v1';
const CONTEXT_ASSEMBLY_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const CONTEXT_ASSEMBLY_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...CONTEXT_ASSEMBLY_REGISTRY_SAFE_FLAGS });
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
  const { idField, tenantField, organizationField, agentField, versionField, validate, idLabel } = config;
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
    const agentId = agentField ? record[agentField] : undefined;
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
      byId.set(id, {
        record: cloneFrozen(record),
        fingerprint,
        tenant_id: tenantId,
        organization_id: organizationId,
        agent_id: agentId,
        version: resolution.version
      });
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

  function listByAgent(agentId, predicate) {
    if (!agentField || !isNonEmptyString(agentId)) return [];
    return listAll((record) => record[agentField] === agentId && (typeof predicate !== 'function' || predicate(record)));
  }

  return Object.freeze({ register, getById, listAll, listByTenant, listByOrganization, listByAgent });
}

function createContextAssemblyRegistry() {
  const requestStore = createEntityStore({
    idField: 'assembly_request_id', versionField: 'assembly_request_version',
    validate: validateContextAssemblyRequest, idLabel: 'assembly_request'
  });
  const sourceReferenceStore = createEntityStore({
    idField: 'source_reference_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    agentField: 'agent_id', versionField: 'source_reference_version',
    validate: validateContextAssemblySourceReference, idLabel: 'source_reference'
  });
  const policyStore = createEntityStore({
    idField: 'assembly_policy_id', versionField: 'assembly_policy_version',
    validate: validateContextAssemblyPolicy, idLabel: 'assembly_policy'
  });
  const budgetStore = createEntityStore({
    idField: 'context_budget_id', validate: validateContextBudget, idLabel: 'context_budget'
  });
  const sectionStore = createEntityStore({
    idField: 'section_id', versionField: 'section_version',
    validate: validateContextAssemblySection, idLabel: 'section'
  });
  const planStore = createEntityStore({
    idField: 'plan_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateContextAssemblyPlan, idLabel: 'plan'
  });
  const resultStore = createEntityStore({
    idField: 'result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    agentField: 'agent_id', validate: validateContextAssemblyResult, idLabel: 'result'
  });

  return Object.freeze({
    registerRequest: requestStore.register,
    getRequestById: requestStore.getById,
    listRequestsByTenant: requestStore.listByTenant,

    registerSourceReference: sourceReferenceStore.register,
    getSourceReferenceById: sourceReferenceStore.getById,
    listSourceReferencesByTenant: sourceReferenceStore.listByTenant,
    listSourceReferencesByOrganization: sourceReferenceStore.listByOrganization,
    listSourceReferencesByAgent: sourceReferenceStore.listByAgent,

    registerPolicy: policyStore.register,
    getPolicyById: policyStore.getById,

    registerBudget: budgetStore.register,
    getBudgetById: budgetStore.getById,

    registerSection: sectionStore.register,
    getSectionById: sectionStore.getById,

    registerPlan: planStore.register,
    getPlanById: planStore.getById,
    listPlansByTenant: planStore.listByTenant,
    listPlansByOrganization: planStore.listByOrganization,

    registerResult: resultStore.register,
    getResultById: resultStore.getById,
    listResultsByTenant: resultStore.listByTenant,
    listResultsByOrganization: resultStore.listByOrganization,
    listResultsByAgent: resultStore.listByAgent
  });
}

module.exports = {
  CONTEXT_ASSEMBLY_REGISTRY_SAFE_FLAGS,
  CONTEXT_ASSEMBLY_REGISTRY_STATUSES,
  CONTEXT_ASSEMBLY_REGISTRY_VALIDATOR_VERSION,
  MAX_LIST_RESULTS,
  createContextAssemblyRegistry
};

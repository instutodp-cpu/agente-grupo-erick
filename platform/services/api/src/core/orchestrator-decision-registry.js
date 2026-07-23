'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateOrchestratorDecisionRequest } = require('./orchestrator-decision-request');
const { validateOrchestrationPlanReference, validatePlanningResultReference } = require('./orchestrator-plan-reference');
const { validateOrchestratorDecisionPolicy } = require('./orchestrator-decision-policy');
const { validateOrchestratorBlocker } = require('./orchestrator-blocker');
const { validateOrchestratorReadiness } = require('./orchestrator-readiness');
const { validateOrchestratorDecisionResult } = require('./orchestrator-decision-result');

const ORCHESTRATOR_DECISION_REGISTRY_VALIDATOR_VERSION = 'orchestrator_decision_registry_validator_v1';
const ORCHESTRATOR_DECISION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const ORCHESTRATOR_DECISION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...ORCHESTRATOR_DECISION_REGISTRY_SAFE_FLAGS });
}

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

function createOrchestratorDecisionRegistry() {
  const requestStore = createEntityStore({
    idField: 'decision_request_id', versionField: 'decision_request_version',
    validate: validateOrchestratorDecisionRequest, idLabel: 'decision_request'
  });
  const planningResultReferenceStore = createEntityStore({
    idField: 'planning_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validatePlanningResultReference, idLabel: 'planning_result_reference'
  });
  const orchestrationPlanReferenceStore = createEntityStore({
    idField: 'plan_id', versionField: 'plan_version', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateOrchestrationPlanReference, idLabel: 'orchestration_plan_reference'
  });
  const policyStore = createEntityStore({
    idField: 'decision_policy_id', versionField: 'decision_policy_version',
    validate: validateOrchestratorDecisionPolicy, idLabel: 'decision_policy'
  });
  const blockerStore = createEntityStore({
    idField: 'blocker_id', versionField: 'blocker_version', validate: validateOrchestratorBlocker, idLabel: 'blocker'
  });
  const readinessStore = createEntityStore({
    idField: 'readiness_id', validate: validateOrchestratorReadiness, idLabel: 'readiness'
  });
  const resultStore = createEntityStore({
    idField: 'result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateOrchestratorDecisionResult, idLabel: 'decision_result'
  });

  return Object.freeze({
    registerDecisionRequest: requestStore.register,
    getDecisionRequestById: requestStore.getById,

    registerPlanningResultReference: planningResultReferenceStore.register,
    getPlanningResultReferenceById: planningResultReferenceStore.getById,

    registerOrchestrationPlanReference: orchestrationPlanReferenceStore.register,
    getOrchestrationPlanReferenceById: orchestrationPlanReferenceStore.getById,
    listOrchestrationPlanReferencesByTenant: orchestrationPlanReferenceStore.listByTenant,

    registerDecisionPolicy: policyStore.register,
    getDecisionPolicyById: policyStore.getById,

    registerBlocker: blockerStore.register,
    getBlockerById: blockerStore.getById,

    registerReadiness: readinessStore.register,
    getReadinessById: readinessStore.getById,

    registerDecisionResult: resultStore.register,
    getDecisionResultById: resultStore.getById,
    listDecisionResultsByTenant: resultStore.listByTenant,
    listDecisionResultsByOrganization: resultStore.listByOrganization
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  ORCHESTRATOR_DECISION_REGISTRY_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_REGISTRY_STATUSES,
  ORCHESTRATOR_DECISION_REGISTRY_VALIDATOR_VERSION,
  createOrchestratorDecisionRegistry
};

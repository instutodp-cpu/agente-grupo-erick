'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeWorkerReference } = require('./runtime-worker-reference');
const { validateRuntimeWorkerCapabilityReference } = require('./runtime-worker-capability-reference');
const { validateRuntimeWorkerCapacityReference } = require('./runtime-worker-capacity-reference');
const { validateRuntimeWorkerHealthReference } = require('./runtime-worker-health-reference');
const { validateRuntimeWorkerCompatibilityReference } = require('./runtime-worker-compatibility-reference');
const { validateRuntimeWorkerCandidateSetReference } = require('./runtime-worker-candidate-set-reference');
const { validateRuntimeWorkerStageAssignmentReference } = require('./runtime-worker-stage-assignment-reference');
const { validateRuntimeWorkerAssignmentRequest } = require('./runtime-worker-assignment-request');
const { validateRuntimeWorkerAssignmentPackage } = require('./runtime-worker-assignment-package');
const { validateRuntimeWorkerAssignmentDecision } = require('./runtime-worker-assignment-decision');
const { validateRuntimeWorkerAssignmentResult } = require('./runtime-worker-assignment-result');
const { validateRuntimeWorkerAssignmentAudit } = require('./runtime-worker-assignment-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-scheduler-registry.js's own
// createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch ->
// expected-version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_WORKER_ASSIGNMENT_REGISTRY_VALIDATOR_VERSION = 'runtime_worker_assignment_registry_validator_v1';
const RUNTIME_WORKER_ASSIGNMENT_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_WORKER_ASSIGNMENT_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_WORKER_ASSIGNMENT_REGISTRY_SAFE_FLAGS });
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
      existing, id, { tenant_id: tenantId, organization_id: organizationId, fingerprint }, version, options, idLabel
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

  return Object.freeze({ register, getById, listAll, listByTenant });
}

function createRuntimeWorkerAssignmentRegistry() {
  const workerStore = createEntityStore({
    idField: 'runtime_worker_reference_id', versionField: 'runtime_worker_reference_version',
    validate: validateRuntimeWorkerReference, idLabel: 'runtime_worker_reference'
  });
  const capabilityStore = createEntityStore({
    idField: 'worker_capability_reference_id', versionField: 'worker_capability_reference_version',
    validate: validateRuntimeWorkerCapabilityReference, idLabel: 'runtime_worker_capability_reference'
  });
  const capacityStore = createEntityStore({
    idField: 'worker_capacity_reference_id', versionField: 'worker_capacity_reference_version',
    validate: validateRuntimeWorkerCapacityReference, idLabel: 'runtime_worker_capacity_reference'
  });
  const healthStore = createEntityStore({
    idField: 'worker_health_reference_id', versionField: 'worker_health_reference_version',
    validate: validateRuntimeWorkerHealthReference, idLabel: 'runtime_worker_health_reference'
  });
  const compatibilityStore = createEntityStore({
    idField: 'worker_compatibility_reference_id', versionField: 'worker_compatibility_reference_version',
    validate: validateRuntimeWorkerCompatibilityReference, idLabel: 'runtime_worker_compatibility_reference'
  });
  const candidateSetStore = createEntityStore({
    idField: 'worker_candidate_set_reference_id', versionField: 'worker_candidate_set_reference_version',
    validate: validateRuntimeWorkerCandidateSetReference, idLabel: 'runtime_worker_candidate_set_reference'
  });
  const assignmentStore = createEntityStore({
    idField: 'worker_stage_assignment_reference_id', versionField: 'worker_stage_assignment_reference_version',
    validate: validateRuntimeWorkerStageAssignmentReference, idLabel: 'runtime_worker_stage_assignment_reference'
  });
  const requestStore = createEntityStore({
    idField: 'runtime_worker_assignment_request_id', versionField: 'runtime_worker_assignment_request_version',
    validate: validateRuntimeWorkerAssignmentRequest, idLabel: 'runtime_worker_assignment_request'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_worker_assignment_package_id', versionField: 'runtime_worker_assignment_package_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeWorkerAssignmentPackage, idLabel: 'runtime_worker_assignment_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_worker_assignment_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeWorkerAssignmentDecision, idLabel: 'runtime_worker_assignment_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_worker_assignment_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeWorkerAssignmentResult, idLabel: 'runtime_worker_assignment_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeWorkerAssignmentAudit, idLabel: 'runtime_worker_assignment_audit'
  });

  return Object.freeze({
    registerRuntimeWorkerReference: workerStore.register,
    getRuntimeWorkerReferenceById: workerStore.getById,

    registerRuntimeWorkerCapabilityReference: capabilityStore.register,
    getRuntimeWorkerCapabilityReferenceById: capabilityStore.getById,

    registerRuntimeWorkerCapacityReference: capacityStore.register,
    getRuntimeWorkerCapacityReferenceById: capacityStore.getById,

    registerRuntimeWorkerHealthReference: healthStore.register,
    getRuntimeWorkerHealthReferenceById: healthStore.getById,

    registerRuntimeWorkerCompatibilityReference: compatibilityStore.register,
    getRuntimeWorkerCompatibilityReferenceById: compatibilityStore.getById,

    registerRuntimeWorkerCandidateSetReference: candidateSetStore.register,
    getRuntimeWorkerCandidateSetReferenceById: candidateSetStore.getById,

    registerRuntimeWorkerStageAssignmentReference: assignmentStore.register,
    getRuntimeWorkerStageAssignmentReferenceById: assignmentStore.getById,

    registerRuntimeWorkerAssignmentRequest: requestStore.register,
    getRuntimeWorkerAssignmentRequestById: requestStore.getById,

    registerRuntimeWorkerAssignmentPackage: packageStore.register,
    getRuntimeWorkerAssignmentPackageById: packageStore.getById,
    listRuntimeWorkerAssignmentPackagesByTenant: packageStore.listByTenant,

    registerRuntimeWorkerAssignmentDecision: decisionStore.register,
    getRuntimeWorkerAssignmentDecisionById: decisionStore.getById,
    listRuntimeWorkerAssignmentDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeWorkerAssignmentResult: resultStore.register,
    getRuntimeWorkerAssignmentResultById: resultStore.getById,
    listRuntimeWorkerAssignmentResultsByTenant: resultStore.listByTenant,

    registerRuntimeWorkerAssignmentAudit: auditStore.register,
    getRuntimeWorkerAssignmentAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_WORKER_ASSIGNMENT_REGISTRY_SAFE_FLAGS,
  RUNTIME_WORKER_ASSIGNMENT_REGISTRY_STATUSES,
  RUNTIME_WORKER_ASSIGNMENT_REGISTRY_VALIDATOR_VERSION,
  createRuntimeWorkerAssignmentRegistry
};

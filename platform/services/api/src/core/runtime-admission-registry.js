'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeCapacitySnapshotReference } = require('./runtime-capacity-snapshot-reference');
const { validateRuntimeConcurrencyReference } = require('./runtime-concurrency-reference');
const { validateRuntimeReadinessFreshnessReference } = require('./runtime-readiness-freshness-reference');
const { validateRuntimeReadinessReplayReference } = require('./runtime-readiness-replay-reference');
const { validateRuntimeReadinessRequest } = require('./runtime-readiness-request');
const { validateRuntimeReadinessDecision } = require('./runtime-readiness-decision');
const { validateRuntimeAdmissionRequest } = require('./runtime-admission-request');
const { validateRuntimeAdmissionDecision } = require('./runtime-admission-decision');
const { validateRuntimeAdmissionResult } = require('./runtime-admission-result');
const { validateRuntimeAdmissionAudit } = require('./runtime-admission-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-execution-simulation-registry.js's
// own createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch ->
// expected-version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_ADMISSION_REGISTRY_VALIDATOR_VERSION = 'runtime_admission_registry_validator_v1';
const RUNTIME_ADMISSION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_ADMISSION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_ADMISSION_REGISTRY_SAFE_FLAGS });
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

  function listByOrganization(organizationId, predicate) {
    if (!organizationField || !isNonEmptyString(organizationId)) return [];
    return listAll((record) => record[organizationField] === organizationId && (typeof predicate !== 'function' || predicate(record)));
  }

  return Object.freeze({ register, getById, listAll, listByTenant, listByOrganization });
}

function createRuntimeAdmissionRegistry() {
  const capacitySnapshotStore = createEntityStore({
    idField: 'runtime_capacity_snapshot_reference_id', versionField: 'runtime_capacity_snapshot_reference_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeCapacitySnapshotReference, idLabel: 'runtime_capacity_snapshot_reference'
  });
  const concurrencyStore = createEntityStore({
    idField: 'runtime_concurrency_reference_id', versionField: 'runtime_concurrency_reference_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeConcurrencyReference, idLabel: 'runtime_concurrency_reference'
  });
  const freshnessStore = createEntityStore({
    idField: 'runtime_readiness_freshness_reference_id', versionField: 'runtime_readiness_freshness_reference_version',
    validate: validateRuntimeReadinessFreshnessReference, idLabel: 'runtime_readiness_freshness_reference'
  });
  const replayStore = createEntityStore({
    idField: 'runtime_readiness_replay_reference_id', versionField: 'runtime_readiness_replay_reference_version',
    validate: validateRuntimeReadinessReplayReference, idLabel: 'runtime_readiness_replay_reference'
  });
  const readinessRequestStore = createEntityStore({
    idField: 'runtime_readiness_request_id', versionField: 'runtime_readiness_request_version',
    validate: validateRuntimeReadinessRequest, idLabel: 'runtime_readiness_request'
  });
  const readinessDecisionStore = createEntityStore({
    idField: 'runtime_readiness_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeReadinessDecision, idLabel: 'runtime_readiness_decision'
  });
  const admissionRequestStore = createEntityStore({
    idField: 'runtime_admission_request_id', versionField: 'runtime_admission_request_version',
    validate: validateRuntimeAdmissionRequest, idLabel: 'runtime_admission_request'
  });
  const admissionDecisionStore = createEntityStore({
    idField: 'runtime_admission_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeAdmissionDecision, idLabel: 'runtime_admission_decision'
  });
  const admissionResultStore = createEntityStore({
    idField: 'runtime_admission_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeAdmissionResult, idLabel: 'runtime_admission_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeAdmissionAudit, idLabel: 'runtime_admission_audit'
  });

  return Object.freeze({
    registerRuntimeCapacitySnapshotReference: capacitySnapshotStore.register,
    getRuntimeCapacitySnapshotReferenceById: capacitySnapshotStore.getById,
    listRuntimeCapacitySnapshotReferencesByTenant: capacitySnapshotStore.listByTenant,

    registerRuntimeConcurrencyReference: concurrencyStore.register,
    getRuntimeConcurrencyReferenceById: concurrencyStore.getById,
    listRuntimeConcurrencyReferencesByTenant: concurrencyStore.listByTenant,

    registerRuntimeReadinessFreshnessReference: freshnessStore.register,
    getRuntimeReadinessFreshnessReferenceById: freshnessStore.getById,

    registerRuntimeReadinessReplayReference: replayStore.register,
    getRuntimeReadinessReplayReferenceById: replayStore.getById,

    registerRuntimeReadinessRequest: readinessRequestStore.register,
    getRuntimeReadinessRequestById: readinessRequestStore.getById,

    registerRuntimeReadinessDecision: readinessDecisionStore.register,
    getRuntimeReadinessDecisionById: readinessDecisionStore.getById,
    listRuntimeReadinessDecisionsByTenant: readinessDecisionStore.listByTenant,

    registerRuntimeAdmissionRequest: admissionRequestStore.register,
    getRuntimeAdmissionRequestById: admissionRequestStore.getById,

    registerRuntimeAdmissionDecision: admissionDecisionStore.register,
    getRuntimeAdmissionDecisionById: admissionDecisionStore.getById,
    listRuntimeAdmissionDecisionsByTenant: admissionDecisionStore.listByTenant,

    registerRuntimeAdmissionResult: admissionResultStore.register,
    getRuntimeAdmissionResultById: admissionResultStore.getById,
    listRuntimeAdmissionResultsByTenant: admissionResultStore.listByTenant,

    registerRuntimeAdmissionAudit: auditStore.register,
    getRuntimeAdmissionAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_ADMISSION_REGISTRY_SAFE_FLAGS,
  RUNTIME_ADMISSION_REGISTRY_STATUSES,
  RUNTIME_ADMISSION_REGISTRY_VALIDATOR_VERSION,
  createRuntimeAdmissionRegistry
};

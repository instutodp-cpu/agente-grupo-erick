'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeQueueMaterializationRequest } = require('./runtime-queue-materialization-request');
const { validateRuntimeQueueMaterializationEntryReference } = require('./runtime-queue-materialization-entry-reference');
const { validateRuntimeQueueMaterializationOrderReference } = require('./runtime-queue-materialization-order-reference');
const { validateRuntimeQueueMaterializationPackage } = require('./runtime-queue-materialization-package');
const { validateRuntimeQueueMaterializationDecision } = require('./runtime-queue-materialization-decision');
const { validateRuntimeQueueMaterializationResult } = require('./runtime-queue-materialization-result');
const { validateRuntimeQueueMaterializationAudit } = require('./runtime-queue-materialization-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-queue-admission-registry.js's own
// createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch -> expected-
// version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_VALIDATOR_VERSION = 'runtime_queue_materialization_registry_validator_v1';
const RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_SAFE_FLAGS });
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

function createRuntimeQueueMaterializationRegistry() {
  const requestStore = createEntityStore({
    idField: 'runtime_queue_materialization_request_id', versionField: 'runtime_queue_materialization_request_version',
    validate: validateRuntimeQueueMaterializationRequest, idLabel: 'runtime_queue_materialization_request'
  });
  const entryStore = createEntityStore({
    idField: 'runtime_queue_materialization_entry_reference_id', versionField: 'runtime_queue_materialization_entry_reference_version',
    validate: validateRuntimeQueueMaterializationEntryReference, idLabel: 'runtime_queue_materialization_entry_reference'
  });
  const orderStore = createEntityStore({
    idField: 'runtime_queue_materialization_order_reference_id', versionField: 'runtime_queue_materialization_order_reference_version',
    validate: validateRuntimeQueueMaterializationOrderReference, idLabel: 'runtime_queue_materialization_order_reference'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_queue_materialization_package_id', versionField: 'runtime_queue_materialization_package_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueueMaterializationPackage, idLabel: 'runtime_queue_materialization_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_queue_materialization_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueueMaterializationDecision, idLabel: 'runtime_queue_materialization_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_queue_materialization_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueueMaterializationResult, idLabel: 'runtime_queue_materialization_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeQueueMaterializationAudit, idLabel: 'runtime_queue_materialization_audit'
  });

  return Object.freeze({
    registerRuntimeQueueMaterializationRequest: requestStore.register,
    getRuntimeQueueMaterializationRequestById: requestStore.getById,

    registerRuntimeQueueMaterializationEntryReference: entryStore.register,
    getRuntimeQueueMaterializationEntryReferenceById: entryStore.getById,

    registerRuntimeQueueMaterializationOrderReference: orderStore.register,
    getRuntimeQueueMaterializationOrderReferenceById: orderStore.getById,

    registerRuntimeQueueMaterializationPackage: packageStore.register,
    getRuntimeQueueMaterializationPackageById: packageStore.getById,
    listRuntimeQueueMaterializationPackagesByTenant: packageStore.listByTenant,

    registerRuntimeQueueMaterializationDecision: decisionStore.register,
    getRuntimeQueueMaterializationDecisionById: decisionStore.getById,
    listRuntimeQueueMaterializationDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeQueueMaterializationResult: resultStore.register,
    getRuntimeQueueMaterializationResultById: resultStore.getById,
    listRuntimeQueueMaterializationResultsByTenant: resultStore.listByTenant,

    registerRuntimeQueueMaterializationAudit: auditStore.register,
    getRuntimeQueueMaterializationAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_SAFE_FLAGS,
  RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_STATUSES,
  RUNTIME_QUEUE_MATERIALIZATION_REGISTRY_VALIDATOR_VERSION,
  createRuntimeQueueMaterializationRegistry
};

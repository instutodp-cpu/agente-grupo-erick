'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeQueuePlacementRequest } = require('./runtime-queue-placement-request');
const { validateRuntimeQueuePlacementEntryReference } = require('./runtime-queue-placement-entry-reference');
const { validateRuntimeQueuePlacementGroupReference } = require('./runtime-queue-placement-group-reference');
const { validateRuntimeQueuePlacementOrderReference } = require('./runtime-queue-placement-order-reference');
const { validateRuntimeQueuePlacementPackage } = require('./runtime-queue-placement-package');
const { validateRuntimeQueuePlacementDecision } = require('./runtime-queue-placement-decision');
const { validateRuntimeQueuePlacementResult } = require('./runtime-queue-placement-result');
const { validateRuntimeQueuePlacementAudit } = require('./runtime-queue-placement-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-queue-materialization-registry.js's
// own createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch ->
// expected-version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_QUEUE_PLACEMENT_REGISTRY_VALIDATOR_VERSION = 'runtime_queue_placement_registry_validator_v1';
const RUNTIME_QUEUE_PLACEMENT_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_QUEUE_PLACEMENT_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_QUEUE_PLACEMENT_REGISTRY_SAFE_FLAGS });
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

function createRuntimeQueuePlacementRegistry() {
  const requestStore = createEntityStore({
    idField: 'runtime_queue_placement_request_id', versionField: 'runtime_queue_placement_request_version',
    validate: validateRuntimeQueuePlacementRequest, idLabel: 'runtime_queue_placement_request'
  });
  const entryStore = createEntityStore({
    idField: 'runtime_queue_placement_entry_reference_id', versionField: 'runtime_queue_placement_entry_reference_version',
    validate: validateRuntimeQueuePlacementEntryReference, idLabel: 'runtime_queue_placement_entry_reference'
  });
  const groupStore = createEntityStore({
    idField: 'runtime_queue_placement_group_reference_id', versionField: 'runtime_queue_placement_group_reference_version',
    validate: validateRuntimeQueuePlacementGroupReference, idLabel: 'runtime_queue_placement_group_reference'
  });
  const orderStore = createEntityStore({
    idField: 'runtime_queue_placement_order_reference_id', versionField: 'runtime_queue_placement_order_reference_version',
    validate: validateRuntimeQueuePlacementOrderReference, idLabel: 'runtime_queue_placement_order_reference'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_queue_placement_package_id', versionField: 'runtime_queue_placement_package_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueuePlacementPackage, idLabel: 'runtime_queue_placement_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_queue_placement_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueuePlacementDecision, idLabel: 'runtime_queue_placement_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_queue_placement_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeQueuePlacementResult, idLabel: 'runtime_queue_placement_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeQueuePlacementAudit, idLabel: 'runtime_queue_placement_audit'
  });

  return Object.freeze({
    registerRuntimeQueuePlacementRequest: requestStore.register,
    getRuntimeQueuePlacementRequestById: requestStore.getById,

    registerRuntimeQueuePlacementEntryReference: entryStore.register,
    getRuntimeQueuePlacementEntryReferenceById: entryStore.getById,

    registerRuntimeQueuePlacementGroupReference: groupStore.register,
    getRuntimeQueuePlacementGroupReferenceById: groupStore.getById,

    registerRuntimeQueuePlacementOrderReference: orderStore.register,
    getRuntimeQueuePlacementOrderReferenceById: orderStore.getById,

    registerRuntimeQueuePlacementPackage: packageStore.register,
    getRuntimeQueuePlacementPackageById: packageStore.getById,
    listRuntimeQueuePlacementPackagesByTenant: packageStore.listByTenant,

    registerRuntimeQueuePlacementDecision: decisionStore.register,
    getRuntimeQueuePlacementDecisionById: decisionStore.getById,
    listRuntimeQueuePlacementDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeQueuePlacementResult: resultStore.register,
    getRuntimeQueuePlacementResultById: resultStore.getById,
    listRuntimeQueuePlacementResultsByTenant: resultStore.listByTenant,

    registerRuntimeQueuePlacementAudit: auditStore.register,
    getRuntimeQueuePlacementAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_QUEUE_PLACEMENT_REGISTRY_SAFE_FLAGS,
  RUNTIME_QUEUE_PLACEMENT_REGISTRY_STATUSES,
  RUNTIME_QUEUE_PLACEMENT_REGISTRY_VALIDATOR_VERSION,
  createRuntimeQueuePlacementRegistry
};

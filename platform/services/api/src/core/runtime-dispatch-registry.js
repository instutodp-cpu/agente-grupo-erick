'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeDispatchRequest } = require('./runtime-dispatch-request');
const { validateRuntimeDispatchStageReference } = require('./runtime-dispatch-stage-reference');
const { validateRuntimeDispatchWorkerBindingReference } = require('./runtime-dispatch-worker-binding-reference');
const { validateRuntimeDispatchDependencyGateReference } = require('./runtime-dispatch-dependency-gate-reference');
const { validateRuntimeDispatchApprovalGateReference } = require('./runtime-dispatch-approval-gate-reference');
const { validateRuntimeDispatchCapacityReference } = require('./runtime-dispatch-capacity-reference');
const { validateRuntimeDispatchBudgetReference } = require('./runtime-dispatch-budget-reference');
const { validateRuntimeDispatchPayloadReference } = require('./runtime-dispatch-payload-reference');
const { validateRuntimeDispatchIntentReference } = require('./runtime-dispatch-intent-reference');
const { validateRuntimeDispatchOrderReference } = require('./runtime-dispatch-order-reference');
const { validateRuntimeDispatchReplayReference } = require('./runtime-dispatch-replay-reference');
const { validateRuntimeDispatchPackage } = require('./runtime-dispatch-package');
const { validateRuntimeDispatchDecision } = require('./runtime-dispatch-decision');
const { validateRuntimeDispatchResult } = require('./runtime-dispatch-result');
const { validateRuntimeDispatchAudit } = require('./runtime-dispatch-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-worker-assignment-registry.js's own
// createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch -> expected-
// version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_DISPATCH_REGISTRY_VALIDATOR_VERSION = 'runtime_dispatch_registry_validator_v1';
const RUNTIME_DISPATCH_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_DISPATCH_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_DISPATCH_REGISTRY_SAFE_FLAGS });
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

function createRuntimeDispatchRegistry() {
  const requestStore = createEntityStore({
    idField: 'runtime_dispatch_request_id', versionField: 'runtime_dispatch_request_version',
    validate: validateRuntimeDispatchRequest, idLabel: 'runtime_dispatch_request'
  });
  const stageStore = createEntityStore({
    idField: 'runtime_dispatch_stage_reference_id', versionField: 'runtime_dispatch_stage_reference_version',
    validate: validateRuntimeDispatchStageReference, idLabel: 'runtime_dispatch_stage_reference'
  });
  const workerBindingStore = createEntityStore({
    idField: 'dispatch_worker_binding_reference_id', versionField: 'dispatch_worker_binding_reference_version',
    validate: validateRuntimeDispatchWorkerBindingReference, idLabel: 'dispatch_worker_binding_reference'
  });
  const dependencyGateStore = createEntityStore({
    idField: 'dispatch_dependency_gate_reference_id', versionField: 'dispatch_dependency_gate_reference_version',
    validate: validateRuntimeDispatchDependencyGateReference, idLabel: 'dispatch_dependency_gate_reference'
  });
  const approvalGateStore = createEntityStore({
    idField: 'dispatch_approval_gate_reference_id', versionField: 'dispatch_approval_gate_reference_version',
    validate: validateRuntimeDispatchApprovalGateReference, idLabel: 'dispatch_approval_gate_reference'
  });
  const capacityStore = createEntityStore({
    idField: 'dispatch_capacity_reference_id', versionField: 'dispatch_capacity_reference_version',
    validate: validateRuntimeDispatchCapacityReference, idLabel: 'dispatch_capacity_reference'
  });
  const budgetStore = createEntityStore({
    idField: 'dispatch_budget_reference_id', versionField: 'dispatch_budget_reference_version',
    validate: validateRuntimeDispatchBudgetReference, idLabel: 'dispatch_budget_reference'
  });
  const payloadStore = createEntityStore({
    idField: 'dispatch_payload_reference_id', versionField: 'dispatch_payload_reference_version',
    validate: validateRuntimeDispatchPayloadReference, idLabel: 'dispatch_payload_reference'
  });
  const intentStore = createEntityStore({
    idField: 'dispatch_intent_reference_id', versionField: 'dispatch_intent_reference_version',
    validate: validateRuntimeDispatchIntentReference, idLabel: 'dispatch_intent_reference'
  });
  const orderStore = createEntityStore({
    idField: 'dispatch_order_reference_id', versionField: 'dispatch_order_reference_version',
    validate: validateRuntimeDispatchOrderReference, idLabel: 'dispatch_order_reference'
  });
  const replayStore = createEntityStore({
    idField: 'runtime_dispatch_replay_reference_id', versionField: 'runtime_dispatch_replay_reference_version',
    validate: validateRuntimeDispatchReplayReference, idLabel: 'runtime_dispatch_replay_reference'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_dispatch_package_id', versionField: 'runtime_dispatch_package_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeDispatchPackage, idLabel: 'runtime_dispatch_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_dispatch_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeDispatchDecision, idLabel: 'runtime_dispatch_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_dispatch_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeDispatchResult, idLabel: 'runtime_dispatch_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeDispatchAudit, idLabel: 'runtime_dispatch_audit'
  });

  return Object.freeze({
    registerRuntimeDispatchRequest: requestStore.register,
    getRuntimeDispatchRequestById: requestStore.getById,

    registerRuntimeDispatchStageReference: stageStore.register,
    getRuntimeDispatchStageReferenceById: stageStore.getById,

    registerRuntimeDispatchWorkerBindingReference: workerBindingStore.register,
    getRuntimeDispatchWorkerBindingReferenceById: workerBindingStore.getById,

    registerRuntimeDispatchDependencyGateReference: dependencyGateStore.register,
    getRuntimeDispatchDependencyGateReferenceById: dependencyGateStore.getById,

    registerRuntimeDispatchApprovalGateReference: approvalGateStore.register,
    getRuntimeDispatchApprovalGateReferenceById: approvalGateStore.getById,

    registerRuntimeDispatchCapacityReference: capacityStore.register,
    getRuntimeDispatchCapacityReferenceById: capacityStore.getById,

    registerRuntimeDispatchBudgetReference: budgetStore.register,
    getRuntimeDispatchBudgetReferenceById: budgetStore.getById,

    registerRuntimeDispatchPayloadReference: payloadStore.register,
    getRuntimeDispatchPayloadReferenceById: payloadStore.getById,

    registerRuntimeDispatchIntentReference: intentStore.register,
    getRuntimeDispatchIntentReferenceById: intentStore.getById,

    registerRuntimeDispatchOrderReference: orderStore.register,
    getRuntimeDispatchOrderReferenceById: orderStore.getById,

    registerRuntimeDispatchReplayReference: replayStore.register,
    getRuntimeDispatchReplayReferenceById: replayStore.getById,

    registerRuntimeDispatchPackage: packageStore.register,
    getRuntimeDispatchPackageById: packageStore.getById,
    listRuntimeDispatchPackagesByTenant: packageStore.listByTenant,

    registerRuntimeDispatchDecision: decisionStore.register,
    getRuntimeDispatchDecisionById: decisionStore.getById,
    listRuntimeDispatchDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeDispatchResult: resultStore.register,
    getRuntimeDispatchResultById: resultStore.getById,
    listRuntimeDispatchResultsByTenant: resultStore.listByTenant,

    registerRuntimeDispatchAudit: auditStore.register,
    getRuntimeDispatchAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_DISPATCH_REGISTRY_SAFE_FLAGS,
  RUNTIME_DISPATCH_REGISTRY_STATUSES,
  RUNTIME_DISPATCH_REGISTRY_VALIDATOR_VERSION,
  createRuntimeDispatchRegistry
};

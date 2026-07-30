'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeSchedulerRequest } = require('./runtime-scheduler-request');
const { validateRuntimeSchedulerStageReference } = require('./runtime-scheduler-stage-reference');
const { validateRuntimeSchedulerDependencyReference } = require('./runtime-scheduler-dependency-reference');
const { validateRuntimeSchedulerParallelGroupReference } = require('./runtime-scheduler-parallel-group-reference');
const { validateRuntimeSchedulerApprovalWaitReference } = require('./runtime-scheduler-approval-wait-reference');
const { validateRuntimeSchedulerCapacityPlanReference } = require('./runtime-scheduler-capacity-plan-reference');
const { validateRuntimeSchedulerQueuePlanReference } = require('./runtime-scheduler-queue-plan-reference');
const { validateRuntimeSchedulerPackage } = require('./runtime-scheduler-package');
const { validateRuntimeSchedulerDecision } = require('./runtime-scheduler-decision');
const { validateRuntimeSchedulerResult } = require('./runtime-scheduler-result');
const { validateRuntimeSchedulerAudit } = require('./runtime-scheduler-audit');

// In-memory only, synthetic, never persisted -- mirrors runtime-admission-registry.js's own
// createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch ->
// expected-version conflict -> expected-fingerprint conflict -> version downgrade -> accepted).
const RUNTIME_SCHEDULER_REGISTRY_VALIDATOR_VERSION = 'runtime_scheduler_registry_validator_v1';
const RUNTIME_SCHEDULER_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_SCHEDULER_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_SCHEDULER_REGISTRY_SAFE_FLAGS });
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

function createRuntimeSchedulerRegistry() {
  const requestStore = createEntityStore({
    idField: 'runtime_scheduler_request_id', versionField: 'runtime_scheduler_request_version',
    validate: validateRuntimeSchedulerRequest, idLabel: 'runtime_scheduler_request'
  });
  const stageStore = createEntityStore({
    idField: 'scheduler_stage_reference_id', versionField: 'scheduler_stage_reference_version',
    validate: validateRuntimeSchedulerStageReference, idLabel: 'runtime_scheduler_stage_reference'
  });
  const dependencyStore = createEntityStore({
    idField: 'scheduler_dependency_reference_id', versionField: 'scheduler_dependency_reference_version',
    validate: validateRuntimeSchedulerDependencyReference, idLabel: 'runtime_scheduler_dependency_reference'
  });
  const parallelGroupStore = createEntityStore({
    idField: 'parallel_group_reference_id', versionField: 'parallel_group_reference_version',
    validate: validateRuntimeSchedulerParallelGroupReference, idLabel: 'runtime_scheduler_parallel_group_reference'
  });
  const approvalWaitStore = createEntityStore({
    idField: 'approval_wait_reference_id', versionField: 'approval_wait_reference_version',
    validate: validateRuntimeSchedulerApprovalWaitReference, idLabel: 'runtime_scheduler_approval_wait_reference'
  });
  const capacityPlanStore = createEntityStore({
    idField: 'scheduler_capacity_plan_reference_id', versionField: 'scheduler_capacity_plan_reference_version',
    validate: validateRuntimeSchedulerCapacityPlanReference, idLabel: 'runtime_scheduler_capacity_plan_reference'
  });
  const queuePlanStore = createEntityStore({
    idField: 'scheduler_queue_plan_reference_id', versionField: 'scheduler_queue_plan_reference_version',
    validate: validateRuntimeSchedulerQueuePlanReference, idLabel: 'runtime_scheduler_queue_plan_reference'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_scheduler_package_id', versionField: 'runtime_scheduler_package_version',
    tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeSchedulerPackage, idLabel: 'runtime_scheduler_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_scheduler_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeSchedulerDecision, idLabel: 'runtime_scheduler_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_scheduler_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeSchedulerResult, idLabel: 'runtime_scheduler_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeSchedulerAudit, idLabel: 'runtime_scheduler_audit'
  });

  return Object.freeze({
    registerRuntimeSchedulerRequest: requestStore.register,
    getRuntimeSchedulerRequestById: requestStore.getById,

    registerRuntimeSchedulerStageReference: stageStore.register,
    getRuntimeSchedulerStageReferenceById: stageStore.getById,

    registerRuntimeSchedulerDependencyReference: dependencyStore.register,
    getRuntimeSchedulerDependencyReferenceById: dependencyStore.getById,

    registerRuntimeSchedulerParallelGroupReference: parallelGroupStore.register,
    getRuntimeSchedulerParallelGroupReferenceById: parallelGroupStore.getById,

    registerRuntimeSchedulerApprovalWaitReference: approvalWaitStore.register,
    getRuntimeSchedulerApprovalWaitReferenceById: approvalWaitStore.getById,

    registerRuntimeSchedulerCapacityPlanReference: capacityPlanStore.register,
    getRuntimeSchedulerCapacityPlanReferenceById: capacityPlanStore.getById,

    registerRuntimeSchedulerQueuePlanReference: queuePlanStore.register,
    getRuntimeSchedulerQueuePlanReferenceById: queuePlanStore.getById,

    registerRuntimeSchedulerPackage: packageStore.register,
    getRuntimeSchedulerPackageById: packageStore.getById,
    listRuntimeSchedulerPackagesByTenant: packageStore.listByTenant,

    registerRuntimeSchedulerDecision: decisionStore.register,
    getRuntimeSchedulerDecisionById: decisionStore.getById,
    listRuntimeSchedulerDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeSchedulerResult: resultStore.register,
    getRuntimeSchedulerResultById: resultStore.getById,
    listRuntimeSchedulerResultsByTenant: resultStore.listByTenant,

    registerRuntimeSchedulerAudit: auditStore.register,
    getRuntimeSchedulerAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_SCHEDULER_REGISTRY_SAFE_FLAGS,
  RUNTIME_SCHEDULER_REGISTRY_STATUSES,
  RUNTIME_SCHEDULER_REGISTRY_VALIDATOR_VERSION,
  createRuntimeSchedulerRegistry
};

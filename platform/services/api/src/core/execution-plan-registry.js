'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateExecutionPlanRequest } = require('./execution-plan-request');
const { validateExecutionPlanContract } = require('./execution-plan-contract');
const { validateExecutionPlanStage } = require('./execution-plan-stage');
const { validateExecutionPlanStageBinding } = require('./execution-plan-stage-binding');
const { validateExecutionPlanDependency } = require('./execution-plan-dependency');
const { validateExecutionPlanBudget } = require('./execution-plan-budget');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateExecutionPlanStopCondition } = require('./execution-plan-stop-condition');
const { validateExecutionPlanCompensationReference } = require('./execution-plan-compensation-reference');
const { validateExecutionPlanResult } = require('./execution-plan-result');

const EXECUTION_PLAN_REGISTRY_VALIDATOR_VERSION = 'execution_plan_registry_validator_v1';
const EXECUTION_PLAN_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const EXECUTION_PLAN_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...EXECUTION_PLAN_REGISTRY_SAFE_FLAGS });
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

function createExecutionPlanRegistry() {
  const requestStore = createEntityStore({
    idField: 'execution_plan_request_id', versionField: 'execution_plan_request_version',
    validate: validateExecutionPlanRequest, idLabel: 'execution_plan_request'
  });
  const planStore = createEntityStore({
    idField: 'execution_plan_id', versionField: 'execution_plan_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateExecutionPlanContract, idLabel: 'execution_plan'
  });
  const stageStore = createEntityStore({
    idField: 'execution_stage_id', versionField: 'execution_stage_version', validate: validateExecutionPlanStage,
    idLabel: 'execution_plan_stage'
  });
  const bindingStore = createEntityStore({
    idField: 'binding_id', versionField: 'binding_version', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateExecutionPlanStageBinding, idLabel: 'execution_plan_stage_binding'
  });
  const dependencyStore = createEntityStore({
    idField: 'dependency_id', versionField: 'dependency_version', validate: validateExecutionPlanDependency,
    idLabel: 'execution_plan_dependency'
  });
  const budgetStore = createEntityStore({
    idField: 'execution_budget_id', versionField: 'execution_budget_version', validate: validateExecutionPlanBudget,
    idLabel: 'execution_plan_budget'
  });
  const idempotencyStore = createEntityStore({
    idField: 'idempotency_reference_id', versionField: 'idempotency_reference_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateExecutionPlanIdempotency, idLabel: 'execution_plan_idempotency'
  });
  const stopConditionStore = createEntityStore({
    idField: 'stop_condition_id', versionField: 'stop_condition_version', validate: validateExecutionPlanStopCondition,
    idLabel: 'execution_plan_stop_condition'
  });
  const compensationStore = createEntityStore({
    idField: 'compensation_reference_id', versionField: 'compensation_reference_version',
    validate: validateExecutionPlanCompensationReference, idLabel: 'execution_plan_compensation_reference'
  });
  const resultStore = createEntityStore({
    idField: 'result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateExecutionPlanResult, idLabel: 'execution_plan_result'
  });

  return Object.freeze({
    registerExecutionPlanRequest: requestStore.register,
    getExecutionPlanRequestById: requestStore.getById,

    registerExecutionPlan: planStore.register,
    getExecutionPlanById: planStore.getById,
    listExecutionPlansByTenant: planStore.listByTenant,
    listExecutionPlansByOrganization: planStore.listByOrganization,

    registerExecutionPlanStage: stageStore.register,
    getExecutionPlanStageById: stageStore.getById,

    registerExecutionPlanStageBinding: bindingStore.register,
    getExecutionPlanStageBindingById: bindingStore.getById,

    registerExecutionPlanDependency: dependencyStore.register,
    getExecutionPlanDependencyById: dependencyStore.getById,

    registerExecutionPlanBudget: budgetStore.register,
    getExecutionPlanBudgetById: budgetStore.getById,

    registerExecutionPlanIdempotency: idempotencyStore.register,
    getExecutionPlanIdempotencyById: idempotencyStore.getById,

    registerExecutionPlanStopCondition: stopConditionStore.register,
    getExecutionPlanStopConditionById: stopConditionStore.getById,

    registerExecutionPlanCompensationReference: compensationStore.register,
    getExecutionPlanCompensationReferenceById: compensationStore.getById,

    registerExecutionPlanResult: resultStore.register,
    getExecutionPlanResultById: resultStore.getById,
    listExecutionPlanResultsByTenant: resultStore.listByTenant
  });
}

module.exports = {
  EXECUTION_PLAN_REGISTRY_SAFE_FLAGS,
  EXECUTION_PLAN_REGISTRY_STATUSES,
  EXECUTION_PLAN_REGISTRY_VALIDATOR_VERSION,
  MAX_LIST_RESULTS,
  createExecutionPlanRegistry
};

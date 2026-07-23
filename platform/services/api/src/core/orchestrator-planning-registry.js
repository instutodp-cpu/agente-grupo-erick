'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateOrchestratorPlanningRequest } = require('./orchestrator-planning-request');
const { validateOrchestratorTaskDefinition } = require('./orchestrator-task-definition');
const { validateOrchestratorPlanningPolicy } = require('./orchestrator-planning-policy');
const { validateOrchestratorPlanBudget } = require('./orchestrator-plan-budget');
const { validateOrchestratorPlanStage } = require('./orchestrator-plan-stage');
const { validateOrchestratorPlanDependency } = require('./orchestrator-plan-dependency');
const { validateOrchestratorSuccessCriteria } = require('./orchestrator-plan-success-criteria');
const { validateOrchestratorPlanningResult } = require('./orchestrator-planning-result');

const ORCHESTRATOR_PLANNING_REGISTRY_VALIDATOR_VERSION = 'orchestrator_planning_registry_validator_v1';
const PLAN_INDEX_VALIDATOR_VERSION = 'orchestrator_plan_index_validator_v1';

const PLAN_INDEX_FIELDS = Object.freeze([
  'plan_id', 'planning_request_id', 'tenant_id', 'organization_id', 'stage_ids', 'dependency_ids', 'plan_fingerprint',
  'validator_version'
]);
const MAX_LIST_ITEMS = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

// A Plan is not one of this PR's own contract files -- it is a small index tying together
// already-independently-registered stages and dependencies for one planning attempt, used
// only so the registry has something to key "plans" (per spec) off of.
function validatePlanIndex(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['plan_index_must_be_object'] };
  exactFields(plan, PLAN_INDEX_FIELDS, 'plan_index', errors);
  for (const field of ['plan_id', 'planning_request_id', 'tenant_id', 'organization_id', 'plan_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(plan.stage_ids)) errors.push('stage_ids_invalid');
  if (!isOrderedUniqueStringList(plan.dependency_ids)) errors.push('dependency_ids_invalid');
  if (plan.validator_version !== PLAN_INDEX_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

const ORCHESTRATOR_PLANNING_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const ORCHESTRATOR_PLANNING_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...ORCHESTRATOR_PLANNING_REGISTRY_SAFE_FLAGS });
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

function createOrchestratorPlanningRegistry() {
  const requestStore = createEntityStore({
    idField: 'planning_request_id', versionField: 'planning_request_version',
    validate: validateOrchestratorPlanningRequest, idLabel: 'planning_request'
  });
  const taskDefinitionStore = createEntityStore({
    idField: 'task_id', versionField: 'task_version', validate: validateOrchestratorTaskDefinition, idLabel: 'task_definition'
  });
  const policyStore = createEntityStore({
    idField: 'planning_policy_id', versionField: 'planning_policy_version',
    validate: validateOrchestratorPlanningPolicy, idLabel: 'planning_policy'
  });
  const budgetStore = createEntityStore({
    idField: 'plan_budget_id', validate: validateOrchestratorPlanBudget, idLabel: 'plan_budget'
  });
  const stageStore = createEntityStore({
    idField: 'stage_id', versionField: 'stage_version', validate: validateOrchestratorPlanStage, idLabel: 'plan_stage'
  });
  const dependencyStore = createEntityStore({
    idField: 'dependency_id', validate: validateOrchestratorPlanDependency, idLabel: 'plan_dependency'
  });
  const criteriaStore = createEntityStore({
    idField: 'criteria_id', versionField: 'criteria_version', validate: validateOrchestratorSuccessCriteria, idLabel: 'success_criteria'
  });
  const planStore = createEntityStore({
    idField: 'plan_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validatePlanIndex, idLabel: 'plan_index'
  });
  const resultStore = createEntityStore({
    idField: 'result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateOrchestratorPlanningResult, idLabel: 'planning_result'
  });

  return Object.freeze({
    registerPlanningRequest: requestStore.register,
    getPlanningRequestById: requestStore.getById,

    registerTaskDefinition: taskDefinitionStore.register,
    getTaskDefinitionById: taskDefinitionStore.getById,

    registerPlanningPolicy: policyStore.register,
    getPlanningPolicyById: policyStore.getById,

    registerPlanBudget: budgetStore.register,
    getPlanBudgetById: budgetStore.getById,

    registerPlanStage: stageStore.register,
    getPlanStageById: stageStore.getById,
    listPlanStagesByTenant: stageStore.listByTenant,

    registerPlanDependency: dependencyStore.register,
    getPlanDependencyById: dependencyStore.getById,

    registerSuccessCriteria: criteriaStore.register,
    getSuccessCriteriaById: criteriaStore.getById,

    registerPlan: planStore.register,
    getPlanById: planStore.getById,
    listPlansByTenant: planStore.listByTenant,
    listPlansByOrganization: planStore.listByOrganization,

    registerPlanningResult: resultStore.register,
    getPlanningResultById: resultStore.getById,
    listPlanningResultsByTenant: resultStore.listByTenant,
    listPlanningResultsByOrganization: resultStore.listByOrganization
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  ORCHESTRATOR_PLANNING_REGISTRY_SAFE_FLAGS,
  ORCHESTRATOR_PLANNING_REGISTRY_STATUSES,
  ORCHESTRATOR_PLANNING_REGISTRY_VALIDATOR_VERSION,
  PLAN_INDEX_FIELDS,
  PLAN_INDEX_VALIDATOR_VERSION,
  createOrchestratorPlanningRegistry,
  validatePlanIndex
};

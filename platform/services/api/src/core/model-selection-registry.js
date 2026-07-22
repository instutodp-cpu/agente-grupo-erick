'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateModelSelectionTaskProfile } = require('./model-selection-task-profile');
const { validateModelSelectionConstraints } = require('./model-selection-constraints');
const { validateModelSelectionCandidate } = require('./model-selection-candidate');
const { validateModelSelectionRanking } = require('./model-selection-ranking');
const { validateModelSelectionDecision } = require('./model-selection-decision');
const { validateModelSelectionEscalationPlan } = require('./model-selection-escalation-plan');

const MODEL_SELECTION_REGISTRY_VALIDATOR_VERSION = 'model_selection_registry_validator_v1';
const MODEL_SELECTION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const MODEL_SELECTION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false,
  runtime_enabled: false
});
const MAX_LIST_RESULTS = 200;

function safe(payload) {
  return cloneFrozen({ ...payload, ...MODEL_SELECTION_REGISTRY_SAFE_FLAGS });
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

  return Object.freeze({ register, getById, listAll, listByTenant });
}

function createConstraintsStore() {
  const byId = new Map();

  function register(constraintsId, constraints, options = {}) {
    if (!isNonEmptyString(constraintsId)) return safe({ ok: false, status: 'VALIDATION_FAILED', errors: ['constraints_id_invalid'] });
    const validation = validateModelSelectionConstraints(constraints);
    if (!validation.valid) return safe({ ok: false, status: 'VALIDATION_FAILED', errors: validation.errors });
    let fingerprint;
    try {
      fingerprint = stablePayload(constraints);
    } catch (error) {
      return safe({ ok: false, status: 'VALIDATION_FAILED', errors: [`fingerprint_invalid::${error.message}`] });
    }
    const existing = byId.get(constraintsId);
    const resolution = resolveRegistration(existing, constraintsId, { fingerprint }, undefined, options, 'constraints');
    if (resolution.ok) {
      byId.set(constraintsId, { record: cloneFrozen(constraints), fingerprint, version: resolution.version });
    }
    return safe(resolution);
  }

  function getById(constraintsId) {
    if (!isNonEmptyString(constraintsId)) return null;
    const entry = byId.get(constraintsId);
    return entry ? cloneFrozen(entry.record) : null;
  }

  return Object.freeze({ register, getById });
}

function createModelSelectionRegistry() {
  const taskProfileStore = createEntityStore({
    idField: 'task_profile_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    versionField: 'task_profile_version', validate: validateModelSelectionTaskProfile, idLabel: 'task_profile'
  });
  const constraintsStore = createConstraintsStore();
  const candidateStore = createEntityStore({
    idField: 'candidate_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    versionField: 'candidate_version', validate: validateModelSelectionCandidate, idLabel: 'candidate'
  });
  const rankingStore = createEntityStore({ idField: 'ranking_id', validate: validateModelSelectionRanking, idLabel: 'ranking' });
  const decisionStore = createEntityStore({
    idField: 'decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateModelSelectionDecision, idLabel: 'decision'
  });
  const escalationPlanStore = createEntityStore({ idField: 'escalation_plan_id', validate: validateModelSelectionEscalationPlan, idLabel: 'escalation_plan' });

  return Object.freeze({
    registerTaskProfile: taskProfileStore.register,
    getTaskProfileById: taskProfileStore.getById,
    listTaskProfilesByTenant: taskProfileStore.listByTenant,

    registerConstraints: constraintsStore.register,
    getConstraintsById: constraintsStore.getById,

    registerCandidate: candidateStore.register,
    getCandidateById: candidateStore.getById,
    listCandidatesByTenant: candidateStore.listByTenant,

    registerRanking: rankingStore.register,
    getRankingById: rankingStore.getById,

    registerDecision: decisionStore.register,
    getDecisionById: decisionStore.getById,
    listDecisionsByTenant: decisionStore.listByTenant,

    registerEscalationPlan: escalationPlanStore.register,
    getEscalationPlanById: escalationPlanStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  MODEL_SELECTION_REGISTRY_SAFE_FLAGS,
  MODEL_SELECTION_REGISTRY_STATUSES,
  MODEL_SELECTION_REGISTRY_VALIDATOR_VERSION,
  createModelSelectionRegistry
};

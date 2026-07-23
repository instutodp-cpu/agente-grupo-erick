'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateBudgetEvidenceReference } = require('./orchestrator-budget-evidence-reference');
const { validateDependencyEvidenceReference } = require('./orchestrator-dependency-evidence-reference');
const { validateConflictEvidenceReference } = require('./orchestrator-conflict-evidence-reference');
const { validateApprovalEvidenceReference } = require('./orchestrator-approval-evidence-reference');
const { validateReadinessEvidenceBundle } = require('./orchestrator-readiness-evidence-bundle');

const ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_VALIDATOR_VERSION = 'orchestrator_decision_evidence_registry_validator_v1';
const ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_SAFE_FLAGS });
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

function createOrchestratorDecisionEvidenceRegistry() {
  const budgetEvidenceStore = createEntityStore({
    idField: 'budget_evidence_id', versionField: 'budget_evidence_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateBudgetEvidenceReference, idLabel: 'budget_evidence'
  });
  const dependencyEvidenceStore = createEntityStore({
    idField: 'dependency_evidence_id', versionField: 'dependency_evidence_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateDependencyEvidenceReference, idLabel: 'dependency_evidence'
  });
  const conflictEvidenceStore = createEntityStore({
    idField: 'conflict_evidence_id', versionField: 'conflict_evidence_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateConflictEvidenceReference, idLabel: 'conflict_evidence'
  });
  const approvalEvidenceStore = createEntityStore({
    idField: 'approval_evidence_id', versionField: 'approval_evidence_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateApprovalEvidenceReference, idLabel: 'approval_evidence'
  });
  const readinessBundleStore = createEntityStore({
    idField: 'readiness_bundle_id', versionField: 'readiness_bundle_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateReadinessEvidenceBundle, idLabel: 'readiness_evidence_bundle'
  });

  return Object.freeze({
    registerBudgetEvidence: budgetEvidenceStore.register,
    getBudgetEvidenceById: budgetEvidenceStore.getById,
    listBudgetEvidenceByTenant: budgetEvidenceStore.listByTenant,

    registerDependencyEvidence: dependencyEvidenceStore.register,
    getDependencyEvidenceById: dependencyEvidenceStore.getById,
    listDependencyEvidenceByTenant: dependencyEvidenceStore.listByTenant,

    registerConflictEvidence: conflictEvidenceStore.register,
    getConflictEvidenceById: conflictEvidenceStore.getById,
    listConflictEvidenceByTenant: conflictEvidenceStore.listByTenant,

    registerApprovalEvidence: approvalEvidenceStore.register,
    getApprovalEvidenceById: approvalEvidenceStore.getById,
    listApprovalEvidenceByTenant: approvalEvidenceStore.listByTenant,

    registerReadinessBundle: readinessBundleStore.register,
    getReadinessBundleById: readinessBundleStore.getById,
    listReadinessBundlesByTenant: readinessBundleStore.listByTenant,
    listReadinessBundlesByOrganization: readinessBundleStore.listByOrganization
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_STATUSES,
  ORCHESTRATOR_DECISION_EVIDENCE_REGISTRY_VALIDATOR_VERSION,
  createOrchestratorDecisionEvidenceRegistry
};

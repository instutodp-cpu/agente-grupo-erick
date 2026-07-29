'use strict';

const { isNonEmptyString } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');
const { validateRuntimeExecutionSimulationRequest } = require('./runtime-execution-simulation-request');
const { validateRuntimeStageSimulationReference } = require('./runtime-stage-simulation-reference');
const { validateRuntimeStageSimulationManifest } = require('./runtime-stage-simulation-manifest');
const { validateRuntimeDependencySimulationReference } = require('./runtime-dependency-simulation-reference');
const { validateRuntimeDependencySimulationManifest } = require('./runtime-dependency-simulation-manifest');
const { validateRuntimeBudgetSimulationReference } = require('./runtime-budget-simulation-reference');
const { validateRuntimeStopSimulationReference } = require('./runtime-stop-simulation-reference');
const { validateRuntimeCompensationSimulationReference } = require('./runtime-compensation-simulation-reference');
const { validateRuntimeArtifactPlanReference } = require('./runtime-artifact-plan-reference');
const { validateRuntimeEventPlanReference } = require('./runtime-event-plan-reference');
const { validateRuntimeExecutionPackage } = require('./runtime-execution-package');
const { validateRuntimeExecutionSimulationDecision } = require('./runtime-execution-simulation-decision');
const { validateRuntimeExecutionSimulationResult } = require('./runtime-execution-simulation-result');
const { validateRuntimeExecutionSimulationAudit } = require('./runtime-execution-simulation-audit');

// In-memory only, synthetic, never persisted -- mirrors execution-gateway-registry.js's own
// createEntityStore/resolveRegistration precedence exactly (replay -> payload mismatch ->
// expected-version conflict -> expected-fingerprint conflict -> version downgrade -> accepted),
// the same discipline every registry in this codebase already follows.
const RUNTIME_EXECUTION_SIMULATION_REGISTRY_VALIDATOR_VERSION = 'runtime_execution_simulation_registry_validator_v1';
const RUNTIME_EXECUTION_SIMULATION_REGISTRY_STATUSES = Object.freeze([
  'REGISTERED_SIMULATION', 'REPLAY_ACCEPTED', 'PAYLOAD_MISMATCH', 'VERSION_CONFLICT', 'FINGERPRINT_CONFLICT',
  'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const RUNTIME_EXECUTION_SIMULATION_REGISTRY_SAFE_FLAGS = Object.freeze({
  simulation: true,
  production_blocked: true,
  executed: false
});
const MAX_LIST_RESULTS = 200;
const NO_VERSION_FIELD_SENTINEL = 1;

function safe(payload) {
  return cloneFrozen({ ...payload, ...RUNTIME_EXECUTION_SIMULATION_REGISTRY_SAFE_FLAGS });
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

function createRuntimeExecutionSimulationRegistry() {
  const requestStore = createEntityStore({
    idField: 'runtime_request_id', versionField: 'runtime_request_version', validate: validateRuntimeExecutionSimulationRequest,
    idLabel: 'runtime_execution_simulation_request'
  });
  const stageReferenceStore = createEntityStore({
    idField: 'runtime_stage_reference_id', versionField: 'runtime_stage_reference_version',
    validate: validateRuntimeStageSimulationReference, idLabel: 'runtime_stage_simulation_reference'
  });
  const stageManifestStore = createEntityStore({
    idField: 'runtime_stage_manifest_id', versionField: 'runtime_stage_manifest_version',
    validate: validateRuntimeStageSimulationManifest, idLabel: 'runtime_stage_simulation_manifest'
  });
  const dependencyReferenceStore = createEntityStore({
    idField: 'runtime_dependency_reference_id', versionField: 'runtime_dependency_reference_version',
    validate: validateRuntimeDependencySimulationReference, idLabel: 'runtime_dependency_simulation_reference'
  });
  const dependencyManifestStore = createEntityStore({
    idField: 'runtime_dependency_manifest_id', versionField: 'runtime_dependency_manifest_version',
    validate: validateRuntimeDependencySimulationManifest, idLabel: 'runtime_dependency_simulation_manifest'
  });
  const budgetReferenceStore = createEntityStore({
    idField: 'runtime_budget_reference_id', versionField: 'runtime_budget_reference_version',
    validate: validateRuntimeBudgetSimulationReference, idLabel: 'runtime_budget_simulation_reference'
  });
  const stopReferenceStore = createEntityStore({
    idField: 'runtime_stop_reference_id', versionField: 'runtime_stop_reference_version',
    validate: validateRuntimeStopSimulationReference, idLabel: 'runtime_stop_simulation_reference'
  });
  const compensationReferenceStore = createEntityStore({
    idField: 'runtime_compensation_reference_id', versionField: 'runtime_compensation_reference_version',
    validate: validateRuntimeCompensationSimulationReference, idLabel: 'runtime_compensation_simulation_reference'
  });
  const artifactPlanStore = createEntityStore({
    idField: 'runtime_artifact_plan_reference_id', versionField: 'runtime_artifact_plan_reference_version',
    validate: validateRuntimeArtifactPlanReference, idLabel: 'runtime_artifact_plan_reference'
  });
  const eventPlanStore = createEntityStore({
    idField: 'runtime_event_plan_reference_id', versionField: 'runtime_event_plan_reference_version',
    validate: validateRuntimeEventPlanReference, idLabel: 'runtime_event_plan_reference'
  });
  const packageStore = createEntityStore({
    idField: 'runtime_execution_package_id', versionField: 'runtime_execution_package_version', tenantField: 'tenant_id',
    organizationField: 'organization_id', validate: validateRuntimeExecutionPackage, idLabel: 'runtime_execution_package'
  });
  const decisionStore = createEntityStore({
    idField: 'runtime_decision_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeExecutionSimulationDecision, idLabel: 'runtime_execution_simulation_decision'
  });
  const resultStore = createEntityStore({
    idField: 'runtime_result_id', tenantField: 'tenant_id', organizationField: 'organization_id',
    validate: validateRuntimeExecutionSimulationResult, idLabel: 'runtime_execution_simulation_result'
  });
  const auditStore = createEntityStore({
    idField: 'audit_id', validate: validateRuntimeExecutionSimulationAudit, idLabel: 'runtime_execution_simulation_audit'
  });

  return Object.freeze({
    registerRuntimeExecutionSimulationRequest: requestStore.register,
    getRuntimeExecutionSimulationRequestById: requestStore.getById,

    registerRuntimeStageSimulationReference: stageReferenceStore.register,
    getRuntimeStageSimulationReferenceById: stageReferenceStore.getById,

    registerRuntimeStageSimulationManifest: stageManifestStore.register,
    getRuntimeStageSimulationManifestById: stageManifestStore.getById,

    registerRuntimeDependencySimulationReference: dependencyReferenceStore.register,
    getRuntimeDependencySimulationReferenceById: dependencyReferenceStore.getById,

    registerRuntimeDependencySimulationManifest: dependencyManifestStore.register,
    getRuntimeDependencySimulationManifestById: dependencyManifestStore.getById,

    registerRuntimeBudgetSimulationReference: budgetReferenceStore.register,
    getRuntimeBudgetSimulationReferenceById: budgetReferenceStore.getById,

    registerRuntimeStopSimulationReference: stopReferenceStore.register,
    getRuntimeStopSimulationReferenceById: stopReferenceStore.getById,

    registerRuntimeCompensationSimulationReference: compensationReferenceStore.register,
    getRuntimeCompensationSimulationReferenceById: compensationReferenceStore.getById,

    registerRuntimeArtifactPlanReference: artifactPlanStore.register,
    getRuntimeArtifactPlanReferenceById: artifactPlanStore.getById,

    registerRuntimeEventPlanReference: eventPlanStore.register,
    getRuntimeEventPlanReferenceById: eventPlanStore.getById,

    registerRuntimeExecutionPackage: packageStore.register,
    getRuntimeExecutionPackageById: packageStore.getById,
    listRuntimeExecutionPackagesByTenant: packageStore.listByTenant,
    listRuntimeExecutionPackagesByOrganization: packageStore.listByOrganization,

    registerRuntimeExecutionSimulationDecision: decisionStore.register,
    getRuntimeExecutionSimulationDecisionById: decisionStore.getById,
    listRuntimeExecutionSimulationDecisionsByTenant: decisionStore.listByTenant,

    registerRuntimeExecutionSimulationResult: resultStore.register,
    getRuntimeExecutionSimulationResultById: resultStore.getById,
    listRuntimeExecutionSimulationResultsByTenant: resultStore.listByTenant,

    registerRuntimeExecutionSimulationAudit: auditStore.register,
    getRuntimeExecutionSimulationAuditById: auditStore.getById
  });
}

module.exports = {
  MAX_LIST_RESULTS,
  RUNTIME_EXECUTION_SIMULATION_REGISTRY_SAFE_FLAGS,
  RUNTIME_EXECUTION_SIMULATION_REGISTRY_STATUSES,
  RUNTIME_EXECUTION_SIMULATION_REGISTRY_VALIDATOR_VERSION,
  createRuntimeExecutionSimulationRegistry
};

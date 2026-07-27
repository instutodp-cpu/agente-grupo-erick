'use strict';

// The concrete, populated ValidationRegistry for the Execution Plan pipeline -- one validator per
// canonical stage (validation-outcome.js's own VALIDATION_STAGES), each a pure, synchronous
// function of a normalized `context` bag (never of `context` in the legacy engine sense; see
// validation-pipeline.js's own note on the two unrelated meanings of "context" in this codebase).
// Wherever an existing PR #94-#100 contract already exports a pure `validate*()` function, that
// function is reused directly as the handler -- never reimplemented.
const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { validateExecutionPlanRequest } = require('./execution-plan-request');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateOrchestratorStageManifestReference } = require('./orchestrator-stage-manifest-reference');
const { validateExecutionPlanDependencyGraphReference } = require('./execution-plan-dependency-graph-reference');
const { createValidationRegistryBuilder } = require('./validation-registry');

const VERSION = 'execution_plan_validation_registry_v1';

function contextRequest(context) {
  return isPlainObject(context) && isPlainObject(context.request) ? context.request : {};
}

function canonicalIdentity(context) {
  const authzRef = contextRequest(context).authorization_decision_reference || {};
  return {
    tenantId: authzRef.tenant_id, organizationId: authzRef.organization_id, agentId: authzRef.agent_id,
    projectId: authzRef.project_id, sessionId: authzRef.session_reference_id
  };
}

const builder = createValidationRegistryBuilder();

builder.register({
  validator_id: 'execution-plan-request-schema', version: VERSION, stage: 'SCHEMA', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => validateExecutionPlanRequest(contextRequest(context))
});

builder.register({
  validator_id: 'execution-plan-simulation-context', version: VERSION, stage: 'SIMULATION_CONTEXT', priority: 0, required: true,
  applicable: (context) => isPlainObject(contextRequest(context).simulation_context),
  handler: (context) => validateAgentSimulationContext(contextRequest(context).simulation_context)
});

builder.register({
  validator_id: 'execution-plan-identity-present', version: VERSION, stage: 'IDENTITY', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const authzRef = request.authorization_decision_reference || {};
    if (!isNonEmptyString(authzRef.tenant_id) || !isNonEmptyString(authzRef.agent_id)) {
      return { status: 'VALIDATION_FAILED', reason: 'canonical_identity_missing' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-tenant-binding', version: VERSION, stage: 'TENANT', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const canonical = canonicalIdentity(context);
    const taskRef = request.task_reference || {};
    if (isNonEmptyString(taskRef.tenant_id) && taskRef.tenant_id !== canonical.tenantId) {
      return { status: 'TENANT_BLOCKED', reason: 'task_reference_tenant_mismatch' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-organization-binding', version: VERSION, stage: 'ORGANIZATION', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const canonical = canonicalIdentity(context);
    const taskRef = request.task_reference || {};
    if (isNonEmptyString(taskRef.organization_id) && taskRef.organization_id !== canonical.organizationId) {
      return { status: 'ORGANIZATION_BLOCKED', reason: 'task_reference_organization_mismatch' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-project-binding', version: VERSION, stage: 'PROJECT', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const canonical = canonicalIdentity(context);
    const taskRef = request.task_reference || {};
    if (isNonEmptyString(taskRef.project_id) && canonical.projectId !== null && taskRef.project_id !== canonical.projectId) {
      return { status: 'PROJECT_BLOCKED', reason: 'task_reference_project_mismatch' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-session-binding', version: VERSION, stage: 'SESSION', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const canonical = canonicalIdentity(context);
    const taskRef = request.task_reference || {};
    if (isNonEmptyString(taskRef.session_reference_id) && canonical.sessionId !== null && taskRef.session_reference_id !== canonical.sessionId) {
      return { status: 'SESSION_BLOCKED', reason: 'task_reference_session_mismatch' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-task-plan-agreement', version: VERSION, stage: 'TASK', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const request = contextRequest(context);
    const planRef = request.orchestration_plan_reference || {};
    const taskRef = request.task_reference || {};
    if (isNonEmptyString(taskRef.plan_id) && isNonEmptyString(planRef.plan_id) && taskRef.plan_id !== planRef.plan_id) {
      return { status: 'TASK_BLOCKED', reason: 'task_reference_plan_id_mismatch' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-authorization-ready', version: VERSION, stage: 'AUTHORIZATION', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const authzRef = contextRequest(context).authorization_decision_reference || {};
    if (authzRef.status !== 'AUTHORIZED_SIMULATION') {
      return { status: 'AUTHORIZATION_BLOCKED', reason: `authorization_status::${authzRef.status}` };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-authorization-provenance-present', version: VERSION, stage: 'AUTHORIZATION_PROVENANCE', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const provenanceRef = contextRequest(context).authorization_provenance_reference;
    if (!isPlainObject(provenanceRef) || provenanceRef.provenance_validated !== true) {
      return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-not-validated' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-authorization-scope-present', version: VERSION, stage: 'AUTHORIZATION_SCOPE', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const scopeRef = contextRequest(context).authorization_scope_reference;
    if (!isPlainObject(scopeRef) || scopeRef.scope_validated !== true) {
      return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-not-validated' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-registry-snapshot-present', version: VERSION, stage: 'REGISTRY_SNAPSHOT', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const snapshotRef = contextRequest(context).registry_snapshot_reference;
    if (!isPlainObject(snapshotRef) || snapshotRef.snapshot_consistent !== true || snapshotRef.snapshot_validated !== true) {
      return { status: 'REGISTRY_SNAPSHOT_BLOCKED', reason: 'registry-snapshot-not-validated' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-evidence-ready', version: VERSION, stage: 'EVIDENCE', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const bundleRef = contextRequest(context).readiness_evidence_bundle_reference || {};
    if (bundleRef.bundle_status !== 'READY_EVIDENCE_SIMULATION') {
      return { status: 'EVIDENCE_BLOCKED', reason: `readiness_evidence_bundle_status::${bundleRef.bundle_status}` };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-stage-manifest-schema', version: VERSION, stage: 'STAGE_MANIFEST', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => validateOrchestratorStageManifestReference(contextRequest(context).stage_manifest_reference)
});

builder.register({
  validator_id: 'execution-plan-dependency-graph-schema', version: VERSION, stage: 'DEPENDENCY_GRAPH', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => validateExecutionPlanDependencyGraphReference(contextRequest(context).dependency_graph_reference)
});

builder.register({
  validator_id: 'execution-plan-reference-binding-ready', version: VERSION, stage: 'REFERENCE_BINDING', priority: 0, required: true,
  applicable: (context) => isPlainObject(context) && context.ledger !== undefined,
  handler: (context) => {
    if (!context.ledger || context.ledger.references_bound_in_simulation !== true) {
      return { status: 'REFERENCE_BINDING_BLOCKED', reason: 'reference_binding_not_fully_bound' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-budget-validated', version: VERSION, stage: 'BUDGET', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const budget = contextRequest(context).execution_plan_budget || {};
    if (budget.budget_validated !== true) return { status: 'BUDGET_BLOCKED', reason: 'execution_plan_budget_not_validated' };
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-idempotency-validated', version: VERSION, stage: 'IDEMPOTENCY', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const idempotency = contextRequest(context).idempotency_policy_reference || {};
    if (idempotency.idempotency_validated !== true) return { status: 'IDEMPOTENCY_BLOCKED', reason: 'idempotency_not_validated' };
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-stop-conditions-present', version: VERSION, stage: 'STOP_CONDITIONS', priority: 0, required: true,
  applicable: () => true,
  handler: (context) => {
    const stopConditions = contextRequest(context).stop_condition_references;
    if (!Array.isArray(stopConditions) || stopConditions.length === 0) {
      return { status: 'STOP_CONDITION_BLOCKED', reason: 'no_stop_conditions_declared' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-compensations-coverage', version: VERSION, stage: 'COMPENSATIONS', priority: 0, required: true,
  applicable: (context) => Array.isArray(context.stateChangeStageIds) && context.stateChangeStageIds.length > 0,
  handler: (context) => {
    const compensations = contextRequest(context).compensation_references || [];
    const uncovered = (context.stateChangeStageIds || []).find(
      (stageId) => !compensations.some((c) => c.execution_stage_id === stageId && c.compensation_type !== 'NONE')
    );
    if (uncovered) return { status: 'COMPENSATION_BLOCKED', reason: 'state_change_stage_missing_compensation' };
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-package-integrity-present', version: VERSION, stage: 'PACKAGE_INTEGRITY', priority: 0, required: true,
  applicable: (context) => isNonEmptyString(context.executionPlanFingerprint),
  handler: (context) => {
    if (context.executionPlanFingerprint === 'fingerprint_not_available') {
      return { status: 'FINGERPRINT_BLOCKED', reason: 'execution_plan_fingerprint_not_available' };
    }
    return null;
  }
});

builder.register({
  validator_id: 'execution-plan-finalization', version: VERSION, stage: 'FINALIZATION', priority: 0, required: true,
  applicable: (context) => context.waitingApproval !== true,
  handler: () => null
});

const executionPlanValidationRegistry = builder.build();

module.exports = {
  VERSION,
  canonicalIdentity,
  contextRequest,
  executionPlanValidationRegistry
};

'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { stablePayload } = require('./agent-identity-contract');
const { buildBindingRecord } = require('./execution-reference-binding-record');
const { buildExecutionReferenceBindingLedger } = require('./execution-reference-binding-ledger');

// This module only *evaluates* -- it never resolves a reference's underlying content, never
// calls a model/tool/workflow provider, never applies a binding, and never authorizes or starts
// execution. Every function here is a pure read of already-materialized, already-fingerprinted
// declarative data, returning either `null` (no blocker) or a { status, reason } pair the engine
// translates into a *_BLOCKED outcome -- fail-closed, exactly like checkBinding() in
// execution-plan-engine.js.

function safeFingerprint(value) {
  try {
    return stablePayload(value === undefined || value === null ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

// --- Authorization Provenance cross-checks -----------------------------------------------------
//
// PR #98's own AuthorizationDecisionReference (23 fields) never carried actor_id, actor_role,
// authorization_scope_id, approval_reference_id, budget_authorization_id,
// expiration_evaluation_id, or any of the five sub-fingerprints PR #97's full AuthorizationDecision
// already has -- that gap is exactly what this PR closes. Fields the request already had a place
// to declare (authorization_decision_id/fingerprint, planning_result_id/fingerprint, plan_id/
// orchestration_plan_fingerprint, task_reference_id/task_fingerprint, tenant/organization/project/
// session/agent) are cross-checked against those pre-existing sources below. Fields this PR
// introduces for the first time (actor_id/role, authorization_scope_id/fingerprint,
// approval_reference_id, expiration_evaluation_id, budget_authorization_id/fingerprint,
// authorization_request/policy fingerprints) are cross-checked against the sibling
// AuthorizationScopeReference and ExecutionPlanBudget this same PR introduces/already has, so the
// three references can never quietly disagree about who is acting or under what budget.
function validateProvenanceCrossChecks(provenanceRef, { authzRef, planningRef, planRef, taskRef, budget, scopeRef, canonical }) {
  if (provenanceRef.authorization_decision_id !== authzRef.authorization_decision_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::authorization_decision_id' };
  }
  if (provenanceRef.authorization_decision_fingerprint !== authzRef.authorization_decision_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::authorization_decision_fingerprint' };
  }
  if (provenanceRef.planning_result_id !== planningRef.planning_result_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::planning_result_id' };
  }
  if (provenanceRef.planning_result_fingerprint !== planningRef.planning_result_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::planning_result_fingerprint' };
  }
  if (provenanceRef.plan_id !== planRef.plan_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::plan_id' };
  }
  if (provenanceRef.orchestration_plan_fingerprint !== planRef.plan_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::orchestration_plan_fingerprint' };
  }
  if (provenanceRef.task_reference_id !== taskRef.task_reference_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::task_reference_id' };
  }
  if (provenanceRef.task_fingerprint !== taskRef.task_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::task_fingerprint' };
  }
  if (
    provenanceRef.agent_id !== canonical.agentId || provenanceRef.tenant_id !== canonical.tenantId ||
    provenanceRef.organization_id !== canonical.organizationId
  ) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::canonical_identity' };
  }
  if (canonical.projectId !== null && provenanceRef.project_id !== canonical.projectId) {
    return { status: 'PROJECT_BLOCKED', reason: 'provenance-id-mismatch::project_id' };
  }
  if (canonical.sessionId !== null && provenanceRef.session_reference_id !== canonical.sessionId) {
    return { status: 'SESSION_BLOCKED', reason: 'provenance-id-mismatch::session_reference_id' };
  }
  if (provenanceRef.budget_authorization_id !== budget.budget_authorization_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::budget_authorization_id' };
  }
  if (provenanceRef.budget_authorization_fingerprint !== budget.budget_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::budget_authorization_fingerprint' };
  }
  if (provenanceRef.authorization_scope_id !== scopeRef.authorization_scope_id) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::authorization_scope_id' };
  }
  if (provenanceRef.authorization_scope_fingerprint !== scopeRef.scope_fingerprint) {
    return { status: 'FINGERPRINT_BLOCKED', reason: 'provenance-fingerprint-mismatch::authorization_scope_fingerprint' };
  }
  if (provenanceRef.actor_id !== scopeRef.actor_id || provenanceRef.actor_role !== scopeRef.actor_role) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-id-mismatch::actor_identity' };
  }
  if (provenanceRef.provenance_validated !== true) {
    return { status: 'AUTHORIZATION_PROVENANCE_BLOCKED', reason: 'provenance-not-validated' };
  }
  return null;
}

// --- Authorization Scope cross-checks -----------------------------------------------------------
//
// A scope reference is a positive allowlist (PR #97's own principle, mirrored here): every list
// this PR needs to check is checked for *inclusion*, and an empty list means nothing of that kind
// is permitted, never "unrestricted."
function validateScopeCrossChecks(scopeRef, { authzRef, canonical, planRef, taskRef, stageRecords, budget, provenanceRef }) {
  if (scopeRef.authorization_decision_id !== authzRef.authorization_decision_id) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-decision-mismatch' };
  }
  if (
    scopeRef.tenant_id !== canonical.tenantId || scopeRef.organization_id !== canonical.organizationId ||
    scopeRef.agent_id !== canonical.agentId
  ) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-canonical-identity-mismatch' };
  }
  if (canonical.projectId !== null && scopeRef.project_id !== canonical.projectId) {
    return { status: 'PROJECT_BLOCKED', reason: 'scope-project-mismatch' };
  }
  if (canonical.sessionId !== null && scopeRef.session_reference_id !== canonical.sessionId) {
    return { status: 'SESSION_BLOCKED', reason: 'scope-session-mismatch' };
  }
  if (!scopeRef.allowed_plan_ids.includes(planRef.plan_id)) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-plan-blocked' };
  }
  if (!scopeRef.allowed_task_reference_ids.includes(taskRef.task_reference_id)) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-task-blocked' };
  }
  if (!scopeRef.allowed_agent_ids.includes(canonical.agentId)) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-agent-blocked' };
  }
  // Only a stage record that actually declares a model/tool/workflow reference needs it inside
  // the allowlist -- model_selection_reference/workflow_decision_reference are always non-null
  // decision objects on the request even for a NO_LLM_SELECTED_SIMULATION/no-workflow-used
  // decision, so the request-level reference_id alone is never a reliable signal of use.
  for (const record of stageRecords) {
    if (isNonEmptyString(record.model_selection_reference_id) && !scopeRef.allowed_model_reference_ids.includes(record.model_selection_reference_id)) {
      return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-selection-blocked' };
    }
    for (const toolId of record.tool_reference_ids || []) {
      if (!scopeRef.allowed_tool_reference_ids.includes(toolId)) {
        return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-tool-blocked' };
      }
    }
    if (isNonEmptyString(record.workflow_reference_id) && !scopeRef.allowed_workflow_reference_ids.includes(record.workflow_reference_id)) {
      return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-workflow-blocked' };
    }
    if (!scopeRef.allowed_stage_types.includes(record.stage_type)) {
      return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-stage-type-blocked' };
    }
  }
  if (!scopeRef.allowed_risk_classifications.includes(taskRef.risk_classification)) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-risk-blocked' };
  }
  if (budget.estimated_total_tokens > scopeRef.maximum_authorized_tokens || budget.estimated_total_cost_minor_units > scopeRef.maximum_authorized_cost_minor_units) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-budget-blocked' };
  }
  if (scopeRef.authorization_scope_id !== provenanceRef.authorization_scope_id) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-provenance-mismatch' };
  }
  if (scopeRef.scope_validated !== true) {
    return { status: 'AUTHORIZATION_SCOPE_BLOCKED', reason: 'scope-not-validated' };
  }
  return null;
}

// --- Registry Snapshot cross-checks ---------------------------------------------------------------
//
// The snapshot's own validator already enforces snapshot_consistent === (expected === observed);
// this function only checks that the snapshot's declared entity fingerprints agree with the
// fingerprints this same evaluation already computed for every versioned entity the request
// carries -- the fixed REGISTRY_ENTITY_KEYS set from execution-registry-snapshot-reference.js.
function validateSnapshotCrossChecks(snapshotRef, { canonical, executionPlanRequestId, executionPlanId, entityFingerprints }) {
  if (
    snapshotRef.tenant_id !== canonical.tenantId || snapshotRef.organization_id !== canonical.organizationId ||
    snapshotRef.execution_plan_request_id !== executionPlanRequestId || snapshotRef.execution_plan_id !== executionPlanId
  ) {
    return { status: 'REGISTRY_SNAPSHOT_BLOCKED', reason: 'missing-registry-entity::identity_mismatch' };
  }
  if (snapshotRef.snapshot_consistent !== true) {
    return { status: 'REGISTRY_SNAPSHOT_BLOCKED', reason: 'registry-version-mismatch' };
  }
  for (const [entityKey, expectedFingerprint] of Object.entries(entityFingerprints)) {
    if (snapshotRef.registry_entity_fingerprints[entityKey] !== expectedFingerprint) {
      return { status: 'REGISTRY_SNAPSHOT_BLOCKED', reason: `registry-fingerprint-mismatch::${entityKey}` };
    }
  }
  if (snapshotRef.snapshot_validated !== true) {
    return { status: 'REGISTRY_SNAPSHOT_BLOCKED', reason: 'registry-snapshot-not-validated' };
  }
  return null;
}

// --- Binding records ------------------------------------------------------------------------------
//
// Every already-computed ExecutionPlanStageBinding (PR #98, unchanged) is wrapped into the richer
// BindingRecord shape one-for-one -- source/target collapse to the same single-target reference,
// since ExecutionPlanStageBinding never had a distinct target concept. Reference-level bindings
// this PR introduces (a whole scope, a whole provenance chain, the registry snapshot, the stage
// manifest, the dependency graph, idempotency, one per stop condition, one per compensation
// reference) are then appended, always at plan scope (execution_stage_id = null).
function wrapStageBindingAsRecord(stageBinding, { executionPlanRequestId, canonical, index }) {
  return buildBindingRecord({
    binding_record_id: `${stageBinding.binding_id}-record`,
    execution_plan_id: stageBinding.execution_plan_id,
    execution_plan_request_id: executionPlanRequestId,
    execution_stage_id: stageBinding.execution_stage_id,
    binding_type: stageBinding.binding_type,
    source_reference_id: stageBinding.source_reference_id,
    source_reference_version: stageBinding.source_reference_version,
    source_reference_fingerprint: stageBinding.source_reference_fingerprint,
    target_reference_id: stageBinding.execution_stage_id,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(stageBinding.execution_stage_id),
    tenant_id: stageBinding.tenant_id,
    organization_id: stageBinding.organization_id,
    project_id: stageBinding.project_id,
    session_reference_id: stageBinding.session_reference_id,
    agent_id: stageBinding.agent_id,
    actor_id: canonical.actorId,
    authorization_scope_id: canonical.authorizationScopeId,
    binding_required: stageBinding.binding_required,
    binding_status: stageBinding.binding_validated ? 'VALIDATED_SIMULATION' : 'BINDING_BLOCKED',
    reason_codes: stageBinding.binding_validated ? [] : [`stage-binding-not-validated::${stageBinding.binding_id}`],
    logical_sequence: index
  });
}

function buildReferenceLevelBindingRecords({
  provenanceRef, scopeRef, snapshotRef, stageManifestRef, depGraphRef, idempotency, stopConditions, compensations,
  canonical, executionPlanId, executionPlanRequestId, startingSequence, authzRef = {}, planFingerprint = null,
  requestFingerprint = null, validStageIds = null
}) {
  let sequence = startingSequence;
  const records = [];
  const common = {
    execution_plan_id: executionPlanId,
    execution_plan_request_id: executionPlanRequestId,
    execution_stage_id: null,
    tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId,
    project_id: canonical.projectId,
    session_reference_id: canonical.sessionId,
    agent_id: canonical.agentId,
    actor_id: canonical.actorId,
    authorization_scope_id: canonical.authorizationScopeId,
    binding_required: true,
    binding_status: 'VALIDATED_SIMULATION',
    reason_codes: []
  };

  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-scope-binding-record`,
    binding_type: 'AUTHORIZATION_SCOPE_BINDING',
    source_reference_id: scopeRef.authorization_scope_reference_id,
    source_reference_version: scopeRef.authorization_scope_reference_version,
    source_reference_fingerprint: scopeRef.scope_fingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    logical_sequence: sequence++
  }));

  // Same bounded-summary reasoning as the snapshot binding above: the provenance reference's own
  // external fingerprint (used elsewhere as the canonical authorization_provenance_fingerprint)
  // already aggregates 41 fields' worth of upstream sub-fingerprints; embedding it again here would
  // re-trigger the same compounding through BindingRecord -> BindingLedger -> package -> plan.
  const provenanceBindingSummaryFingerprint = safeFingerprint({
    authorization_provenance_reference_id: provenanceRef.authorization_provenance_reference_id,
    authorization_provenance_reference_version: provenanceRef.authorization_provenance_reference_version,
    authorization_decision_id: provenanceRef.authorization_decision_id,
    plan_id: provenanceRef.plan_id,
    provenance_validated: provenanceRef.provenance_validated
  });
  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-provenance-binding-record`,
    binding_type: 'AUTHORIZATION_PROVENANCE_BINDING',
    source_reference_id: provenanceRef.authorization_provenance_reference_id,
    source_reference_version: provenanceRef.authorization_provenance_reference_version,
    source_reference_fingerprint: provenanceBindingSummaryFingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    logical_sequence: sequence++
  }));

  // The snapshot's own self-fingerprint necessarily aggregates all seven registry entity
  // fingerprints (it has to, to detect drift in any of them) and is therefore already
  // significantly larger than every other bounded fingerprint in this codebase. Embedding it
  // verbatim as a BindingRecord field would mean it gets re-serialized (with string-escaping
  // overhead) at every downstream layer -- BindingRecord's own recompute-and-compare, then the
  // BindingLedger, then the ExecutionPlanPackage, then plan/result/audit -- compounding a ~15KB
  // string into a multi-hundred-KB one by the time it reaches the plan. The binding only needs to
  // *reference* the snapshot (id, version, and its own shallow consistency signal), not carry a
  // second full copy of its fingerprint; validateSnapshotCrossChecks (run earlier, independently)
  // is what actually verifies snapshot_fingerprint itself.
  const snapshotBindingSummaryFingerprint = safeFingerprint({
    registry_snapshot_reference_id: snapshotRef.registry_snapshot_reference_id,
    registry_snapshot_reference_version: snapshotRef.registry_snapshot_reference_version,
    expected_registry_version: snapshotRef.expected_registry_version,
    observed_registry_version: snapshotRef.observed_registry_version,
    snapshot_consistent: snapshotRef.snapshot_consistent
  });
  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-snapshot-binding-record`,
    binding_type: 'REGISTRY_SNAPSHOT_BINDING',
    source_reference_id: snapshotRef.registry_snapshot_reference_id,
    source_reference_version: snapshotRef.registry_snapshot_reference_version,
    source_reference_fingerprint: snapshotBindingSummaryFingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    logical_sequence: sequence++
  }));

  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-manifest-binding-record`,
    binding_type: 'STAGE_MANIFEST_BINDING',
    source_reference_id: stageManifestRef.stage_manifest_reference_id,
    source_reference_version: stageManifestRef.stage_manifest_reference_version,
    source_reference_fingerprint: stageManifestRef.manifest_fingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    logical_sequence: sequence++
  }));

  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-dependency-graph-binding-record`,
    binding_type: 'DEPENDENCY_GRAPH_BINDING',
    source_reference_id: depGraphRef.dependency_graph_reference_id,
    source_reference_version: depGraphRef.dependency_graph_reference_version,
    source_reference_fingerprint: depGraphRef.graph_fingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    logical_sequence: sequence++
  }));

  // Idempotência: cross-checks execution_plan_id/authorization_decision_id/plan_fingerprint/
  // request_fingerprint agreement against the same canonical sources every other reference in
  // this ledger is checked against -- a policy reference that quietly drifted from the plan it
  // claims to cover must never validate.
  const idempotencyMismatches = [];
  if (idempotency.execution_plan_id !== executionPlanId) idempotencyMismatches.push('idempotency-plan-mismatch');
  if (isNonEmptyString(authzRef.authorization_decision_id) && idempotency.authorization_decision_id !== authzRef.authorization_decision_id) {
    idempotencyMismatches.push('idempotency-authz-mismatch');
  }
  if (planFingerprint !== null && idempotency.plan_fingerprint !== planFingerprint) idempotencyMismatches.push('idempotency-fingerprint-mismatch');
  if (requestFingerprint !== null && idempotency.request_fingerprint !== requestFingerprint) idempotencyMismatches.push('idempotency-request-fingerprint-mismatch');
  records.push(buildBindingRecord({
    ...common,
    binding_record_id: `${executionPlanId}-idempotency-binding-record`,
    binding_type: 'IDEMPOTENCY_BINDING',
    source_reference_id: idempotency.idempotency_reference_id,
    source_reference_version: 1,
    source_reference_fingerprint: idempotency.idempotency_fingerprint,
    target_reference_id: executionPlanId,
    target_reference_version: 1,
    target_reference_fingerprint: safeFingerprint(executionPlanId),
    binding_status: idempotencyMismatches.length > 0 ? 'CONFLICT_BLOCKED' : 'VALIDATED_SIMULATION',
    reason_codes: idempotencyMismatches,
    logical_sequence: sequence++
  }));

  stopConditions.forEach((condition, index) => {
    const mismatches = [];
    if (condition.execution_plan_id !== executionPlanId) mismatches.push('stop-condition-plan-mismatch');
    if (Array.isArray(validStageIds) && !validStageIds.includes(condition.execution_stage_id)) mismatches.push('stop-condition-stage-mismatch');
    records.push(buildBindingRecord({
      ...common,
      binding_record_id: `${executionPlanId}-stop-condition-binding-record-${index}`,
      binding_type: 'STOP_CONDITION_BINDING',
      source_reference_id: condition.stop_condition_id,
      source_reference_version: 1,
      source_reference_fingerprint: condition.condition_fingerprint,
      target_reference_id: condition.execution_stage_id || executionPlanId,
      target_reference_version: 1,
      target_reference_fingerprint: safeFingerprint(condition.execution_stage_id || executionPlanId),
      binding_status: mismatches.length > 0 ? 'CONFLICT_BLOCKED' : 'VALIDATED_SIMULATION',
      reason_codes: mismatches,
      logical_sequence: sequence++
    }));
  });

  compensations.forEach((compensation, index) => {
    const mismatches = [];
    if (compensation.execution_plan_id !== executionPlanId) mismatches.push('compensation-plan-mismatch');
    if (Array.isArray(validStageIds) && !validStageIds.includes(compensation.execution_stage_id)) mismatches.push('compensation-stage-mismatch');
    records.push(buildBindingRecord({
      ...common,
      binding_record_id: `${executionPlanId}-compensation-binding-record-${index}`,
      binding_type: 'COMPENSATION_BINDING',
      source_reference_id: compensation.compensation_reference_id,
      source_reference_version: 1,
      source_reference_fingerprint: compensation.compensation_fingerprint,
      target_reference_id: compensation.execution_stage_id || executionPlanId,
      target_reference_version: 1,
      target_reference_fingerprint: safeFingerprint(compensation.execution_stage_id || executionPlanId),
      binding_status: mismatches.length > 0 ? 'CONFLICT_BLOCKED' : 'VALIDATED_SIMULATION',
      reason_codes: mismatches,
      logical_sequence: sequence++
    }));
  });

  return { records, nextSequence: sequence };
}

function buildBindingLedgerForPlan({
  stageBindings, provenanceRef, scopeRef, snapshotRef, stageManifestRef, depGraphRef, idempotency, stopConditions,
  compensations, canonical, executionPlanId, executionPlanRequestId, authzRef, logicalSequence,
  planFingerprint = null, requestFingerprint = null, validStageIds = null
}) {
  const stageBindingRecords = stageBindings.map((binding, index) => wrapStageBindingAsRecord(binding, { executionPlanRequestId, canonical, index }));
  const { records: referenceLevelRecords } = buildReferenceLevelBindingRecords({
    provenanceRef, scopeRef, snapshotRef, stageManifestRef, depGraphRef, idempotency, stopConditions, compensations,
    canonical, executionPlanId, executionPlanRequestId, startingSequence: stageBindingRecords.length,
    authzRef, planFingerprint, requestFingerprint, validStageIds
  });
  const bindingRecords = [...stageBindingRecords, ...referenceLevelRecords];
  const allRequiredPresent = bindingRecords.every((record) => record.binding_required !== true || record.binding_validated === true);

  return buildExecutionReferenceBindingLedger({
    binding_ledger_id: `${executionPlanId}-binding-ledger`,
    execution_plan_request_id: executionPlanRequestId,
    execution_plan_id: executionPlanId,
    authorization_decision_id: authzRef.authorization_decision_id,
    authorization_scope_reference_id: scopeRef.authorization_scope_reference_id,
    authorization_provenance_reference_id: provenanceRef.authorization_provenance_reference_id,
    registry_snapshot_reference_id: snapshotRef.registry_snapshot_reference_id,
    tenant_id: canonical.tenantId,
    organization_id: canonical.organizationId,
    project_id: canonical.projectId,
    session_reference_id: canonical.sessionId,
    agent_id: canonical.agentId,
    actor_id: canonical.actorId,
    binding_records: bindingRecords,
    all_required_bindings_present: allRequiredPresent,
    logical_sequence: logicalSequence
  });
}

module.exports = {
  buildBindingLedgerForPlan,
  buildReferenceLevelBindingRecords,
  safeFingerprint,
  validateProvenanceCrossChecks,
  validateScopeCrossChecks,
  validateSnapshotCrossChecks,
  wrapStageBindingAsRecord
};

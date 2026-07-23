'use strict';

const { isNonEmptyString, isPlainObject } = require('./read-only-adapter-contract');
const { validateBudgetEvidenceReference, computeBudgetEvidenceFingerprint } = require('./orchestrator-budget-evidence-reference');
const { validateDependencyEvidenceReference, computeDependencyEvidenceFingerprint } = require('./orchestrator-dependency-evidence-reference');
const { validateConflictEvidenceReference, computeConflictEvidenceFingerprint } = require('./orchestrator-conflict-evidence-reference');
const { validateApprovalEvidenceReference, computeApprovalEvidenceFingerprint } = require('./orchestrator-approval-evidence-reference');
const { buildReadinessEvidenceBundle } = require('./orchestrator-readiness-evidence-bundle');

// Validates the four evidence references (structure, bindings, fingerprints, and mutual
// planning_result_id/plan_id consistency), then consolidates them -- plus the caller-supplied
// domain-readiness flags for the domains that carry no evidence contract of their own (policy,
// memory, preferences, project state, continuity, context, model, tools, workflow; those are
// already validated by PR #95's Decision Engine, this module never re-derives them) -- into one
// ReadinessEvidenceBundle. This module never alters a decision, re-evaluates budget, recomputes
// dependencies beyond the declarative data already on the evidence references, resolves a
// conflict, grants an approval, or authorizes execution.
function evaluateDecisionEvidence(input = {}) {
  const {
    readinessBundleId, decisionRequestId, planningResultId, planId, agentId, tenantId, organizationId, projectId,
    sessionReferenceId, budgetEvidence, dependencyEvidence, conflictEvidence, approvalEvidence,
    policyDecisionFingerprint, memorySelectionDecisionFingerprint, contextAssemblyResultFingerprint,
    modelSelectionDecisionFingerprint, toolDecisionFingerprints, workflowDecisionFingerprint, logicalSequence
  } = input;

  const evidenceEntries = [
    ['budget_evidence_reference', budgetEvidence, validateBudgetEvidenceReference, computeBudgetEvidenceFingerprint],
    ['dependency_evidence_reference', dependencyEvidence, validateDependencyEvidenceReference, computeDependencyEvidenceFingerprint],
    ['conflict_evidence_reference', conflictEvidence, validateConflictEvidenceReference, computeConflictEvidenceFingerprint],
    ['approval_evidence_reference', approvalEvidence, validateApprovalEvidenceReference, computeApprovalEvidenceFingerprint]
  ];

  // 1-2. presence and per-reference structural validity.
  for (const [label, evidence] of evidenceEntries) {
    if (!isPlainObject(evidence)) {
      return buildOutcome(input, 'MISSING_EVIDENCE_BLOCKED', [`${label}_missing`]);
    }
  }
  for (const [label, evidence, validate] of evidenceEntries) {
    const validation = validate(evidence);
    if (!validation.valid) {
      return buildOutcome(input, 'VALIDATION_FAILED', validation.errors.map((e) => `${label}_${e}`));
    }
  }

  // 3-4. planning_result_id/plan_id consistency across every evidence and the canonical identity.
  for (const [label, evidence] of evidenceEntries) {
    if (evidence.planning_result_id !== planningResultId || evidence.plan_id !== planId) {
      return buildOutcome(input, 'BINDING_BLOCKED', [`${label}_planning_result_or_plan_id_mismatch`]);
    }
  }

  // 5-6. tenant/organization/project/session bindings (project/session only apply to the
  // evidence kinds that carry those fields: budget and approval).
  for (const [label, evidence] of evidenceEntries) {
    if (evidence.tenant_id !== tenantId) return buildOutcome(input, 'BINDING_BLOCKED', [`${label}_tenant_mismatch`]);
    if (evidence.organization_id !== organizationId) return buildOutcome(input, 'BINDING_BLOCKED', [`${label}_organization_mismatch`]);
  }
  if (budgetEvidence.project_id !== projectId) return buildOutcome(input, 'BINDING_BLOCKED', ['budget_evidence_reference_project_mismatch']);
  if (budgetEvidence.session_reference_id !== sessionReferenceId) return buildOutcome(input, 'BINDING_BLOCKED', ['budget_evidence_reference_session_mismatch']);
  if (approvalEvidence.project_id !== projectId) return buildOutcome(input, 'BINDING_BLOCKED', ['approval_evidence_reference_project_mismatch']);
  if (approvalEvidence.session_reference_id !== sessionReferenceId) return buildOutcome(input, 'BINDING_BLOCKED', ['approval_evidence_reference_session_mismatch']);

  // 7. version consistency (optional caller-supplied expected version, mirroring the pattern
  // established by every prior PR's registry-version check).
  if (isNonEmptyString(input.expectedRegistryVersion) && isNonEmptyString(input.currentRegistryVersion) && input.expectedRegistryVersion !== input.currentRegistryVersion) {
    return buildOutcome(input, 'VERSION_BLOCKED', ['expected_registry_version_mismatch']);
  }

  // 8. fingerprint consistency: recompute each evidence's own fingerprint and confirm it
  // matches what the evidence itself declares (tamper detection), since a loose flag can be
  // faked but a mismatched recomputed fingerprint cannot.
  for (const [label, evidence, , computeFingerprint] of evidenceEntries) {
    const recomputed = computeFingerprint(evidence);
    if (recomputed !== evidence.evidence_fingerprint) {
      return buildOutcome(input, 'FINGERPRINT_BLOCKED', [`${label}_fingerprint_mismatch`]);
    }
  }

  const bundle = buildReadinessEvidenceBundle({
    readiness_bundle_id: readinessBundleId, decision_request_id: decisionRequestId, planning_result_id: planningResultId,
    plan_id: planId, agent_id: agentId, tenant_id: tenantId, organization_id: organizationId, project_id: projectId,
    session_reference_id: sessionReferenceId, budget_evidence_reference: budgetEvidence,
    dependency_evidence_reference: dependencyEvidence, conflict_evidence_reference: conflictEvidence,
    approval_evidence_reference: approvalEvidence, policy_decision_fingerprint: policyDecisionFingerprint,
    memory_selection_decision_fingerprint: memorySelectionDecisionFingerprint,
    context_assembly_result_fingerprint: contextAssemblyResultFingerprint,
    model_selection_decision_fingerprint: modelSelectionDecisionFingerprint,
    tool_decision_fingerprints: toolDecisionFingerprints, workflow_decision_fingerprint: workflowDecisionFingerprint,
    bindings_consistent: true, versions_consistent: true, fingerprints_consistent: true,
    policy_ready: input.policyReady === true, memory_ready: input.memoryReady === true,
    preferences_ready: input.preferencesReady === true, project_state_ready: input.projectStateReady === true,
    continuity_ready: input.continuityReady === true, context_ready: input.contextReady === true,
    model_ready: input.modelReady === true, tools_ready: input.toolsReady === true,
    workflow_ready: input.workflowReady === true, blocking_count: 0, warning_count: 0, critical_count: 0,
    logical_sequence: logicalSequence
  });

  return { bundle, reasonCodes: [bundle.bundle_status === 'READY_EVIDENCE_SIMULATION' ? 'evidence_bundle_ready_in_simulation' : `evidence_bundle_status::${bundle.bundle_status}`] };
}

function buildOutcome(input, bundleStatus, reasonCodes) {
  const bundle = buildReadinessEvidenceBundle({
    readiness_bundle_id: input.readinessBundleId || 'readiness_bundle_not_available',
    decision_request_id: input.decisionRequestId || 'decision_request_not_available',
    planning_result_id: input.planningResultId || 'planning_result_not_available',
    plan_id: input.planId || 'plan_not_available',
    agent_id: input.agentId || 'agent_not_available',
    tenant_id: input.tenantId || 'tenant_not_available',
    organization_id: input.organizationId || 'organization_not_available',
    project_id: input.projectId || 'project_not_available',
    session_reference_id: input.sessionReferenceId || 'session_not_available',
    budget_evidence_reference: isPlainObject(input.budgetEvidence) ? input.budgetEvidence : null,
    dependency_evidence_reference: isPlainObject(input.dependencyEvidence) ? input.dependencyEvidence : null,
    conflict_evidence_reference: isPlainObject(input.conflictEvidence) ? input.conflictEvidence : null,
    approval_evidence_reference: isPlainObject(input.approvalEvidence) ? input.approvalEvidence : null,
    policy_decision_fingerprint: input.policyDecisionFingerprint,
    memory_selection_decision_fingerprint: input.memorySelectionDecisionFingerprint,
    context_assembly_result_fingerprint: input.contextAssemblyResultFingerprint,
    model_selection_decision_fingerprint: input.modelSelectionDecisionFingerprint,
    tool_decision_fingerprints: input.toolDecisionFingerprints,
    workflow_decision_fingerprint: input.workflowDecisionFingerprint,
    bindings_consistent: bundleStatus !== 'BINDING_BLOCKED',
    versions_consistent: bundleStatus !== 'VERSION_BLOCKED',
    fingerprints_consistent: bundleStatus !== 'FINGERPRINT_BLOCKED',
    bundle_status: bundleStatus,
    blocking_count: 1,
    critical_count: 0,
    warning_count: 0,
    logical_sequence: input.logicalSequence
  });
  return { bundle, reasonCodes };
}

module.exports = {
  evaluateDecisionEvidence
};

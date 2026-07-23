'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateBudgetEvidenceReference } = require('./orchestrator-budget-evidence-reference');
const { validateDependencyEvidenceReference } = require('./orchestrator-dependency-evidence-reference');
const { validateConflictEvidenceReference } = require('./orchestrator-conflict-evidence-reference');
const { validateApprovalEvidenceReference } = require('./orchestrator-approval-evidence-reference');

const READINESS_EVIDENCE_BUNDLE_VALIDATOR_VERSION = 'orchestrator_readiness_evidence_bundle_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const READINESS_EVIDENCE_BUNDLE_FIELDS = Object.freeze([
  'readiness_bundle_id', 'readiness_bundle_version', 'decision_request_id', 'planning_result_id', 'plan_id',
  'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'budget_evidence_reference',
  'dependency_evidence_reference', 'conflict_evidence_reference', 'approval_evidence_reference',
  'policy_decision_fingerprint', 'memory_selection_decision_fingerprint', 'context_assembly_result_fingerprint',
  'model_selection_decision_fingerprint', 'tool_decision_fingerprints', 'workflow_decision_fingerprint',
  'all_required_evidence_present', 'bindings_consistent', 'versions_consistent', 'fingerprints_consistent',
  'policy_ready', 'memory_ready', 'preferences_ready', 'project_state_ready', 'continuity_ready', 'context_ready',
  'model_ready', 'tools_ready', 'workflow_ready', 'budget_ready', 'dependencies_ready', 'conflicts_ready',
  'approval_ready', 'overall_ready_in_simulation', 'blocking_count', 'warning_count', 'critical_count',
  'readiness_score', 'bundle_status', 'bundle_fingerprint', 'logical_sequence', 'evidence_evaluated',
  'execution_authorized', 'execution_started', 'simulation', 'production_blocked', 'validator_version'
]);

const DOMAIN_READY_FIELDS = Object.freeze([
  'policy_ready', 'memory_ready', 'preferences_ready', 'project_state_ready', 'continuity_ready', 'context_ready',
  'model_ready', 'tools_ready', 'workflow_ready', 'budget_ready', 'dependencies_ready', 'conflicts_ready',
  'approval_ready'
]);

const CONSISTENCY_FIELDS = Object.freeze(['all_required_evidence_present', 'bindings_consistent', 'versions_consistent', 'fingerprints_consistent']);
const COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);

const BUNDLE_STATUSES = Object.freeze([
  'READY_EVIDENCE_SIMULATION', 'WAITING_APPROVAL_EVIDENCE', 'BUDGET_EVIDENCE_BLOCKED',
  'DEPENDENCY_EVIDENCE_BLOCKED', 'CONFLICT_EVIDENCE_BLOCKED', 'MISSING_EVIDENCE_BLOCKED', 'BINDING_BLOCKED',
  'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'VALIDATION_FAILED'
]);

const READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS = Object.freeze({
  evidence_evaluated: true,
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_SCORE = 100;
const MAX_COUNT = 1000;
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateReadinessEvidenceBundle(bundle) {
  const errors = [];
  if (!isPlainObject(bundle)) return { valid: false, errors: ['readiness_evidence_bundle_must_be_object'] };
  exactFields(bundle, READINESS_EVIDENCE_BUNDLE_FIELDS, 'readiness_evidence_bundle', errors);
  for (const field of [
    'readiness_bundle_id', 'decision_request_id', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'policy_decision_fingerprint',
    'memory_selection_decision_fingerprint', 'context_assembly_result_fingerprint',
    'model_selection_decision_fingerprint', 'workflow_decision_fingerprint', 'bundle_status', 'bundle_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(bundle[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(bundle.readiness_bundle_version) || bundle.readiness_bundle_version < 1) errors.push('readiness_bundle_version_invalid');
  // Each embedded evidence reference is either a genuinely absent (null) evidence -- which is
  // exactly what all_required_evidence_present=false / MISSING_EVIDENCE_BLOCKED represents --
  // or a structurally valid evidence reference. It is never a malformed non-null value.
  if (bundle.budget_evidence_reference !== null) {
    errors.push(...validateBudgetEvidenceReference(bundle.budget_evidence_reference).errors.map((e) => `budget_evidence_reference_${e}`));
  }
  if (bundle.dependency_evidence_reference !== null) {
    errors.push(...validateDependencyEvidenceReference(bundle.dependency_evidence_reference).errors.map((e) => `dependency_evidence_reference_${e}`));
  }
  if (bundle.conflict_evidence_reference !== null) {
    errors.push(...validateConflictEvidenceReference(bundle.conflict_evidence_reference).errors.map((e) => `conflict_evidence_reference_${e}`));
  }
  if (bundle.approval_evidence_reference !== null) {
    errors.push(...validateApprovalEvidenceReference(bundle.approval_evidence_reference).errors.map((e) => `approval_evidence_reference_${e}`));
  }
  if (!isOrderedUniqueStringList(bundle.tool_decision_fingerprints)) errors.push('tool_decision_fingerprints_invalid');
  for (const field of CONSISTENCY_FIELDS) {
    if (typeof bundle[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of DOMAIN_READY_FIELDS) {
    if (typeof bundle[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof bundle.overall_ready_in_simulation !== 'boolean') errors.push('overall_ready_in_simulation_must_be_boolean');
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(bundle[field]) || bundle[field] < 0 || bundle[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(bundle.readiness_score) || bundle.readiness_score < 0 || bundle.readiness_score > MAX_SCORE) errors.push('readiness_score_invalid');
  if (!BUNDLE_STATUSES.includes(bundle.bundle_status)) errors.push(`bundle_status_not_allowed::${bundle.bundle_status}`);
  if (!Number.isInteger(bundle.logical_sequence) || bundle.logical_sequence < 0) errors.push('logical_sequence_invalid');
  for (const [field, expected] of Object.entries(READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS)) {
    if (bundle[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (bundle.blocking_count > 0 && bundle.overall_ready_in_simulation !== false) errors.push('overall_ready_in_simulation_must_be_false_when_blocking_count_positive');
  if (bundle.critical_count > 0 && bundle.overall_ready_in_simulation !== false) errors.push('overall_ready_in_simulation_must_be_false_when_critical_count_positive');
  const allConsistent = CONSISTENCY_FIELDS.every((field) => bundle[field] === true);
  const allDomainsReady = DOMAIN_READY_FIELDS.every((field) => bundle[field] === true);
  if (bundle.overall_ready_in_simulation === true && !(allConsistent && allDomainsReady)) {
    errors.push('overall_ready_in_simulation_requires_full_consistency_and_readiness');
  }
  if (bundle.overall_ready_in_simulation === true && bundle.bundle_status !== 'READY_EVIDENCE_SIMULATION') {
    errors.push('bundle_status_must_be_ready_evidence_simulation_when_overall_ready');
  }

  if (bundle.validator_version !== READINESS_EVIDENCE_BUNDLE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(bundle);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(bundle));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeReadinessScore(domainReadyMap, consistencyMap, warningCount) {
  const notReadyCount = DOMAIN_READY_FIELDS.filter((field) => domainReadyMap[field] !== true).length;
  const notConsistentCount = CONSISTENCY_FIELDS.filter((field) => consistencyMap[field] !== true).length;
  const penalty = notReadyCount * 7 + notConsistentCount * 5 + Math.min(Number.isInteger(warningCount) ? warningCount : 0, 10) * 2;
  return Math.max(0, MAX_SCORE - penalty);
}

function buildReadinessEvidenceBundle(input = {}) {
  const budgetEvidence = input.budget_evidence_reference;
  const dependencyEvidence = input.dependency_evidence_reference;
  const conflictEvidence = input.conflict_evidence_reference;
  const approvalEvidence = input.approval_evidence_reference;

  const budgetReady = isPlainObject(budgetEvidence) && budgetEvidence.evidence_status === 'VALIDATED_SIMULATION' && budgetEvidence.budget_validated === true;
  const dependenciesReady = isPlainObject(dependencyEvidence) && dependencyEvidence.evidence_status === 'VALIDATED_SIMULATION' && dependencyEvidence.dependency_graph_valid === true;
  const conflictsReady = isPlainObject(conflictEvidence) && conflictEvidence.evidence_status === 'NO_CONFLICT_SIMULATION' && conflictEvidence.conflicts_resolved === true;
  const approvalStatusesConsideredReady = ['NO_APPROVAL_REQUIRED_SIMULATION', 'APPROVAL_REFERENCE_VALIDATED_SIMULATION'];
  const approvalReady = isPlainObject(approvalEvidence) && approvalStatusesConsideredReady.includes(approvalEvidence.evidence_status);
  const approvalWaiting = isPlainObject(approvalEvidence) && approvalEvidence.evidence_status === 'WAITING_APPROVAL_SIMULATION';

  const domainReady = {
    policy_ready: input.policy_ready === true,
    memory_ready: input.memory_ready === true,
    preferences_ready: input.preferences_ready === true,
    project_state_ready: input.project_state_ready === true,
    continuity_ready: input.continuity_ready === true,
    context_ready: input.context_ready === true,
    model_ready: input.model_ready === true,
    tools_ready: input.tools_ready === true,
    workflow_ready: input.workflow_ready === true,
    budget_ready: budgetReady,
    dependencies_ready: dependenciesReady,
    conflicts_ready: conflictsReady,
    approval_ready: approvalReady
  };

  const allRequiredEvidencePresent = isPlainObject(budgetEvidence) && isPlainObject(dependencyEvidence) &&
    isPlainObject(conflictEvidence) && isPlainObject(approvalEvidence);
  const bindingsConsistent = input.bindings_consistent === true;
  const versionsConsistent = input.versions_consistent === true;
  const fingerprintsConsistent = input.fingerprints_consistent === true;
  const consistency = {
    all_required_evidence_present: allRequiredEvidencePresent,
    bindings_consistent: bindingsConsistent,
    versions_consistent: versionsConsistent,
    fingerprints_consistent: fingerprintsConsistent
  };

  const blockingCount = Number.isInteger(input.blocking_count) ? input.blocking_count : 0;
  const criticalCount = Number.isInteger(input.critical_count) ? input.critical_count : 0;
  const warningCount = Number.isInteger(input.warning_count) ? input.warning_count : 0;

  const allConsistent = Object.values(consistency).every(Boolean);
  const allDomainsReady = Object.values(domainReady).every(Boolean);
  const overallReady = allConsistent && allDomainsReady && blockingCount === 0 && criticalCount === 0;

  const overridableStatuses = ['VALIDATION_FAILED', 'VERSION_BLOCKED', 'FINGERPRINT_BLOCKED', 'BINDING_BLOCKED', 'MISSING_EVIDENCE_BLOCKED'];
  let status;
  if (overridableStatuses.includes(input.bundle_status)) status = input.bundle_status;
  else if (!allRequiredEvidencePresent) status = 'MISSING_EVIDENCE_BLOCKED';
  else if (!bindingsConsistent) status = 'BINDING_BLOCKED';
  else if (!versionsConsistent) status = 'VERSION_BLOCKED';
  else if (!fingerprintsConsistent) status = 'FINGERPRINT_BLOCKED';
  else if (isPlainObject(conflictEvidence) && !conflictsReady) status = 'CONFLICT_EVIDENCE_BLOCKED';
  else if (isPlainObject(budgetEvidence) && !budgetReady) status = 'BUDGET_EVIDENCE_BLOCKED';
  else if (isPlainObject(dependencyEvidence) && !dependenciesReady) status = 'DEPENDENCY_EVIDENCE_BLOCKED';
  else if (approvalWaiting) status = 'WAITING_APPROVAL_EVIDENCE';
  else if (overallReady) status = 'READY_EVIDENCE_SIMULATION';
  else status = 'VALIDATION_FAILED';

  const bundle = {
    readiness_bundle_id: input.readiness_bundle_id,
    readiness_bundle_version: Number.isInteger(input.readiness_bundle_version) ? input.readiness_bundle_version : 1,
    decision_request_id: input.decision_request_id,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    budget_evidence_reference: budgetEvidence,
    dependency_evidence_reference: dependencyEvidence,
    conflict_evidence_reference: conflictEvidence,
    approval_evidence_reference: approvalEvidence,
    policy_decision_fingerprint: input.policy_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    memory_selection_decision_fingerprint: input.memory_selection_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    context_assembly_result_fingerprint: input.context_assembly_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_selection_decision_fingerprint: input.model_selection_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    tool_decision_fingerprints: Array.isArray(input.tool_decision_fingerprints) ? uniqueSorted(input.tool_decision_fingerprints) : [],
    workflow_decision_fingerprint: input.workflow_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    ...consistency,
    ...domainReady,
    overall_ready_in_simulation: overallReady,
    blocking_count: blockingCount,
    warning_count: warningCount,
    critical_count: criticalCount,
    readiness_score: computeReadinessScore(domainReady, consistency, warningCount),
    bundle_status: status,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    validator_version: READINESS_EVIDENCE_BUNDLE_VALIDATOR_VERSION,
    ...READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS
  };
  const { bundle_fingerprint, ...bundleWithoutFingerprint } = bundle;
  bundle.bundle_fingerprint = stablePayload(bundleWithoutFingerprint);

  const validation = validateReadinessEvidenceBundle(bundle);
  if (!validation.valid) {
    throw new Error(`readiness_evidence_bundle_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(bundle);
}

module.exports = {
  BUNDLE_STATUSES,
  CONSISTENCY_FIELDS,
  COUNT_FIELDS,
  DOMAIN_READY_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_SCORE,
  NOT_AVAILABLE_FINGERPRINT,
  READINESS_EVIDENCE_BUNDLE_FIELDS,
  READINESS_EVIDENCE_BUNDLE_SAFE_FLAGS,
  READINESS_EVIDENCE_BUNDLE_VALIDATOR_VERSION,
  buildReadinessEvidenceBundle,
  computeReadinessScore,
  validateReadinessEvidenceBundle
};

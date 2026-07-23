'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_VALIDATOR_VERSION = 'orchestrator_decision_evidence_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'decision_request_id', 'budget_evidence_fingerprint', 'dependency_evidence_fingerprint',
  'conflict_evidence_fingerprint', 'approval_evidence_fingerprint', 'bundle_fingerprint',
  'planning_result_fingerprint', 'plan_fingerprint', 'tenant_binding', 'organization_binding', 'project_binding',
  'session_binding', 'evidence_statuses', 'consistency_flags', 'counts', 'bundle_status', 'reason_codes',
  'logical_sequence', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const EVIDENCE_STATUS_FIELDS = Object.freeze([
  'budget_evidence_status', 'dependency_evidence_status', 'conflict_evidence_status', 'approval_evidence_status'
]);
const CONSISTENCY_FLAG_FIELDS = Object.freeze([
  'all_required_evidence_present', 'bindings_consistent', 'versions_consistent', 'fingerprints_consistent'
]);
const COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);

function validateOrchestratorDecisionEvidenceAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['decision_evidence_audit_must_be_object'] };
  exactFields(audit, ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_FIELDS, 'decision_evidence_audit', errors);
  for (const field of [
    'audit_id', 'decision_request_id', 'budget_evidence_fingerprint', 'dependency_evidence_fingerprint',
    'conflict_evidence_fingerprint', 'approval_evidence_fingerprint', 'bundle_fingerprint',
    'planning_result_fingerprint', 'plan_fingerprint', 'bundle_status', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) {
    errors.push('organization_binding_invalid');
  }
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.evidence_statuses)) {
    errors.push('evidence_statuses_must_be_object');
  } else {
    for (const field of EVIDENCE_STATUS_FIELDS) {
      if (!isNonEmptyString(audit.evidence_statuses[field])) errors.push(`evidence_statuses_${field}_invalid`);
    }
  }
  if (!isPlainObject(audit.consistency_flags)) {
    errors.push('consistency_flags_must_be_object');
  } else {
    for (const field of CONSISTENCY_FLAG_FIELDS) {
      if (typeof audit.consistency_flags[field] !== 'boolean') errors.push(`consistency_flags_${field}_invalid`);
    }
  }
  if (!isPlainObject(audit.counts)) {
    errors.push('counts_must_be_object');
  } else {
    for (const field of COUNT_FIELDS) {
      if (!Number.isInteger(audit.counts[field]) || audit.counts[field] < 0) errors.push(`counts_${field}_invalid`);
    }
  }
  if (!Array.isArray(audit.reason_codes) || !audit.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorDecisionEvidenceAudit(input = {}) {
  const bundle = isPlainObject(input.bundle) ? input.bundle : {};
  const budgetEvidence = isPlainObject(bundle.budget_evidence_reference) ? bundle.budget_evidence_reference : null;
  const dependencyEvidence = isPlainObject(bundle.dependency_evidence_reference) ? bundle.dependency_evidence_reference : null;
  const conflictEvidence = isPlainObject(bundle.conflict_evidence_reference) ? bundle.conflict_evidence_reference : null;
  const approvalEvidence = isPlainObject(bundle.approval_evidence_reference) ? bundle.approval_evidence_reference : null;

  const audit = {
    audit_id: `orchestrator_decision_evidence_audit_${bundle.readiness_bundle_id || 'not_available'}`,
    decision_request_id: bundle.decision_request_id || 'decision_request_not_available',
    budget_evidence_fingerprint: budgetEvidence ? budgetEvidence.evidence_fingerprint : NOT_AVAILABLE_FINGERPRINT,
    dependency_evidence_fingerprint: dependencyEvidence ? dependencyEvidence.evidence_fingerprint : NOT_AVAILABLE_FINGERPRINT,
    conflict_evidence_fingerprint: conflictEvidence ? conflictEvidence.evidence_fingerprint : NOT_AVAILABLE_FINGERPRINT,
    approval_evidence_fingerprint: approvalEvidence ? approvalEvidence.evidence_fingerprint : NOT_AVAILABLE_FINGERPRINT,
    bundle_fingerprint: bundle.bundle_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    planning_result_fingerprint: input.planningResultFingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: input.planFingerprint || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: bundle.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: bundle.organization_id || 'organization_not_available' },
    project_binding: { project_id: bundle.project_id || 'project_not_available' },
    session_binding: { session_reference_id: bundle.session_reference_id || 'session_not_available' },
    evidence_statuses: {
      budget_evidence_status: budgetEvidence ? budgetEvidence.evidence_status : 'evidence_not_available',
      dependency_evidence_status: dependencyEvidence ? dependencyEvidence.evidence_status : 'evidence_not_available',
      conflict_evidence_status: conflictEvidence ? conflictEvidence.evidence_status : 'evidence_not_available',
      approval_evidence_status: approvalEvidence ? approvalEvidence.evidence_status : 'evidence_not_available'
    },
    consistency_flags: {
      all_required_evidence_present: bundle.all_required_evidence_present === true,
      bindings_consistent: bundle.bindings_consistent === true,
      versions_consistent: bundle.versions_consistent === true,
      fingerprints_consistent: bundle.fingerprints_consistent === true
    },
    counts: {
      blocking_count: Number.isInteger(bundle.blocking_count) ? bundle.blocking_count : 0,
      warning_count: Number.isInteger(bundle.warning_count) ? bundle.warning_count : 0,
      critical_count: Number.isInteger(bundle.critical_count) ? bundle.critical_count : 0
    },
    bundle_status: bundle.bundle_status || 'VALIDATION_FAILED',
    reason_codes: Array.isArray(input.reasonCodes) ? uniqueSorted(input.reasonCodes) : [],
    logical_sequence: Number.isInteger(bundle.logical_sequence) ? bundle.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  CONSISTENCY_FLAG_FIELDS,
  COUNT_FIELDS,
  EVIDENCE_STATUS_FIELDS,
  NOT_AVAILABLE_FINGERPRINT,
  ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_FIELDS,
  ORCHESTRATOR_DECISION_EVIDENCE_AUDIT_VALIDATOR_VERSION,
  buildOrchestratorDecisionEvidenceAudit,
  validateOrchestratorDecisionEvidenceAudit
};

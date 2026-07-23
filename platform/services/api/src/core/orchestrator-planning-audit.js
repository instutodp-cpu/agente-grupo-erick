'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLANNING_AUDIT_VALIDATOR_VERSION = 'orchestrator_planning_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const ORCHESTRATOR_PLANNING_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'planning_request_id', 'request_fingerprint', 'task_fingerprint', 'policy_fingerprint',
  'budget_fingerprint', 'stage_fingerprints', 'dependency_fingerprints', 'success_criteria_fingerprints',
  'plan_fingerprint', 'result_fingerprint', 'tenant_binding', 'organization_binding', 'project_binding',
  'agent_binding', 'counts', 'estimates', 'declared_approvals', 'blockers', 'reason_codes', 'logical_sequence',
  'decision', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const COUNT_FIELDS = Object.freeze([
  'stage_count', 'parallel_stage_count', 'model_stage_count', 'tool_stage_count', 'workflow_stage_count',
  'approval_stage_count'
]);
const ESTIMATE_FIELDS = Object.freeze(['estimated_total_tokens', 'estimated_total_cost_minor_units']);
const DECLARED_APPROVAL_FIELDS = Object.freeze(['approval_required', 'approval_type', 'minimum_approvals']);

function isFingerprintList(list) {
  return Array.isArray(list) && list.every(isNonEmptyString);
}

function validateOrchestratorPlanningAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['planning_audit_must_be_object'] };
  exactFields(audit, ORCHESTRATOR_PLANNING_AUDIT_FIELDS, 'planning_audit', errors);
  for (const field of [
    'audit_id', 'planning_request_id', 'request_fingerprint', 'task_fingerprint', 'policy_fingerprint',
    'budget_fingerprint', 'plan_fingerprint', 'result_fingerprint', 'decision', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['stage_fingerprints', 'dependency_fingerprints', 'success_criteria_fingerprints']) {
    if (!isFingerprintList(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) {
    errors.push('organization_binding_invalid');
  }
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.agent_binding) || !isNonEmptyString(audit.agent_binding.agent_id)) errors.push('agent_binding_invalid');
  if (!isPlainObject(audit.counts)) {
    errors.push('counts_must_be_object');
  } else {
    for (const field of COUNT_FIELDS) {
      if (!Number.isInteger(audit.counts[field]) || audit.counts[field] < 0) errors.push(`counts_${field}_invalid`);
    }
  }
  if (!isPlainObject(audit.estimates)) {
    errors.push('estimates_must_be_object');
  } else {
    for (const field of ESTIMATE_FIELDS) {
      if (!Number.isInteger(audit.estimates[field]) || audit.estimates[field] < 0) errors.push(`estimates_${field}_invalid`);
    }
  }
  if (!isPlainObject(audit.declared_approvals)) {
    errors.push('declared_approvals_must_be_object');
  } else {
    if (typeof audit.declared_approvals.approval_required !== 'boolean') errors.push('declared_approvals_approval_required_invalid');
    if (!isNonEmptyString(audit.declared_approvals.approval_type)) errors.push('declared_approvals_approval_type_invalid');
    if (!Number.isInteger(audit.declared_approvals.minimum_approvals) || audit.declared_approvals.minimum_approvals < 0) {
      errors.push('declared_approvals_minimum_approvals_invalid');
    }
  }
  if (!Array.isArray(audit.blockers) || !audit.blockers.every(isNonEmptyString)) errors.push('blockers_invalid');
  if (!Array.isArray(audit.reason_codes) || !audit.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== ORCHESTRATOR_PLANNING_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorPlanningAudit(input = {}) {
  const result = isPlainObject(input.result) ? input.result : {};
  const approvalContext = isPlainObject(input.approvalContext) ? input.approvalContext : {};

  const counts = {};
  for (const field of COUNT_FIELDS) counts[field] = Number.isInteger(result[field]) ? result[field] : 0;
  const estimates = {};
  for (const field of ESTIMATE_FIELDS) estimates[field] = Number.isInteger(result[field]) ? result[field] : 0;

  const audit = {
    audit_id: `orchestrator_planning_audit_${result.result_id || 'not_available'}`,
    planning_request_id: result.planning_request_id || 'planning_request_not_available',
    request_fingerprint: result.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_fingerprint: result.task_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: result.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: result.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    stage_fingerprints: Array.isArray(input.stageFingerprints) ? uniqueSorted(input.stageFingerprints) : [],
    dependency_fingerprints: Array.isArray(input.dependencyFingerprints) ? uniqueSorted(input.dependencyFingerprints) : [],
    success_criteria_fingerprints: Array.isArray(input.successCriteriaFingerprints) ? uniqueSorted(input.successCriteriaFingerprints) : [],
    plan_fingerprint: result.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    result_fingerprint: (() => {
      try {
        return stablePayload(result);
      } catch (error) {
        return NOT_AVAILABLE_FINGERPRINT;
      }
    })(),
    tenant_binding: { tenant_id: result.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: result.organization_id || 'organization_not_available' },
    project_binding: { project_id: result.project_id || 'project_not_available' },
    agent_binding: { agent_id: result.agent_id || 'agent_not_available' },
    counts,
    estimates,
    declared_approvals: {
      approval_required: approvalContext.approval_required === true,
      approval_type: isNonEmptyString(approvalContext.approval_type) ? approvalContext.approval_type : 'NONE',
      minimum_approvals: Number.isInteger(approvalContext.minimum_approvals) ? approvalContext.minimum_approvals : 0
    },
    blockers: Array.isArray(result.blockers) ? uniqueSorted(result.blockers) : [],
    reason_codes: Array.isArray(result.reason_codes) ? uniqueSorted(result.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    decision: result.status || 'VALIDATION_FAILED',
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: ORCHESTRATOR_PLANNING_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  COUNT_FIELDS,
  DECLARED_APPROVAL_FIELDS,
  ESTIMATE_FIELDS,
  NOT_AVAILABLE_FINGERPRINT,
  ORCHESTRATOR_PLANNING_AUDIT_FIELDS,
  ORCHESTRATOR_PLANNING_AUDIT_VALIDATOR_VERSION,
  buildOrchestratorPlanningAudit,
  validateOrchestratorPlanningAudit
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_DECISION_AUDIT_VALIDATOR_VERSION = 'orchestrator_decision_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const ORCHESTRATOR_DECISION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'decision_request_id', 'request_fingerprint', 'planning_result_fingerprint', 'plan_fingerprint',
  'policy_fingerprint', 'memory_fingerprint', 'context_fingerprint', 'model_fingerprint', 'tool_fingerprints',
  'workflow_fingerprint', 'blocker_fingerprints', 'readiness_fingerprint', 'result_fingerprint', 'tenant_binding',
  'organization_binding', 'project_binding', 'agent_binding', 'status', 'decision', 'next_state', 'counts',
  'readiness_score', 'reason_codes', 'logical_sequence', 'simulation', 'production_blocked', 'executed',
  'validator_version'
]);

const COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);

function isFingerprintList(list) {
  return Array.isArray(list) && list.every(isNonEmptyString);
}

function validateOrchestratorDecisionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['decision_audit_must_be_object'] };
  exactFields(audit, ORCHESTRATOR_DECISION_AUDIT_FIELDS, 'decision_audit', errors);
  for (const field of [
    'audit_id', 'decision_request_id', 'request_fingerprint', 'planning_result_fingerprint', 'plan_fingerprint',
    'policy_fingerprint', 'memory_fingerprint', 'context_fingerprint', 'model_fingerprint', 'workflow_fingerprint',
    'readiness_fingerprint', 'result_fingerprint', 'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isFingerprintList(audit.tool_fingerprints)) errors.push('tool_fingerprints_invalid');
  if (!isFingerprintList(audit.blocker_fingerprints)) errors.push('blocker_fingerprints_invalid');
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
  if (!Number.isInteger(audit.readiness_score) || audit.readiness_score < 0 || audit.readiness_score > 100) errors.push('readiness_score_invalid');
  if (!Array.isArray(audit.reason_codes) || !audit.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== ORCHESTRATOR_DECISION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorDecisionAudit(input = {}) {
  const result = isPlainObject(input.result) ? input.result : {};
  const counts = {};
  for (const field of COUNT_FIELDS) counts[field] = Number.isInteger(result[field]) ? result[field] : 0;

  const audit = {
    audit_id: `orchestrator_decision_audit_${result.result_id || 'not_available'}`,
    decision_request_id: result.decision_request_id || 'decision_request_not_available',
    request_fingerprint: result.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    planning_result_fingerprint: result.planning_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: result.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: result.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    memory_fingerprint: result.memory_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    context_fingerprint: result.context_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_fingerprint: result.model_selection_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    tool_fingerprints: Array.isArray(result.tool_fingerprints) ? uniqueSorted(result.tool_fingerprints) : [],
    workflow_fingerprint: result.workflow_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    blocker_fingerprints: Array.isArray(input.blockerFingerprints) ? uniqueSorted(input.blockerFingerprints) : [],
    readiness_fingerprint: input.readinessFingerprint || NOT_AVAILABLE_FINGERPRINT,
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
    status: result.status || 'VALIDATION_FAILED',
    decision: result.decision || 'BLOCKED',
    next_state: result.next_state || 'BLOCKED_REFERENCE',
    counts,
    readiness_score: Number.isInteger(result.readiness_score) ? result.readiness_score : 0,
    reason_codes: Array.isArray(input.reasonCodes) ? uniqueSorted(input.reasonCodes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: ORCHESTRATOR_DECISION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  COUNT_FIELDS,
  NOT_AVAILABLE_FINGERPRINT,
  ORCHESTRATOR_DECISION_AUDIT_FIELDS,
  ORCHESTRATOR_DECISION_AUDIT_VALIDATOR_VERSION,
  buildOrchestratorDecisionAudit,
  validateOrchestratorDecisionAudit
};

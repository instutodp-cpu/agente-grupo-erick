'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_SELECTION_AUDIT_VALIDATOR_VERSION = 'model_selection_audit_v1';
const MODEL_SELECTION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'request_fingerprint', 'task_profile_fingerprint', 'constraints_fingerprint', 'candidate_fingerprints',
  'ranking_fingerprint', 'decision_fingerprint', 'escalation_plan_fingerprint', 'tenant_binding',
  'organization_binding', 'task_type', 'complexity_tier', 'risk_classification', 'data_classification',
  'selected_candidate_id', 'selected_cost_tier', 'estimated_cost_minor_units', 'decision', 'blockers',
  'reason_codes', 'logical_sequence', 'registry_version', 'simulation', 'production_blocked', 'executed',
  'validator_version'
]);
const DECISION_VALUES = Object.freeze(['SELECT_NO_LLM_REFERENCE', 'SELECT_MODEL_REFERENCE', 'BLOCKED']);
const NOT_AVAILABLE = 'not_available';
const MAX_CANDIDATE_FINGERPRINTS = 200;

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function isOrderedUniqueStringList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  return true;
}

function validateModelSelectionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['model_selection_audit_must_be_object'] };
  exactFields(audit, MODEL_SELECTION_AUDIT_FIELDS, 'model_selection_audit', errors);
  for (const field of [
    'audit_id', 'request_fingerprint', 'task_profile_fingerprint', 'constraints_fingerprint', 'ranking_fingerprint',
    'decision_fingerprint', 'escalation_plan_fingerprint', 'task_type', 'complexity_tier', 'risk_classification',
    'data_classification', 'selected_candidate_id', 'selected_cost_tier', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(audit.candidate_fingerprints, MAX_CANDIDATE_FINGERPRINTS)) errors.push('candidate_fingerprints_invalid');
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!DECISION_VALUES.includes(audit.decision)) errors.push(`decision_not_allowed::${audit.decision}`);
  if (!Number.isInteger(audit.estimated_cost_minor_units) || audit.estimated_cost_minor_units < 0) errors.push('estimated_cost_minor_units_invalid');
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Array.isArray(audit.reason_codes)) errors.push('reason_codes_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== MODEL_SELECTION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelSelectionAudit(input = {}) {
  const request = isPlainObject(input.request) ? input.request : {};
  const taskProfile = isPlainObject(request.task_profile) ? request.task_profile : {};
  const constraints = isPlainObject(request.constraints) ? request.constraints : {};
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const ranking = isPlainObject(input.ranking) ? input.ranking : null;
  const escalationPlan = isPlainObject(input.escalationPlan) ? input.escalationPlan : null;
  const candidates = Array.isArray(input.candidates) ? input.candidates : [];

  const audit = {
    audit_id: `model_selection_audit_${decision.decision_id || request.selection_request_id || NOT_AVAILABLE}`,
    request_fingerprint: decision.request_fingerprint || fingerprint(request),
    task_profile_fingerprint: decision.task_profile_fingerprint || fingerprint(taskProfile),
    constraints_fingerprint: decision.constraints_fingerprint || fingerprint(constraints),
    candidate_fingerprints: uniqueSorted(candidates.map((candidate) => fingerprint(candidate))),
    ranking_fingerprint: decision.ranking_fingerprint || (ranking ? fingerprint(ranking) : `ranking_${NOT_AVAILABLE}`),
    decision_fingerprint: input.decision_fingerprint || fingerprint(decision),
    escalation_plan_fingerprint: escalationPlan ? fingerprint(escalationPlan) : `escalation_plan_${NOT_AVAILABLE}`,
    tenant_binding: {
      request_tenant_id: taskProfile.tenant_id || `tenant_${NOT_AVAILABLE}`,
      decision_tenant_id: decision.tenant_id || `tenant_${NOT_AVAILABLE}`
    },
    organization_binding: {
      request_organization_id: taskProfile.organization_id || `organization_${NOT_AVAILABLE}`,
      decision_organization_id: decision.organization_id || `organization_${NOT_AVAILABLE}`
    },
    task_type: taskProfile.task_type || `task_type_${NOT_AVAILABLE}`,
    complexity_tier: taskProfile.complexity_tier || `complexity_tier_${NOT_AVAILABLE}`,
    risk_classification: taskProfile.risk_classification || `risk_classification_${NOT_AVAILABLE}`,
    data_classification: taskProfile.data_classification || `data_classification_${NOT_AVAILABLE}`,
    selected_candidate_id: decision.selected_candidate_id || `selected_candidate_${NOT_AVAILABLE}`,
    selected_cost_tier: decision.selected_cost_tier || 'UNKNOWN_BLOCKED',
    estimated_cost_minor_units: Number.isInteger(decision.estimated_cost_minor_units) ? decision.estimated_cost_minor_units : 0,
    decision: decision.decision && DECISION_VALUES.includes(decision.decision) ? decision.decision : 'BLOCKED',
    blockers: uniqueSorted(decision.blockers || []),
    reason_codes: uniqueSorted(decision.reason_codes || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 0 ? input.logical_sequence : 0,
    registry_version: decision.registry_version || `registry_version_${NOT_AVAILABLE}`,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: MODEL_SELECTION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  MODEL_SELECTION_AUDIT_FIELDS,
  MODEL_SELECTION_AUDIT_VALIDATOR_VERSION,
  buildModelSelectionAudit,
  validateModelSelectionAudit
};

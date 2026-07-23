'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { ACTOR_ROLES } = require('./agent-context-contract');
const { TASK_COMPLEXITIES, TASK_TYPES } = require('./orchestrator-task-definition');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');

const EXECUTION_AUTHORIZATION_AUDIT_VALIDATOR_VERSION = 'execution_authorization_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const EXECUTION_AUTHORIZATION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'authorization_request_id', 'request_fingerprint', 'orchestrator_decision_fingerprint',
  'readiness_bundle_fingerprint', 'plan_fingerprint', 'scope_fingerprint', 'actor_fingerprint',
  'approval_fingerprint', 'budget_fingerprint', 'expiration_fingerprint', 'task_reference_id',
  'task_fingerprint', 'task_classification', 'task_validation_flags', 'tenant_binding',
  'organization_binding', 'project_binding', 'session_binding', 'actor_binding', 'status', 'decision',
  'next_state', 'blockers', 'reason_codes', 'logical_sequence', 'simulation', 'production_blocked', 'executed',
  'validator_version'
]);

const FINGERPRINT_FIELDS = Object.freeze([
  'request_fingerprint', 'orchestrator_decision_fingerprint', 'readiness_bundle_fingerprint', 'plan_fingerprint',
  'scope_fingerprint', 'actor_fingerprint', 'approval_fingerprint', 'budget_fingerprint', 'expiration_fingerprint',
  'task_fingerprint'
]);

const TASK_CLASSIFICATION_FIELDS = Object.freeze(['task_type', 'task_complexity', 'risk_classification']);
const TASK_VALIDATION_FLAG_FIELDS = Object.freeze(['task_validated', 'task_type_validated', 'risk_classification_validated']);

const MAX_LIST_ITEMS = 50;

function isSanitizedStringList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateExecutionAuthorizationAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['execution_authorization_audit_must_be_object'] };
  exactFields(audit, EXECUTION_AUTHORIZATION_AUDIT_FIELDS, 'execution_authorization_audit', errors);
  for (const field of ['audit_id', 'authorization_request_id', 'task_reference_id', ...FINGERPRINT_FIELDS, 'status', 'decision', 'next_state', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(audit.task_classification)) {
    errors.push('task_classification_must_be_object');
  } else {
    if (audit.task_classification.task_type !== NOT_AVAILABLE_LABEL && !TASK_TYPES.includes(audit.task_classification.task_type)) {
      errors.push('task_classification_task_type_invalid');
    }
    if (audit.task_classification.task_complexity !== NOT_AVAILABLE_LABEL && !TASK_COMPLEXITIES.includes(audit.task_classification.task_complexity)) {
      errors.push('task_classification_task_complexity_invalid');
    }
    if (audit.task_classification.risk_classification !== NOT_AVAILABLE_LABEL && !RISK_CLASSIFICATIONS.includes(audit.task_classification.risk_classification)) {
      errors.push('task_classification_risk_classification_invalid');
    }
  }
  if (!isPlainObject(audit.task_validation_flags)) {
    errors.push('task_validation_flags_must_be_object');
  } else {
    for (const field of TASK_VALIDATION_FLAG_FIELDS) {
      if (typeof audit.task_validation_flags[field] !== 'boolean') errors.push(`task_validation_flags_${field}_invalid`);
    }
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) errors.push('organization_binding_invalid');
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.actor_binding) || !isNonEmptyString(audit.actor_binding.actor_id) || !ACTOR_ROLES.includes(audit.actor_binding.actor_role)) {
    errors.push('actor_binding_invalid');
  }
  if (!isSanitizedStringList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedStringList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== EXECUTION_AUTHORIZATION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

// Records only fingerprints, bindings, and the decision outcome -- never plan content, approval
// reference ids, budget numbers, prompts, memory, credentials, endpoints, tool parameters, or
// model responses.
function buildExecutionAuthorizationAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const taskReference = isPlainObject(input.taskReference) ? input.taskReference : {};

  const audit = {
    audit_id: `execution_authorization_audit_${decision.authorization_decision_id || 'not_available'}`,
    authorization_request_id: decision.authorization_request_id || 'authorization_request_not_available',
    request_fingerprint: decision.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    orchestrator_decision_fingerprint: decision.orchestrator_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    readiness_bundle_fingerprint: decision.readiness_bundle_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: decision.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    scope_fingerprint: decision.scope_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    actor_fingerprint: decision.actor_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    approval_fingerprint: decision.approval_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: decision.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    expiration_fingerprint: decision.expiration_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_reference_id: decision.task_reference_id || 'task_reference_not_available',
    task_fingerprint: decision.task_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_classification: {
      task_type: TASK_TYPES.includes(taskReference.task_type) ? taskReference.task_type : NOT_AVAILABLE_LABEL,
      task_complexity: TASK_COMPLEXITIES.includes(taskReference.task_complexity) ? taskReference.task_complexity : NOT_AVAILABLE_LABEL,
      risk_classification: RISK_CLASSIFICATIONS.includes(taskReference.risk_classification) ? taskReference.risk_classification : NOT_AVAILABLE_LABEL
    },
    task_validation_flags: {
      task_validated: decision.task_validated === true,
      task_type_validated: decision.task_type_validated === true,
      risk_classification_validated: decision.risk_classification_validated === true
    },
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    actor_binding: {
      actor_id: decision.actor_id || 'actor_not_available',
      actor_role: ACTOR_ROLES.includes(decision.actor_role) ? decision.actor_role : 'COLLABORATOR'
    },
    status: decision.status || 'VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(input.reasonCodes) ? uniqueSorted(input.reasonCodes) : (Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : []),
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: EXECUTION_AUTHORIZATION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  EXECUTION_AUTHORIZATION_AUDIT_FIELDS,
  EXECUTION_AUTHORIZATION_AUDIT_VALIDATOR_VERSION,
  FINGERPRINT_FIELDS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  TASK_CLASSIFICATION_FIELDS,
  TASK_VALIDATION_FLAG_FIELDS,
  buildExecutionAuthorizationAudit,
  validateExecutionAuthorizationAudit
};

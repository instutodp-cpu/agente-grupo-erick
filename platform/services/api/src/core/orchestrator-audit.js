'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_AUDIT_VALIDATOR_VERSION = 'orchestrator_audit_validator_v1';
const ORCHESTRATOR_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'orchestrator_request_id', 'request_fingerprint', 'plan_fingerprint', 'tenant_binding',
  'organization_binding', 'agent_id', 'workflow_reference_id', 'tool_reference_ids', 'model_selection_reference_id',
  'context_reference_id', 'decision', 'reason_codes', 'simulation', 'production_blocked', 'executed',
  'validator_version'
]);

function validateOrchestratorAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['orchestrator_audit_must_be_object'] };
  const allowed = new Set(ORCHESTRATOR_AUDIT_FIELDS);
  for (const field of ORCHESTRATOR_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  }
  for (const field of Object.keys(audit)) {
    if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  }
  for (const field of ['audit_id', 'orchestrator_request_id', 'request_fingerprint', 'plan_fingerprint', 'agent_id', 'decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (audit.model_selection_reference_id !== null && !isNonEmptyString(audit.model_selection_reference_id)) {
    errors.push('model_selection_reference_id_must_be_null_or_string');
  }
  if (!isNonEmptyString(audit.workflow_reference_id)) errors.push('workflow_reference_id_invalid');
  if (!isNonEmptyString(audit.context_reference_id)) errors.push('context_reference_id_invalid');
  if (!Array.isArray(audit.tool_reference_ids) || !audit.tool_reference_ids.every(isNonEmptyString)) {
    errors.push('tool_reference_ids_invalid');
  }
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.reason_codes) || !audit.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== ORCHESTRATOR_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorAudit(input = {}) {
  const decision = input.decision || {};
  const audit = {
    audit_id: `orchestrator_audit_${decision.decision_id || 'not_available'}`,
    orchestrator_request_id: decision.orchestrator_request_id || 'orchestrator_request_not_available',
    request_fingerprint: decision.request_fingerprint || 'fingerprint_not_available',
    plan_fingerprint: decision.plan_fingerprint || 'fingerprint_not_available',
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    agent_id: decision.agent_id || 'agent_not_available',
    workflow_reference_id: decision.workflow_reference_id || 'reference_not_available',
    tool_reference_ids: Array.isArray(decision.tool_reference_ids) ? uniqueSorted(decision.tool_reference_ids) : [],
    model_selection_reference_id: isNonEmptyString(decision.model_selection_reference_id) ? decision.model_selection_reference_id : null,
    context_reference_id: decision.context_reference_id || 'reference_not_available',
    decision: decision.status || 'VALIDATION_FAILED',
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: ORCHESTRATOR_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  ORCHESTRATOR_AUDIT_FIELDS,
  ORCHESTRATOR_AUDIT_VALIDATOR_VERSION,
  buildOrchestratorAudit,
  validateOrchestratorAudit
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_AUDIT_VALIDATOR_VERSION = 'workflow_audit_validator_v1';
const WORKFLOW_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'workflow_id', 'workflow_fingerprint', 'step_fingerprints', 'tenant_binding', 'organization_binding',
  'decision', 'reason_codes', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

function validateWorkflowAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['workflow_audit_must_be_object'] };
  const allowed = new Set(WORKFLOW_AUDIT_FIELDS);
  for (const field of WORKFLOW_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  }
  for (const field of Object.keys(audit)) {
    if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  }
  for (const field of ['audit_id', 'workflow_id', 'workflow_fingerprint', 'decision', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(audit.step_fingerprints) || !audit.step_fingerprints.every(isNonEmptyString)) {
    errors.push('step_fingerprints_invalid');
  }
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.reason_codes) || !audit.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== WORKFLOW_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildWorkflowAudit(input = {}) {
  const decision = input.decision || {};
  const audit = {
    audit_id: `workflow_audit_${decision.decision_id || 'not_available'}`,
    workflow_id: decision.workflow_id || 'workflow_not_available',
    workflow_fingerprint: decision.workflow_fingerprint || 'fingerprint_not_available',
    step_fingerprints: Array.isArray(decision.step_fingerprints) ? uniqueSorted(decision.step_fingerprints) : [],
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    decision: decision.status || 'VALIDATION_FAILED',
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: WORKFLOW_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  WORKFLOW_AUDIT_FIELDS,
  WORKFLOW_AUDIT_VALIDATOR_VERSION,
  buildWorkflowAudit,
  validateWorkflowAudit
};

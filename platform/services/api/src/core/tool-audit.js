'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');

const TOOL_AUDIT_VALIDATOR_VERSION = 'tool_audit_validator_v1';
const TOOL_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'tool_id', 'tool_fingerprint', 'capability_fingerprint', 'permission_fingerprint', 'cost_fingerprint',
  'side_effect_fingerprint', 'tenant_binding', 'organization_binding', 'decision', 'blockers', 'reason_codes',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

function validateToolAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['tool_audit_must_be_object'] };
  const allowed = new Set(TOOL_AUDIT_FIELDS);
  for (const field of TOOL_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  }
  for (const field of Object.keys(audit)) {
    if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  }
  for (const field of [
    'audit_id', 'tool_id', 'tool_fingerprint', 'capability_fingerprint', 'permission_fingerprint', 'cost_fingerprint',
    'side_effect_fingerprint', 'decision', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  for (const field of ['blockers', 'reason_codes']) {
    if (!Array.isArray(audit[field]) || !audit[field].every(isNonEmptyString)) errors.push(`${field}_invalid`);
  }
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== TOOL_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildToolAudit(input = {}) {
  const decision = input.decision || {};
  const audit = {
    audit_id: `tool_audit_${decision.decision_id || 'not_available'}`,
    tool_id: decision.tool_id || 'tool_not_available',
    tool_fingerprint: decision.tool_fingerprint || 'fingerprint_not_available',
    capability_fingerprint: decision.capability_fingerprint || 'fingerprint_not_available',
    permission_fingerprint: decision.permission_fingerprint || 'fingerprint_not_available',
    cost_fingerprint: decision.cost_fingerprint || 'fingerprint_not_available',
    side_effect_fingerprint: decision.side_effect_fingerprint || 'fingerprint_not_available',
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    decision: decision.status || 'VALIDATION_FAILED',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: TOOL_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  TOOL_AUDIT_FIELDS,
  TOOL_AUDIT_VALIDATOR_VERSION,
  buildToolAudit,
  validateToolAudit
};

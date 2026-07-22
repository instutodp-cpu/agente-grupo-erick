'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, stablePayload } = require('./agent-identity-contract');

const CONTEXT_ASSEMBLY_AUDIT_VALIDATOR_VERSION = 'context_assembly_audit_validator_v1';
const CONTEXT_ASSEMBLY_AUDIT_FIELDS = Object.freeze([
  'audit_id',
  'assembly_request_id',
  'request_fingerprint',
  'source_fingerprints',
  'policy_fingerprint',
  'budget_fingerprint',
  'section_fingerprints',
  'plan_fingerprint',
  'result_fingerprint',
  'model_selection_decision_fingerprint',
  'tenant_binding',
  'organization_binding',
  'agent_id',
  'section_counts',
  'source_counts',
  'token_estimates',
  'overflow_status',
  'decision_status',
  'blockers',
  'reason_codes',
  'logical_sequence',
  'simulation',
  'production_blocked',
  'executed',
  'validator_version'
]);

function validateContextAssemblyAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['context_assembly_audit_must_be_object'] };
  const allowed = new Set(CONTEXT_ASSEMBLY_AUDIT_FIELDS);
  for (const field of CONTEXT_ASSEMBLY_AUDIT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(audit, field)) errors.push(`audit_missing_${field}`);
  }
  for (const field of Object.keys(audit)) {
    if (!allowed.has(field)) errors.push(`audit_unexpected_field::${field}`);
  }
  for (const field of [
    'audit_id', 'assembly_request_id', 'request_fingerprint', 'policy_fingerprint', 'budget_fingerprint',
    'plan_fingerprint', 'result_fingerprint', 'model_selection_decision_fingerprint', 'agent_id',
    'decision_status', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['source_fingerprints', 'section_fingerprints', 'blockers', 'reason_codes']) {
    if (!Array.isArray(audit[field]) || !audit[field].every(isNonEmptyString)) errors.push(`${field}_invalid`);
  }
  for (const field of ['tenant_binding', 'organization_binding', 'section_counts', 'source_counts', 'token_estimates']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (typeof audit.overflow_status !== 'boolean') errors.push('overflow_status_must_be_boolean');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== CONTEXT_ASSEMBLY_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function fingerprint(value) {
  try {
    return stablePayload(value === undefined ? null : value);
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function buildContextAssemblyAudit(input = {}) {
  const request = input.request || {};
  const result = input.result || {};
  const plan = input.plan || null;
  const audit = {
    audit_id: `context_assembly_audit_${result.assembly_request_id || request.assembly_request_id || 'missing'}`,
    assembly_request_id: result.assembly_request_id || request.assembly_request_id || 'assembly_request_not_available',
    request_fingerprint: result.request_fingerprint || fingerprint(request),
    source_fingerprints: Array.isArray(result.source_fingerprints) ? uniqueSorted(result.source_fingerprints) : [],
    policy_fingerprint: result.policy_fingerprint || 'policy_not_available',
    budget_fingerprint: result.budget_fingerprint || 'budget_not_available',
    section_fingerprints: Array.isArray(result.section_fingerprints) ? uniqueSorted(result.section_fingerprints) : [],
    plan_fingerprint: result.plan_fingerprint || 'plan_not_available',
    result_fingerprint: fingerprint(result),
    model_selection_decision_fingerprint: result.model_selection_decision_fingerprint || 'model_selection_decision_not_available',
    tenant_binding: { tenant_id: result.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: result.organization_id || 'organization_not_available' },
    agent_id: result.agent_id || 'agent_not_available',
    section_counts: {
      included: Number.isInteger(result.included_section_count) ? result.included_section_count : 0,
      excluded: Number.isInteger(result.excluded_section_count) ? result.excluded_section_count : 0,
      trimmed: Number.isInteger(result.trimmed_section_count) ? result.trimmed_section_count : 0
    },
    source_counts: {
      included: Number.isInteger(result.included_source_count) ? result.included_source_count : 0,
      excluded: Number.isInteger(result.excluded_source_count) ? result.excluded_source_count : 0
    },
    token_estimates: {
      total_estimated_tokens: Number.isInteger(result.total_estimated_tokens) ? result.total_estimated_tokens : 0,
      total_allocated_tokens: Number.isInteger(result.total_allocated_tokens) ? result.total_allocated_tokens : 0,
      remaining_context_tokens: Number.isInteger(result.remaining_context_tokens) ? result.remaining_context_tokens : 0
    },
    overflow_status: plan ? plan.overflow_detected === true : false,
    decision_status: result.status || 'VALIDATION_FAILED',
    blockers: Array.isArray(result.blockers) ? uniqueSorted(result.blockers) : [],
    reason_codes: Array.isArray(result.reason_codes) ? uniqueSorted(result.reason_codes) : [],
    logical_sequence: Number.isInteger(request.logical_sequence) ? request.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: CONTEXT_ASSEMBLY_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  CONTEXT_ASSEMBLY_AUDIT_FIELDS,
  CONTEXT_ASSEMBLY_AUDIT_VALIDATOR_VERSION,
  buildContextAssemblyAudit,
  validateContextAssemblyAudit
};

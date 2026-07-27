'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const EXECUTION_REFERENCE_BINDING_AUDIT_VALIDATOR_VERSION = 'execution_reference_binding_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

const EXECUTION_REFERENCE_BINDING_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'execution_plan_request_id', 'execution_plan_id', 'binding_ledger_id', 'fingerprints',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding',
  'actor_binding', 'scope_binding', 'counts', 'status', 'references_bound_in_simulation', 'reason_codes',
  'logical_sequence', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze(['provenance', 'scope', 'snapshot', 'ledger']);
const COUNT_KEYS = Object.freeze(['binding_count', 'required_binding_count', 'validated_binding_count', 'blocked_binding_count']);
const MAX_LIST_ITEMS = 50;

function isSanitizedStringList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

// Never records full payloads -- only ids, fingerprints, status, counts, the seven bindings
// (tenant/organization/project/session/agent/actor/scope), logical_sequence, reason_codes, and
// the simulation-only flags. Mirrors execution-plan-audit.js's own restraint, applied to the
// binding ledger this PR introduces rather than to the plan itself.
function validateExecutionReferenceBindingAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['execution_reference_binding_audit_must_be_object'] };
  exactFields(audit, EXECUTION_REFERENCE_BINDING_AUDIT_FIELDS, 'execution_reference_binding_audit', errors);
  for (const field of ['audit_id', 'execution_plan_request_id', 'execution_plan_id', 'binding_ledger_id', 'status', 'validator_version']) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(audit.fingerprints)) {
    errors.push('fingerprints_must_be_object');
  } else {
    for (const key of FINGERPRINT_KEYS) {
      if (!isNonEmptyString(audit.fingerprints[key])) errors.push(`fingerprints_${key}_invalid`);
    }
  }
  if (!isPlainObject(audit.tenant_binding) || !isNonEmptyString(audit.tenant_binding.tenant_id)) errors.push('tenant_binding_invalid');
  if (!isPlainObject(audit.organization_binding) || !isNonEmptyString(audit.organization_binding.organization_id)) errors.push('organization_binding_invalid');
  if (!isPlainObject(audit.project_binding) || !isNonEmptyString(audit.project_binding.project_id)) errors.push('project_binding_invalid');
  if (!isPlainObject(audit.session_binding) || !isNonEmptyString(audit.session_binding.session_reference_id)) errors.push('session_binding_invalid');
  if (!isPlainObject(audit.agent_binding) || !isNonEmptyString(audit.agent_binding.agent_id)) errors.push('agent_binding_invalid');
  if (!isPlainObject(audit.actor_binding) || !isNonEmptyString(audit.actor_binding.actor_id)) errors.push('actor_binding_invalid');
  if (!isPlainObject(audit.scope_binding) || !isNonEmptyString(audit.scope_binding.authorization_scope_id)) errors.push('scope_binding_invalid');
  if (!isPlainObject(audit.counts)) {
    errors.push('counts_must_be_object');
  } else {
    for (const key of COUNT_KEYS) {
      if (!Number.isInteger(audit.counts[key]) || audit.counts[key] < 0) errors.push(`counts_${key}_invalid`);
    }
  }
  if (typeof audit.references_bound_in_simulation !== 'boolean') errors.push('references_bound_in_simulation_must_be_boolean');
  if (!isSanitizedStringList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== EXECUTION_REFERENCE_BINDING_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionReferenceBindingAudit(input = {}) {
  const ledger = isPlainObject(input.ledger) ? input.ledger : {};
  const provenanceRef = isPlainObject(input.provenanceRef) ? input.provenanceRef : {};
  const scopeRef = isPlainObject(input.scopeRef) ? input.scopeRef : {};
  const snapshotRef = isPlainObject(input.snapshotRef) ? input.snapshotRef : {};

  const audit = {
    audit_id: `execution_reference_binding_audit_${ledger.binding_ledger_id || NOT_AVAILABLE_LABEL}`,
    execution_plan_request_id: ledger.execution_plan_request_id || NOT_AVAILABLE_LABEL,
    execution_plan_id: ledger.execution_plan_id || NOT_AVAILABLE_LABEL,
    binding_ledger_id: ledger.binding_ledger_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      provenance: input.provenanceFingerprint || NOT_AVAILABLE_FINGERPRINT,
      scope: scopeRef.scope_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      snapshot: snapshotRef.snapshot_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      ledger: ledger.ledger_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    tenant_binding: { tenant_id: ledger.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: ledger.organization_id || 'organization_not_available' },
    project_binding: { project_id: ledger.project_id || 'project_not_available' },
    session_binding: { session_reference_id: ledger.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: ledger.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: ledger.actor_id || 'actor_not_available' },
    scope_binding: { authorization_scope_id: provenanceRef.authorization_scope_id || 'authorization_scope_not_available' },
    counts: {
      binding_count: Number.isInteger(ledger.binding_count) ? ledger.binding_count : 0,
      required_binding_count: Number.isInteger(ledger.required_binding_count) ? ledger.required_binding_count : 0,
      validated_binding_count: Number.isInteger(ledger.validated_binding_count) ? ledger.validated_binding_count : 0,
      blocked_binding_count: Number.isInteger(ledger.blocked_binding_count) ? ledger.blocked_binding_count : 0
    },
    status: ledger.ledger_status || 'VALIDATION_FAILED',
    references_bound_in_simulation: ledger.references_bound_in_simulation === true,
    reason_codes: Array.isArray(input.reasonCodes) ? uniqueSorted(input.reasonCodes) : [],
    logical_sequence: Number.isInteger(ledger.logical_sequence) ? ledger.logical_sequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: EXECUTION_REFERENCE_BINDING_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  COUNT_KEYS,
  EXECUTION_REFERENCE_BINDING_AUDIT_FIELDS,
  EXECUTION_REFERENCE_BINDING_AUDIT_VALIDATOR_VERSION,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  buildExecutionReferenceBindingAudit,
  validateExecutionReferenceBindingAudit
};

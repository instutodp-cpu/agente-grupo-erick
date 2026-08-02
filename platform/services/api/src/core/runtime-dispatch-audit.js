'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DISPATCH_STATUSES, DISPATCH_DECISIONS, DISPATCH_NEXT_STATES } = require('./runtime-dispatch-decision');

const RUNTIME_DISPATCH_AUDIT_VALIDATOR_VERSION = 'runtime_dispatch_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only ids, fingerprints, digest, status/decision/next_state, identity bindings, and
// counts/estimates/blockers/reason codes -- never a payload, prompt, memory, message, tool
// argument, secret, endpoint, provider output, sensitive token, or credential. Mirrors
// runtime-worker-assignment-audit.js's own shape exactly, one layer up.
const RUNTIME_DISPATCH_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_dispatch_request_id', 'runtime_dispatch_decision_id', 'runtime_dispatch_result_id',
  'runtime_dispatch_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'stage_intent_counts', 'estimate_summary', 'worker_reference_ids', 'dependency_gate_outcomes', 'approval_gate_outcomes',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_dispatch_request_fingerprint', 'runtime_dispatch_decision_fingerprint', 'runtime_dispatch_package_fingerprint'
]);
const STAGE_INTENT_COUNT_KEYS = Object.freeze([
  'dispatch_stage_count', 'dispatch_intent_count', 'prepared_intent_count', 'waiting_dependency_count',
  'waiting_approval_count', 'optional_count', 'blocked_count'
]);
const ESTIMATE_SUMMARY_KEYS = Object.freeze([
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_total_cost_minor_units'
]);

const MAX_LIST_ITEMS = 200;

function isSanitizedList(list, maxItems = MAX_LIST_ITEMS) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateIntegerCountObject(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}_must_be_object`);
    return;
  }
  for (const key of keys) {
    if (!Number.isInteger(value[key]) || value[key] < 0) errors.push(`${label}_${key}_invalid`);
  }
}

function validateRuntimeDispatchAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_dispatch_audit_must_be_object'] };
  exactFields(audit, RUNTIME_DISPATCH_AUDIT_FIELDS, 'runtime_dispatch_audit', errors);
  for (const field of [
    'audit_id', 'runtime_dispatch_request_id', 'runtime_dispatch_decision_id', 'runtime_dispatch_result_id',
    'runtime_dispatch_package_id', 'package_digest', 'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!DISPATCH_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!DISPATCH_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!DISPATCH_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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

  validateIntegerCountObject(audit.stage_intent_counts, STAGE_INTENT_COUNT_KEYS, 'stage_intent_counts', errors);
  validateIntegerCountObject(audit.estimate_summary, ESTIMATE_SUMMARY_KEYS, 'estimate_summary', errors);

  if (!isSanitizedList(audit.worker_reference_ids)) errors.push('worker_reference_ids_invalid');
  if (!isSanitizedList(audit.dependency_gate_outcomes)) errors.push('dependency_gate_outcomes_invalid');
  if (!isSanitizedList(audit.approval_gate_outcomes)) errors.push('approval_gate_outcomes_invalid');
  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_DISPATCH_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_dispatch_audit_${result.runtime_dispatch_result_id || decision.runtime_dispatch_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_dispatch_request_id: decision.runtime_dispatch_request_id || NOT_AVAILABLE_LABEL,
    runtime_dispatch_decision_id: decision.runtime_dispatch_decision_id || NOT_AVAILABLE_LABEL,
    runtime_dispatch_result_id: result.runtime_dispatch_result_id || NOT_AVAILABLE_LABEL,
    runtime_dispatch_package_id: decision.runtime_dispatch_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_dispatch_request_fingerprint: decision.runtime_dispatch_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_dispatch_decision_fingerprint: result.runtime_dispatch_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_dispatch_package_fingerprint: decision.runtime_dispatch_package_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_dispatch_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    stage_intent_counts: Object.fromEntries(STAGE_INTENT_COUNT_KEYS.map((key) => [key, Number.isInteger(result[key]) ? result[key] : 0])),
    estimate_summary: Object.fromEntries(ESTIMATE_SUMMARY_KEYS.map((key) => [key, Number.isInteger(result[key]) ? result[key] : 0])),
    worker_reference_ids: Array.isArray(input.workerReferenceIds) ? uniqueSorted(input.workerReferenceIds) : [],
    dependency_gate_outcomes: Array.isArray(input.dependencyGateOutcomes) ? uniqueSorted(input.dependencyGateOutcomes) : [],
    approval_gate_outcomes: Array.isArray(input.approvalGateOutcomes) ? uniqueSorted(input.approvalGateOutcomes) : [],
    status: decision.status || 'DISPATCH_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_DISPATCH_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  ESTIMATE_SUMMARY_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_DISPATCH_AUDIT_FIELDS,
  RUNTIME_DISPATCH_AUDIT_VALIDATOR_VERSION,
  STAGE_INTENT_COUNT_KEYS,
  buildRuntimeDispatchAudit,
  validateRuntimeDispatchAudit
};

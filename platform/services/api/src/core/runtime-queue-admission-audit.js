'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { QUEUE_ADMISSION_STATUSES, QUEUE_ADMISSION_DECISIONS, QUEUE_ADMISSION_NEXT_STATES } = require('./runtime-queue-admission-decision');

const RUNTIME_QUEUE_ADMISSION_AUDIT_VALIDATOR_VERSION = 'runtime_queue_admission_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only ids, fingerprints, digest, status/decision/next_state, identity bindings, queue
// class/partition/quota reference ids, counts, priority classes, fairness rank outcomes, and
// estimates/blockers/reason codes -- never a payload, prompt, memory, message, tool argument,
// secret, endpoint, provider output, sensitive token, or credential. Mirrors
// runtime-dispatch-audit.js's own shape exactly, one layer up.
const RUNTIME_QUEUE_ADMISSION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_queue_admission_request_id', 'runtime_queue_admission_decision_id',
  'runtime_queue_admission_result_id', 'runtime_queue_admission_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'queue_class_reference_ids', 'queue_partition_reference_ids', 'queue_quota_reference_ids',
  'entry_counts', 'priority_classes', 'backlog_summary', 'fairness_rank_outcomes', 'estimate_summary',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_queue_admission_request_fingerprint', 'runtime_queue_admission_decision_fingerprint',
  'runtime_queue_admission_package_fingerprint'
]);
const ENTRY_COUNT_KEYS = Object.freeze(['entry_count', 'accepted_count', 'deferred_count', 'waiting_count', 'optional_count', 'blocked_count']);
const BACKLOG_SUMMARY_KEYS = Object.freeze(['model_admission_count', 'tool_admission_count', 'workflow_admission_count', 'parallel_admission_count']);
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

function validateRuntimeQueueAdmissionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_queue_admission_audit_must_be_object'] };
  exactFields(audit, RUNTIME_QUEUE_ADMISSION_AUDIT_FIELDS, 'runtime_queue_admission_audit', errors);
  for (const field of [
    'audit_id', 'runtime_queue_admission_request_id', 'runtime_queue_admission_decision_id',
    'runtime_queue_admission_result_id', 'runtime_queue_admission_package_id', 'package_digest',
    'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!QUEUE_ADMISSION_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!QUEUE_ADMISSION_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!QUEUE_ADMISSION_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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

  if (!isSanitizedList(audit.queue_class_reference_ids)) errors.push('queue_class_reference_ids_invalid');
  if (!isSanitizedList(audit.queue_partition_reference_ids)) errors.push('queue_partition_reference_ids_invalid');
  if (!isSanitizedList(audit.queue_quota_reference_ids)) errors.push('queue_quota_reference_ids_invalid');
  if (!isSanitizedList(audit.priority_classes)) errors.push('priority_classes_invalid');
  if (!isSanitizedList(audit.fairness_rank_outcomes)) errors.push('fairness_rank_outcomes_invalid');

  validateIntegerCountObject(audit.entry_counts, ENTRY_COUNT_KEYS, 'entry_counts', errors);
  validateIntegerCountObject(audit.backlog_summary, BACKLOG_SUMMARY_KEYS, 'backlog_summary', errors);
  validateIntegerCountObject(audit.estimate_summary, ESTIMATE_SUMMARY_KEYS, 'estimate_summary', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_QUEUE_ADMISSION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueAdmissionAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_queue_admission_audit_${result.runtime_queue_admission_result_id || decision.runtime_queue_admission_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_queue_admission_request_id: decision.runtime_queue_admission_request_id || NOT_AVAILABLE_LABEL,
    runtime_queue_admission_decision_id: decision.runtime_queue_admission_decision_id || NOT_AVAILABLE_LABEL,
    runtime_queue_admission_result_id: result.runtime_queue_admission_result_id || NOT_AVAILABLE_LABEL,
    runtime_queue_admission_package_id: decision.runtime_queue_admission_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_queue_admission_request_fingerprint: decision.runtime_queue_admission_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_queue_admission_decision_fingerprint: result.runtime_queue_admission_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_queue_admission_package_fingerprint: decision.runtime_queue_admission_package_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_queue_admission_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    queue_class_reference_ids: Array.isArray(input.queueClassReferenceIds) ? uniqueSorted(input.queueClassReferenceIds) : [],
    queue_partition_reference_ids: Array.isArray(input.queuePartitionReferenceIds) ? uniqueSorted(input.queuePartitionReferenceIds) : [],
    queue_quota_reference_ids: Array.isArray(input.queueQuotaReferenceIds) ? uniqueSorted(input.queueQuotaReferenceIds) : [],
    priority_classes: Array.isArray(input.priorityClasses) ? uniqueSorted(input.priorityClasses) : [],
    fairness_rank_outcomes: Array.isArray(input.fairnessRankOutcomes) ? uniqueSorted(input.fairnessRankOutcomes) : [],
    entry_counts: Object.fromEntries(ENTRY_COUNT_KEYS.map((key) => [key, Number.isInteger(result[key]) ? result[key] : 0])),
    backlog_summary: Object.fromEntries(BACKLOG_SUMMARY_KEYS.map((key) => [key, Number.isInteger(input[key]) ? input[key] : 0])),
    estimate_summary: Object.fromEntries(ESTIMATE_SUMMARY_KEYS.map((key) => [key, Number.isInteger(result[key]) ? result[key] : 0])),
    status: decision.status || 'QUEUE_ADMISSION_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_QUEUE_ADMISSION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  BACKLOG_SUMMARY_KEYS,
  ENTRY_COUNT_KEYS,
  ESTIMATE_SUMMARY_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_QUEUE_ADMISSION_AUDIT_FIELDS,
  RUNTIME_QUEUE_ADMISSION_AUDIT_VALIDATOR_VERSION,
  buildRuntimeQueueAdmissionAudit,
  validateRuntimeQueueAdmissionAudit
};

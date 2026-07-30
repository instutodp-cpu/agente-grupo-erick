'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { WORKER_ASSIGNMENT_STATUSES, WORKER_ASSIGNMENT_DECISIONS, WORKER_ASSIGNMENT_NEXT_STATES } = require('./runtime-worker-assignment-decision');

const RUNTIME_WORKER_ASSIGNMENT_AUDIT_VALIDATOR_VERSION = 'runtime_worker_assignment_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only ids, fingerprints, digest, status/decision/next_state, identity bindings, and
// counts/estimates/flags -- never a payload, prompt, memory, message, tool argument, secret,
// endpoint, provider output, sensitive token, or credential. Mirrors
// runtime-scheduler-audit.js's own shape exactly, one layer up.
const RUNTIME_WORKER_ASSIGNMENT_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_worker_assignment_request_id', 'runtime_worker_assignment_decision_id',
  'runtime_worker_assignment_result_id', 'runtime_worker_assignment_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'stage_worker_counts', 'candidate_counts', 'assignment_counts',
  'recommended_worker_ids', 'capability_mismatch_codes', 'health_statuses', 'capacity_summary',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_worker_assignment_request_fingerprint', 'runtime_worker_assignment_decision_fingerprint',
  'runtime_worker_assignment_package_fingerprint'
]);
const STAGE_WORKER_COUNT_KEYS = Object.freeze(['stage_count', 'worker_count']);
const CANDIDATE_COUNT_KEYS = Object.freeze(['compatible_candidate_count', 'incompatible_candidate_count']);
const ASSIGNMENT_COUNT_KEYS = Object.freeze([
  'recommended_assignment_count', 'waiting_dependency_assignment_count', 'waiting_approval_assignment_count',
  'no_candidate_assignment_count', 'blocked_assignment_count'
]);
const CAPACITY_SUMMARY_KEYS = Object.freeze(['available_stage_assignments_total', 'available_parallel_assignments_total']);

const MAX_LIST_ITEMS = 100;

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

function validateRuntimeWorkerAssignmentAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_worker_assignment_audit_must_be_object'] };
  exactFields(audit, RUNTIME_WORKER_ASSIGNMENT_AUDIT_FIELDS, 'runtime_worker_assignment_audit', errors);
  for (const field of [
    'audit_id', 'runtime_worker_assignment_request_id', 'runtime_worker_assignment_decision_id',
    'runtime_worker_assignment_result_id', 'runtime_worker_assignment_package_id', 'package_digest', 'status',
    'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKER_ASSIGNMENT_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!WORKER_ASSIGNMENT_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!WORKER_ASSIGNMENT_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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

  validateIntegerCountObject(audit.stage_worker_counts, STAGE_WORKER_COUNT_KEYS, 'stage_worker_counts', errors);
  validateIntegerCountObject(audit.candidate_counts, CANDIDATE_COUNT_KEYS, 'candidate_counts', errors);
  validateIntegerCountObject(audit.assignment_counts, ASSIGNMENT_COUNT_KEYS, 'assignment_counts', errors);
  validateIntegerCountObject(audit.capacity_summary, CAPACITY_SUMMARY_KEYS, 'capacity_summary', errors);

  if (!isSanitizedList(audit.recommended_worker_ids)) errors.push('recommended_worker_ids_invalid');
  if (!isSanitizedList(audit.capability_mismatch_codes)) errors.push('capability_mismatch_codes_invalid');
  if (!isSanitizedList(audit.health_statuses)) errors.push('health_statuses_invalid');
  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_WORKER_ASSIGNMENT_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerAssignmentAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_worker_assignment_audit_${result.runtime_worker_assignment_result_id || decision.runtime_worker_assignment_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_worker_assignment_request_id: decision.runtime_worker_assignment_request_id || NOT_AVAILABLE_LABEL,
    runtime_worker_assignment_decision_id: decision.runtime_worker_assignment_decision_id || NOT_AVAILABLE_LABEL,
    runtime_worker_assignment_result_id: result.runtime_worker_assignment_result_id || NOT_AVAILABLE_LABEL,
    runtime_worker_assignment_package_id: decision.runtime_worker_assignment_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_worker_assignment_request_fingerprint: decision.runtime_worker_assignment_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_worker_assignment_decision_fingerprint: result.runtime_worker_assignment_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_worker_assignment_package_fingerprint: decision.runtime_worker_assignment_package_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_worker_assignment_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    stage_worker_counts: {
      stage_count: Number.isInteger(result.stage_count) ? result.stage_count : 0,
      worker_count: Number.isInteger(result.worker_count) ? result.worker_count : 0
    },
    candidate_counts: {
      compatible_candidate_count: Number.isInteger(result.compatible_candidate_count) ? result.compatible_candidate_count : 0,
      incompatible_candidate_count: Number.isInteger(result.incompatible_candidate_count) ? result.incompatible_candidate_count : 0
    },
    assignment_counts: {
      recommended_assignment_count: Number.isInteger(result.recommended_assignment_count) ? result.recommended_assignment_count : 0,
      waiting_dependency_assignment_count: Number.isInteger(result.waiting_dependency_assignment_count) ? result.waiting_dependency_assignment_count : 0,
      waiting_approval_assignment_count: Number.isInteger(result.waiting_approval_assignment_count) ? result.waiting_approval_assignment_count : 0,
      no_candidate_assignment_count: Number.isInteger(result.no_candidate_assignment_count) ? result.no_candidate_assignment_count : 0,
      blocked_assignment_count: Number.isInteger(result.blocked_assignment_count) ? result.blocked_assignment_count : 0
    },
    recommended_worker_ids: Array.isArray(input.recommendedWorkerIds) ? uniqueSorted(input.recommendedWorkerIds) : [],
    capability_mismatch_codes: Array.isArray(input.capabilityMismatchCodes) ? uniqueSorted(input.capabilityMismatchCodes) : [],
    health_statuses: Array.isArray(input.healthStatuses) ? uniqueSorted(input.healthStatuses) : [],
    capacity_summary: {
      available_stage_assignments_total: Number.isInteger(input.availableStageAssignmentsTotal) ? input.availableStageAssignmentsTotal : 0,
      available_parallel_assignments_total: Number.isInteger(input.availableParallelAssignmentsTotal) ? input.availableParallelAssignmentsTotal : 0
    },
    status: decision.status || 'WORKER_ASSIGNMENT_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_WORKER_ASSIGNMENT_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  ASSIGNMENT_COUNT_KEYS,
  CANDIDATE_COUNT_KEYS,
  CAPACITY_SUMMARY_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_WORKER_ASSIGNMENT_AUDIT_FIELDS,
  RUNTIME_WORKER_ASSIGNMENT_AUDIT_VALIDATOR_VERSION,
  STAGE_WORKER_COUNT_KEYS,
  buildRuntimeWorkerAssignmentAudit,
  validateRuntimeWorkerAssignmentAudit
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { RUNTIME_ADMISSION_STATUSES, RUNTIME_ADMISSION_DECISIONS, RUNTIME_ADMISSION_NEXT_STATES } = require('./runtime-admission-decision');

const RUNTIME_ADMISSION_AUDIT_VALIDATOR_VERSION = 'runtime_admission_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only ids, fingerprints, digest, status/decision/next_state, identity bindings, and
// counts/estimates/flags -- never a payload, StageRecord, prompt, memory, message, tool argument,
// response, secret, real token, endpoint, code, or provider output. Mirrors
// runtime-execution-simulation-audit.js's own shape exactly, one layer up.
const RUNTIME_ADMISSION_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_admission_request_id', 'runtime_admission_decision_id', 'runtime_admission_result_id',
  'runtime_readiness_decision_id', 'runtime_execution_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'requested_capacities', 'available_capacities', 'concurrency_counts', 'budget_estimates',
  'freshness_flags', 'replay_attempts',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_admission_request_fingerprint', 'runtime_admission_decision_fingerprint',
  'runtime_readiness_decision_fingerprint', 'runtime_execution_package_fingerprint',
  'runtime_capacity_snapshot_fingerprint', 'runtime_concurrency_fingerprint'
]);
const REQUESTED_CAPACITY_KEYS = Object.freeze([
  'requested_package_slots', 'requested_stage_slots', 'requested_parallel_stage_slots',
  'requested_model_stage_slots', 'requested_tool_stage_slots', 'requested_workflow_stage_slots'
]);
const AVAILABLE_CAPACITY_KEYS = Object.freeze([
  'available_package_capacity', 'available_stage_capacity', 'available_parallel_stage_capacity',
  'available_model_stage_capacity', 'available_tool_stage_capacity', 'available_workflow_stage_capacity',
  'available_tokens_capacity', 'available_cost_capacity_minor_units'
]);
const CONCURRENCY_COUNT_KEYS = Object.freeze(['current_tenant_package_slots', 'current_organization_package_slots', 'current_agent_package_slots']);
const BUDGET_ESTIMATE_KEYS = Object.freeze(['estimated_total_tokens', 'estimated_total_cost_minor_units']);
const FRESHNESS_FLAG_KEYS = Object.freeze(['freshness_validated', 'replay_validated']);
const REPLAY_ATTEMPT_KEYS = Object.freeze(['expected_readiness_attempt', 'expected_admission_attempt']);

const MAX_LIST_ITEMS = 50;

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

function validateBooleanFlagObject(value, keys, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label}_must_be_object`);
    return;
  }
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') errors.push(`${label}_${key}_invalid`);
  }
}

function validateRuntimeAdmissionAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_admission_audit_must_be_object'] };
  exactFields(audit, RUNTIME_ADMISSION_AUDIT_FIELDS, 'runtime_admission_audit', errors);
  for (const field of [
    'audit_id', 'runtime_admission_request_id', 'runtime_admission_decision_id', 'runtime_admission_result_id',
    'runtime_readiness_decision_id', 'runtime_execution_package_id', 'package_digest', 'status', 'decision',
    'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_ADMISSION_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!RUNTIME_ADMISSION_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!RUNTIME_ADMISSION_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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

  validateIntegerCountObject(audit.requested_capacities, REQUESTED_CAPACITY_KEYS, 'requested_capacities', errors);
  validateIntegerCountObject(audit.available_capacities, AVAILABLE_CAPACITY_KEYS, 'available_capacities', errors);
  validateIntegerCountObject(audit.concurrency_counts, CONCURRENCY_COUNT_KEYS, 'concurrency_counts', errors);
  validateIntegerCountObject(audit.budget_estimates, BUDGET_ESTIMATE_KEYS, 'budget_estimates', errors);
  validateBooleanFlagObject(audit.freshness_flags, FRESHNESS_FLAG_KEYS, 'freshness_flags', errors);
  validateIntegerCountObject(audit.replay_attempts, REPLAY_ATTEMPT_KEYS, 'replay_attempts', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_ADMISSION_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeAdmissionAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};

  const audit = {
    audit_id: `runtime_admission_audit_${result.runtime_admission_result_id || decision.runtime_admission_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_admission_request_id: decision.runtime_admission_request_id || NOT_AVAILABLE_LABEL,
    runtime_admission_decision_id: decision.runtime_admission_decision_id || NOT_AVAILABLE_LABEL,
    runtime_admission_result_id: result.runtime_admission_result_id || NOT_AVAILABLE_LABEL,
    runtime_readiness_decision_id: decision.runtime_readiness_decision_id || NOT_AVAILABLE_LABEL,
    runtime_execution_package_id: decision.runtime_execution_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_admission_request_fingerprint: decision.runtime_admission_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_admission_decision_fingerprint: result.runtime_admission_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_readiness_decision_fingerprint: decision.runtime_readiness_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_execution_package_fingerprint: decision.runtime_execution_package_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_capacity_snapshot_fingerprint: decision.runtime_capacity_snapshot_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_concurrency_fingerprint: decision.runtime_concurrency_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_execution_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    requested_capacities: {
      requested_package_slots: Number.isInteger(result.requested_package_slots) ? result.requested_package_slots : 0,
      requested_stage_slots: Number.isInteger(result.requested_stage_slots) ? result.requested_stage_slots : 0,
      requested_parallel_stage_slots: Number.isInteger(result.requested_parallel_stage_slots) ? result.requested_parallel_stage_slots : 0,
      requested_model_stage_slots: Number.isInteger(result.requested_model_stage_slots) ? result.requested_model_stage_slots : 0,
      requested_tool_stage_slots: Number.isInteger(result.requested_tool_stage_slots) ? result.requested_tool_stage_slots : 0,
      requested_workflow_stage_slots: Number.isInteger(result.requested_workflow_stage_slots) ? result.requested_workflow_stage_slots : 0
    },
    available_capacities: {
      available_package_capacity: Number.isInteger(input.availablePackageCapacity) ? input.availablePackageCapacity : 0,
      available_stage_capacity: Number.isInteger(input.availableStageCapacity) ? input.availableStageCapacity : 0,
      available_parallel_stage_capacity: Number.isInteger(input.availableParallelStageCapacity) ? input.availableParallelStageCapacity : 0,
      available_model_stage_capacity: Number.isInteger(input.availableModelStageCapacity) ? input.availableModelStageCapacity : 0,
      available_tool_stage_capacity: Number.isInteger(input.availableToolStageCapacity) ? input.availableToolStageCapacity : 0,
      available_workflow_stage_capacity: Number.isInteger(input.availableWorkflowStageCapacity) ? input.availableWorkflowStageCapacity : 0,
      available_tokens_capacity: Number.isInteger(input.availableTokensCapacity) ? input.availableTokensCapacity : 0,
      available_cost_capacity_minor_units: Number.isInteger(input.availableCostCapacityMinorUnits) ? input.availableCostCapacityMinorUnits : 0
    },
    concurrency_counts: {
      current_tenant_package_slots: Number.isInteger(input.currentTenantPackageSlots) ? input.currentTenantPackageSlots : 0,
      current_organization_package_slots: Number.isInteger(input.currentOrganizationPackageSlots) ? input.currentOrganizationPackageSlots : 0,
      current_agent_package_slots: Number.isInteger(input.currentAgentPackageSlots) ? input.currentAgentPackageSlots : 0
    },
    budget_estimates: {
      estimated_total_tokens: Number.isInteger(result.estimated_total_tokens) ? result.estimated_total_tokens : 0,
      estimated_total_cost_minor_units: Number.isInteger(result.estimated_total_cost_minor_units) ? result.estimated_total_cost_minor_units : 0
    },
    freshness_flags: {
      freshness_validated: input.freshnessValidated === true,
      replay_validated: input.replayValidated === true
    },
    replay_attempts: {
      expected_readiness_attempt: Number.isInteger(input.expectedReadinessAttempt) ? input.expectedReadinessAttempt : 0,
      expected_admission_attempt: Number.isInteger(input.expectedAdmissionAttempt) ? input.expectedAdmissionAttempt : 0
    },
    status: decision.status || 'RUNTIME_ADMISSION_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_ADMISSION_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  AVAILABLE_CAPACITY_KEYS,
  BUDGET_ESTIMATE_KEYS,
  CONCURRENCY_COUNT_KEYS,
  FINGERPRINT_KEYS,
  FRESHNESS_FLAG_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  REPLAY_ATTEMPT_KEYS,
  REQUESTED_CAPACITY_KEYS,
  RUNTIME_ADMISSION_AUDIT_FIELDS,
  RUNTIME_ADMISSION_AUDIT_VALIDATOR_VERSION,
  buildRuntimeAdmissionAudit,
  validateRuntimeAdmissionAudit
};

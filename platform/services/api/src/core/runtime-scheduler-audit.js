'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { RUNTIME_SCHEDULER_STATUSES, RUNTIME_SCHEDULER_DECISIONS, RUNTIME_SCHEDULER_NEXT_STATES } = require('./runtime-scheduler-decision');

const RUNTIME_SCHEDULER_AUDIT_VALIDATOR_VERSION = 'runtime_scheduler_audit_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const NOT_AVAILABLE_LABEL = 'not_available';

// Registers only ids, fingerprints, digest, status/decision/next_state, identity bindings, and
// counts/estimates/flags -- never a payload, StageRecord, prompt, memory, message, tool argument,
// response, secret, real token, endpoint, code, or provider output. Mirrors
// runtime-admission-audit.js's own shape exactly, one layer up.
const RUNTIME_SCHEDULER_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'runtime_scheduler_request_id', 'runtime_scheduler_decision_id', 'runtime_scheduler_result_id',
  'runtime_scheduler_package_id',
  'fingerprints', 'package_digest',
  'tenant_binding', 'organization_binding', 'project_binding', 'session_binding', 'agent_binding', 'actor_binding',
  'stage_counts', 'eligibility_counts', 'capacity_limit_flags', 'budget_estimates',
  'status', 'decision', 'next_state',
  'blockers', 'reason_codes', 'logical_sequence',
  'simulation', 'production_blocked', 'executed', 'validator_version'
]);

const FINGERPRINT_KEYS = Object.freeze([
  'runtime_scheduler_request_fingerprint', 'runtime_scheduler_decision_fingerprint',
  'runtime_scheduler_package_fingerprint'
]);
const STAGE_COUNT_KEYS = Object.freeze(['scheduler_stage_count', 'scheduler_dependency_count', 'parallel_group_count', 'approval_wait_count']);
const ELIGIBILITY_COUNT_KEYS = Object.freeze(['eligible_count', 'waiting_dependency_count', 'waiting_approval_count', 'optional_count', 'blocked_count']);
const CAPACITY_LIMIT_FLAG_KEYS = Object.freeze([
  'package_capacity_within_limit', 'stage_capacity_within_limit', 'parallel_capacity_within_limit',
  'model_capacity_within_limit', 'tool_capacity_within_limit', 'workflow_capacity_within_limit',
  'token_capacity_within_limit', 'cost_capacity_within_limit'
]);
const BUDGET_ESTIMATE_KEYS = Object.freeze(['estimated_total_tokens', 'estimated_total_cost_minor_units']);

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

function validateRuntimeSchedulerAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['runtime_scheduler_audit_must_be_object'] };
  exactFields(audit, RUNTIME_SCHEDULER_AUDIT_FIELDS, 'runtime_scheduler_audit', errors);
  for (const field of [
    'audit_id', 'runtime_scheduler_request_id', 'runtime_scheduler_decision_id', 'runtime_scheduler_result_id',
    'runtime_scheduler_package_id', 'package_digest', 'status', 'decision', 'next_state', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_SCHEDULER_STATUSES.includes(audit.status)) errors.push('status_invalid');
  if (!RUNTIME_SCHEDULER_DECISIONS.includes(audit.decision)) errors.push('decision_invalid');
  if (!RUNTIME_SCHEDULER_NEXT_STATES.includes(audit.next_state)) errors.push('next_state_invalid');

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

  validateIntegerCountObject(audit.stage_counts, STAGE_COUNT_KEYS, 'stage_counts', errors);
  validateIntegerCountObject(audit.eligibility_counts, ELIGIBILITY_COUNT_KEYS, 'eligibility_counts', errors);
  validateBooleanFlagObject(audit.capacity_limit_flags, CAPACITY_LIMIT_FLAG_KEYS, 'capacity_limit_flags', errors);
  validateIntegerCountObject(audit.budget_estimates, BUDGET_ESTIMATE_KEYS, 'budget_estimates', errors);

  if (!isSanitizedList(audit.blockers)) errors.push('blockers_invalid');
  if (!isSanitizedList(audit.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== RUNTIME_SCHEDULER_AUDIT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(audit));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerAudit(input = {}) {
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const result = isPlainObject(input.result) ? input.result : {};
  const capacityPlan = isPlainObject(input.capacityPlan) ? input.capacityPlan : {};

  const audit = {
    audit_id: `runtime_scheduler_audit_${result.runtime_scheduler_result_id || decision.runtime_scheduler_decision_id || NOT_AVAILABLE_LABEL}`,
    runtime_scheduler_request_id: decision.runtime_scheduler_request_id || NOT_AVAILABLE_LABEL,
    runtime_scheduler_decision_id: decision.runtime_scheduler_decision_id || NOT_AVAILABLE_LABEL,
    runtime_scheduler_result_id: result.runtime_scheduler_result_id || NOT_AVAILABLE_LABEL,
    runtime_scheduler_package_id: decision.runtime_scheduler_package_id || NOT_AVAILABLE_LABEL,
    fingerprints: {
      runtime_scheduler_request_fingerprint: decision.runtime_scheduler_request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_scheduler_decision_fingerprint: result.runtime_scheduler_decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
      runtime_scheduler_package_fingerprint: decision.runtime_scheduler_package_fingerprint || NOT_AVAILABLE_FINGERPRINT
    },
    package_digest: decision.runtime_scheduler_package_digest || NOT_AVAILABLE_FINGERPRINT,
    tenant_binding: { tenant_id: decision.tenant_id || 'tenant_not_available' },
    organization_binding: { organization_id: decision.organization_id || 'organization_not_available' },
    project_binding: { project_id: decision.project_id || 'project_not_available' },
    session_binding: { session_reference_id: decision.session_reference_id || 'session_not_available' },
    agent_binding: { agent_id: decision.agent_id || 'agent_not_available' },
    actor_binding: { actor_id: decision.actor_id || 'actor_not_available' },
    stage_counts: {
      scheduler_stage_count: Number.isInteger(result.scheduler_stage_count) ? result.scheduler_stage_count : 0,
      scheduler_dependency_count: Number.isInteger(result.scheduler_dependency_count) ? result.scheduler_dependency_count : 0,
      parallel_group_count: Number.isInteger(result.parallel_group_count) ? result.parallel_group_count : 0,
      approval_wait_count: Number.isInteger(result.approval_wait_count) ? result.approval_wait_count : 0
    },
    eligibility_counts: {
      eligible_count: Number.isInteger(result.eligible_stage_count) ? result.eligible_stage_count : 0,
      waiting_dependency_count: Number.isInteger(result.waiting_dependency_stage_count) ? result.waiting_dependency_stage_count : 0,
      waiting_approval_count: Number.isInteger(result.waiting_approval_stage_count) ? result.waiting_approval_stage_count : 0,
      optional_count: Number.isInteger(result.optional_stage_count) ? result.optional_stage_count : 0,
      blocked_count: Number.isInteger(result.blocked_stage_count) ? result.blocked_stage_count : 0
    },
    capacity_limit_flags: Object.fromEntries(CAPACITY_LIMIT_FLAG_KEYS.map((key) => [key, capacityPlan[key] === true])),
    budget_estimates: {
      estimated_total_tokens: Number.isInteger(result.estimated_total_tokens) ? result.estimated_total_tokens : 0,
      estimated_total_cost_minor_units: Number.isInteger(result.estimated_total_cost_minor_units) ? result.estimated_total_cost_minor_units : 0
    },
    status: decision.status || 'SCHEDULER_VALIDATION_FAILED',
    decision: decision.decision || 'BLOCKED',
    next_state: decision.next_state || 'BLOCKED_REFERENCE',
    blockers: Array.isArray(decision.blockers) ? uniqueSorted(decision.blockers) : [],
    reason_codes: Array.isArray(decision.reason_codes) ? uniqueSorted(decision.reason_codes) : [],
    logical_sequence: Number.isInteger(input.logicalSequence) ? input.logicalSequence : 0,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: RUNTIME_SCHEDULER_AUDIT_VALIDATOR_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  BUDGET_ESTIMATE_KEYS,
  CAPACITY_LIMIT_FLAG_KEYS,
  ELIGIBILITY_COUNT_KEYS,
  FINGERPRINT_KEYS,
  MAX_LIST_ITEMS,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_LABEL,
  RUNTIME_SCHEDULER_AUDIT_FIELDS,
  RUNTIME_SCHEDULER_AUDIT_VALIDATOR_VERSION,
  STAGE_COUNT_KEYS,
  buildRuntimeSchedulerAudit,
  validateRuntimeSchedulerAudit
};

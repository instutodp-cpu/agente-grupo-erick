'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MEMORY_SELECTION_DECISION_VALIDATOR_VERSION = 'memory_selection_decision_validator_v1';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const MEMORY_SELECTION_DECISION_FIELDS = Object.freeze([
  'decision_id', 'selection_request_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id', 'status',
  'decision', 'plan_fingerprint', 'request_fingerprint', 'policy_fingerprint', 'budget_fingerprint',
  'included_reference_count', 'excluded_reference_count', 'required_reference_count', 'relevant_reference_count',
  'optional_reference_count', 'blockers', 'reason_codes', 'request_validated', 'policy_validated',
  'budget_validated', 'references_validated', 'conflicts_resolved', 'required_memory_preserved',
  'preferences_preserved', 'project_state_preserved', 'continuity_preserved', 'pending_tasks_preserved',
  'applicable_decisions_preserved', 'required_memory_omitted', 'preference_omitted', 'project_state_omitted',
  'continuity_omitted', 'memory_loaded', 'memory_read', 'memory_written', 'summary_generated',
  'embedding_generated', 'vector_store_used', 'tokens_consumed', 'cost_consumed', 'network_used', 'executed',
  'runtime_enabled', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const DECISION_STATUSES = Object.freeze([
  'SELECTION_PLANNED_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED',
  'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'POLICY_BLOCKED', 'BUDGET_BLOCKED', 'CONFLICT_BLOCKED',
  'REQUIRED_MEMORY_BLOCKED', 'CONTINUITY_BLOCKED', 'VERSION_BLOCKED'
]);
const DECISION_VALUES = Object.freeze(['PLAN_MEMORY_REFERENCES', 'BLOCKED']);

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'budget_validated', 'references_validated', 'conflicts_resolved'
]);
const PRESERVATION_FLAG_FIELDS = Object.freeze([
  'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'pending_tasks_preserved', 'applicable_decisions_preserved'
]);
const OMISSION_FLAG_FIELDS = Object.freeze([
  'required_memory_omitted', 'preference_omitted', 'project_state_omitted', 'continuity_omitted'
]);
const COUNT_FIELDS = Object.freeze([
  'included_reference_count', 'excluded_reference_count', 'required_reference_count', 'relevant_reference_count',
  'optional_reference_count'
]);

const MEMORY_SELECTION_DECISION_SAFE_FLAGS = Object.freeze({
  memory_loaded: false,
  memory_read: false,
  memory_written: false,
  summary_generated: false,
  embedding_generated: false,
  vector_store_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  network_used: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

const MAX_LIST_ITEMS = 2000;
const MAX_COUNT = 1000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateSelectionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['selection_decision_must_be_object'] };
  exactFields(decision, MEMORY_SELECTION_DECISION_FIELDS, 'selection_decision', errors);
  for (const field of [
    'decision_id', 'selection_request_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
    'plan_fingerprint', 'request_fingerprint', 'policy_fingerprint', 'budget_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(decision[field]) || decision[field] < 0 || decision[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(decision.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(decision.reason_codes)) errors.push('reason_codes_invalid');
  for (const field of [...VALIDATION_FLAG_FIELDS, ...PRESERVATION_FLAG_FIELDS, ...OMISSION_FLAG_FIELDS]) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(MEMORY_SELECTION_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (decision.status === 'SELECTION_PLANNED_SIMULATION') {
    if (decision.decision !== 'PLAN_MEMORY_REFERENCES') errors.push('decision_must_be_plan_memory_references_when_planned');
    for (const field of PRESERVATION_FLAG_FIELDS) {
      if (decision[field] !== true) errors.push(`${field}_must_be_true_when_planned`);
    }
    for (const field of OMISSION_FLAG_FIELDS) {
      if (decision[field] !== false) errors.push(`${field}_must_be_false_when_planned`);
    }
  } else if (decision.decision !== 'BLOCKED') {
    errors.push('decision_must_be_blocked_unless_planned');
  }

  if (decision.validator_version !== MEMORY_SELECTION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSelectionDecision(overrides = {}) {
  const status = DECISION_STATUSES.includes(overrides.status) ? overrides.status : 'VALIDATION_FAILED';
  const isPlanned = status === 'SELECTION_PLANNED_SIMULATION';
  const decision = {
    decision_id: overrides.decision_id || 'memory_selection_decision_not_available',
    selection_request_id: overrides.selection_request_id || 'selection_request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    project_id: overrides.project_id || 'project_not_available',
    status,
    decision: isPlanned ? 'PLAN_MEMORY_REFERENCES' : 'BLOCKED',
    plan_fingerprint: overrides.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: overrides.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: overrides.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    included_reference_count: Number.isInteger(overrides.included_reference_count) ? overrides.included_reference_count : 0,
    excluded_reference_count: Number.isInteger(overrides.excluded_reference_count) ? overrides.excluded_reference_count : 0,
    required_reference_count: Number.isInteger(overrides.required_reference_count) ? overrides.required_reference_count : 0,
    relevant_reference_count: Number.isInteger(overrides.relevant_reference_count) ? overrides.relevant_reference_count : 0,
    optional_reference_count: Number.isInteger(overrides.optional_reference_count) ? overrides.optional_reference_count : 0,
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    request_validated: overrides.request_validated === true,
    policy_validated: overrides.policy_validated === true,
    budget_validated: overrides.budget_validated === true,
    references_validated: overrides.references_validated === true,
    conflicts_resolved: overrides.conflicts_resolved === true,
    required_memory_preserved: isPlanned ? true : overrides.required_memory_preserved === true,
    preferences_preserved: isPlanned ? true : overrides.preferences_preserved === true,
    project_state_preserved: isPlanned ? true : overrides.project_state_preserved === true,
    continuity_preserved: isPlanned ? true : overrides.continuity_preserved === true,
    pending_tasks_preserved: isPlanned ? true : overrides.pending_tasks_preserved === true,
    applicable_decisions_preserved: isPlanned ? true : overrides.applicable_decisions_preserved === true,
    required_memory_omitted: isPlanned ? false : overrides.required_memory_omitted === true,
    preference_omitted: isPlanned ? false : overrides.preference_omitted === true,
    project_state_omitted: isPlanned ? false : overrides.project_state_omitted === true,
    continuity_omitted: isPlanned ? false : overrides.continuity_omitted === true,
    validator_version: MEMORY_SELECTION_DECISION_VALIDATOR_VERSION,
    ...MEMORY_SELECTION_DECISION_SAFE_FLAGS
  };

  const validation = validateSelectionDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      required_memory_preserved: overrides.required_memory_preserved === true,
      preferences_preserved: overrides.preferences_preserved === true,
      project_state_preserved: overrides.project_state_preserved === true,
      continuity_preserved: overrides.continuity_preserved === true,
      pending_tasks_preserved: overrides.pending_tasks_preserved === true,
      applicable_decisions_preserved: overrides.applicable_decisions_preserved === true,
      required_memory_omitted: overrides.required_memory_omitted === true,
      preference_omitted: overrides.preference_omitted === true,
      project_state_omitted: overrides.project_state_omitted === true,
      continuity_omitted: overrides.continuity_omitted === true,
      blockers: uniqueSorted([...decision.blockers, ...validation.errors]),
      reason_codes: uniqueSorted([...decision.reason_codes, validation.errors[0] || 'memory_selection_decision_invalid']),
      ...MEMORY_SELECTION_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  COUNT_FIELDS,
  DECISION_STATUSES,
  DECISION_VALUES,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MEMORY_SELECTION_DECISION_FIELDS,
  MEMORY_SELECTION_DECISION_SAFE_FLAGS,
  MEMORY_SELECTION_DECISION_VALIDATOR_VERSION,
  NOT_AVAILABLE_FINGERPRINT,
  OMISSION_FLAG_FIELDS,
  PRESERVATION_FLAG_FIELDS,
  VALIDATION_FLAG_FIELDS,
  buildSelectionDecision,
  validateSelectionDecision
};

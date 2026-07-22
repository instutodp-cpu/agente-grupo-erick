'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { COST_TIERS } = require('./model-contract');

const MODEL_SELECTION_DECISION_VALIDATOR_VERSION = 'model_selection_decision_validator_v1';
const SELECTION_DECISION_FIELDS = Object.freeze([
  'decision_id', 'selection_request_id', 'agent_id', 'tenant_id', 'organization_id', 'status', 'decision',
  'selected_candidate_id', 'selected_provider_id', 'selected_model_id', 'selected_cost_tier',
  'estimated_cost_minor_units', 'deterministic_resolution_selected', 'fallback_plan_present',
  'escalation_plan_present', 'candidate_count', 'eligible_candidate_count', 'ineligible_candidate_count',
  'request_fingerprint', 'task_profile_fingerprint', 'constraints_fingerprint', 'ranking_fingerprint',
  'selected_candidate_fingerprint', 'registry_version', 'blockers', 'reason_codes', 'selection_evaluated',
  'model_selected_in_simulation', 'provider_called', 'model_called', 'network_used', 'tokens_consumed',
  'cost_consumed', 'fallback_executed', 'escalation_executed', 'executed', 'runtime_enabled', 'simulation',
  'production_blocked', 'rollout_percentage', 'validator_version'
]);
const DECISION_STATUSES = Object.freeze([
  'NO_LLM_SELECTED_SIMULATION', 'MODEL_SELECTED_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'POLICY_BLOCKED',
  'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'NO_ELIGIBLE_CANDIDATE', 'BUDGET_BLOCKED', 'PRIVACY_BLOCKED',
  'CAPABILITY_BLOCKED', 'CONTEXT_BLOCKED', 'RISK_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED'
]);
const DECISION_VALUES = Object.freeze(['SELECT_NO_LLM_REFERENCE', 'SELECT_MODEL_REFERENCE', 'BLOCKED']);
const MODEL_SELECTION_DECISION_SAFE_FLAGS = Object.freeze({
  provider_called: false,
  model_called: false,
  network_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  fallback_executed: false,
  escalation_executed: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const SELECTION_BLOCKED_CANDIDATE_SENTINEL = 'SELECTION_BLOCKED';
const MAX_LIST_ITEMS = 200;
const MAX_COUNT = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['selection_decision_must_be_object'] };
  exactFields(decision, SELECTION_DECISION_FIELDS, 'selection_decision', errors);
  for (const field of [
    'decision_id', 'selection_request_id', 'agent_id', 'tenant_id', 'organization_id', 'selected_candidate_id',
    'request_fingerprint', 'task_profile_fingerprint', 'constraints_fingerprint', 'ranking_fingerprint',
    'selected_candidate_fingerprint', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (!COST_TIERS.includes(decision.selected_cost_tier)) errors.push(`selected_cost_tier_not_allowed::${decision.selected_cost_tier}`);
  if (!Number.isInteger(decision.estimated_cost_minor_units) || decision.estimated_cost_minor_units < 0) errors.push('estimated_cost_minor_units_invalid');
  for (const field of ['fallback_plan_present', 'escalation_plan_present', 'deterministic_resolution_selected']) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of ['candidate_count', 'eligible_candidate_count', 'ineligible_candidate_count']) {
    if (!Number.isInteger(decision[field]) || decision[field] < 0 || decision[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(decision.eligible_candidate_count) && Number.isInteger(decision.ineligible_candidate_count) &&
    Number.isInteger(decision.candidate_count) &&
    decision.candidate_count !== decision.eligible_candidate_count + decision.ineligible_candidate_count
  ) {
    errors.push('candidate_count_mismatch');
  }
  if (!isOrderedUniqueStringList(decision.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(decision.reason_codes)) errors.push('reason_codes_invalid');
  if (decision.selection_evaluated !== true) errors.push('selection_evaluated_must_be_true');
  if (typeof decision.model_selected_in_simulation !== 'boolean') errors.push('model_selected_in_simulation_must_be_boolean');
  if (decision.model_selected_in_simulation === true && decision.status !== 'MODEL_SELECTED_SIMULATION') {
    errors.push('model_selected_in_simulation_inconsistent_with_status');
  }
  if (decision.model_selected_in_simulation === false && decision.status === 'MODEL_SELECTED_SIMULATION') {
    errors.push('model_selected_in_simulation_must_be_true_for_model_selected_status');
  }
  for (const [field, expected] of Object.entries(MODEL_SELECTION_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (decision.status === 'NO_LLM_SELECTED_SIMULATION') {
    if (decision.decision !== 'SELECT_NO_LLM_REFERENCE') errors.push('decision_must_be_select_no_llm_reference');
    if (decision.selected_provider_id !== null) errors.push('selected_provider_id_must_be_null_for_no_llm');
    if (decision.selected_model_id !== null) errors.push('selected_model_id_must_be_null_for_no_llm');
    if (decision.estimated_cost_minor_units !== 0) errors.push('estimated_cost_minor_units_must_be_0_for_no_llm');
    if (decision.deterministic_resolution_selected !== true) errors.push('deterministic_resolution_selected_must_be_true_for_no_llm');
  } else if (decision.status === 'MODEL_SELECTED_SIMULATION') {
    if (decision.decision !== 'SELECT_MODEL_REFERENCE') errors.push('decision_must_be_select_model_reference');
    if (!isNonEmptyString(decision.selected_provider_id)) errors.push('selected_provider_id_required_for_model_selected');
    if (!isNonEmptyString(decision.selected_model_id)) errors.push('selected_model_id_required_for_model_selected');
    if (decision.deterministic_resolution_selected !== false) errors.push('deterministic_resolution_selected_must_be_false_for_model_selected');
  } else {
    if (decision.decision !== 'BLOCKED') errors.push('decision_must_be_blocked');
    if (decision.selected_provider_id !== null) errors.push('selected_provider_id_must_be_null_when_blocked');
    if (decision.selected_model_id !== null) errors.push('selected_model_id_must_be_null_when_blocked');
    if (decision.deterministic_resolution_selected !== false) errors.push('deterministic_resolution_selected_must_be_false_when_blocked');
  }
  if (decision.selected_provider_id !== null && !isNonEmptyString(decision.selected_provider_id)) errors.push('selected_provider_id_must_be_null_or_string');
  if (decision.selected_model_id !== null && !isNonEmptyString(decision.selected_model_id)) errors.push('selected_model_id_must_be_null_or_string');

  if (decision.validator_version !== MODEL_SELECTION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelSelectionDecision(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const isNoLlm = status === 'NO_LLM_SELECTED_SIMULATION';
  const isModelSelected = status === 'MODEL_SELECTED_SIMULATION';
  const decision = {
    decision_id: overrides.decision_id || 'model_selection_decision_not_available',
    selection_request_id: overrides.selection_request_id || 'selection_request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    status,
    decision: isNoLlm ? 'SELECT_NO_LLM_REFERENCE' : isModelSelected ? 'SELECT_MODEL_REFERENCE' : 'BLOCKED',
    selected_candidate_id: overrides.selected_candidate_id || SELECTION_BLOCKED_CANDIDATE_SENTINEL,
    selected_provider_id: isModelSelected ? (overrides.selected_provider_id || null) : null,
    selected_model_id: isModelSelected ? (overrides.selected_model_id || null) : null,
    selected_cost_tier: COST_TIERS.includes(overrides.selected_cost_tier) ? overrides.selected_cost_tier : 'UNKNOWN_BLOCKED',
    estimated_cost_minor_units: isNoLlm ? 0 : (Number.isInteger(overrides.estimated_cost_minor_units) ? overrides.estimated_cost_minor_units : 0),
    deterministic_resolution_selected: isNoLlm,
    fallback_plan_present: overrides.fallback_plan_present === true,
    escalation_plan_present: overrides.escalation_plan_present === true,
    candidate_count: Number.isInteger(overrides.candidate_count) ? overrides.candidate_count : 0,
    eligible_candidate_count: Number.isInteger(overrides.eligible_candidate_count) ? overrides.eligible_candidate_count : 0,
    ineligible_candidate_count: Number.isInteger(overrides.ineligible_candidate_count) ? overrides.ineligible_candidate_count : 0,
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_profile_fingerprint: overrides.task_profile_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    constraints_fingerprint: overrides.constraints_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    ranking_fingerprint: overrides.ranking_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    selected_candidate_fingerprint: overrides.selected_candidate_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    registry_version: overrides.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    selection_evaluated: true,
    model_selected_in_simulation: isModelSelected,
    validator_version: MODEL_SELECTION_DECISION_VALIDATOR_VERSION,
    ...MODEL_SELECTION_DECISION_SAFE_FLAGS
  };
  const validation = validateModelSelectionDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      selected_candidate_id: SELECTION_BLOCKED_CANDIDATE_SENTINEL,
      selected_provider_id: null,
      selected_model_id: null,
      estimated_cost_minor_units: 0,
      deterministic_resolution_selected: false,
      model_selected_in_simulation: false,
      blockers: uniqueSorted([...(decision.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(decision.reason_codes || []), validation.errors[0] || 'model_selection_decision_invalid']),
      ...MODEL_SELECTION_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  DECISION_STATUSES,
  DECISION_VALUES,
  MODEL_SELECTION_DECISION_SAFE_FLAGS,
  MODEL_SELECTION_DECISION_VALIDATOR_VERSION,
  NOT_AVAILABLE_FINGERPRINT,
  SELECTION_BLOCKED_CANDIDATE_SENTINEL,
  SELECTION_DECISION_FIELDS,
  buildModelSelectionDecision,
  validateModelSelectionDecision
};

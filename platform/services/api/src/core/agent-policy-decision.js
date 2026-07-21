'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { validateBudgetDecision } = require('./agent-policy-budget');
const { validateLimitDecision } = require('./agent-policy-limits');

const AGENT_POLICY_DECISION_VALIDATOR_VERSION = 'agent_policy_decision_validator_v1';
const AGENT_POLICY_DECISION_FIELDS = Object.freeze([
  'decision_id',
  'policy_request_id',
  'agent_id',
  'tenant_id',
  'organization_id',
  'status',
  'effect',
  'allowed_in_simulation',
  'approval_required',
  'applicable_policy_ids',
  'applicable_policy_fingerprints',
  'evaluated_rule_ids',
  'evaluated_rule_fingerprints',
  'matched_scopes',
  'blockers',
  'reason_codes',
  'budget_decision',
  'limit_decision',
  'contract_fingerprint',
  'request_fingerprint',
  'decision_fingerprint',
  'policy_registry_version',
  'logical_sequence',
  'policy_evaluated',
  'capability_activated',
  'agent_executed',
  'llm_called',
  'tool_called',
  'memory_read',
  'memory_written',
  'network_used',
  'runtime_mutated',
  'budget_consumed',
  'limit_consumed',
  'executed',
  'runtime_enabled',
  'simulation',
  'production_blocked',
  'rollout_percentage',
  'validator_version'
]);
const DECISION_STATUSES = Object.freeze([
  'ALLOW_SIMULATION', 'DENY', 'REQUIRE_APPROVAL_SIMULATION', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'POLICY_BLOCKED', 'CAPABILITY_BLOCKED', 'LIFECYCLE_BLOCKED', 'RISK_BLOCKED',
  'DATA_BLOCKED', 'CHANNEL_BLOCKED', 'BUDGET_BLOCKED', 'LIMIT_BLOCKED', 'VERSION_BLOCKED',
  'DEPENDENCY_BLOCKED', 'CONFLICT_BLOCKED'
]);
const DECISION_EFFECTS = Object.freeze(['DENY', 'ALLOW_SIMULATION', 'REQUIRE_APPROVAL_SIMULATION']);
const MATCHED_SCOPE_TYPES = Object.freeze(['SUBJECT', 'RESOURCE', 'ACTION', 'RISK', 'DATA', 'CHANNEL']);
const AGENT_POLICY_DECISION_SAFE_FLAGS = Object.freeze({
  policy_evaluated: true,
  capability_activated: false,
  agent_executed: false,
  llm_called: false,
  tool_called: false,
  memory_read: false,
  memory_written: false,
  network_used: false,
  runtime_mutated: false,
  budget_consumed: false,
  limit_consumed: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateAgentPolicyDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['agent_policy_decision_must_be_object'] };
  exactFields(decision, AGENT_POLICY_DECISION_FIELDS, 'agent_policy_decision', errors);
  for (const field of ['decision_id', 'policy_request_id', 'agent_id', 'tenant_id', 'organization_id', 'contract_fingerprint', 'request_fingerprint', 'decision_fingerprint', 'policy_registry_version', 'validator_version']) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_EFFECTS.includes(decision.effect)) errors.push(`effect_not_allowed::${decision.effect}`);
  if (typeof decision.allowed_in_simulation !== 'boolean') errors.push('allowed_in_simulation_must_be_boolean');
  if (typeof decision.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (!isOrderedUniqueStringList(decision.applicable_policy_ids)) errors.push('applicable_policy_ids_invalid');
  if (!isOrderedUniqueStringList(decision.applicable_policy_fingerprints)) errors.push('applicable_policy_fingerprints_invalid');
  if (!isOrderedUniqueStringList(decision.evaluated_rule_ids)) errors.push('evaluated_rule_ids_invalid');
  if (!isOrderedUniqueStringList(decision.evaluated_rule_fingerprints)) errors.push('evaluated_rule_fingerprints_invalid');
  if (!Array.isArray(decision.matched_scopes) || !decision.matched_scopes.every((scope) => MATCHED_SCOPE_TYPES.includes(scope)) || !isOrderedUniqueStringList(decision.matched_scopes)) {
    errors.push('matched_scopes_invalid');
  }
  if (!isOrderedUniqueStringList(decision.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(decision.reason_codes)) errors.push('reason_codes_invalid');
  if (!Number.isInteger(decision.logical_sequence) || decision.logical_sequence < 1) errors.push('logical_sequence_invalid');
  errors.push(...validateBudgetDecision(decision.budget_decision).errors.map((error) => `budget_decision_${error}`));
  errors.push(...validateLimitDecision(decision.limit_decision).errors.map((error) => `limit_decision_${error}`));
  for (const [field, expected] of Object.entries(AGENT_POLICY_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.allowed_in_simulation === true && (decision.status !== 'ALLOW_SIMULATION' || decision.effect !== 'ALLOW_SIMULATION')) {
    errors.push('allowed_in_simulation_inconsistent_with_status_effect');
  }
  if (decision.status === 'DENY' && decision.effect !== 'DENY') errors.push('deny_status_effect_mismatch');
  if (decision.validator_version !== AGENT_POLICY_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildAgentPolicyDecision(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const effect = overrides.effect || 'DENY';
  const allowed = status === 'ALLOW_SIMULATION' && effect === 'ALLOW_SIMULATION' && overrides.allowed_in_simulation === true;
  const decision = {
    decision_id: overrides.decision_id || `agent_policy_decision_${overrides.policy_request_id || 'missing'}`,
    policy_request_id: overrides.policy_request_id || 'policy_request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    status,
    effect,
    allowed_in_simulation: allowed,
    approval_required: overrides.approval_required === true,
    applicable_policy_ids: Array.isArray(overrides.applicable_policy_ids) ? uniqueSorted(overrides.applicable_policy_ids) : [],
    applicable_policy_fingerprints: Array.isArray(overrides.applicable_policy_fingerprints) ? uniqueSorted(overrides.applicable_policy_fingerprints) : [],
    evaluated_rule_ids: Array.isArray(overrides.evaluated_rule_ids) ? uniqueSorted(overrides.evaluated_rule_ids) : [],
    evaluated_rule_fingerprints: Array.isArray(overrides.evaluated_rule_fingerprints) ? uniqueSorted(overrides.evaluated_rule_fingerprints) : [],
    matched_scopes: Array.isArray(overrides.matched_scopes) ? uniqueSorted(overrides.matched_scopes.filter((scope) => MATCHED_SCOPE_TYPES.includes(scope))) : [],
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    budget_decision: overrides.budget_decision,
    limit_decision: overrides.limit_decision,
    contract_fingerprint: overrides.contract_fingerprint || 'contract_fingerprint_not_available',
    request_fingerprint: overrides.request_fingerprint || 'request_fingerprint_not_available',
    decision_fingerprint: overrides.decision_fingerprint || 'decision_fingerprint_not_available',
    policy_registry_version: overrides.policy_registry_version || 'policy_registry_version_not_available',
    logical_sequence: Number.isInteger(overrides.logical_sequence) && overrides.logical_sequence >= 1 ? overrides.logical_sequence : 1,
    validator_version: AGENT_POLICY_DECISION_VALIDATOR_VERSION,
    ...AGENT_POLICY_DECISION_SAFE_FLAGS
  };
  const validation = validateAgentPolicyDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      effect: 'DENY',
      allowed_in_simulation: false,
      approval_required: false,
      blockers: uniqueSorted([...(decision.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(decision.reason_codes || []), validation.errors[0] || 'agent_policy_decision_invalid']),
      budget_decision: isPlainObject(decision.budget_decision) ? decision.budget_decision : {
        within_budget: false, cost_within_limit: false, input_tokens_within_limit: false, output_tokens_within_limit: false,
        total_tokens_within_limit: false, model_calls_within_limit: false, tool_calls_within_limit: false,
        memory_reads_within_limit: false, memory_writes_within_limit: false, network_calls_within_limit: false,
        escalations_within_limit: false, budget_consumed: false, reason_codes: ['budget_decision_not_available'],
        validator_version: 'agent_policy_budget_validator_v1'
      },
      limit_decision: isPlainObject(decision.limit_decision) ? decision.limit_decision : {
        within_limits: false, requests_within_limit: false, concurrency_within_limit: false, duration_within_limit: false,
        payload_within_limit: false, context_references_within_limit: false, dependency_references_within_limit: false,
        policy_evaluations_within_limit: false, limit_consumed: false, reason_codes: ['limit_decision_not_available'],
        validator_version: 'agent_policy_limits_validator_v1'
      },
      ...AGENT_POLICY_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

module.exports = {
  AGENT_POLICY_DECISION_FIELDS,
  AGENT_POLICY_DECISION_SAFE_FLAGS,
  AGENT_POLICY_DECISION_VALIDATOR_VERSION,
  DECISION_EFFECTS,
  DECISION_STATUSES,
  MATCHED_SCOPE_TYPES,
  buildAgentPolicyDecision,
  isOrderedUniqueStringList,
  validateAgentPolicyDecision
};

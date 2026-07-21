'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const AGENT_POLICY_BUDGET_VALIDATOR_VERSION = 'agent_policy_budget_validator_v1';
const BUDGET_POLICY_FIELDS = Object.freeze([
  'budget_policy_id',
  'currency',
  'period_type',
  'maximum_cost_minor_units',
  'maximum_input_tokens',
  'maximum_output_tokens',
  'maximum_total_tokens',
  'maximum_model_calls',
  'maximum_tool_calls',
  'maximum_memory_reads',
  'maximum_memory_writes',
  'maximum_network_calls',
  'maximum_escalations',
  'budget_enforced',
  'budget_consumed',
  'simulation',
  'production_blocked',
  'validator_version'
]);
const BUDGET_REQUEST_FIELDS = Object.freeze([
  'estimated_cost_minor_units',
  'estimated_input_tokens',
  'estimated_output_tokens',
  'estimated_total_tokens',
  'requested_model_calls',
  'requested_tool_calls',
  'requested_memory_reads',
  'requested_memory_writes',
  'requested_network_calls',
  'requested_escalations',
  'validator_version'
]);
const BUDGET_DECISION_FIELDS = Object.freeze([
  'within_budget',
  'cost_within_limit',
  'input_tokens_within_limit',
  'output_tokens_within_limit',
  'total_tokens_within_limit',
  'model_calls_within_limit',
  'tool_calls_within_limit',
  'memory_reads_within_limit',
  'memory_writes_within_limit',
  'network_calls_within_limit',
  'escalations_within_limit',
  'budget_consumed',
  'reason_codes',
  'validator_version'
]);
const PERIOD_TYPES = Object.freeze(['REQUEST', 'SESSION_REFERENCE', 'DAY_REFERENCE', 'MONTH_REFERENCE', 'WORKFLOW_REFERENCE']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const ZERO_THIS_PR_BUDGET_FIELDS = Object.freeze(['maximum_model_calls', 'maximum_tool_calls', 'maximum_memory_reads', 'maximum_memory_writes', 'maximum_network_calls', 'maximum_escalations']);
const ZERO_THIS_PR_REQUEST_FIELDS = Object.freeze(['requested_model_calls', 'requested_tool_calls', 'requested_memory_reads', 'requested_memory_writes', 'requested_network_calls', 'requested_escalations']);

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateBudgetPolicy(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['budget_policy_must_be_object'] };
  exactFields(policy, BUDGET_POLICY_FIELDS, 'budget_policy', errors);
  if (!isNonEmptyString(policy.budget_policy_id)) errors.push('budget_policy_id_invalid');
  if (!CURRENCY_PATTERN.test(policy.currency || '')) errors.push('currency_invalid');
  if (!PERIOD_TYPES.includes(policy.period_type)) errors.push(`period_type_not_allowed::${policy.period_type}`);
  for (const field of ['maximum_cost_minor_units', 'maximum_input_tokens', 'maximum_output_tokens', 'maximum_total_tokens', 'maximum_model_calls', 'maximum_tool_calls', 'maximum_memory_reads', 'maximum_memory_writes', 'maximum_network_calls', 'maximum_escalations']) {
    if (!isNonNegativeInteger(policy[field])) errors.push(`${field}_invalid`);
  }
  if (
    isNonNegativeInteger(policy.maximum_total_tokens) &&
    isNonNegativeInteger(policy.maximum_input_tokens) &&
    isNonNegativeInteger(policy.maximum_output_tokens) &&
    policy.maximum_total_tokens < Math.max(policy.maximum_input_tokens, policy.maximum_output_tokens)
  ) {
    errors.push('maximum_total_tokens_below_component_limit');
  }
  for (const field of ZERO_THIS_PR_BUDGET_FIELDS) {
    if (policy[field] !== 0) errors.push(`${field}_must_be_zero_this_pr`);
  }
  if (policy.budget_enforced !== true) errors.push('budget_enforced_must_be_true');
  if (policy.budget_consumed !== false) errors.push('budget_consumed_must_be_false');
  if (policy.simulation !== true) errors.push('simulation_must_be_true');
  if (policy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (policy.validator_version !== AGENT_POLICY_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateBudgetRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['budget_request_must_be_object'] };
  exactFields(request, BUDGET_REQUEST_FIELDS, 'budget_request', errors);
  for (const field of ['estimated_cost_minor_units', 'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'requested_model_calls', 'requested_tool_calls', 'requested_memory_reads', 'requested_memory_writes', 'requested_network_calls', 'requested_escalations']) {
    if (!isNonNegativeInteger(request[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ZERO_THIS_PR_REQUEST_FIELDS) {
    if (request[field] !== 0) errors.push(`${field}_must_be_zero_this_pr`);
  }
  if (request.validator_version !== AGENT_POLICY_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateBudgetDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['budget_decision_must_be_object'] };
  exactFields(decision, BUDGET_DECISION_FIELDS, 'budget_decision', errors);
  for (const field of ['within_budget', 'cost_within_limit', 'input_tokens_within_limit', 'output_tokens_within_limit', 'total_tokens_within_limit', 'model_calls_within_limit', 'tool_calls_within_limit', 'memory_reads_within_limit', 'memory_writes_within_limit', 'network_calls_within_limit', 'escalations_within_limit']) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Array.isArray(decision.reason_codes) || !decision.reason_codes.every(isNonEmptyString)) errors.push('reason_codes_invalid');
  if (decision.budget_consumed !== false) errors.push('budget_consumed_must_be_false');
  if (decision.validator_version !== AGENT_POLICY_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function evaluateBudget(policy, request) {
  const policyValidation = validateBudgetPolicy(policy);
  const requestValidation = validateBudgetRequest(request);
  if (!policyValidation.valid || !requestValidation.valid) {
    return cloneFrozen({
      within_budget: false,
      cost_within_limit: false,
      input_tokens_within_limit: false,
      output_tokens_within_limit: false,
      total_tokens_within_limit: false,
      model_calls_within_limit: false,
      tool_calls_within_limit: false,
      memory_reads_within_limit: false,
      memory_writes_within_limit: false,
      network_calls_within_limit: false,
      escalations_within_limit: false,
      budget_consumed: false,
      reason_codes: uniqueSorted(['budget_policy_or_request_invalid', ...policyValidation.errors, ...requestValidation.errors]),
      validator_version: AGENT_POLICY_BUDGET_VALIDATOR_VERSION
    });
  }
  const costWithin = request.estimated_cost_minor_units <= policy.maximum_cost_minor_units;
  const inputWithin = request.estimated_input_tokens <= policy.maximum_input_tokens;
  const outputWithin = request.estimated_output_tokens <= policy.maximum_output_tokens;
  const totalWithin = request.estimated_total_tokens <= policy.maximum_total_tokens;
  const modelWithin = request.requested_model_calls <= policy.maximum_model_calls;
  const toolWithin = request.requested_tool_calls <= policy.maximum_tool_calls;
  const memoryReadsWithin = request.requested_memory_reads <= policy.maximum_memory_reads;
  const memoryWritesWithin = request.requested_memory_writes <= policy.maximum_memory_writes;
  const networkWithin = request.requested_network_calls <= policy.maximum_network_calls;
  const escalationsWithin = request.requested_escalations <= policy.maximum_escalations;
  const reasonCodes = [];
  if (!costWithin) reasonCodes.push('budget_cost_exceeded');
  if (!inputWithin) reasonCodes.push('budget_input_tokens_exceeded');
  if (!outputWithin) reasonCodes.push('budget_output_tokens_exceeded');
  if (!totalWithin) reasonCodes.push('budget_total_tokens_exceeded');
  if (!modelWithin) reasonCodes.push('budget_model_calls_exceeded');
  if (!toolWithin) reasonCodes.push('budget_tool_calls_exceeded');
  if (!memoryReadsWithin) reasonCodes.push('budget_memory_reads_exceeded');
  if (!memoryWritesWithin) reasonCodes.push('budget_memory_writes_exceeded');
  if (!networkWithin) reasonCodes.push('budget_network_calls_exceeded');
  if (!escalationsWithin) reasonCodes.push('budget_escalations_exceeded');
  const withinBudget = reasonCodes.length === 0;
  return cloneFrozen({
    within_budget: withinBudget,
    cost_within_limit: costWithin,
    input_tokens_within_limit: inputWithin,
    output_tokens_within_limit: outputWithin,
    total_tokens_within_limit: totalWithin,
    model_calls_within_limit: modelWithin,
    tool_calls_within_limit: toolWithin,
    memory_reads_within_limit: memoryReadsWithin,
    memory_writes_within_limit: memoryWritesWithin,
    network_calls_within_limit: networkWithin,
    escalations_within_limit: escalationsWithin,
    budget_consumed: false,
    reason_codes: uniqueSorted(reasonCodes),
    validator_version: AGENT_POLICY_BUDGET_VALIDATOR_VERSION
  });
}

module.exports = {
  AGENT_POLICY_BUDGET_VALIDATOR_VERSION,
  BUDGET_DECISION_FIELDS,
  BUDGET_POLICY_FIELDS,
  BUDGET_REQUEST_FIELDS,
  PERIOD_TYPES,
  evaluateBudget,
  validateBudgetDecision,
  validateBudgetPolicy,
  validateBudgetRequest
};

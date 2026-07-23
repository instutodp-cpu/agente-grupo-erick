'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLAN_BUDGET_VALIDATOR_VERSION = 'orchestrator_plan_budget_validator_v1';

const ORCHESTRATOR_PLAN_BUDGET_FIELDS = Object.freeze([
  'plan_budget_id', 'maximum_total_tokens', 'maximum_input_tokens', 'maximum_output_tokens',
  'maximum_total_cost_minor_units', 'maximum_model_stages', 'maximum_tool_stages', 'maximum_workflow_stages',
  'maximum_parallel_stages', 'maximum_fallbacks', 'maximum_escalations', 'reserved_memory_tokens',
  'reserved_context_tokens', 'reserved_output_tokens', 'budget_enforced', 'budget_consumed', 'simulation',
  'production_blocked', 'validator_version'
]);

const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_total_tokens', 'maximum_input_tokens', 'maximum_output_tokens', 'maximum_total_cost_minor_units',
  'maximum_model_stages', 'maximum_tool_stages', 'maximum_workflow_stages', 'maximum_parallel_stages',
  'maximum_fallbacks', 'maximum_escalations', 'reserved_memory_tokens', 'reserved_context_tokens',
  'reserved_output_tokens'
]);

const RESERVED_TOKEN_FIELDS = Object.freeze(['reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens']);
const PROTECTED_RESERVED_TOKEN_FIELDS = Object.freeze(['reserved_memory_tokens']);

const ORCHESTRATOR_PLAN_BUDGET_SAFE_FLAGS = Object.freeze({
  budget_enforced: true,
  budget_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_TOKEN_BOUND = 1000000000;

function validateOrchestratorPlanBudget(budget) {
  const errors = [];
  if (!isPlainObject(budget)) return { valid: false, errors: ['plan_budget_must_be_object'] };
  exactFields(budget, ORCHESTRATOR_PLAN_BUDGET_FIELDS, 'plan_budget', errors);
  for (const field of ['plan_budget_id', 'validator_version']) {
    if (!isNonEmptyString(budget[field])) errors.push(`${field}_invalid`);
  }
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!Number.isInteger(budget[field]) || budget[field] < 0 || budget[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLAN_BUDGET_SAFE_FLAGS)) {
    if (budget[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (RESERVED_TOKEN_FIELDS.every((field) => Number.isInteger(budget[field])) && Number.isInteger(budget.maximum_total_tokens)) {
    const reservedSum = RESERVED_TOKEN_FIELDS.reduce((sum, field) => sum + budget[field], 0);
    if (reservedSum > budget.maximum_total_tokens) errors.push('reserved_tokens_exceed_maximum_total_tokens');
  }
  if (budget.validator_version !== ORCHESTRATOR_PLAN_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(budget);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(budget));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_TOKEN_BOUND,
  NON_NEGATIVE_INTEGER_FIELDS,
  ORCHESTRATOR_PLAN_BUDGET_FIELDS,
  ORCHESTRATOR_PLAN_BUDGET_SAFE_FLAGS,
  ORCHESTRATOR_PLAN_BUDGET_VALIDATOR_VERSION,
  PROTECTED_RESERVED_TOKEN_FIELDS,
  RESERVED_TOKEN_FIELDS,
  validateOrchestratorPlanBudget
};

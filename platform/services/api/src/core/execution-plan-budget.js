'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_BUDGET_VALIDATOR_VERSION = 'execution_plan_budget_validator_v1';

const EXECUTION_PLAN_BUDGET_FIELDS = Object.freeze([
  'execution_budget_id', 'execution_budget_version', 'execution_plan_id', 'budget_authorization_id',
  'maximum_total_tokens', 'estimated_total_tokens', 'maximum_input_tokens', 'estimated_input_tokens',
  'maximum_output_tokens', 'estimated_output_tokens', 'maximum_total_cost_minor_units',
  'estimated_total_cost_minor_units', 'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens',
  'maximum_model_stages', 'maximum_tool_stages', 'maximum_workflow_stages', 'maximum_parallel_stages',
  'maximum_attempts_reference', 'tokens_within_limit', 'cost_within_limit', 'protected_reservations_preserved',
  'budget_validated', 'budget_consumed', 'budget_fingerprint', 'simulation', 'production_blocked', 'validator_version'
]);

const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_total_tokens', 'estimated_total_tokens', 'maximum_input_tokens', 'estimated_input_tokens',
  'maximum_output_tokens', 'estimated_output_tokens', 'maximum_total_cost_minor_units',
  'estimated_total_cost_minor_units', 'reserved_memory_tokens', 'reserved_context_tokens', 'reserved_output_tokens',
  'maximum_model_stages', 'maximum_tool_stages', 'maximum_workflow_stages', 'maximum_parallel_stages'
]);

const LIMIT_FLAG_FIELDS = Object.freeze(['tokens_within_limit', 'cost_within_limit', 'protected_reservations_preserved']);

const EXECUTION_PLAN_BUDGET_SAFE_FLAGS = Object.freeze({
  budget_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_TOKEN_BOUND = 1000000000;
const MAX_STAGE_CAP = 100000;

function validateExecutionPlanBudget(budget) {
  const errors = [];
  if (!isPlainObject(budget)) return { valid: false, errors: ['execution_plan_budget_must_be_object'] };
  exactFields(budget, EXECUTION_PLAN_BUDGET_FIELDS, 'execution_plan_budget', errors);
  for (const field of ['execution_budget_id', 'execution_plan_id', 'budget_authorization_id', 'budget_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(budget[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(budget.execution_budget_version) || budget.execution_budget_version < 1) errors.push('execution_budget_version_invalid');
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    const bound = field.startsWith('maximum_') && field.endsWith('_stages') ? MAX_STAGE_CAP : MAX_TOKEN_BOUND;
    if (!Number.isInteger(budget[field]) || budget[field] < 0 || budget[field] > bound) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(budget.maximum_attempts_reference) || budget.maximum_attempts_reference < 1) errors.push('maximum_attempts_reference_invalid');
  for (const field of LIMIT_FLAG_FIELDS) {
    if (typeof budget[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof budget.budget_validated !== 'boolean') errors.push('budget_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_BUDGET_SAFE_FLAGS)) {
    if (budget[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (LIMIT_FLAG_FIELDS.every((field) => typeof budget[field] === 'boolean')) {
    const expectedValidated = LIMIT_FLAG_FIELDS.every((field) => budget[field] === true);
    if (budget.budget_validated !== expectedValidated) errors.push('budget_validated_inconsistent_with_limit_flags');
  }

  if (budget.validator_version !== EXECUTION_PLAN_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(budget);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(budget));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeExecutionPlanBudgetFingerprint(budget) {
  const { budget_fingerprint, ...rest } = budget;
  return stablePayload(rest);
}

function buildExecutionPlanBudget(input = {}) {
  const tokensWithinLimit = Number.isInteger(input.estimated_total_tokens) && Number.isInteger(input.maximum_total_tokens) &&
    input.estimated_total_tokens <= input.maximum_total_tokens;
  const costWithinLimit = Number.isInteger(input.estimated_total_cost_minor_units) && Number.isInteger(input.maximum_total_cost_minor_units) &&
    input.estimated_total_cost_minor_units <= input.maximum_total_cost_minor_units;
  const reservedSum = (input.reserved_memory_tokens || 0) + (input.reserved_context_tokens || 0) + (input.reserved_output_tokens || 0);
  const protectedReservationsPreserved = Number.isInteger(input.maximum_total_tokens) && reservedSum <= input.maximum_total_tokens;
  const budgetValidated = tokensWithinLimit && costWithinLimit && protectedReservationsPreserved;

  const budget = {
    execution_budget_id: input.execution_budget_id,
    execution_budget_version: Number.isInteger(input.execution_budget_version) ? input.execution_budget_version : 1,
    execution_plan_id: input.execution_plan_id,
    budget_authorization_id: input.budget_authorization_id,
    maximum_total_tokens: input.maximum_total_tokens,
    estimated_total_tokens: input.estimated_total_tokens,
    maximum_input_tokens: input.maximum_input_tokens,
    estimated_input_tokens: input.estimated_input_tokens,
    maximum_output_tokens: input.maximum_output_tokens,
    estimated_output_tokens: input.estimated_output_tokens,
    maximum_total_cost_minor_units: input.maximum_total_cost_minor_units,
    estimated_total_cost_minor_units: input.estimated_total_cost_minor_units,
    reserved_memory_tokens: input.reserved_memory_tokens,
    reserved_context_tokens: input.reserved_context_tokens,
    reserved_output_tokens: input.reserved_output_tokens,
    maximum_model_stages: input.maximum_model_stages,
    maximum_tool_stages: input.maximum_tool_stages,
    maximum_workflow_stages: input.maximum_workflow_stages,
    maximum_parallel_stages: input.maximum_parallel_stages,
    maximum_attempts_reference: Number.isInteger(input.maximum_attempts_reference) ? input.maximum_attempts_reference : 1,
    tokens_within_limit: tokensWithinLimit,
    cost_within_limit: costWithinLimit,
    protected_reservations_preserved: protectedReservationsPreserved,
    budget_validated: budgetValidated,
    budget_consumed: false,
    simulation: true,
    production_blocked: true,
    validator_version: EXECUTION_PLAN_BUDGET_VALIDATOR_VERSION
  };
  budget.budget_fingerprint = computeExecutionPlanBudgetFingerprint({ ...budget, budget_fingerprint: undefined });

  const validation = validateExecutionPlanBudget(budget);
  if (!validation.valid) {
    throw new Error(`execution_plan_budget_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(budget);
}

module.exports = {
  EXECUTION_PLAN_BUDGET_FIELDS,
  EXECUTION_PLAN_BUDGET_SAFE_FLAGS,
  EXECUTION_PLAN_BUDGET_VALIDATOR_VERSION,
  LIMIT_FLAG_FIELDS,
  MAX_STAGE_CAP,
  MAX_TOKEN_BOUND,
  NON_NEGATIVE_INTEGER_FIELDS,
  buildExecutionPlanBudget,
  computeExecutionPlanBudgetFingerprint,
  validateExecutionPlanBudget
};

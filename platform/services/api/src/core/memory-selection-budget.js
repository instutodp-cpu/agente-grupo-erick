'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MEMORY_SELECTION_BUDGET_VALIDATOR_VERSION = 'memory_selection_budget_validator_v1';

const MEMORY_SELECTION_BUDGET_FIELDS = Object.freeze([
  'budget_id', 'maximum_total_tokens', 'reserved_preference_tokens', 'reserved_project_state_tokens',
  'reserved_continuity_tokens', 'reserved_required_memory_tokens', 'reserved_relevant_memory_tokens',
  'reserved_optional_memory_tokens', 'reserved_output_tokens', 'budget_enforced', 'budget_consumed',
  'overflow_strategy', 'simulation', 'production_blocked', 'validator_version'
]);

const RESERVED_TOKEN_FIELDS = Object.freeze([
  'reserved_preference_tokens', 'reserved_project_state_tokens', 'reserved_continuity_tokens',
  'reserved_required_memory_tokens', 'reserved_relevant_memory_tokens', 'reserved_optional_memory_tokens',
  'reserved_output_tokens'
]);

const PROTECTED_RESERVED_TOKEN_FIELDS = Object.freeze([
  'reserved_preference_tokens', 'reserved_project_state_tokens', 'reserved_continuity_tokens',
  'reserved_required_memory_tokens'
]);

const OVERFLOW_STRATEGIES = Object.freeze([
  'BLOCK', 'DROP_OPTIONAL', 'DROP_LOWEST_PRIORITY_RELEVANT', 'REQUIRE_HIERARCHICAL_SUMMARY', 'REQUIRE_REASSEMBLY'
]);

const MEMORY_SELECTION_BUDGET_SAFE_FLAGS = Object.freeze({
  budget_enforced: true,
  budget_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_TOKEN_BOUND = 1000000000;

function validateSelectionBudget(budget) {
  const errors = [];
  if (!isPlainObject(budget)) return { valid: false, errors: ['selection_budget_must_be_object'] };
  exactFields(budget, MEMORY_SELECTION_BUDGET_FIELDS, 'selection_budget', errors);
  for (const field of ['budget_id', 'validator_version']) {
    if (!isNonEmptyString(budget[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(budget.maximum_total_tokens) || budget.maximum_total_tokens < 0 || budget.maximum_total_tokens > MAX_TOKEN_BOUND) {
    errors.push('maximum_total_tokens_invalid');
  }
  for (const field of RESERVED_TOKEN_FIELDS) {
    if (!Number.isInteger(budget[field]) || budget[field] < 0 || budget[field] > MAX_TOKEN_BOUND) errors.push(`${field}_invalid`);
  }
  if (!OVERFLOW_STRATEGIES.includes(budget.overflow_strategy)) errors.push(`overflow_strategy_not_allowed::${budget.overflow_strategy}`);
  for (const [field, expected] of Object.entries(MEMORY_SELECTION_BUDGET_SAFE_FLAGS)) {
    if (budget[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (RESERVED_TOKEN_FIELDS.every((field) => Number.isInteger(budget[field])) && Number.isInteger(budget.maximum_total_tokens)) {
    const reservedSum = RESERVED_TOKEN_FIELDS.reduce((sum, field) => sum + budget[field], 0);
    if (reservedSum > budget.maximum_total_tokens) errors.push('reserved_tokens_exceed_maximum_total_tokens');
  }
  if (budget.validator_version !== MEMORY_SELECTION_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
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
  MEMORY_SELECTION_BUDGET_FIELDS,
  MEMORY_SELECTION_BUDGET_SAFE_FLAGS,
  MEMORY_SELECTION_BUDGET_VALIDATOR_VERSION,
  OVERFLOW_STRATEGIES,
  PROTECTED_RESERVED_TOKEN_FIELDS,
  RESERVED_TOKEN_FIELDS,
  validateSelectionBudget
};

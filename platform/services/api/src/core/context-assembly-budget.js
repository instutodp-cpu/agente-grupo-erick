'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const CONTEXT_ASSEMBLY_BUDGET_VALIDATOR_VERSION = 'context_assembly_budget_validator_v1';
const CONTEXT_BUDGET_FIELDS = Object.freeze([
  'context_budget_id', 'maximum_total_tokens', 'reserved_system_tokens', 'reserved_agent_tokens',
  'reserved_policy_tokens', 'reserved_session_tokens', 'reserved_memory_tokens', 'reserved_task_tokens',
  'reserved_user_input_tokens', 'reserved_document_tokens', 'reserved_tool_result_tokens',
  'reserved_workflow_tokens', 'reserved_audit_tokens', 'reserved_output_tokens', 'budget_enforced',
  'budget_consumed', 'overflow_strategy', 'simulation', 'production_blocked', 'validator_version'
]);
const RESERVED_TOKEN_FIELDS = Object.freeze([
  'reserved_system_tokens', 'reserved_agent_tokens', 'reserved_policy_tokens', 'reserved_session_tokens',
  'reserved_memory_tokens', 'reserved_task_tokens', 'reserved_user_input_tokens', 'reserved_document_tokens',
  'reserved_tool_result_tokens', 'reserved_workflow_tokens', 'reserved_audit_tokens', 'reserved_output_tokens'
]);
const OVERFLOW_STRATEGIES = Object.freeze(['BLOCK', 'DROP_LOWEST_PRIORITY_OPTIONAL', 'TRIM_OPTIONAL_REFERENCES', 'REQUIRE_REASSEMBLY']);
const MAX_TOKENS_REFERENCE = 100000000;

function validateContextBudget(budget) {
  const errors = [];
  if (!isPlainObject(budget)) return { valid: false, errors: ['context_budget_must_be_object'] };
  exactFields(budget, CONTEXT_BUDGET_FIELDS, 'context_budget', errors);
  for (const field of ['context_budget_id', 'validator_version']) {
    if (!isNonEmptyString(budget[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(budget.maximum_total_tokens) || budget.maximum_total_tokens < 0 || budget.maximum_total_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('maximum_total_tokens_invalid');
  }
  for (const field of RESERVED_TOKEN_FIELDS) {
    if (!Number.isInteger(budget[field]) || budget[field] < 0 || budget[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(budget.maximum_total_tokens) &&
    RESERVED_TOKEN_FIELDS.every((field) => Number.isInteger(budget[field]))
  ) {
    const reservedSum = RESERVED_TOKEN_FIELDS.reduce((sum, field) => sum + budget[field], 0);
    if (reservedSum > budget.maximum_total_tokens) errors.push('reserved_tokens_exceed_maximum_total_tokens');
  }
  if (!OVERFLOW_STRATEGIES.includes(budget.overflow_strategy)) errors.push(`overflow_strategy_not_allowed::${budget.overflow_strategy}`);
  if (budget.budget_enforced !== true) errors.push('budget_enforced_must_be_true');
  if (budget.budget_consumed !== false) errors.push('budget_consumed_must_be_false');
  if (budget.simulation !== true) errors.push('simulation_must_be_true');
  if (budget.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (budget.validator_version !== CONTEXT_ASSEMBLY_BUDGET_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(budget);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(budget));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTEXT_ASSEMBLY_BUDGET_VALIDATOR_VERSION,
  CONTEXT_BUDGET_FIELDS,
  MAX_TOKENS_REFERENCE,
  OVERFLOW_STRATEGIES,
  RESERVED_TOKEN_FIELDS,
  validateContextBudget
};

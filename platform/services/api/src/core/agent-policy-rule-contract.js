'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const AGENT_POLICY_RULE_VALIDATOR_VERSION = 'agent_policy_rule_validator_v1';
const AGENT_POLICY_RULE_FIELDS = Object.freeze([
  'rule_id',
  'rule_version',
  'policy_id',
  'rule_type',
  'rule_operator',
  'left_operand_reference',
  'right_operand_reference',
  'expected_result',
  'failure_effect',
  'reason_code',
  'rule_status',
  'validator_version'
]);
const RULE_TYPES = Object.freeze([
  'TENANT_MATCH', 'ORGANIZATION_MATCH', 'AGENT_MATCH', 'AGENT_TYPE_MATCH', 'ACTOR_TYPE_MATCH',
  'ACTOR_ROLE_MATCH', 'CAPABILITY_MATCH', 'LIFECYCLE_MATCH', 'CHANNEL_MATCH', 'RISK_LIMIT',
  'DATA_LIMIT', 'BUDGET_LIMIT', 'TOKEN_LIMIT', 'COST_LIMIT', 'RATE_LIMIT', 'CONCURRENCY_LIMIT',
  'TIME_LIMIT', 'APPROVAL_REQUIRED', 'DEPENDENCY_PRESENT', 'VERSION_MATCH', 'SIMULATION_REQUIRED',
  'PRODUCTION_BLOCKED_REQUIRED'
]);
const RULE_OPERATORS = Object.freeze([
  'EQUALS', 'NOT_EQUALS', 'IN', 'NOT_IN', 'LESS_THAN', 'LESS_THAN_OR_EQUAL',
  'GREATER_THAN', 'GREATER_THAN_OR_EQUAL', 'BOOLEAN_IS', 'REFERENCE_PRESENT', 'VERSION_COMPATIBLE'
]);
const RULE_FAILURE_EFFECTS = Object.freeze(['DENY', 'REQUIRE_APPROVAL_SIMULATION', 'POLICY_BLOCKED', 'TENANT_BLOCKED', 'VERSION_BLOCKED', 'BUDGET_BLOCKED', 'LIMIT_BLOCKED']);
const RULE_STATUSES = Object.freeze(['VALIDATED_SIMULATION', 'INVALID', 'SUSPENDED', 'ARCHIVED']);
const OPERAND_REFERENCE_PATTERN = /^[A-Z][A-Z0-9_]*(\.[A-Z][A-Z0-9_]*)*$/;

function isValidExpectedResult(value) {
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 50 && value.every((item) => isNonEmptyString(item));
  return false;
}

function validateAgentPolicyRule(rule) {
  const errors = [];
  if (!isPlainObject(rule)) return { valid: false, errors: ['agent_policy_rule_must_be_object'] };
  exactFields(rule, AGENT_POLICY_RULE_FIELDS, 'agent_policy_rule', errors);
  for (const field of ['rule_id', 'policy_id', 'left_operand_reference', 'right_operand_reference', 'reason_code', 'validator_version']) {
    if (!isNonEmptyString(rule[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(rule.rule_version) || rule.rule_version < 1) errors.push('rule_version_invalid');
  if (!RULE_TYPES.includes(rule.rule_type)) errors.push(`rule_type_not_allowed::${rule.rule_type}`);
  if (!RULE_OPERATORS.includes(rule.rule_operator)) errors.push(`rule_operator_not_allowed::${rule.rule_operator}`);
  if (!RULE_FAILURE_EFFECTS.includes(rule.failure_effect)) errors.push(`failure_effect_not_allowed::${rule.failure_effect}`);
  if (!RULE_STATUSES.includes(rule.rule_status)) errors.push(`rule_status_not_allowed::${rule.rule_status}`);
  if (isNonEmptyString(rule.left_operand_reference) && !OPERAND_REFERENCE_PATTERN.test(rule.left_operand_reference)) errors.push('left_operand_reference_invalid_format');
  if (isNonEmptyString(rule.right_operand_reference) && !OPERAND_REFERENCE_PATTERN.test(rule.right_operand_reference)) errors.push('right_operand_reference_invalid_format');
  if (!isValidExpectedResult(rule.expected_result)) errors.push('expected_result_invalid');
  if (rule.validator_version !== AGENT_POLICY_RULE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(rule);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(rule));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function applyRuleOperator(operator, left, right) {
  switch (operator) {
    case 'EQUALS': return left === right;
    case 'NOT_EQUALS': return left !== right;
    case 'IN': return Array.isArray(right) && right.includes(left);
    case 'NOT_IN': return Array.isArray(right) && !right.includes(left);
    case 'LESS_THAN': return typeof left === 'number' && typeof right === 'number' && left < right;
    case 'LESS_THAN_OR_EQUAL': return typeof left === 'number' && typeof right === 'number' && left <= right;
    case 'GREATER_THAN': return typeof left === 'number' && typeof right === 'number' && left > right;
    case 'GREATER_THAN_OR_EQUAL': return typeof left === 'number' && typeof right === 'number' && left >= right;
    case 'BOOLEAN_IS': return typeof left === 'boolean' && left === right;
    case 'REFERENCE_PRESENT': return (isNonEmptyString(left) || (Array.isArray(left) && left.length > 0));
    case 'VERSION_COMPATIBLE': return Number.isInteger(left) && Number.isInteger(right) && left === right;
    default: return false;
  }
}

function evaluateAgentPolicyRule(rule, resolvedLeft, resolvedRight) {
  const validation = validateAgentPolicyRule(rule);
  if (!validation.valid) {
    return { passed: false, errors: validation.errors, reason_code: 'rule_invalid', failure_effect: 'POLICY_BLOCKED' };
  }
  const actual = applyRuleOperator(rule.rule_operator, resolvedLeft, resolvedRight);
  const passed = actual === rule.expected_result;
  return {
    passed,
    errors: [],
    reason_code: passed ? null : rule.reason_code,
    failure_effect: passed ? null : rule.failure_effect
  };
}

module.exports = {
  AGENT_POLICY_RULE_FIELDS,
  AGENT_POLICY_RULE_VALIDATOR_VERSION,
  OPERAND_REFERENCE_PATTERN,
  RULE_FAILURE_EFFECTS,
  RULE_OPERATORS,
  RULE_STATUSES,
  RULE_TYPES,
  applyRuleOperator,
  evaluateAgentPolicyRule,
  isValidExpectedResult,
  validateAgentPolicyRule
};

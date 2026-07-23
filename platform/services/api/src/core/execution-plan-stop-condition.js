'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_STOP_CONDITION_VALIDATOR_VERSION = 'execution_plan_stop_condition_validator_v1';

const EXECUTION_PLAN_STOP_CONDITION_FIELDS = Object.freeze([
  'stop_condition_id', 'stop_condition_version', 'execution_plan_id', 'execution_stage_id', 'condition_type',
  'condition_priority', 'blocking', 'terminal', 'evaluation_reference_id', 'condition_evaluated',
  'condition_triggered', 'stop_applied', 'reason_codes', 'condition_fingerprint', 'validator_version'
]);

const CONDITION_TYPES = Object.freeze([
  'POLICY_DENY_REFERENCE', 'APPROVAL_DENIED_REFERENCE', 'BUDGET_EXCEEDED_REFERENCE', 'TOKEN_LIMIT_REFERENCE',
  'COST_LIMIT_REFERENCE', 'DEPENDENCY_FAILURE_REFERENCE', 'TOOL_FAILURE_REFERENCE', 'WORKFLOW_FAILURE_REFERENCE',
  'MODEL_FAILURE_REFERENCE', 'VALIDATION_FAILURE_REFERENCE', 'TIMEOUT_REFERENCE', 'RETRY_LIMIT_REFERENCE',
  'HUMAN_STOP_REFERENCE', 'SAFETY_BLOCK_REFERENCE', 'RISK_ESCALATION_REFERENCE', 'SUCCESS_REFERENCE'
]);

// No stop condition is ever evaluated by this PR -- only declared for a future evaluator.
const EXECUTION_PLAN_STOP_CONDITION_SAFE_FLAGS = Object.freeze({
  condition_evaluated: false,
  condition_triggered: false,
  stop_applied: false
});

const MAX_PRIORITY = 1000000;
const MAX_LIST_ITEMS = 50;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionPlanStopCondition(condition) {
  const errors = [];
  if (!isPlainObject(condition)) return { valid: false, errors: ['execution_plan_stop_condition_must_be_object'] };
  exactFields(condition, EXECUTION_PLAN_STOP_CONDITION_FIELDS, 'execution_plan_stop_condition', errors);
  for (const field of ['stop_condition_id', 'execution_plan_id', 'execution_stage_id', 'evaluation_reference_id', 'condition_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(condition[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(condition.stop_condition_version) || condition.stop_condition_version < 1) errors.push('stop_condition_version_invalid');
  if (!CONDITION_TYPES.includes(condition.condition_type)) errors.push(`condition_type_not_allowed::${condition.condition_type}`);
  if (!Number.isInteger(condition.condition_priority) || condition.condition_priority < 0 || condition.condition_priority > MAX_PRIORITY) {
    errors.push('condition_priority_invalid');
  }
  for (const field of ['blocking', 'terminal']) {
    if (typeof condition[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueStringList(condition.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_STOP_CONDITION_SAFE_FLAGS)) {
    if (condition[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (condition.validator_version !== EXECUTION_PLAN_STOP_CONDITION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(condition);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(condition));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeStopConditionFingerprint(condition) {
  const { condition_fingerprint, ...rest } = condition;
  return stablePayload(rest);
}

function buildExecutionPlanStopCondition(input = {}) {
  const condition = {
    stop_condition_id: input.stop_condition_id,
    stop_condition_version: Number.isInteger(input.stop_condition_version) ? input.stop_condition_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_stage_id: input.execution_stage_id,
    condition_type: input.condition_type,
    condition_priority: Number.isInteger(input.condition_priority) ? input.condition_priority : 0,
    blocking: input.blocking === true,
    terminal: input.terminal === true,
    evaluation_reference_id: input.evaluation_reference_id,
    condition_evaluated: false,
    condition_triggered: false,
    stop_applied: false,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    validator_version: EXECUTION_PLAN_STOP_CONDITION_VALIDATOR_VERSION
  };
  condition.condition_fingerprint = computeStopConditionFingerprint({ ...condition, condition_fingerprint: undefined });

  const validation = validateExecutionPlanStopCondition(condition);
  if (!validation.valid) {
    throw new Error(`execution_plan_stop_condition_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(condition);
}

module.exports = {
  CONDITION_TYPES,
  EXECUTION_PLAN_STOP_CONDITION_FIELDS,
  EXECUTION_PLAN_STOP_CONDITION_SAFE_FLAGS,
  EXECUTION_PLAN_STOP_CONDITION_VALIDATOR_VERSION,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  buildExecutionPlanStopCondition,
  computeStopConditionFingerprint,
  isOrderedUniqueStringList,
  validateExecutionPlanStopCondition
};

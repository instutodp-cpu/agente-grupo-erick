'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_CONDITION_CONTRACT_VALIDATOR_VERSION = 'workflow_condition_contract_validator_v1';
const WORKFLOW_CONDITION_FIELDS = Object.freeze([
  'condition_id', 'condition_type', 'simulation', 'production_blocked', 'validator_version'
]);
const WORKFLOW_CONDITION_TYPES = Object.freeze([
  'IF_REFERENCE', 'ELSE_REFERENCE', 'SWITCH_REFERENCE', 'ALWAYS_REFERENCE', 'NEVER_REFERENCE'
]);
const MAX_CONDITIONS = 50;

function validateWorkflowCondition(condition) {
  const errors = [];
  if (!isPlainObject(condition)) return { valid: false, errors: ['condition_must_be_object'] };
  exactFields(condition, WORKFLOW_CONDITION_FIELDS, 'condition', errors);
  for (const field of ['condition_id', 'validator_version']) {
    if (!isNonEmptyString(condition[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_CONDITION_TYPES.includes(condition.condition_type)) errors.push(`condition_type_not_allowed::${condition.condition_type}`);
  if (condition.simulation !== true) errors.push('simulation_must_be_true');
  if (condition.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (condition.validator_version !== WORKFLOW_CONDITION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(condition);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(condition));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateWorkflowConditionList(conditions, label) {
  const errors = [];
  if (!Array.isArray(conditions) || conditions.length > MAX_CONDITIONS) {
    return [`${label}_must_be_array`];
  }
  const seenIds = new Set();
  conditions.forEach((condition, index) => {
    const validation = validateWorkflowCondition(condition);
    errors.push(...validation.errors.map((error) => `${label}[${index}]_${error}`));
    if (isPlainObject(condition) && isNonEmptyString(condition.condition_id)) {
      if (seenIds.has(condition.condition_id)) errors.push(`${label}_duplicate::${condition.condition_id}`);
      seenIds.add(condition.condition_id);
    }
  });
  return errors;
}

module.exports = {
  MAX_CONDITIONS,
  WORKFLOW_CONDITION_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_CONDITION_FIELDS,
  WORKFLOW_CONDITION_TYPES,
  validateWorkflowCondition,
  validateWorkflowConditionList
};

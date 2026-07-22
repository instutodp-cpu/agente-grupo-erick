'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateSingleReference } = require('./model-contract');
const { TOOL_CAPABILITIES } = require('./tool-capability-contract');
const { validateWorkflowDependencyList } = require('./workflow-dependency-contract');
const { validateWorkflowTimeoutContract } = require('./workflow-timeout-contract');
const { validateWorkflowRetryContract } = require('./workflow-retry-contract');
const { validateWorkflowCompensationContract } = require('./workflow-compensation-contract');

const WORKFLOW_STEP_CONTRACT_VALIDATOR_VERSION = 'workflow_step_contract_validator_v1';
const WORKFLOW_STEP_FIELDS = Object.freeze([
  'step_id', 'step_version', 'step_type', 'required_capabilities', 'tool_reference', 'model_reference',
  'context_reference', 'depends_on', 'priority', 'parallelizable', 'optional', 'approval_required',
  'timeout_reference', 'retry_reference', 'compensation_reference', 'estimated_cost_minor_units',
  'estimated_duration_ms', 'simulation', 'production_blocked', 'validator_version'
]);
const WORKFLOW_STEP_TYPES = Object.freeze([
  'SYSTEM_REFERENCE', 'MODEL_REFERENCE', 'TOOL_REFERENCE', 'HUMAN_APPROVAL_REFERENCE', 'WORKFLOW_REFERENCE',
  'DECISION_REFERENCE', 'AUDIT_REFERENCE', 'NOTIFICATION_REFERENCE', 'VALIDATION_REFERENCE'
]);
const MAX_PRIORITY = 1000;
const MAX_COST_MINOR_UNITS = 100000000;
const MAX_DURATION_MS = 1000000000;

function isOrderedUniqueRequiredCapabilityList(list) {
  if (!Array.isArray(list) || list.length > TOOL_CAPABILITIES.length) return false;
  if (!list.every((item) => isNonEmptyString(item) && TOOL_CAPABILITIES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateNullableReference(value, validator, label, errors) {
  if (value === null) return;
  const validation = validator(value);
  errors.push(...validation.errors.map((error) => `${label}_${error}`));
}

function validateWorkflowStep(step) {
  const errors = [];
  if (!isPlainObject(step)) return { valid: false, errors: ['step_must_be_object'] };
  exactFields(step, WORKFLOW_STEP_FIELDS, 'step', errors);
  for (const field of ['step_id', 'validator_version']) {
    if (!isNonEmptyString(step[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(step.step_version) || step.step_version < 1) errors.push('step_version_invalid');
  if (!WORKFLOW_STEP_TYPES.includes(step.step_type)) errors.push(`step_type_not_allowed::${step.step_type}`);
  if (!isOrderedUniqueRequiredCapabilityList(step.required_capabilities)) errors.push('required_capabilities_invalid');

  if (step.tool_reference !== null) validateNullableReference(step.tool_reference, validateSingleReference, 'tool_reference', errors);
  if (step.model_reference !== null) validateNullableReference(step.model_reference, validateSingleReference, 'model_reference', errors);
  if (step.context_reference !== null) validateNullableReference(step.context_reference, validateSingleReference, 'context_reference', errors);

  errors.push(...validateWorkflowDependencyList(step.depends_on, 'depends_on'));

  if (!Number.isInteger(step.priority) || step.priority < 0 || step.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'optional', 'approval_required']) {
    if (typeof step[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }

  if (step.timeout_reference !== null) validateNullableReference(step.timeout_reference, validateWorkflowTimeoutContract, 'timeout_reference', errors);
  if (step.retry_reference !== null) validateNullableReference(step.retry_reference, validateWorkflowRetryContract, 'retry_reference', errors);
  if (step.compensation_reference !== null) validateNullableReference(step.compensation_reference, validateWorkflowCompensationContract, 'compensation_reference', errors);

  if (!Number.isInteger(step.estimated_cost_minor_units) || step.estimated_cost_minor_units < 0 || step.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!Number.isInteger(step.estimated_duration_ms) || step.estimated_duration_ms < 0 || step.estimated_duration_ms > MAX_DURATION_MS) {
    errors.push('estimated_duration_ms_invalid');
  }
  if (step.simulation !== true) errors.push('simulation_must_be_true');
  if (step.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (step.validator_version !== WORKFLOW_STEP_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(step);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(step));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_COST_MINOR_UNITS,
  MAX_DURATION_MS,
  MAX_PRIORITY,
  WORKFLOW_STEP_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_STEP_FIELDS,
  WORKFLOW_STEP_TYPES,
  isOrderedUniqueRequiredCapabilityList,
  validateWorkflowStep
};

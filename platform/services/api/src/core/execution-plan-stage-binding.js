'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_STAGE_BINDING_VALIDATOR_VERSION = 'execution_plan_stage_binding_validator_v1';

const EXECUTION_PLAN_STAGE_BINDING_FIELDS = Object.freeze([
  'binding_id', 'binding_version', 'execution_plan_id', 'execution_stage_id', 'binding_type', 'source_reference_id',
  'source_reference_version', 'source_reference_fingerprint', 'tenant_id', 'organization_id', 'project_id',
  'session_reference_id', 'agent_id', 'binding_required', 'binding_validated', 'binding_applied',
  'binding_fingerprint', 'validator_version'
]);

const BINDING_TYPES = Object.freeze([
  'TASK_BINDING', 'AGENT_BINDING', 'MEMORY_BINDING', 'CONTEXT_BINDING', 'MODEL_BINDING', 'TOOL_BINDING',
  'WORKFLOW_BINDING', 'BUDGET_BINDING', 'AUTHORIZATION_BINDING', 'APPROVAL_BINDING', 'STOP_CONDITION_BINDING',
  'COMPENSATION_BINDING'
]);

const EXECUTION_PLAN_STAGE_BINDING_SAFE_FLAGS = Object.freeze({
  binding_applied: false
});

function validateExecutionPlanStageBinding(binding) {
  const errors = [];
  if (!isPlainObject(binding)) return { valid: false, errors: ['execution_plan_stage_binding_must_be_object'] };
  exactFields(binding, EXECUTION_PLAN_STAGE_BINDING_FIELDS, 'execution_plan_stage_binding', errors);
  for (const field of [
    'binding_id', 'execution_plan_id', 'execution_stage_id', 'source_reference_id', 'source_reference_fingerprint',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'binding_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(binding[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(binding.binding_version) || binding.binding_version < 1) errors.push('binding_version_invalid');
  if (!Number.isInteger(binding.source_reference_version) || binding.source_reference_version < 1) errors.push('source_reference_version_invalid');
  if (!BINDING_TYPES.includes(binding.binding_type)) errors.push(`binding_type_not_allowed::${binding.binding_type}`);
  for (const field of ['binding_required', 'binding_validated']) {
    if (typeof binding[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_STAGE_BINDING_SAFE_FLAGS)) {
    if (binding[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (binding.validator_version !== EXECUTION_PLAN_STAGE_BINDING_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(binding);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(binding));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function computeStageBindingFingerprint(binding) {
  const { binding_fingerprint, ...rest } = binding;
  return stablePayload(rest);
}

function buildExecutionPlanStageBinding(input = {}) {
  const binding = {
    binding_id: input.binding_id,
    binding_version: Number.isInteger(input.binding_version) ? input.binding_version : 1,
    execution_plan_id: input.execution_plan_id,
    execution_stage_id: input.execution_stage_id,
    binding_type: input.binding_type,
    source_reference_id: input.source_reference_id,
    source_reference_version: Number.isInteger(input.source_reference_version) ? input.source_reference_version : 1,
    source_reference_fingerprint: input.source_reference_fingerprint,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    binding_required: input.binding_required === true,
    binding_validated: input.binding_validated === true,
    binding_applied: false,
    validator_version: EXECUTION_PLAN_STAGE_BINDING_VALIDATOR_VERSION
  };
  binding.binding_fingerprint = computeStageBindingFingerprint({ ...binding, binding_fingerprint: undefined });

  const validation = validateExecutionPlanStageBinding(binding);
  if (!validation.valid) {
    throw new Error(`execution_plan_stage_binding_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(binding);
}

module.exports = {
  BINDING_TYPES,
  EXECUTION_PLAN_STAGE_BINDING_FIELDS,
  EXECUTION_PLAN_STAGE_BINDING_SAFE_FLAGS,
  EXECUTION_PLAN_STAGE_BINDING_VALIDATOR_VERSION,
  buildExecutionPlanStageBinding,
  computeStageBindingFingerprint,
  validateExecutionPlanStageBinding
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { TOOL_SIDE_EFFECTS } = require('./tool-side-effects-contract');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');

const EXECUTION_PLAN_STAGE_VALIDATOR_VERSION = 'execution_plan_stage_validator_v1';

const EXECUTION_PLAN_STAGE_FIELDS = Object.freeze([
  'execution_stage_id', 'execution_stage_version', 'execution_plan_id', 'source_orchestrator_stage_id',
  'stage_sequence', 'stage_type', 'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id',
  'context_assembly_reference_id', 'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'dependency_ids', 'binding_ids', 'stop_condition_ids', 'compensation_reference_ids', 'priority',
  'parallelizable', 'optional', 'approval_required', 'side_effect_classification', 'risk_classification',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units',
  'maximum_attempts_reference', 'timeout_reference', 'stage_status', 'stage_prepared', 'stage_executable',
  'stage_started', 'stage_completed', 'stage_failed', 'stage_compensated', 'simulation', 'production_blocked',
  'validator_version'
]);

// SIDE_EFFECT_CLASSIFICATIONS reuses PR #93's TOOL_SIDE_EFFECTS verbatim -- same 5 values, same
// meaning, no parallel enum.
const SIDE_EFFECT_CLASSIFICATIONS = TOOL_SIDE_EFFECTS;

const STAGE_STATUSES = Object.freeze(['PREPARED_SIMULATION', 'WAITING_APPROVAL_REFERENCE', 'BLOCKED', 'NOT_PREPARED']);

const NULLABLE_REFERENCE_FIELDS = Object.freeze([
  'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'workflow_reference_id', 'timeout_reference'
]);

const ORDERED_LIST_FIELDS = Object.freeze([
  'tool_reference_ids', 'dependency_ids', 'binding_ids', 'stop_condition_ids', 'compensation_reference_ids'
]);

const EXECUTION_PLAN_STAGE_SAFE_FLAGS = Object.freeze({
  stage_executable: false,
  stage_started: false,
  stage_completed: false,
  stage_failed: false,
  stage_compensated: false,
  simulation: true,
  production_blocked: true
});

const MAX_PRIORITY = 1000000;
const MAX_STAGE_SEQUENCE = 100000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionPlanStage(stage) {
  const errors = [];
  if (!isPlainObject(stage)) return { valid: false, errors: ['execution_plan_stage_must_be_object'] };
  exactFields(stage, EXECUTION_PLAN_STAGE_FIELDS, 'execution_plan_stage', errors);
  for (const field of ['execution_stage_id', 'execution_plan_id', 'source_orchestrator_stage_id', 'task_reference_id', 'validator_version']) {
    if (!isNonEmptyString(stage[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(stage.execution_stage_version) || stage.execution_stage_version < 1) errors.push('execution_stage_version_invalid');
  if (!Number.isInteger(stage.stage_sequence) || stage.stage_sequence < 0 || stage.stage_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('stage_sequence_invalid');
  }
  if (!STAGE_TYPES.includes(stage.stage_type)) errors.push(`stage_type_not_allowed::${stage.stage_type}`);
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (stage[field] !== null && !isNonEmptyString(stage[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(stage[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(stage.priority) || stage.priority < 0 || stage.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'optional', 'approval_required']) {
    if (typeof stage[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!SIDE_EFFECT_CLASSIFICATIONS.includes(stage.side_effect_classification)) errors.push(`side_effect_classification_not_allowed::${stage.side_effect_classification}`);
  if (!RISK_CLASSIFICATIONS.includes(stage.risk_classification)) errors.push(`risk_classification_not_allowed::${stage.risk_classification}`);
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(stage[field]) || stage[field] < 0 || stage[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(stage.estimated_input_tokens) && Number.isInteger(stage.estimated_output_tokens) &&
    Number.isInteger(stage.estimated_total_tokens) &&
    stage.estimated_total_tokens !== stage.estimated_input_tokens + stage.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  if (!Number.isInteger(stage.estimated_cost_minor_units) || stage.estimated_cost_minor_units < 0 || stage.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!Number.isInteger(stage.maximum_attempts_reference) || stage.maximum_attempts_reference < 1) errors.push('maximum_attempts_reference_invalid');
  if (!STAGE_STATUSES.includes(stage.stage_status)) errors.push(`stage_status_not_allowed::${stage.stage_status}`);
  if (typeof stage.stage_prepared !== 'boolean') errors.push('stage_prepared_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_STAGE_SAFE_FLAGS)) {
    if (stage[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (stage.stage_status === 'PREPARED_SIMULATION' && stage.stage_prepared !== true) errors.push('stage_prepared_must_be_true_when_prepared_simulation');
  if (stage.stage_status !== 'PREPARED_SIMULATION' && stage.stage_prepared !== false) errors.push('stage_prepared_must_be_false_unless_prepared_simulation');
  if (stage.dependency_ids.includes(stage.execution_stage_id)) errors.push('stage_cannot_depend_on_itself');

  if (stage.validator_version !== EXECUTION_PLAN_STAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(stage);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(stage));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionPlanStage(input = {}) {
  const status = STAGE_STATUSES.includes(input.stage_status) ? input.stage_status : 'NOT_PREPARED';
  const stage = {
    execution_stage_id: input.execution_stage_id,
    execution_stage_version: Number.isInteger(input.execution_stage_version) ? input.execution_stage_version : 1,
    execution_plan_id: input.execution_plan_id,
    source_orchestrator_stage_id: input.source_orchestrator_stage_id,
    stage_sequence: Number.isInteger(input.stage_sequence) ? input.stage_sequence : 0,
    stage_type: input.stage_type,
    task_reference_id: input.task_reference_id,
    agent_reference_id: input.agent_reference_id === undefined ? null : input.agent_reference_id,
    memory_selection_reference_id: input.memory_selection_reference_id === undefined ? null : input.memory_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id === undefined ? null : input.context_assembly_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    tool_reference_ids: uniqueSorted(input.tool_reference_ids || []),
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    dependency_ids: uniqueSorted(input.dependency_ids || []),
    binding_ids: uniqueSorted(input.binding_ids || []),
    stop_condition_ids: uniqueSorted(input.stop_condition_ids || []),
    compensation_reference_ids: uniqueSorted(input.compensation_reference_ids || []),
    priority: Number.isInteger(input.priority) ? input.priority : 0,
    parallelizable: input.parallelizable === true,
    optional: input.optional === true,
    approval_required: input.approval_required === true,
    side_effect_classification: input.side_effect_classification,
    risk_classification: input.risk_classification,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens
      : (Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0) + (Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0),
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    maximum_attempts_reference: Number.isInteger(input.maximum_attempts_reference) ? input.maximum_attempts_reference : 1,
    timeout_reference: input.timeout_reference === undefined ? null : input.timeout_reference,
    stage_status: status,
    stage_prepared: status === 'PREPARED_SIMULATION',
    stage_executable: false,
    stage_started: false,
    stage_completed: false,
    stage_failed: false,
    stage_compensated: false,
    simulation: true,
    production_blocked: true,
    validator_version: EXECUTION_PLAN_STAGE_VALIDATOR_VERSION
  };

  const validation = validateExecutionPlanStage(stage);
  if (!validation.valid) {
    throw new Error(`execution_plan_stage_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(stage);
}

module.exports = {
  EXECUTION_PLAN_STAGE_FIELDS,
  EXECUTION_PLAN_STAGE_SAFE_FLAGS,
  EXECUTION_PLAN_STAGE_VALIDATOR_VERSION,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MAX_STAGE_SEQUENCE,
  MAX_TOKENS_REFERENCE,
  NULLABLE_REFERENCE_FIELDS,
  ORDERED_LIST_FIELDS,
  SIDE_EFFECT_CLASSIFICATIONS,
  STAGE_STATUSES,
  buildExecutionPlanStage,
  isOrderedUniqueStringList,
  validateExecutionPlanStage
};

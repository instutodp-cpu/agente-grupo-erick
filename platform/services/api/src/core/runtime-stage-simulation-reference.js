'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { SIDE_EFFECT_CLASSIFICATIONS } = require('./execution-plan-stage');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

// A pure 1:1 declarative materialization of a single stage from the Gateway's already-accepted
// StageManifestReference -- never infers stage_type, never zeroes estimates, never adds a
// model/tool/workflow reference the source stage record didn't already declare. "Materializar" here
// means "copy across, unchanged", the same discipline execution-plan-stage.js already established
// one layer below (PR #98/#99).
const RUNTIME_STAGE_SIMULATION_REFERENCE_VALIDATOR_VERSION = 'runtime_stage_simulation_reference_validator_v1';

const RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS = Object.freeze([
  'runtime_stage_reference_id', 'runtime_stage_reference_version', 'runtime_request_id',
  'runtime_execution_package_id', 'execution_plan_id', 'source_execution_stage_id', 'source_orchestrator_stage_id',
  'stage_sequence', 'stage_type', 'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id',
  'context_assembly_reference_id', 'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'dependency_reference_ids', 'binding_reference_ids', 'stop_reference_ids', 'compensation_reference_ids',
  'required_capabilities', 'required_modalities', 'priority', 'parallelizable', 'optional', 'approval_required',
  'side_effect_classification', 'risk_classification', 'estimated_input_tokens', 'estimated_output_tokens',
  'estimated_total_tokens', 'estimated_cost_minor_units', 'stage_state', 'stage_would_execute',
  'stage_would_call_model', 'stage_would_call_tool', 'stage_would_call_workflow', 'stage_would_use_network',
  'stage_would_read_memory', 'stage_would_write_memory', 'stage_started', 'stage_completed', 'stage_failed',
  'stage_compensated', 'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_STAGE_STATES = Object.freeze([
  'RUNTIME_STAGE_PREPARED_SIMULATION', 'RUNTIME_STAGE_WAITING_APPROVAL_REFERENCE', 'RUNTIME_STAGE_BLOCKED',
  'RUNTIME_STAGE_NOT_PREPARED'
]);

const NULLABLE_REFERENCE_FIELDS = Object.freeze([
  'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'workflow_reference_id'
]);

const ORDERED_LIST_FIELDS = Object.freeze([
  'tool_reference_ids', 'dependency_reference_ids', 'binding_reference_ids', 'stop_reference_ids',
  'compensation_reference_ids'
]);

// "Campos would_* não podem indicar intenção operacional nesta PR. Permanecem false." -- every
// one of these, plus stage_started/completed/failed/compensated, is forced false regardless of
// stage_state; only a real future runtime (out of scope here) could ever set one of them true.
const RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS = Object.freeze({
  stage_would_execute: false,
  stage_would_call_model: false,
  stage_would_call_tool: false,
  stage_would_call_workflow: false,
  stage_would_use_network: false,
  stage_would_read_memory: false,
  stage_would_write_memory: false,
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
const MAX_REQUIRED_CAPABILITIES = 50;
const MAX_REQUIRED_MODALITIES = 20;
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateRuntimeStageSimulationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_stage_simulation_reference_must_be_object'] };
  exactFields(reference, RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS, 'runtime_stage_simulation_reference', errors);
  for (const field of [
    'runtime_stage_reference_id', 'runtime_request_id', 'runtime_execution_package_id', 'execution_plan_id',
    'source_execution_stage_id', 'source_orchestrator_stage_id', 'task_reference_id', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_stage_reference_version) || reference.runtime_stage_reference_version < 1) {
    errors.push('runtime_stage_reference_version_invalid');
  }
  if (!Number.isInteger(reference.stage_sequence) || reference.stage_sequence < 0 || reference.stage_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('stage_sequence_invalid');
  }
  if (!STAGE_TYPES.includes(reference.stage_type)) errors.push(`stage_type_not_allowed::${reference.stage_type}`);
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(reference.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) {
    errors.push('required_capabilities_invalid');
  }
  if (!isOrderedUniqueEnumList(reference.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) {
    errors.push('required_modalities_invalid');
  }
  if (!Number.isInteger(reference.priority) || reference.priority < 0 || reference.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'optional', 'approval_required']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!SIDE_EFFECT_CLASSIFICATIONS.includes(reference.side_effect_classification)) {
    errors.push(`side_effect_classification_not_allowed::${reference.side_effect_classification}`);
  }
  if (!RISK_CLASSIFICATIONS.includes(reference.risk_classification)) errors.push(`risk_classification_not_allowed::${reference.risk_classification}`);
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.estimated_input_tokens) && Number.isInteger(reference.estimated_output_tokens) &&
    Number.isInteger(reference.estimated_total_tokens) &&
    reference.estimated_total_tokens !== reference.estimated_input_tokens + reference.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  if (!Number.isInteger(reference.estimated_cost_minor_units) || reference.estimated_cost_minor_units < 0 || reference.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!RUNTIME_STAGE_STATES.includes(reference.stage_state)) errors.push(`stage_state_not_allowed::${reference.stage_state}`);
  for (const [field, expected] of Object.entries(RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.dependency_reference_ids.includes(reference.source_execution_stage_id)) errors.push('stage_cannot_depend_on_itself');
  if (reference.validator_version !== RUNTIME_STAGE_SIMULATION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeStageSimulationReference(input = {}) {
  const reference = {
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    runtime_stage_reference_version: Number.isInteger(input.runtime_stage_reference_version) ? input.runtime_stage_reference_version : 1,
    runtime_request_id: input.runtime_request_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    execution_plan_id: input.execution_plan_id,
    source_execution_stage_id: input.source_execution_stage_id,
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
    dependency_reference_ids: uniqueSorted(input.dependency_reference_ids || []),
    binding_reference_ids: uniqueSorted(input.binding_reference_ids || []),
    stop_reference_ids: uniqueSorted(input.stop_reference_ids || []),
    compensation_reference_ids: uniqueSorted(input.compensation_reference_ids || []),
    required_capabilities: Array.isArray(input.required_capabilities) ? input.required_capabilities : [],
    required_modalities: Array.isArray(input.required_modalities) ? input.required_modalities : [],
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
    stage_state: RUNTIME_STAGE_STATES.includes(input.stage_state) ? input.stage_state : 'RUNTIME_STAGE_NOT_PREPARED',
    ...RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_STAGE_SIMULATION_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateRuntimeStageSimulationReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_stage_simulation_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MAX_REQUIRED_CAPABILITIES,
  MAX_REQUIRED_MODALITIES,
  MAX_STAGE_SEQUENCE,
  MAX_TOKENS_REFERENCE,
  NULLABLE_REFERENCE_FIELDS,
  ORDERED_LIST_FIELDS,
  RUNTIME_STAGE_SIMULATION_REFERENCE_FIELDS,
  RUNTIME_STAGE_SIMULATION_REFERENCE_SAFE_FLAGS,
  RUNTIME_STAGE_SIMULATION_REFERENCE_VALIDATOR_VERSION,
  RUNTIME_STAGE_STATES,
  buildRuntimeStageSimulationReference,
  isOrderedUniqueStringList,
  validateRuntimeStageSimulationReference
};

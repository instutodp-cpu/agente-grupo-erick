'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

const ORCHESTRATOR_PLAN_STAGE_VALIDATOR_VERSION = 'orchestrator_plan_stage_validator_v1';

const ORCHESTRATOR_PLAN_STAGE_FIELDS = Object.freeze([
  'stage_id', 'stage_version', 'stage_type', 'stage_sequence', 'agent_reference_id', 'task_reference_id',
  'model_selection_reference_id', 'context_assembly_reference_id', 'memory_selection_reference_id',
  'tool_reference_ids', 'workflow_reference_id', 'dependency_reference_ids', 'required_capabilities',
  'required_modalities', 'priority', 'parallelizable', 'optional', 'approval_required', 'estimated_input_tokens',
  'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units', 'success_criteria_reference_ids',
  'fallback_reference_ids', 'escalation_reference_ids', 'stage_planned', 'stage_executed', 'simulation',
  'production_blocked', 'validator_version'
]);

const STAGE_TYPES = Object.freeze([
  'VALIDATION_STAGE', 'DETERMINISTIC_STAGE', 'MEMORY_REFERENCE_STAGE', 'CONTEXT_REFERENCE_STAGE',
  'MODEL_REFERENCE_STAGE', 'TOOL_REFERENCE_STAGE', 'WORKFLOW_REFERENCE_STAGE', 'HUMAN_APPROVAL_STAGE',
  'AUDIT_STAGE', 'FINALIZATION_STAGE'
]);

const NULLABLE_REFERENCE_FIELDS = Object.freeze([
  'agent_reference_id', 'model_selection_reference_id', 'context_assembly_reference_id',
  'memory_selection_reference_id', 'workflow_reference_id'
]);

const ORDERED_LIST_FIELDS = Object.freeze([
  'tool_reference_ids', 'dependency_reference_ids', 'success_criteria_reference_ids', 'fallback_reference_ids',
  'escalation_reference_ids'
]);

const ORCHESTRATOR_PLAN_STAGE_SAFE_FLAGS = Object.freeze({
  stage_planned: true,
  stage_executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_PRIORITY = 1000000;
const MAX_STAGE_SEQUENCE = 100000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;
const MAX_REQUIRED_CAPABILITIES = CAPABILITY_TYPES.length;
const MAX_REQUIRED_MODALITIES = MODALITIES.length;
const MAX_LIST_ITEMS = 200;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorPlanStage(stage) {
  const errors = [];
  if (!isPlainObject(stage)) return { valid: false, errors: ['plan_stage_must_be_object'] };
  exactFields(stage, ORCHESTRATOR_PLAN_STAGE_FIELDS, 'plan_stage', errors);
  for (const field of ['stage_id', 'task_reference_id', 'validator_version']) {
    if (!isNonEmptyString(stage[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(stage.stage_version) || stage.stage_version < 1) errors.push('stage_version_invalid');
  if (!STAGE_TYPES.includes(stage.stage_type)) errors.push(`stage_type_not_allowed::${stage.stage_type}`);
  if (!Number.isInteger(stage.stage_sequence) || stage.stage_sequence < 0 || stage.stage_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('stage_sequence_invalid');
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (stage[field] !== null && !isNonEmptyString(stage[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(stage[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueEnumList(stage.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) errors.push('required_capabilities_invalid');
  if (!isOrderedUniqueEnumList(stage.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) errors.push('required_modalities_invalid');
  if (!Number.isInteger(stage.priority) || stage.priority < 0 || stage.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'optional', 'approval_required']) {
    if (typeof stage[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
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
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLAN_STAGE_SAFE_FLAGS)) {
    if (stage[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (stage.dependency_reference_ids.includes(stage.stage_id)) errors.push('stage_cannot_depend_on_itself');

  if (stage.validator_version !== ORCHESTRATOR_PLAN_STAGE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(stage);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(stage));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_COST_MINOR_UNITS,
  MAX_PRIORITY,
  MAX_REQUIRED_CAPABILITIES,
  MAX_REQUIRED_MODALITIES,
  MAX_STAGE_SEQUENCE,
  MAX_TOKENS_REFERENCE,
  NULLABLE_REFERENCE_FIELDS,
  ORCHESTRATOR_PLAN_STAGE_FIELDS,
  ORCHESTRATOR_PLAN_STAGE_SAFE_FLAGS,
  ORCHESTRATOR_PLAN_STAGE_VALIDATOR_VERSION,
  ORDERED_LIST_FIELDS,
  STAGE_TYPES,
  isOrderedUniqueStringList,
  validateOrchestratorPlanStage
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { COMPLEXITY_TIERS, isOrderedUniqueEnumList } = require('./model-selection-task-profile');
const { SCOPE_TYPES } = require('./memory-selection-item-reference');

const ORCHESTRATOR_TASK_DEFINITION_VALIDATOR_VERSION = 'orchestrator_task_definition_validator_v1';

const ORCHESTRATOR_TASK_DEFINITION_FIELDS = Object.freeze([
  'task_id', 'task_version', 'task_type', 'task_complexity', 'task_risk', 'task_data_classification', 'task_scope',
  'required_capabilities', 'required_modalities', 'required_memory_reference_ids', 'required_tool_reference_ids',
  'required_workflow_reference_id', 'requires_model', 'requires_context', 'requires_human_approval',
  'decomposition_allowed', 'parallelism_allowed', 'maximum_stages', 'success_criteria_references',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units',
  'logical_sequence', 'validator_version'
]);

const TASK_TYPES = Object.freeze([
  'DETERMINISTIC_REFERENCE', 'CLASSIFICATION_REFERENCE', 'EXTRACTION_REFERENCE', 'SUMMARIZATION_REFERENCE',
  'ANALYSIS_REFERENCE', 'PLANNING_REFERENCE', 'REASONING_REFERENCE', 'DOCUMENT_REFERENCE', 'CODE_REFERENCE',
  'AUDIT_REFERENCE', 'ROUTING_REFERENCE', 'TOOL_COORDINATION_REFERENCE', 'WORKFLOW_COORDINATION_REFERENCE',
  'MULTI_AGENT_REFERENCE'
]);

const TASK_COMPLEXITIES = COMPLEXITY_TIERS;
const RESTRICTED_TASK_RISK = 'RESTRICTED';

const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;
const MAX_MAXIMUM_STAGES = 100;
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

function validateOrchestratorTaskDefinition(task) {
  const errors = [];
  if (!isPlainObject(task)) return { valid: false, errors: ['task_definition_must_be_object'] };
  exactFields(task, ORCHESTRATOR_TASK_DEFINITION_FIELDS, 'task_definition', errors);
  for (const field of ['task_id', 'task_scope', 'validator_version']) {
    if (!isNonEmptyString(task[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(task.task_version) || task.task_version < 1) errors.push('task_version_invalid');
  if (!TASK_TYPES.includes(task.task_type)) errors.push(`task_type_not_allowed::${task.task_type}`);
  if (!TASK_COMPLEXITIES.includes(task.task_complexity)) errors.push(`task_complexity_not_allowed::${task.task_complexity}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(task.task_risk)) errors.push(`task_risk_not_allowed::${task.task_risk}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(task.task_data_classification)) errors.push(`task_data_classification_not_allowed::${task.task_data_classification}`);
  if (!SCOPE_TYPES.includes(task.task_scope)) errors.push(`task_scope_not_allowed::${task.task_scope}`);
  if (!isOrderedUniqueEnumList(task.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) errors.push('required_capabilities_invalid');
  if (!isOrderedUniqueEnumList(task.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) errors.push('required_modalities_invalid');
  if (!isOrderedUniqueStringList(task.required_memory_reference_ids)) errors.push('required_memory_reference_ids_invalid');
  if (!isOrderedUniqueStringList(task.required_tool_reference_ids)) errors.push('required_tool_reference_ids_invalid');
  if (task.required_workflow_reference_id !== null && !isNonEmptyString(task.required_workflow_reference_id)) {
    errors.push('required_workflow_reference_id_must_be_null_or_string');
  }
  for (const field of [
    'requires_model', 'requires_context', 'requires_human_approval', 'decomposition_allowed', 'parallelism_allowed'
  ]) {
    if (typeof task[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!Number.isInteger(task.maximum_stages) || task.maximum_stages < 1 || task.maximum_stages > MAX_MAXIMUM_STAGES) {
    errors.push('maximum_stages_invalid');
  }
  if (!isOrderedUniqueStringList(task.success_criteria_references)) errors.push('success_criteria_references_invalid');
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(task[field]) || task[field] < 0 || task[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(task.estimated_input_tokens) && Number.isInteger(task.estimated_output_tokens) &&
    Number.isInteger(task.estimated_total_tokens) &&
    task.estimated_total_tokens !== task.estimated_input_tokens + task.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  if (!Number.isInteger(task.estimated_cost_minor_units) || task.estimated_cost_minor_units < 0 || task.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!Number.isInteger(task.logical_sequence) || task.logical_sequence < 0) errors.push('logical_sequence_invalid');

  if (task.task_complexity === 'TIER_0_DETERMINISTIC' && task.requires_model !== false) {
    errors.push('tier_0_deterministic_requires_no_llm');
  }
  if (task.task_complexity === 'TIER_5_CRITICAL' && task.requires_human_approval !== true) {
    errors.push('tier_5_critical_requires_human_approval');
  }

  if (task.validator_version !== ORCHESTRATOR_TASK_DEFINITION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(task);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(task));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_COST_MINOR_UNITS,
  MAX_MAXIMUM_STAGES,
  MAX_REQUIRED_CAPABILITIES,
  MAX_REQUIRED_MODALITIES,
  MAX_TOKENS_REFERENCE,
  ORCHESTRATOR_TASK_DEFINITION_FIELDS,
  ORCHESTRATOR_TASK_DEFINITION_VALIDATOR_VERSION,
  RESTRICTED_TASK_RISK,
  TASK_COMPLEXITIES,
  TASK_TYPES,
  isOrderedUniqueStringList,
  validateOrchestratorTaskDefinition
};

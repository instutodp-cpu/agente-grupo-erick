'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { RESULT_DECISIONS, RESULT_STATUSES } = require('./orchestrator-planning-result');

const PLANNING_RESULT_REFERENCE_VALIDATOR_VERSION = 'orchestrator_planning_result_reference_validator_v1';
const ORCHESTRATION_PLAN_REFERENCE_VALIDATOR_VERSION = 'orchestrator_orchestration_plan_reference_validator_v1';

const PLANNING_RESULT_REFERENCE_FIELDS = Object.freeze([
  'planning_result_id', 'planning_request_id', 'planning_result_fingerprint', 'plan_id', 'plan_fingerprint',
  'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'status', 'decision',
  'stage_ids', 'dependency_ids', 'approval_stage_ids', 'required_memory_reference_ids',
  'selected_model_reference_ids', 'selected_tool_reference_ids', 'selected_workflow_reference_ids',
  'context_reference_ids', 'stage_count', 'parallel_stage_count', 'model_stage_count', 'tool_stage_count',
  'workflow_stage_count', 'approval_stage_count', 'estimated_total_tokens', 'estimated_total_cost_minor_units',
  'request_validated', 'bindings_validated', 'memory_preserved', 'continuity_preserved', 'project_state_preserved',
  'policy_validated', 'budget_validated', 'plan_generated', 'plan_executed', 'executed', 'simulation',
  'production_blocked', 'validator_version'
]);

const PLANNING_RESULT_REFERENCE_LIST_FIELDS = Object.freeze([
  'stage_ids', 'dependency_ids', 'approval_stage_ids', 'required_memory_reference_ids',
  'selected_model_reference_ids', 'selected_tool_reference_ids', 'selected_workflow_reference_ids',
  'context_reference_ids'
]);

const PLANNING_RESULT_REFERENCE_COUNT_FIELDS = Object.freeze([
  'stage_count', 'parallel_stage_count', 'model_stage_count', 'tool_stage_count', 'workflow_stage_count',
  'approval_stage_count'
]);

const PLANNING_RESULT_REFERENCE_VALIDATION_FIELDS = Object.freeze([
  'request_validated', 'bindings_validated', 'memory_preserved', 'continuity_preserved', 'project_state_preserved',
  'policy_validated', 'budget_validated', 'plan_generated'
]);

const PLANNING_RESULT_REFERENCE_SAFE_FLAGS = Object.freeze({
  plan_executed: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const ORCHESTRATION_PLAN_REFERENCE_FIELDS = Object.freeze([
  'plan_id', 'plan_version', 'plan_fingerprint', 'tenant_id', 'organization_id', 'agent_id', 'project_id',
  'session_reference_id', 'ordered_stage_ids', 'dependency_ids', 'approval_stage_ids',
  'required_memory_reference_ids', 'context_reference_ids', 'model_reference_ids', 'tool_reference_ids',
  'workflow_reference_ids', 'success_criteria_ids', 'estimated_total_tokens', 'estimated_total_cost_minor_units',
  'plan_generated', 'plan_executed', 'simulation', 'production_blocked', 'validator_version'
]);

const ORCHESTRATION_PLAN_REFERENCE_LIST_FIELDS = Object.freeze([
  'ordered_stage_ids', 'dependency_ids', 'approval_stage_ids', 'required_memory_reference_ids',
  'context_reference_ids', 'model_reference_ids', 'tool_reference_ids', 'workflow_reference_ids',
  'success_criteria_ids'
]);

const ORCHESTRATION_PLAN_REFERENCE_SAFE_FLAGS = Object.freeze({
  plan_executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 500;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validatePlanningResultReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['planning_result_reference_must_be_object'] };
  exactFields(reference, PLANNING_RESULT_REFERENCE_FIELDS, 'planning_result_reference', errors);
  for (const field of [
    'planning_result_id', 'planning_request_id', 'planning_result_fingerprint', 'plan_id', 'plan_fingerprint',
    'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(reference.status)) errors.push(`status_not_allowed::${reference.status}`);
  if (!RESULT_DECISIONS.includes(reference.decision)) errors.push(`decision_not_allowed::${reference.decision}`);
  for (const field of PLANNING_RESULT_REFERENCE_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PLANNING_RESULT_REFERENCE_COUNT_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.estimated_total_tokens) || reference.estimated_total_tokens < 0 || reference.estimated_total_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (
    !Number.isInteger(reference.estimated_total_cost_minor_units) || reference.estimated_total_cost_minor_units < 0 ||
    reference.estimated_total_cost_minor_units > MAX_COST_MINOR_UNITS
  ) {
    errors.push('estimated_total_cost_minor_units_invalid');
  }
  for (const field of PLANNING_RESULT_REFERENCE_VALIDATION_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(PLANNING_RESULT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== PLANNING_RESULT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateOrchestrationPlanReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['orchestration_plan_reference_must_be_object'] };
  exactFields(reference, ORCHESTRATION_PLAN_REFERENCE_FIELDS, 'orchestration_plan_reference', errors);
  for (const field of ['plan_id', 'plan_fingerprint', 'tenant_id', 'organization_id', 'agent_id', 'project_id', 'session_reference_id', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.plan_version) || reference.plan_version < 1) errors.push('plan_version_invalid');
  for (const field of ORCHESTRATION_PLAN_REFERENCE_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.estimated_total_tokens) || reference.estimated_total_tokens < 0 || reference.estimated_total_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (
    !Number.isInteger(reference.estimated_total_cost_minor_units) || reference.estimated_total_cost_minor_units < 0 ||
    reference.estimated_total_cost_minor_units > MAX_COST_MINOR_UNITS
  ) {
    errors.push('estimated_total_cost_minor_units_invalid');
  }
  if (typeof reference.plan_generated !== 'boolean') errors.push('plan_generated_must_be_boolean');
  for (const [field, expected] of Object.entries(ORCHESTRATION_PLAN_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== ORCHESTRATION_PLAN_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_COST_MINOR_UNITS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_TOKENS_REFERENCE,
  ORCHESTRATION_PLAN_REFERENCE_FIELDS,
  ORCHESTRATION_PLAN_REFERENCE_SAFE_FLAGS,
  ORCHESTRATION_PLAN_REFERENCE_VALIDATOR_VERSION,
  PLANNING_RESULT_REFERENCE_FIELDS,
  PLANNING_RESULT_REFERENCE_SAFE_FLAGS,
  PLANNING_RESULT_REFERENCE_VALIDATION_FIELDS,
  PLANNING_RESULT_REFERENCE_VALIDATOR_VERSION,
  isOrderedUniqueStringList,
  validateOrchestrationPlanReference,
  validatePlanningResultReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');
const { SIDE_EFFECT_CLASSIFICATIONS } = require('./execution-plan-stage');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');

// pr107: a minimized, 1:1 declarative materialization of one Scheduler Stage Reference for dispatch
// preparation purposes -- "Dispatch não pode ser apenas stage ID + worker ID." Preserves every field
// the eventual Payload/Order layers need, never redirects or invents any of them. `dispatch_stage_status`
// is derived structurally from the stage's own Scheduler status plus its Worker Stage Assignment
// status -- only WORKER_RECOMMENDED_SIMULATION assignments become DISPATCH_STAGE_ELIGIBLE_SIMULATION;
// waiting/optional/blocked/no-candidate assignments stay in their own dedicated status, never eligible.
const RUNTIME_DISPATCH_STAGE_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_stage_reference_validator_v1';

const DISPATCH_STAGE_STATUSES = Object.freeze([
  'DISPATCH_STAGE_ELIGIBLE_SIMULATION', 'DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE',
  'DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE', 'DISPATCH_STAGE_OPTIONAL_REFERENCE',
  'DISPATCH_STAGE_NO_WORKER_BLOCKED', 'DISPATCH_STAGE_BLOCKED', 'DISPATCH_STAGE_NOT_EVALUATED'
]);

const DISPATCH_ELIGIBILITY_STATUSES = Object.freeze([
  'DISPATCH_ELIGIBLE_REFERENCE_SIMULATION', 'WAITING_DEPENDENCY_REFERENCE', 'WAITING_APPROVAL_REFERENCE',
  'OPTIONAL_REFERENCE', 'NO_WORKER_REFERENCE', 'BLOCKED_REFERENCE', 'NOT_EVALUATED_REFERENCE'
]);

// Structural 1:1 mapping between the two status vocabularies -- never diverges, so a Dispatch Stage
// Reference can never declare an eligibility status inconsistent with its own dispatch_stage_status.
const ELIGIBILITY_BY_STAGE_STATUS = Object.freeze({
  DISPATCH_STAGE_ELIGIBLE_SIMULATION: 'DISPATCH_ELIGIBLE_REFERENCE_SIMULATION',
  DISPATCH_STAGE_WAITING_DEPENDENCY_REFERENCE: 'WAITING_DEPENDENCY_REFERENCE',
  DISPATCH_STAGE_WAITING_APPROVAL_REFERENCE: 'WAITING_APPROVAL_REFERENCE',
  DISPATCH_STAGE_OPTIONAL_REFERENCE: 'OPTIONAL_REFERENCE',
  DISPATCH_STAGE_NO_WORKER_BLOCKED: 'NO_WORKER_REFERENCE',
  DISPATCH_STAGE_BLOCKED: 'BLOCKED_REFERENCE',
  DISPATCH_STAGE_NOT_EVALUATED: 'NOT_EVALUATED_REFERENCE'
});

const RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS = Object.freeze([
  'runtime_dispatch_stage_reference_id', 'runtime_dispatch_stage_reference_version',
  'runtime_dispatch_request_id', 'runtime_dispatch_package_id',
  'runtime_scheduler_package_id', 'runtime_worker_assignment_package_id', 'runtime_execution_package_id',
  'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'worker_stage_assignment_reference_id',
  'stage_sequence', 'scheduler_sequence', 'dispatch_sequence',
  'stage_type', 'priority', 'required', 'optional', 'parallelizable', 'approval_required',
  'dependency_reference_ids', 'blocking_dependency_reference_ids',
  'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'required_capabilities', 'required_modalities', 'stage_policy_requirement_reference_ids',
  'side_effect_classification', 'risk_classification',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units',
  'dispatch_stage_status', 'dispatch_eligibility_status',
  'dispatch_stage_validated', 'dispatch_stage_applied', 'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed',
  'reason_codes',
  'dispatch_stage_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_STAGE_REFERENCE_SAFE_FLAGS = Object.freeze({
  dispatch_stage_applied: false,
  stage_dispatched: false,
  stage_started: false,
  stage_completed: false,
  stage_failed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 200;
const MAX_SEQUENCE = 1000000;
const MAX_PRIORITY = 1000000;
const MAX_TOKENS = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeDispatchStageFingerprint(reference) {
  const { dispatch_stage_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchStageReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_stage_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS, 'runtime_dispatch_stage_reference', errors);
  for (const field of [
    'runtime_dispatch_stage_reference_id', 'runtime_dispatch_request_id', 'runtime_dispatch_package_id',
    'runtime_scheduler_package_id', 'runtime_worker_assignment_package_id', 'runtime_execution_package_id',
    'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'worker_stage_assignment_reference_id',
    'dispatch_stage_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_dispatch_stage_reference_version) || reference.runtime_dispatch_stage_reference_version < 1) {
    errors.push('runtime_dispatch_stage_reference_version_invalid');
  }
  for (const field of ['stage_sequence', 'scheduler_sequence', 'dispatch_sequence']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_SEQUENCE) errors.push(`${field}_invalid`);
  }
  if (!STAGE_TYPES.includes(reference.stage_type)) errors.push(`stage_type_not_allowed::${reference.stage_type}`);
  if (!Number.isInteger(reference.priority) || reference.priority < 0 || reference.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['required', 'optional', 'parallelizable', 'approval_required']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueStringList(reference.dependency_reference_ids)) errors.push('dependency_reference_ids_invalid');
  if (!isOrderedUniqueStringList(reference.blocking_dependency_reference_ids)) errors.push('blocking_dependency_reference_ids_invalid');
  if (!isNonEmptyString(reference.task_reference_id)) errors.push('task_reference_id_invalid');
  for (const field of ['agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id', 'model_selection_reference_id', 'workflow_reference_id']) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!isOrderedUniqueStringList(reference.tool_reference_ids)) errors.push('tool_reference_ids_invalid');
  if (!isOrderedUniqueEnumList(reference.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_capabilities_invalid');
  }
  if (!isOrderedUniqueEnumList(reference.required_modalities, MODALITIES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_modalities_invalid');
  }
  if (!isOrderedUniqueStringList(reference.stage_policy_requirement_reference_ids)) errors.push('stage_policy_requirement_reference_ids_invalid');
  if (!SIDE_EFFECT_CLASSIFICATIONS.includes(reference.side_effect_classification)) {
    errors.push(`side_effect_classification_not_allowed::${reference.side_effect_classification}`);
  }
  if (!RISK_CLASSIFICATIONS.includes(reference.risk_classification)) errors.push(`risk_classification_not_allowed::${reference.risk_classification}`);
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKENS) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.estimated_cost_minor_units) || reference.estimated_cost_minor_units < 0 || reference.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!DISPATCH_STAGE_STATUSES.includes(reference.dispatch_stage_status)) errors.push('dispatch_stage_status_invalid');
  if (!DISPATCH_ELIGIBILITY_STATUSES.includes(reference.dispatch_eligibility_status)) errors.push('dispatch_eligibility_status_invalid');
  const expectedEligibility = ELIGIBILITY_BY_STAGE_STATUS[reference.dispatch_stage_status];
  if (expectedEligibility && reference.dispatch_eligibility_status !== expectedEligibility) {
    errors.push('dispatch_eligibility_status_does_not_match_stage_status');
  }
  if (typeof reference.dispatch_stage_validated !== 'boolean') errors.push('dispatch_stage_validated_must_be_boolean');
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_STAGE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_STAGE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeDispatchStageFingerprint(reference) !== reference.dispatch_stage_fingerprint) errors.push('dispatch_stage_fingerprint_mismatch');
  } catch (error) {
    errors.push('dispatch_stage_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchStageReference(input = {}) {
  const status = DISPATCH_STAGE_STATUSES.includes(input.dispatch_stage_status) ? input.dispatch_stage_status : 'DISPATCH_STAGE_NOT_EVALUATED';
  const reference = {
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    runtime_dispatch_stage_reference_version: Number.isInteger(input.runtime_dispatch_stage_reference_version) ? input.runtime_dispatch_stage_reference_version : 1,
    runtime_dispatch_request_id: input.runtime_dispatch_request_id,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    worker_stage_assignment_reference_id: input.worker_stage_assignment_reference_id,
    stage_sequence: Number.isInteger(input.stage_sequence) ? input.stage_sequence : 0,
    scheduler_sequence: Number.isInteger(input.scheduler_sequence) ? input.scheduler_sequence : 0,
    dispatch_sequence: Number.isInteger(input.dispatch_sequence) ? input.dispatch_sequence : 0,
    stage_type: input.stage_type,
    priority: Number.isInteger(input.priority) ? input.priority : 0,
    required: input.required === true,
    optional: input.optional === true,
    parallelizable: input.parallelizable === true,
    approval_required: input.approval_required === true,
    dependency_reference_ids: uniqueSorted(input.dependency_reference_ids || []),
    blocking_dependency_reference_ids: uniqueSorted(input.blocking_dependency_reference_ids || []),
    task_reference_id: input.task_reference_id,
    agent_reference_id: input.agent_reference_id === undefined ? null : input.agent_reference_id,
    memory_selection_reference_id: input.memory_selection_reference_id === undefined ? null : input.memory_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id === undefined ? null : input.context_assembly_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    tool_reference_ids: uniqueSorted(input.tool_reference_ids || []),
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    required_capabilities: Array.isArray(input.required_capabilities) ? input.required_capabilities : [],
    required_modalities: Array.isArray(input.required_modalities) ? input.required_modalities : [],
    stage_policy_requirement_reference_ids: uniqueSorted(input.stage_policy_requirement_reference_ids || []),
    side_effect_classification: input.side_effect_classification,
    risk_classification: input.risk_classification,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    dispatch_stage_status: status,
    dispatch_eligibility_status: ELIGIBILITY_BY_STAGE_STATUS[status] || 'NOT_EVALUATED_REFERENCE',
    dispatch_stage_validated: true,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    dispatch_stage_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_STAGE_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_STAGE_REFERENCE_VALIDATOR_VERSION
  };
  reference.dispatch_stage_fingerprint = computeDispatchStageFingerprint(reference);

  const validation = validateRuntimeDispatchStageReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_stage_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  DISPATCH_ELIGIBILITY_STATUSES,
  DISPATCH_STAGE_STATUSES,
  ELIGIBILITY_BY_STAGE_STATUS,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MAX_SEQUENCE,
  MAX_TOKENS,
  RUNTIME_DISPATCH_STAGE_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_STAGE_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_STAGE_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchStageReference,
  computeDispatchStageFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchStageReference
};

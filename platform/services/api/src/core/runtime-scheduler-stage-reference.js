'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { SIDE_EFFECT_CLASSIFICATIONS } = require('./execution-plan-stage');
const { RISK_CLASSIFICATIONS } = require('./execution-authorization-scope');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

// pr105: a minimized, 1:1 declarative materialization of a single RuntimeStageSimulationReference
// (PR #103) for scheduling purposes only -- preserves every field the spec's own "Stage
// preservation" cross-check requires unchanged, and adds only genuinely new scheduling-derived
// fields (scheduler_sequence, scheduler_stage_status/eligibility_status, waiting_reason_codes,
// blocking/parallel dependency partitions). runtime-scheduler-boundary.js derives the status/
// eligibility/sequence fields from the real Runtime Dependency Manifest and Scheduler Policy --
// this contract only validates the resulting shape is internally consistent, never re-derives
// eligibility itself. "Isso ainda não significa que será executado" -- every operational flag stays
// forced false regardless of status.
const RUNTIME_SCHEDULER_STAGE_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_stage_reference_validator_v1';

const SCHEDULER_STAGE_STATUSES = Object.freeze([
  'SCHEDULER_STAGE_ELIGIBLE_SIMULATION', 'SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE',
  'SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE', 'SCHEDULER_STAGE_OPTIONAL_REFERENCE', 'SCHEDULER_STAGE_BLOCKED',
  'SCHEDULER_STAGE_NOT_EVALUATED'
]);

const ELIGIBILITY_STATUSES = Object.freeze([
  'ELIGIBLE_REFERENCE_SIMULATION', 'WAITING_DEPENDENCY_REFERENCE', 'WAITING_APPROVAL_REFERENCE',
  'OPTIONAL_REFERENCE', 'BLOCKED_REFERENCE', 'NOT_EVALUATED_REFERENCE'
]);

// One-to-one, deliberately not collapsible: every scheduler stage status has exactly one matching
// eligibility status, and vice versa (mirrors the same STATUS_OUTCOME_MAP pattern every decision/
// result pair in this codebase already uses for status/decision/next_state consistency).
const STATUS_ELIGIBILITY_MAP = Object.freeze({
  SCHEDULER_STAGE_ELIGIBLE_SIMULATION: 'ELIGIBLE_REFERENCE_SIMULATION',
  SCHEDULER_STAGE_WAITING_DEPENDENCY_REFERENCE: 'WAITING_DEPENDENCY_REFERENCE',
  SCHEDULER_STAGE_WAITING_APPROVAL_REFERENCE: 'WAITING_APPROVAL_REFERENCE',
  SCHEDULER_STAGE_OPTIONAL_REFERENCE: 'OPTIONAL_REFERENCE',
  SCHEDULER_STAGE_BLOCKED: 'BLOCKED_REFERENCE',
  SCHEDULER_STAGE_NOT_EVALUATED: 'NOT_EVALUATED_REFERENCE'
});

const NULLABLE_REFERENCE_FIELDS = Object.freeze([
  'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'workflow_reference_id'
]);

const ORDERED_LIST_FIELDS = Object.freeze([
  'dependency_reference_ids', 'blocking_dependency_reference_ids', 'parallel_dependency_reference_ids',
  'tool_reference_ids', 'stop_reference_ids', 'compensation_reference_ids'
]);

const RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS = Object.freeze([
  'scheduler_stage_reference_id', 'scheduler_stage_reference_version',
  'runtime_scheduler_request_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'runtime_stage_reference_id', 'source_execution_stage_id', 'source_orchestrator_stage_id',
  'stage_sequence', 'scheduler_sequence', 'stage_type', 'priority',
  'required', 'optional', 'parallelizable', 'approval_required',
  'dependency_reference_ids', 'blocking_dependency_reference_ids', 'parallel_dependency_reference_ids',
  'required_capabilities', 'required_modalities',
  'task_reference_id', 'agent_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id',
  'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'stop_reference_ids', 'compensation_reference_ids',
  'side_effect_classification', 'risk_classification',
  'estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens', 'estimated_cost_minor_units',
  'scheduler_stage_status', 'eligibility_status', 'waiting_reason_codes',
  'scheduler_stage_validated', 'scheduler_stage_applied',
  'job_created', 'queue_used', 'worker_assigned', 'stage_dispatched', 'stage_started', 'stage_completed', 'stage_failed',
  'stage_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_STAGE_REFERENCE_SAFE_FLAGS = Object.freeze({
  scheduler_stage_applied: false,
  job_created: false,
  queue_used: false,
  worker_assigned: false,
  stage_dispatched: false,
  stage_started: false,
  stage_completed: false,
  stage_failed: false,
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

function computeSchedulerStageFingerprint(reference) {
  const { stage_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeSchedulerStageReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_stage_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS, 'runtime_scheduler_stage_reference', errors);
  for (const field of [
    'scheduler_stage_reference_id', 'runtime_scheduler_request_id', 'runtime_scheduler_package_id',
    'runtime_execution_package_id', 'runtime_stage_reference_id', 'source_execution_stage_id',
    'source_orchestrator_stage_id', 'task_reference_id', 'stage_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.scheduler_stage_reference_version) || reference.scheduler_stage_reference_version < 1) {
    errors.push('scheduler_stage_reference_version_invalid');
  }
  if (!Number.isInteger(reference.stage_sequence) || reference.stage_sequence < 0 || reference.stage_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('stage_sequence_invalid');
  }
  if (!Number.isInteger(reference.scheduler_sequence) || reference.scheduler_sequence < 0 || reference.scheduler_sequence > MAX_STAGE_SEQUENCE) {
    errors.push('scheduler_sequence_invalid');
  }
  if (!STAGE_TYPES.includes(reference.stage_type)) errors.push(`stage_type_not_allowed::${reference.stage_type}`);
  if (!Number.isInteger(reference.priority) || reference.priority < 0 || reference.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['required', 'optional', 'parallelizable', 'approval_required']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of NULLABLE_REFERENCE_FIELDS) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(reference[field])) errors.push(`${field}_invalid`);
  }
  if (
    Array.isArray(reference.blocking_dependency_reference_ids) && Array.isArray(reference.dependency_reference_ids)
    && !reference.blocking_dependency_reference_ids.every((id) => reference.dependency_reference_ids.includes(id))
  ) {
    errors.push('blocking_dependency_reference_ids_not_subset_of_dependency_reference_ids');
  }
  if (
    Array.isArray(reference.parallel_dependency_reference_ids) && Array.isArray(reference.dependency_reference_ids)
    && !reference.parallel_dependency_reference_ids.every((id) => reference.dependency_reference_ids.includes(id))
  ) {
    errors.push('parallel_dependency_reference_ids_not_subset_of_dependency_reference_ids');
  }
  if (!isOrderedUniqueEnumList(reference.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) {
    errors.push('required_capabilities_invalid');
  }
  if (!isOrderedUniqueEnumList(reference.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) {
    errors.push('required_modalities_invalid');
  }
  if (!SIDE_EFFECT_CLASSIFICATIONS.includes(reference.side_effect_classification)) {
    errors.push(`side_effect_classification_not_allowed::${reference.side_effect_classification}`);
  }
  if (!RISK_CLASSIFICATIONS.includes(reference.risk_classification)) errors.push(`risk_classification_not_allowed::${reference.risk_classification}`);
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.estimated_input_tokens) && Number.isInteger(reference.estimated_output_tokens)
    && Number.isInteger(reference.estimated_total_tokens)
    && reference.estimated_total_tokens !== reference.estimated_input_tokens + reference.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  if (!Number.isInteger(reference.estimated_cost_minor_units) || reference.estimated_cost_minor_units < 0 || reference.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!SCHEDULER_STAGE_STATUSES.includes(reference.scheduler_stage_status)) errors.push('scheduler_stage_status_invalid');
  if (!ELIGIBILITY_STATUSES.includes(reference.eligibility_status)) errors.push('eligibility_status_invalid');
  if (STATUS_ELIGIBILITY_MAP[reference.scheduler_stage_status] !== reference.eligibility_status) {
    errors.push('eligibility_status_does_not_match_scheduler_stage_status');
  }
  if (!isOrderedUniqueStringList(reference.waiting_reason_codes)) errors.push('waiting_reason_codes_invalid');
  if (typeof reference.scheduler_stage_validated !== 'boolean') errors.push('scheduler_stage_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_STAGE_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_STAGE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeSchedulerStageFingerprint(reference) !== reference.stage_fingerprint) errors.push('stage_fingerprint_mismatch');
  } catch (error) {
    errors.push('stage_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerStageReference(input = {}) {
  const status = SCHEDULER_STAGE_STATUSES.includes(input.scheduler_stage_status) ? input.scheduler_stage_status : 'SCHEDULER_STAGE_NOT_EVALUATED';
  const reference = {
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    scheduler_stage_reference_version: Number.isInteger(input.scheduler_stage_reference_version) ? input.scheduler_stage_reference_version : 1,
    runtime_scheduler_request_id: input.runtime_scheduler_request_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    source_execution_stage_id: input.source_execution_stage_id,
    source_orchestrator_stage_id: input.source_orchestrator_stage_id,
    stage_sequence: Number.isInteger(input.stage_sequence) ? input.stage_sequence : 0,
    scheduler_sequence: Number.isInteger(input.scheduler_sequence) ? input.scheduler_sequence : 0,
    stage_type: input.stage_type,
    priority: Number.isInteger(input.priority) ? input.priority : 0,
    required: input.required === true,
    optional: input.optional === true,
    parallelizable: input.parallelizable === true,
    approval_required: input.approval_required === true,
    dependency_reference_ids: uniqueSorted(input.dependency_reference_ids || []),
    blocking_dependency_reference_ids: uniqueSorted(input.blocking_dependency_reference_ids || []),
    parallel_dependency_reference_ids: uniqueSorted(input.parallel_dependency_reference_ids || []),
    required_capabilities: Array.isArray(input.required_capabilities) ? input.required_capabilities : [],
    required_modalities: Array.isArray(input.required_modalities) ? input.required_modalities : [],
    task_reference_id: input.task_reference_id,
    agent_reference_id: input.agent_reference_id === undefined ? null : input.agent_reference_id,
    memory_selection_reference_id: input.memory_selection_reference_id === undefined ? null : input.memory_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id === undefined ? null : input.context_assembly_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    tool_reference_ids: uniqueSorted(input.tool_reference_ids || []),
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    stop_reference_ids: uniqueSorted(input.stop_reference_ids || []),
    compensation_reference_ids: uniqueSorted(input.compensation_reference_ids || []),
    side_effect_classification: input.side_effect_classification,
    risk_classification: input.risk_classification,
    estimated_input_tokens: Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0,
    estimated_output_tokens: Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0,
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens
      : (Number.isInteger(input.estimated_input_tokens) ? input.estimated_input_tokens : 0) + (Number.isInteger(input.estimated_output_tokens) ? input.estimated_output_tokens : 0),
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    scheduler_stage_status: status,
    eligibility_status: STATUS_ELIGIBILITY_MAP[status],
    waiting_reason_codes: Array.isArray(input.waiting_reason_codes) ? uniqueSorted(input.waiting_reason_codes) : [],
    scheduler_stage_validated: true,
    stage_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_STAGE_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_STAGE_REFERENCE_VALIDATOR_VERSION
  };
  reference.stage_fingerprint = computeSchedulerStageFingerprint(reference);

  const validation = validateRuntimeSchedulerStageReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_stage_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ELIGIBILITY_STATUSES,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MAX_REQUIRED_CAPABILITIES,
  MAX_REQUIRED_MODALITIES,
  MAX_STAGE_SEQUENCE,
  MAX_TOKENS_REFERENCE,
  NULLABLE_REFERENCE_FIELDS,
  ORDERED_LIST_FIELDS,
  RUNTIME_SCHEDULER_STAGE_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_STAGE_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_STAGE_REFERENCE_VALIDATOR_VERSION,
  SCHEDULER_STAGE_STATUSES,
  STATUS_ELIGIBILITY_MAP,
  buildRuntimeSchedulerStageReference,
  computeSchedulerStageFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeSchedulerStageReference
};

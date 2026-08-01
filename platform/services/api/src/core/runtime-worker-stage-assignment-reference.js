'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { STAGE_TYPES } = require('./orchestrator-plan-stage');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES } = require('./model-contract');
const { isOrderedUniqueEnumList } = require('./model-selection-task-profile');

// pr106: the final, per-stage declarative outcome -- "recommended_worker_reference_id não constitui
// lease, reserva ou autorização de dispatch." A stage already WAITING_DEPENDENCY_REFERENCE/
// WAITING_APPROVAL_REFERENCE at the Scheduler layer (PR #105) stays waiting here too, regardless of
// whether a compatible worker exists; a blocked stage never receives a recommendation at all.
// worker_reserved/worker_started/stage_dispatched/stage_started are permanently forced false --
// this contract only ever recommends, never assigns.
const RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_stage_assignment_reference_validator_v1';

const ASSIGNMENT_STATUSES = Object.freeze([
  'WORKER_RECOMMENDED_SIMULATION', 'WORKER_NOT_REQUIRED_REFERENCE', 'WORKER_WAITING_APPROVAL_REFERENCE',
  'WORKER_WAITING_DEPENDENCY_REFERENCE', 'WORKER_NO_COMPATIBLE_CANDIDATE_BLOCKED', 'WORKER_ASSIGNMENT_BLOCKED'
]);

const RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS = Object.freeze([
  'worker_stage_assignment_reference_id', 'worker_stage_assignment_reference_version',
  'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'scheduler_stage_reference_id', 'runtime_stage_reference_id', 'worker_candidate_set_reference_id',
  'recommended_worker_reference_id',
  'assignment_status', 'assignment_reason_codes',
  'stage_type', 'priority', 'parallelizable', 'approval_required', 'required_capability_ids',
  'required_modality_ids', 'estimated_total_tokens', 'estimated_cost_minor_units',
  'worker_assignment_validated', 'worker_assignment_applied', 'worker_reserved', 'worker_started',
  'stage_dispatched', 'stage_started',
  'assignment_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_SAFE_FLAGS = Object.freeze({
  worker_assignment_applied: false,
  worker_reserved: false,
  worker_started: false,
  stage_dispatched: false,
  stage_started: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;
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

function computeAssignmentFingerprint(reference) {
  const { assignment_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerStageAssignmentReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_stage_assignment_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS, 'runtime_worker_stage_assignment_reference', errors);
  for (const field of [
    'worker_stage_assignment_reference_id', 'runtime_worker_assignment_package_id', 'runtime_scheduler_package_id',
    'runtime_execution_package_id', 'scheduler_stage_reference_id', 'runtime_stage_reference_id',
    'worker_candidate_set_reference_id', 'assignment_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_stage_assignment_reference_version) || reference.worker_stage_assignment_reference_version < 1) {
    errors.push('worker_stage_assignment_reference_version_invalid');
  }
  if (reference.recommended_worker_reference_id !== null && !isNonEmptyString(reference.recommended_worker_reference_id)) {
    errors.push('recommended_worker_reference_id_must_be_null_or_string');
  }
  if (!ASSIGNMENT_STATUSES.includes(reference.assignment_status)) errors.push('assignment_status_invalid');
  else if (reference.assignment_status !== 'WORKER_RECOMMENDED_SIMULATION' && reference.recommended_worker_reference_id !== null) {
    errors.push('recommended_worker_reference_id_must_be_null_unless_recommended');
  } else if (reference.assignment_status === 'WORKER_RECOMMENDED_SIMULATION' && reference.recommended_worker_reference_id === null) {
    errors.push('recommended_worker_reference_id_required_when_recommended');
  }
  if (!isOrderedUniqueStringList(reference.assignment_reason_codes)) errors.push('assignment_reason_codes_invalid');
  if (!STAGE_TYPES.includes(reference.stage_type)) errors.push(`stage_type_not_allowed::${reference.stage_type}`);
  if (!Number.isInteger(reference.priority) || reference.priority < 0 || reference.priority > MAX_PRIORITY) errors.push('priority_invalid');
  for (const field of ['parallelizable', 'approval_required']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isOrderedUniqueEnumList(reference.required_capability_ids, CAPABILITY_TYPES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_capability_ids_invalid');
  }
  if (!isOrderedUniqueEnumList(reference.required_modality_ids, MODALITIES, { maxItems: MAX_LIST_ITEMS })) {
    errors.push('required_modality_ids_invalid');
  }
  if (!Number.isInteger(reference.estimated_total_tokens) || reference.estimated_total_tokens < 0 || reference.estimated_total_tokens > MAX_TOKENS) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (!Number.isInteger(reference.estimated_cost_minor_units) || reference.estimated_cost_minor_units < 0 || reference.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (typeof reference.worker_assignment_validated !== 'boolean') errors.push('worker_assignment_validated_must_be_boolean');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeAssignmentFingerprint(reference) !== reference.assignment_fingerprint) errors.push('assignment_fingerprint_mismatch');
  } catch (error) {
    errors.push('assignment_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerStageAssignmentReference(input = {}) {
  const status = ASSIGNMENT_STATUSES.includes(input.assignment_status) ? input.assignment_status : 'WORKER_ASSIGNMENT_BLOCKED';
  const reference = {
    worker_stage_assignment_reference_id: input.worker_stage_assignment_reference_id,
    worker_stage_assignment_reference_version: Number.isInteger(input.worker_stage_assignment_reference_version) ? input.worker_stage_assignment_reference_version : 1,
    runtime_worker_assignment_package_id: input.runtime_worker_assignment_package_id,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    scheduler_stage_reference_id: input.scheduler_stage_reference_id,
    runtime_stage_reference_id: input.runtime_stage_reference_id,
    worker_candidate_set_reference_id: input.worker_candidate_set_reference_id,
    recommended_worker_reference_id: status === 'WORKER_RECOMMENDED_SIMULATION' ? (input.recommended_worker_reference_id || null) : null,
    assignment_status: status,
    assignment_reason_codes: Array.isArray(input.assignment_reason_codes) ? uniqueSorted(input.assignment_reason_codes) : [],
    stage_type: input.stage_type,
    priority: Number.isInteger(input.priority) ? input.priority : 0,
    parallelizable: input.parallelizable === true,
    approval_required: input.approval_required === true,
    required_capability_ids: Array.isArray(input.required_capability_ids) ? input.required_capability_ids : [],
    required_modality_ids: Array.isArray(input.required_modality_ids) ? input.required_modality_ids : [],
    estimated_total_tokens: Number.isInteger(input.estimated_total_tokens) ? input.estimated_total_tokens : 0,
    estimated_cost_minor_units: Number.isInteger(input.estimated_cost_minor_units) ? input.estimated_cost_minor_units : 0,
    worker_assignment_validated: true,
    assignment_fingerprint: 'pending',
    ...RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_VALIDATOR_VERSION
  };
  reference.assignment_fingerprint = computeAssignmentFingerprint(reference);

  const validation = validateRuntimeWorkerStageAssignmentReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_stage_assignment_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  ASSIGNMENT_STATUSES,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_PRIORITY,
  MAX_TOKENS,
  RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_FIELDS,
  RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_STAGE_ASSIGNMENT_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerStageAssignmentReference,
  computeAssignmentFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeWorkerStageAssignmentReference
};

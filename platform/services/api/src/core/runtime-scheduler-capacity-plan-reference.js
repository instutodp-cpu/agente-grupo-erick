'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr105: "requested values derivados do package/manifests; available values derivados do
// snapshot/concurrency; flags recalculadas." runtime-scheduler-boundary.js is the only place that
// actually derives `requested_*` (from the real Runtime Stage Manifest, never accepted as declared
// by the caller) and `available_*` (from the real Capacity Snapshot/Concurrency Reference); this
// contract only validates the resulting 8-dimension within-limit comparison is internally
// consistent. No capacity is ever reserved and no slot is ever consumed here
// (capacity_reserved/slots_consumed/capacity_plan_applied are permanently forced false).
const RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_VALIDATOR_VERSION = 'runtime_scheduler_capacity_plan_reference_validator_v1';

// [requested field, available field, within-limit field] triples -- one per capacity dimension.
const CAPACITY_PLAN_DIMENSIONS = Object.freeze([
  ['requested_package_slots', 'available_package_slots', 'package_capacity_within_limit'],
  ['requested_stage_slots', 'available_stage_slots', 'stage_capacity_within_limit'],
  ['requested_parallel_stage_slots', 'available_parallel_stage_slots', 'parallel_capacity_within_limit'],
  ['requested_model_stage_slots', 'available_model_stage_slots', 'model_capacity_within_limit'],
  ['requested_tool_stage_slots', 'available_tool_stage_slots', 'tool_capacity_within_limit'],
  ['requested_workflow_stage_slots', 'available_workflow_stage_slots', 'workflow_capacity_within_limit'],
  ['requested_tokens', 'available_tokens', 'token_capacity_within_limit'],
  ['requested_cost_minor_units', 'available_cost_minor_units', 'cost_capacity_within_limit']
]);

const REQUESTED_FIELDS = Object.freeze(CAPACITY_PLAN_DIMENSIONS.map((d) => d[0]));
const AVAILABLE_FIELDS = Object.freeze(CAPACITY_PLAN_DIMENSIONS.map((d) => d[1]));
const WITHIN_LIMIT_FIELDS = Object.freeze(CAPACITY_PLAN_DIMENSIONS.map((d) => d[2]));

const RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS = Object.freeze([
  'scheduler_capacity_plan_reference_id', 'scheduler_capacity_plan_reference_version',
  'runtime_scheduler_package_id', 'runtime_execution_package_id',
  'runtime_capacity_snapshot_reference_id', 'runtime_concurrency_reference_id',
  ...REQUESTED_FIELDS, ...AVAILABLE_FIELDS, ...WITHIN_LIMIT_FIELDS,
  'capacity_plan_validated', 'capacity_plan_applied', 'capacity_reserved', 'slots_consumed',
  'capacity_plan_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_SAFE_FLAGS = Object.freeze({
  capacity_plan_applied: false,
  capacity_reserved: false,
  slots_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_CAPACITY_BOUND = 1000000000;

function computeCapacityPlanFingerprint(reference) {
  const { capacity_plan_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeSchedulerCapacityPlanReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_scheduler_capacity_plan_reference_must_be_object'] };
  exactFields(reference, RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS, 'runtime_scheduler_capacity_plan_reference', errors);
  for (const field of [
    'scheduler_capacity_plan_reference_id', 'runtime_scheduler_package_id', 'runtime_execution_package_id',
    'runtime_capacity_snapshot_reference_id', 'runtime_concurrency_reference_id', 'capacity_plan_fingerprint',
    'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.scheduler_capacity_plan_reference_version) || reference.scheduler_capacity_plan_reference_version < 1) {
    errors.push('scheduler_capacity_plan_reference_version_invalid');
  }
  for (const field of [...REQUESTED_FIELDS, ...AVAILABLE_FIELDS]) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_CAPACITY_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [requestedField, availableField, withinLimitField] of CAPACITY_PLAN_DIMENSIONS) {
    if (typeof reference[withinLimitField] !== 'boolean') {
      errors.push(`${withinLimitField}_must_be_boolean`);
      continue;
    }
    if (Number.isInteger(reference[requestedField]) && Number.isInteger(reference[availableField])) {
      const expected = reference[availableField] >= reference[requestedField];
      if (reference[withinLimitField] !== expected) errors.push(`${withinLimitField}_does_not_match_requested_and_available`);
    }
  }
  const expectedValidated = WITHIN_LIMIT_FIELDS.every((field) => reference[field] === true);
  if (typeof reference.capacity_plan_validated !== 'boolean') errors.push('capacity_plan_validated_must_be_boolean');
  else if (reference.capacity_plan_validated !== expectedValidated) errors.push('capacity_plan_validated_inconsistent_with_limits');
  for (const [field, expected] of Object.entries(RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeCapacityPlanFingerprint(reference) !== reference.capacity_plan_fingerprint) errors.push('capacity_plan_fingerprint_mismatch');
  } catch (error) {
    errors.push('capacity_plan_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeSchedulerCapacityPlanReference(input = {}) {
  const reference = {
    scheduler_capacity_plan_reference_id: input.scheduler_capacity_plan_reference_id,
    scheduler_capacity_plan_reference_version: Number.isInteger(input.scheduler_capacity_plan_reference_version) ? input.scheduler_capacity_plan_reference_version : 1,
    runtime_scheduler_package_id: input.runtime_scheduler_package_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    runtime_capacity_snapshot_reference_id: input.runtime_capacity_snapshot_reference_id,
    runtime_concurrency_reference_id: input.runtime_concurrency_reference_id,
    capacity_plan_fingerprint: 'pending',
    ...RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of [...REQUESTED_FIELDS, ...AVAILABLE_FIELDS]) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  for (const [requestedField, availableField, withinLimitField] of CAPACITY_PLAN_DIMENSIONS) {
    reference[withinLimitField] = reference[availableField] >= reference[requestedField];
  }
  reference.capacity_plan_validated = WITHIN_LIMIT_FIELDS.every((field) => reference[field] === true);
  reference.capacity_plan_fingerprint = computeCapacityPlanFingerprint(reference);

  const validation = validateRuntimeSchedulerCapacityPlanReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_scheduler_capacity_plan_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  AVAILABLE_FIELDS,
  CAPACITY_PLAN_DIMENSIONS,
  MAX_CAPACITY_BOUND,
  REQUESTED_FIELDS,
  RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_FIELDS,
  RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_SAFE_FLAGS,
  RUNTIME_SCHEDULER_CAPACITY_PLAN_REFERENCE_VALIDATOR_VERSION,
  WITHIN_LIMIT_FIELDS,
  buildRuntimeSchedulerCapacityPlanReference,
  computeCapacityPlanFingerprint,
  validateRuntimeSchedulerCapacityPlanReference
};

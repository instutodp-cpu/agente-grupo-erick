'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr107: cross-checks a single Dispatch Stage's own requested slots/tokens/cost (derived from the
// Stage itself, never invented) against BOTH the runtime-wide Capacity Snapshot/Concurrency
// Reference and the specific worker's own Capacity Reference -- "Nenhuma capacidade aplicada ou
// reservada." `capacity_validated` is a pure derived boolean, true only when every one of the 14
// `*_capacity_available` flags is true.
const RUNTIME_DISPATCH_CAPACITY_REFERENCE_VALIDATOR_VERSION = 'runtime_dispatch_capacity_reference_validator_v1';

const REQUESTED_FIELDS = Object.freeze([
  'requested_stage_slots', 'requested_parallel_slots', 'requested_model_slots', 'requested_tool_slots',
  'requested_workflow_slots', 'requested_tokens', 'requested_cost_minor_units'
]);

const AVAILABILITY_FLAG_FIELDS = Object.freeze([
  'runtime_stage_capacity_available', 'runtime_parallel_capacity_available', 'runtime_model_capacity_available',
  'runtime_tool_capacity_available', 'runtime_workflow_capacity_available', 'runtime_token_capacity_available',
  'runtime_cost_capacity_available',
  'worker_stage_capacity_available', 'worker_parallel_capacity_available', 'worker_model_capacity_available',
  'worker_tool_capacity_available', 'worker_workflow_capacity_available', 'worker_token_capacity_available',
  'worker_cost_capacity_available'
]);

const RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS = Object.freeze([
  'dispatch_capacity_reference_id', 'dispatch_capacity_reference_version',
  'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id', 'runtime_worker_reference_id',
  'runtime_capacity_snapshot_reference_id', 'runtime_concurrency_reference_id', 'worker_capacity_reference_id',
  ...REQUESTED_FIELDS,
  ...AVAILABILITY_FLAG_FIELDS,
  'capacity_validated', 'capacity_applied', 'capacity_reserved', 'slots_consumed',
  'reason_codes',
  'capacity_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_DISPATCH_CAPACITY_REFERENCE_SAFE_FLAGS = Object.freeze({
  capacity_applied: false,
  capacity_reserved: false,
  slots_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_LIST_ITEMS = 50;
const MAX_SLOTS = 1000000;
const MAX_TOKENS = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function computeCapacityFingerprint(reference) {
  const { capacity_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeDispatchCapacityReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_dispatch_capacity_reference_must_be_object'] };
  exactFields(reference, RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS, 'runtime_dispatch_capacity_reference', errors);
  for (const field of [
    'dispatch_capacity_reference_id', 'runtime_dispatch_package_id', 'runtime_dispatch_stage_reference_id',
    'runtime_worker_reference_id', 'runtime_capacity_snapshot_reference_id', 'runtime_concurrency_reference_id',
    'worker_capacity_reference_id', 'capacity_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.dispatch_capacity_reference_version) || reference.dispatch_capacity_reference_version < 1) {
    errors.push('dispatch_capacity_reference_version_invalid');
  }
  for (const field of REQUESTED_FIELDS) {
    const bound = field.endsWith('tokens') ? MAX_TOKENS : field.endsWith('minor_units') ? MAX_COST_MINOR_UNITS : MAX_SLOTS;
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > bound) errors.push(`${field}_invalid`);
  }
  for (const field of AVAILABILITY_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof reference.capacity_validated !== 'boolean') errors.push('capacity_validated_must_be_boolean');
  if (AVAILABILITY_FLAG_FIELDS.every((field) => typeof reference[field] === 'boolean')) {
    const expectedValidated = AVAILABILITY_FLAG_FIELDS.every((field) => reference[field] === true);
    if (reference.capacity_validated !== expectedValidated) errors.push('capacity_validated_inconsistent_with_availability_flags');
  }
  if (!isOrderedUniqueStringList(reference.reason_codes)) errors.push('reason_codes_invalid');
  for (const [field, expected] of Object.entries(RUNTIME_DISPATCH_CAPACITY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_DISPATCH_CAPACITY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeCapacityFingerprint(reference) !== reference.capacity_fingerprint) errors.push('capacity_fingerprint_mismatch');
  } catch (error) {
    errors.push('capacity_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeDispatchCapacityReference(input = {}) {
  const reference = {
    dispatch_capacity_reference_id: input.dispatch_capacity_reference_id,
    dispatch_capacity_reference_version: Number.isInteger(input.dispatch_capacity_reference_version) ? input.dispatch_capacity_reference_version : 1,
    runtime_dispatch_package_id: input.runtime_dispatch_package_id,
    runtime_dispatch_stage_reference_id: input.runtime_dispatch_stage_reference_id,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    runtime_capacity_snapshot_reference_id: input.runtime_capacity_snapshot_reference_id,
    runtime_concurrency_reference_id: input.runtime_concurrency_reference_id,
    worker_capacity_reference_id: input.worker_capacity_reference_id,
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    capacity_fingerprint: 'pending',
    ...RUNTIME_DISPATCH_CAPACITY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_DISPATCH_CAPACITY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of REQUESTED_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  for (const field of AVAILABILITY_FLAG_FIELDS) {
    reference[field] = input[field] === true;
  }
  reference.capacity_validated = AVAILABILITY_FLAG_FIELDS.every((field) => reference[field] === true);

  reference.capacity_fingerprint = computeCapacityFingerprint(reference);

  const validation = validateRuntimeDispatchCapacityReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_dispatch_capacity_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  AVAILABILITY_FLAG_FIELDS,
  MAX_COST_MINOR_UNITS,
  MAX_LIST_ITEMS,
  MAX_SLOTS,
  MAX_TOKENS,
  REQUESTED_FIELDS,
  RUNTIME_DISPATCH_CAPACITY_REFERENCE_FIELDS,
  RUNTIME_DISPATCH_CAPACITY_REFERENCE_SAFE_FLAGS,
  RUNTIME_DISPATCH_CAPACITY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeDispatchCapacityReference,
  computeCapacityFingerprint,
  isOrderedUniqueStringList,
  validateRuntimeDispatchCapacityReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// pr106: a declarative capacity snapshot for a single synthetic worker -- mirrors
// runtime-capacity-snapshot-reference.js's own total/used/available-per-dimension discipline
// exactly, one worker at a time instead of the whole package. No capacity is ever reserved and no
// slot is ever consumed here (capacity_applied/capacity_reserved/slots_consumed are always false);
// this contract only records the numbers and lets the boundary compare them against real stage
// requirements.
const RUNTIME_WORKER_CAPACITY_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_capacity_reference_validator_v1';

// [maximum field, current/used field, available field] triples -- 7 dimensions.
const CAPACITY_DIMENSIONS = Object.freeze([
  ['maximum_stage_assignments', 'current_stage_assignments', 'available_stage_assignments'],
  ['maximum_parallel_assignments', 'current_parallel_assignments', 'available_parallel_assignments'],
  ['maximum_model_assignments', 'current_model_assignments', 'available_model_assignments'],
  ['maximum_tool_assignments', 'current_tool_assignments', 'available_tool_assignments'],
  ['maximum_workflow_assignments', 'current_workflow_assignments', 'available_workflow_assignments'],
  ['maximum_token_capacity', 'used_token_capacity', 'available_token_capacity'],
  ['maximum_cost_capacity_minor_units', 'used_cost_capacity_minor_units', 'available_cost_capacity_minor_units']
]);

const CAPACITY_NUMERIC_FIELDS = Object.freeze(CAPACITY_DIMENSIONS.flat());

const RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS = Object.freeze([
  'worker_capacity_reference_id', 'worker_capacity_reference_version', 'runtime_worker_reference_id',
  ...CAPACITY_NUMERIC_FIELDS,
  'capacity_consistent', 'capacity_available', 'capacity_validated', 'capacity_applied', 'capacity_reserved',
  'slots_consumed',
  'capacity_fingerprint', 'capacity_digest',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_CAPACITY_REFERENCE_SAFE_FLAGS = Object.freeze({
  capacity_applied: false,
  capacity_reserved: false,
  slots_consumed: false,
  simulation: true,
  production_blocked: true
});

const MAX_CAPACITY_BOUND = 1000000000;

function computeCapacityFingerprint(reference) {
  const { capacity_fingerprint, capacity_digest, ...rest } = reference;
  return stablePayload(rest);
}

function computeCapacityDigest(reference) {
  const { capacity_digest, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeWorkerCapacityReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_capacity_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS, 'runtime_worker_capacity_reference', errors);
  for (const field of ['worker_capacity_reference_id', 'runtime_worker_reference_id', 'capacity_fingerprint', 'capacity_digest', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_capacity_reference_version) || reference.worker_capacity_reference_version < 1) {
    errors.push('worker_capacity_reference_version_invalid');
  }
  for (const field of CAPACITY_NUMERIC_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_CAPACITY_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [totalField, usedField, availableField] of CAPACITY_DIMENSIONS) {
    const total = reference[totalField];
    const used = reference[usedField];
    const available = reference[availableField];
    if (Number.isInteger(total) && Number.isInteger(used) && Number.isInteger(available)) {
      if (used + available !== total) errors.push(`${totalField}_not_equal_to_used_plus_available`);
      if (used > total) errors.push(`${usedField}_exceeds_total`);
    }
  }
  for (const field of ['capacity_consistent', 'capacity_available', 'capacity_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const expectedConsistent = CAPACITY_DIMENSIONS.every(([t, u, a]) => (
    Number.isInteger(reference[t]) && Number.isInteger(reference[u]) && Number.isInteger(reference[a]) && reference[u] + reference[a] === reference[t]
  ));
  if (reference.capacity_consistent !== expectedConsistent) errors.push('capacity_consistent_does_not_match_dimensions');
  if (typeof reference.capacity_available === 'boolean' && typeof reference.capacity_validated === 'boolean') {
    const expectedValidated = expectedConsistent && reference.capacity_available === true;
    if (reference.capacity_validated !== expectedValidated) errors.push('capacity_validated_inconsistent_with_dimensions');
  }
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_CAPACITY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_CAPACITY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
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
  try {
    if (computeCapacityDigest(reference) !== reference.capacity_digest) errors.push('capacity_digest_mismatch');
  } catch (error) {
    errors.push('capacity_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerCapacityReference(input = {}) {
  const consistent = CAPACITY_DIMENSIONS.every(([t, u, a]) => (
    Number.isInteger(input[t]) && Number.isInteger(input[u]) && Number.isInteger(input[a]) && input[u] + input[a] === input[t]
  ));
  const reference = {
    worker_capacity_reference_id: input.worker_capacity_reference_id,
    worker_capacity_reference_version: Number.isInteger(input.worker_capacity_reference_version) ? input.worker_capacity_reference_version : 1,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    capacity_consistent: consistent,
    capacity_available: input.capacity_available === true,
    capacity_validated: consistent && input.capacity_available === true,
    capacity_fingerprint: 'pending',
    capacity_digest: 'pending',
    ...RUNTIME_WORKER_CAPACITY_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_CAPACITY_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of CAPACITY_NUMERIC_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.capacity_fingerprint = computeCapacityFingerprint(reference);
  reference.capacity_digest = computeCapacityDigest(reference);

  const validation = validateRuntimeWorkerCapacityReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_capacity_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CAPACITY_DIMENSIONS,
  CAPACITY_NUMERIC_FIELDS,
  MAX_CAPACITY_BOUND,
  RUNTIME_WORKER_CAPACITY_REFERENCE_FIELDS,
  RUNTIME_WORKER_CAPACITY_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_CAPACITY_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerCapacityReference,
  computeCapacityDigest,
  computeCapacityFingerprint,
  validateRuntimeWorkerCapacityReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// pr104: a versioned, fingerprinted snapshot of declarative capacity -- "RuntimeCapacitySnapshotReference
// descreve capacidade declarativa. Ela não representa recursos reais reservados." No resource is
// ever reserved here (capacity_applied is always false); this contract only records
// total/used/available per dimension and lets the boundary compare them against a real Runtime
// Package's requirements. `capacity_available` is accepted as a caller-supplied boolean (the same
// "caller decides, this contract only records" shape runtime-budget-simulation-reference.js already
// established for its own stage_counts_within_limit) -- the contract never derives it in isolation
// from total/used/available alone, since it has no package-requirement fields of its own; the real
// adequacy proof is runtime-admission-boundary.js's own independent recomputation against the real
// Runtime Package (never trusting this field as declared).
const RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION = 'runtime_capacity_snapshot_reference_validator_v1';

// Each dimension's [total-or-maximum field, used field, available field] triple -- tokens/cost use
// a `maximum_*` prefix instead of `total_*`, exactly as the spec's own field list names them.
const CAPACITY_DIMENSIONS = Object.freeze([
  ['total_package_capacity', 'used_package_capacity', 'available_package_capacity'],
  ['total_stage_capacity', 'used_stage_capacity', 'available_stage_capacity'],
  ['total_parallel_stage_capacity', 'used_parallel_stage_capacity', 'available_parallel_stage_capacity'],
  ['total_model_stage_capacity', 'used_model_stage_capacity', 'available_model_stage_capacity'],
  ['total_tool_stage_capacity', 'used_tool_stage_capacity', 'available_tool_stage_capacity'],
  ['total_workflow_stage_capacity', 'used_workflow_stage_capacity', 'available_workflow_stage_capacity'],
  ['maximum_tokens_capacity', 'used_tokens_capacity', 'available_tokens_capacity'],
  ['maximum_cost_capacity_minor_units', 'used_cost_capacity_minor_units', 'available_cost_capacity_minor_units']
]);

const CAPACITY_NUMERIC_FIELDS = Object.freeze(CAPACITY_DIMENSIONS.flat());

const RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS = Object.freeze([
  'runtime_capacity_snapshot_reference_id', 'runtime_capacity_snapshot_reference_version',
  'runtime_environment_reference_id', 'runtime_registry_snapshot_reference_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id',
  ...CAPACITY_NUMERIC_FIELDS,
  'snapshot_created_logical_sequence', 'current_logical_sequence', 'maximum_valid_sequences',
  'snapshot_expired_logically',
  'capacity_consistent', 'capacity_available', 'capacity_validated', 'capacity_applied',
  'capacity_fingerprint', 'capacity_digest',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS = Object.freeze({
  capacity_applied: false,
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

function validateRuntimeCapacitySnapshotReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_capacity_snapshot_reference_must_be_object'] };
  exactFields(reference, RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS, 'runtime_capacity_snapshot_reference', errors);
  for (const field of [
    'runtime_capacity_snapshot_reference_id', 'runtime_environment_reference_id',
    'runtime_registry_snapshot_reference_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'agent_id', 'capacity_fingerprint', 'capacity_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_capacity_snapshot_reference_version) || reference.runtime_capacity_snapshot_reference_version < 1) {
    errors.push('runtime_capacity_snapshot_reference_version_invalid');
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
      if (available > total) errors.push(`${availableField}_exceeds_total`);
    }
  }
  for (const field of ['snapshot_created_logical_sequence', 'current_logical_sequence', 'maximum_valid_sequences']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.current_logical_sequence) && Number.isInteger(reference.snapshot_created_logical_sequence)
    && reference.current_logical_sequence < reference.snapshot_created_logical_sequence
  ) {
    errors.push('current_logical_sequence_before_snapshot_created');
  }
  const expectedExpired = Number.isInteger(reference.current_logical_sequence) && Number.isInteger(reference.snapshot_created_logical_sequence)
    && Number.isInteger(reference.maximum_valid_sequences)
    ? (reference.current_logical_sequence - reference.snapshot_created_logical_sequence) > reference.maximum_valid_sequences
    : true;
  if (reference.snapshot_expired_logically !== expectedExpired) errors.push('snapshot_expired_logically_does_not_match_sequences');

  for (const field of ['capacity_consistent', 'capacity_available', 'capacity_validated']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const expectedConsistent = CAPACITY_DIMENSIONS.every(([t, u, a]) => (
    Number.isInteger(reference[t]) && Number.isInteger(reference[u]) && Number.isInteger(reference[a]) && reference[u] + reference[a] === reference[t]
  ));
  if (reference.capacity_consistent !== expectedConsistent) errors.push('capacity_consistent_does_not_match_dimensions');
  if (typeof reference.snapshot_expired_logically === 'boolean' && typeof reference.capacity_available === 'boolean' && typeof reference.capacity_validated === 'boolean') {
    const expectedValidated = expectedConsistent && reference.snapshot_expired_logically === false && reference.capacity_available === true;
    if (reference.capacity_validated !== expectedValidated) errors.push('capacity_validated_inconsistent_with_dimensions');
  }

  for (const [field, expected] of Object.entries(RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
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

function buildRuntimeCapacitySnapshotReference(input = {}) {
  const expiredLogically = Number.isInteger(input.current_logical_sequence) && Number.isInteger(input.snapshot_created_logical_sequence)
    && Number.isInteger(input.maximum_valid_sequences)
    ? (input.current_logical_sequence - input.snapshot_created_logical_sequence) > input.maximum_valid_sequences
    : true;
  const consistent = CAPACITY_DIMENSIONS.every(([t, u, a]) => (
    Number.isInteger(input[t]) && Number.isInteger(input[u]) && Number.isInteger(input[a]) && input[u] + input[a] === input[t]
  ));

  const reference = {
    runtime_capacity_snapshot_reference_id: input.runtime_capacity_snapshot_reference_id,
    runtime_capacity_snapshot_reference_version: Number.isInteger(input.runtime_capacity_snapshot_reference_version) ? input.runtime_capacity_snapshot_reference_version : 1,
    runtime_environment_reference_id: input.runtime_environment_reference_id,
    runtime_registry_snapshot_reference_id: input.runtime_registry_snapshot_reference_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    snapshot_created_logical_sequence: Number.isInteger(input.snapshot_created_logical_sequence) ? input.snapshot_created_logical_sequence : 0,
    current_logical_sequence: Number.isInteger(input.current_logical_sequence) ? input.current_logical_sequence : 0,
    maximum_valid_sequences: Number.isInteger(input.maximum_valid_sequences) ? input.maximum_valid_sequences : 0,
    snapshot_expired_logically: expiredLogically,
    capacity_consistent: consistent,
    capacity_available: input.capacity_available === true,
    capacity_validated: consistent && !expiredLogically && input.capacity_available === true,
    capacity_fingerprint: 'pending',
    capacity_digest: 'pending',
    ...RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of CAPACITY_NUMERIC_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.capacity_fingerprint = computeCapacityFingerprint(reference);
  reference.capacity_digest = computeCapacityDigest(reference);

  const validation = validateRuntimeCapacitySnapshotReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_capacity_snapshot_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CAPACITY_DIMENSIONS,
  CAPACITY_NUMERIC_FIELDS,
  MAX_CAPACITY_BOUND,
  RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_FIELDS,
  RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
  RUNTIME_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeCapacitySnapshotReference,
  computeCapacityDigest,
  computeCapacityFingerprint,
  validateRuntimeCapacitySnapshotReference
};

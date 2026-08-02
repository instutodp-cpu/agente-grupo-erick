'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest } = require('./canonical-content-digest');

// pr108: a versioned, fingerprinted snapshot of declarative queue capacity -- 7 dimensions
// (backlog/inflight/parallel/model/tool/workflow/tokens/cost), each a genuine [maximum, current,
// available] triple with recomputed arithmetic consistency, never a caller-declared `available`.
// "O sistema pode receber um Queue Capacity Snapshot declarativo, mas não deve: consultar fila
// real; contar mensagens reais; reservar slot; alterar backlog." `capacity_applied`/
// `capacity_reserved`/`queue_backlog_changed` are permanently forced `false`. Logical expiration is
// deliberately NOT self-contained here (no `current_logical_sequence` field on this contract) --
// "expiração lógica recalculada no Queue Admission Request," the same discipline
// runtime-capacity-snapshot-reference.js's own sibling one layer below uses for its own
// `current_logical_sequence`, just anchored to the Queue Admission Request's own sequence instead.
const RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION = 'runtime_queue_capacity_snapshot_reference_validator_v1';

const CAPACITY_DIMENSIONS = Object.freeze([
  ['maximum_backlog_count', 'current_backlog_count', 'available_backlog_count'],
  ['maximum_inflight_count', 'current_inflight_count', 'available_inflight_count'],
  ['maximum_parallel_count', 'current_parallel_count', 'available_parallel_count'],
  ['maximum_model_count', 'current_model_count', 'available_model_count'],
  ['maximum_tool_count', 'current_tool_count', 'available_tool_count'],
  ['maximum_workflow_count', 'current_workflow_count', 'available_workflow_count'],
  ['maximum_tokens', 'current_tokens', 'available_tokens'],
  ['maximum_cost_minor_units', 'current_cost_minor_units', 'available_cost_minor_units']
]);

const CAPACITY_NUMERIC_FIELDS = Object.freeze(CAPACITY_DIMENSIONS.flat());

const RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS = Object.freeze([
  'runtime_queue_capacity_snapshot_reference_id', 'runtime_queue_capacity_snapshot_reference_version',
  'runtime_queue_class_reference_id', 'logical_sequence',
  ...CAPACITY_NUMERIC_FIELDS,
  'snapshot_valid_sequences', 'snapshot_expired_logically',
  'capacity_consistent', 'capacity_available', 'capacity_validated', 'capacity_applied', 'capacity_reserved',
  'queue_backlog_changed',
  'capacity_snapshot_fingerprint', 'capacity_snapshot_digest',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS = Object.freeze({
  capacity_applied: false,
  capacity_reserved: false,
  queue_backlog_changed: false,
  simulation: true,
  production_blocked: true
});

const MAX_CAPACITY_BOUND = 1000000000;

function computeQueueCapacitySnapshotFingerprint(reference) {
  const { capacity_snapshot_fingerprint, capacity_snapshot_digest, ...rest } = reference;
  return stablePayload(rest);
}

function computeQueueCapacitySnapshotDigest(reference) {
  const { capacity_snapshot_digest, ...rest } = reference;
  return computeCanonicalContentDigest(rest);
}

function validateRuntimeQueueCapacitySnapshotReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_queue_capacity_snapshot_reference_must_be_object'] };
  exactFields(reference, RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS, 'runtime_queue_capacity_snapshot_reference', errors);
  for (const field of [
    'runtime_queue_capacity_snapshot_reference_id', 'runtime_queue_class_reference_id',
    'capacity_snapshot_fingerprint', 'capacity_snapshot_digest', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_queue_capacity_snapshot_reference_version) || reference.runtime_queue_capacity_snapshot_reference_version < 1) {
    errors.push('runtime_queue_capacity_snapshot_reference_version_invalid');
  }
  if (!Number.isInteger(reference.logical_sequence) || reference.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(reference.snapshot_valid_sequences) || reference.snapshot_valid_sequences < 0) errors.push('snapshot_valid_sequences_invalid');
  for (const field of CAPACITY_NUMERIC_FIELDS) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0 || reference[field] > MAX_CAPACITY_BOUND) errors.push(`${field}_invalid`);
  }
  for (const [maxField, usedField, availableField] of CAPACITY_DIMENSIONS) {
    const maximum = reference[maxField];
    const used = reference[usedField];
    const available = reference[availableField];
    if (Number.isInteger(maximum) && Number.isInteger(used) && Number.isInteger(available)) {
      if (used + available !== maximum) errors.push(`${maxField}_not_equal_to_used_plus_available`);
      if (used > maximum) errors.push(`${usedField}_exceeds_maximum`);
      if (available > maximum) errors.push(`${availableField}_exceeds_maximum`);
    }
  }
  const expectedConsistent = CAPACITY_DIMENSIONS.every(([m, u, a]) => (
    Number.isInteger(reference[m]) && Number.isInteger(reference[u]) && Number.isInteger(reference[a]) && reference[u] + reference[a] === reference[m]
  ));
  for (const field of ['capacity_consistent', 'capacity_available', 'capacity_validated', 'snapshot_expired_logically']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (reference.capacity_consistent !== expectedConsistent) errors.push('capacity_consistent_does_not_match_dimensions');
  if (typeof reference.snapshot_expired_logically === 'boolean' && typeof reference.capacity_available === 'boolean' && typeof reference.capacity_validated === 'boolean') {
    const expectedValidated = expectedConsistent && reference.snapshot_expired_logically === false && reference.capacity_available === true;
    if (reference.capacity_validated !== expectedValidated) errors.push('capacity_validated_inconsistent_with_dimensions');
  }
  for (const [field, expected] of Object.entries(RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeQueueCapacitySnapshotFingerprint(reference) !== reference.capacity_snapshot_fingerprint) errors.push('capacity_snapshot_fingerprint_mismatch');
  } catch (error) {
    errors.push('capacity_snapshot_fingerprint_mismatch');
  }
  try {
    if (computeQueueCapacitySnapshotDigest(reference) !== reference.capacity_snapshot_digest) errors.push('capacity_snapshot_digest_mismatch');
  } catch (error) {
    errors.push('capacity_snapshot_digest_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeQueueCapacitySnapshotReference(input = {}) {
  const consistent = CAPACITY_DIMENSIONS.every(([m, u, a]) => (
    Number.isInteger(input[m]) && Number.isInteger(input[u]) && Number.isInteger(input[a]) && input[u] + input[a] === input[m]
  ));
  const expiredLogically = input.snapshot_expired_logically === true;

  const reference = {
    runtime_queue_capacity_snapshot_reference_id: input.runtime_queue_capacity_snapshot_reference_id,
    runtime_queue_capacity_snapshot_reference_version: Number.isInteger(input.runtime_queue_capacity_snapshot_reference_version) ? input.runtime_queue_capacity_snapshot_reference_version : 1,
    runtime_queue_class_reference_id: input.runtime_queue_class_reference_id,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    snapshot_valid_sequences: Number.isInteger(input.snapshot_valid_sequences) ? input.snapshot_valid_sequences : 0,
    snapshot_expired_logically: expiredLogically,
    capacity_consistent: consistent,
    capacity_available: input.capacity_available === true,
    capacity_validated: consistent && !expiredLogically && input.capacity_available === true,
    capacity_snapshot_fingerprint: 'pending',
    capacity_snapshot_digest: 'pending',
    ...RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of CAPACITY_NUMERIC_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  reference.capacity_snapshot_fingerprint = computeQueueCapacitySnapshotFingerprint(reference);
  reference.capacity_snapshot_digest = computeQueueCapacitySnapshotDigest(reference);

  const validation = validateRuntimeQueueCapacitySnapshotReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_queue_capacity_snapshot_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CAPACITY_DIMENSIONS,
  CAPACITY_NUMERIC_FIELDS,
  MAX_CAPACITY_BOUND,
  RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_FIELDS,
  RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_SAFE_FLAGS,
  RUNTIME_QUEUE_CAPACITY_SNAPSHOT_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeQueueCapacitySnapshotReference,
  computeQueueCapacitySnapshotDigest,
  computeQueueCapacitySnapshotFingerprint,
  validateRuntimeQueueCapacitySnapshotReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr106: a declarative health snapshot for a single synthetic worker -- "Não executar health check
// real." `health_status` is a caller-declared value the boundary treats as a claim, never
// independently probed; `health_expired_logically` is the one field genuinely recomputed here,
// using the same logical-sequence expiration math every freshness reference in this codebase
// already follows (expired = (current - created) > maximum). Only `HEALTHY_REFERENCE_SIMULATION`
// can be selected by default -- see runtime-worker-assignment-boundary.js's own compatibility
// derivation.
const RUNTIME_WORKER_HEALTH_REFERENCE_VALIDATOR_VERSION = 'runtime_worker_health_reference_validator_v1';

const HEALTH_STATUSES = Object.freeze([
  'HEALTHY_REFERENCE_SIMULATION', 'DEGRADED_REFERENCE', 'UNHEALTHY_REFERENCE', 'UNKNOWN_REFERENCE', 'EXPIRED_REFERENCE'
]);

const BINDING_VALID_FIELDS = Object.freeze([
  'configuration_valid', 'registration_valid', 'capability_reference_valid', 'capacity_reference_valid',
  'policy_references_valid'
]);

const RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS = Object.freeze([
  'worker_health_reference_id', 'worker_health_reference_version', 'runtime_worker_reference_id',
  'health_status', 'health_source_type',
  'health_created_logical_sequence', 'current_logical_sequence', 'maximum_valid_sequences', 'health_expired_logically',
  ...BINDING_VALID_FIELDS,
  'health_validated', 'health_applied',
  'health_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_WORKER_HEALTH_REFERENCE_SAFE_FLAGS = Object.freeze({
  health_applied: false,
  simulation: true,
  production_blocked: true
});

function computeHealthFingerprint(reference) {
  const { health_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeWorkerHealthReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_worker_health_reference_must_be_object'] };
  exactFields(reference, RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS, 'runtime_worker_health_reference', errors);
  for (const field of ['worker_health_reference_id', 'runtime_worker_reference_id', 'health_source_type', 'health_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.worker_health_reference_version) || reference.worker_health_reference_version < 1) {
    errors.push('worker_health_reference_version_invalid');
  }
  if (!HEALTH_STATUSES.includes(reference.health_status)) errors.push('health_status_invalid');
  for (const field of ['health_created_logical_sequence', 'current_logical_sequence', 'maximum_valid_sequences']) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(reference.current_logical_sequence) && Number.isInteger(reference.health_created_logical_sequence)
    && reference.current_logical_sequence < reference.health_created_logical_sequence
  ) {
    errors.push('current_logical_sequence_before_health_created_logical_sequence');
  }
  const expectedExpired = Number.isInteger(reference.current_logical_sequence) && Number.isInteger(reference.health_created_logical_sequence)
    && Number.isInteger(reference.maximum_valid_sequences)
    ? (reference.current_logical_sequence - reference.health_created_logical_sequence) > reference.maximum_valid_sequences
    : true;
  if (reference.health_expired_logically !== expectedExpired) errors.push('health_expired_logically_does_not_match_sequences');
  for (const field of BINDING_VALID_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const bindingsValid = BINDING_VALID_FIELDS.every((field) => reference[field] === true);
  const expectedValidated = bindingsValid && reference.health_expired_logically === false && reference.health_status === 'HEALTHY_REFERENCE_SIMULATION';
  if (typeof reference.health_validated !== 'boolean') errors.push('health_validated_must_be_boolean');
  else if (reference.health_validated !== expectedValidated) errors.push('health_validated_inconsistent_with_status_and_bindings');
  for (const [field, expected] of Object.entries(RUNTIME_WORKER_HEALTH_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_WORKER_HEALTH_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeHealthFingerprint(reference) !== reference.health_fingerprint) errors.push('health_fingerprint_mismatch');
  } catch (error) {
    errors.push('health_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeWorkerHealthReference(input = {}) {
  const status = HEALTH_STATUSES.includes(input.health_status) ? input.health_status : 'UNKNOWN_REFERENCE';
  const expired = Number.isInteger(input.current_logical_sequence) && Number.isInteger(input.health_created_logical_sequence)
    && Number.isInteger(input.maximum_valid_sequences)
    ? (input.current_logical_sequence - input.health_created_logical_sequence) > input.maximum_valid_sequences
    : true;
  const reference = {
    worker_health_reference_id: input.worker_health_reference_id,
    worker_health_reference_version: Number.isInteger(input.worker_health_reference_version) ? input.worker_health_reference_version : 1,
    runtime_worker_reference_id: input.runtime_worker_reference_id,
    health_status: status,
    health_source_type: input.health_source_type,
    health_created_logical_sequence: Number.isInteger(input.health_created_logical_sequence) ? input.health_created_logical_sequence : 0,
    current_logical_sequence: Number.isInteger(input.current_logical_sequence) ? input.current_logical_sequence : 0,
    maximum_valid_sequences: Number.isInteger(input.maximum_valid_sequences) ? input.maximum_valid_sequences : 0,
    health_expired_logically: expired,
    health_fingerprint: 'pending',
    ...RUNTIME_WORKER_HEALTH_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_WORKER_HEALTH_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of BINDING_VALID_FIELDS) {
    reference[field] = input[field] === true;
  }
  const bindingsValid = BINDING_VALID_FIELDS.every((field) => reference[field] === true);
  reference.health_validated = bindingsValid && !expired && status === 'HEALTHY_REFERENCE_SIMULATION';
  reference.health_fingerprint = computeHealthFingerprint(reference);

  const validation = validateRuntimeWorkerHealthReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_worker_health_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  BINDING_VALID_FIELDS,
  HEALTH_STATUSES,
  RUNTIME_WORKER_HEALTH_REFERENCE_FIELDS,
  RUNTIME_WORKER_HEALTH_REFERENCE_SAFE_FLAGS,
  RUNTIME_WORKER_HEALTH_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeWorkerHealthReference,
  computeHealthFingerprint,
  validateRuntimeWorkerHealthReference
};

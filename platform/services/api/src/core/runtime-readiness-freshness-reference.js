'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// pr104: recomputes logical-sequence freshness for every reference a Runtime Readiness Request
// carries -- "Readiness e admission recalculam freshness, replay, capacidade e concorrência; não
// confiam em flags soltas fornecidas pelo caller." Mirrors the exact expiration-math pattern
// architecture-gate-evidence-reference.js already established (expired = (current - created) >
// maximum), applied independently to 9 tracked dimensions. No real clock is ever read (`Date`/
// `Date.now`/timers are all forbidden by the architecture gates) -- every sequence is a caller-
// supplied logical counter.
const RUNTIME_READINESS_FRESHNESS_REFERENCE_VALIDATOR_VERSION = 'runtime_readiness_freshness_reference_validator_v1';

// [dimension id field, created-sequence field, maximum-valid-sequences field, expired-logically field]
const FRESHNESS_DIMENSIONS = Object.freeze([
  ['runtime_execution_package_id', 'package_created_logical_sequence', 'maximum_package_valid_sequences', 'package_expired_logically'],
  ['gateway_decision_id', 'gateway_created_logical_sequence', 'maximum_gateway_valid_sequences', 'gateway_expired_logically'],
  ['authorization_decision_id', 'authorization_created_logical_sequence', 'maximum_authorization_valid_sequences', 'authorization_expired_logically'],
  ['authorization_scope_reference_id', 'scope_created_logical_sequence', 'maximum_scope_valid_sequences', 'scope_expired_logically'],
  ['registry_snapshot_reference_id', 'registry_created_logical_sequence', 'maximum_registry_valid_sequences', 'registry_expired_logically'],
  ['architecture_gate_evidence_reference_id', 'architecture_evidence_created_logical_sequence', 'maximum_architecture_evidence_valid_sequences', 'architecture_evidence_expired_logically'],
  ['binding_ledger_id', 'binding_ledger_created_logical_sequence', 'maximum_binding_ledger_valid_sequences', 'binding_ledger_expired_logically'],
  ['validation_ledger_id', 'validation_ledger_created_logical_sequence', 'maximum_validation_ledger_valid_sequences', 'validation_ledger_expired_logically'],
  ['runtime_capacity_snapshot_reference_id', 'capacity_snapshot_created_logical_sequence', 'maximum_capacity_valid_sequences', 'capacity_expired_logically']
]);

const ID_FIELDS = Object.freeze(FRESHNESS_DIMENSIONS.map((d) => d[0]));
const CREATED_SEQUENCE_FIELDS = Object.freeze(FRESHNESS_DIMENSIONS.map((d) => d[1]));
const MAXIMUM_SEQUENCE_FIELDS = Object.freeze(FRESHNESS_DIMENSIONS.map((d) => d[2]));
const EXPIRED_FLAG_FIELDS = Object.freeze(FRESHNESS_DIMENSIONS.map((d) => d[3]));

const RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS = Object.freeze([
  'runtime_readiness_freshness_reference_id', 'runtime_readiness_freshness_reference_version',
  ...ID_FIELDS,
  ...CREATED_SEQUENCE_FIELDS,
  'current_logical_sequence',
  ...MAXIMUM_SEQUENCE_FIELDS,
  ...EXPIRED_FLAG_FIELDS,
  'freshness_validated', 'freshness_applied', 'freshness_fingerprint',
  'simulation', 'production_blocked', 'validator_version'
]);

const RUNTIME_READINESS_FRESHNESS_REFERENCE_SAFE_FLAGS = Object.freeze({
  freshness_applied: false,
  simulation: true,
  production_blocked: true
});

function computeFreshnessFingerprint(reference) {
  const { freshness_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateRuntimeReadinessFreshnessReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['runtime_readiness_freshness_reference_must_be_object'] };
  exactFields(reference, RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS, 'runtime_readiness_freshness_reference', errors);
  for (const field of ['runtime_readiness_freshness_reference_id', ...ID_FIELDS, 'freshness_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.runtime_readiness_freshness_reference_version) || reference.runtime_readiness_freshness_reference_version < 1) {
    errors.push('runtime_readiness_freshness_reference_version_invalid');
  }
  for (const field of [...CREATED_SEQUENCE_FIELDS, 'current_logical_sequence', ...MAXIMUM_SEQUENCE_FIELDS]) {
    if (!Number.isInteger(reference[field]) || reference[field] < 0) errors.push(`${field}_invalid`);
  }
  let anyExpired = false;
  for (const [, createdField, maximumField, expiredField] of FRESHNESS_DIMENSIONS) {
    const created = reference[createdField];
    const maximum = reference[maximumField];
    const current = reference.current_logical_sequence;
    if (!Number.isInteger(created) || !Number.isInteger(maximum) || !Number.isInteger(current)) {
      errors.push(`${expiredField}_undetermined`);
      continue;
    }
    if (current < created) errors.push(`current_logical_sequence_before_${createdField}`);
    const expectedExpired = (current - created) > maximum;
    if (reference[expiredField] !== expectedExpired) errors.push(`${expiredField}_does_not_match_sequences`);
    if (typeof reference[expiredField] !== 'boolean' || reference[expiredField] === true) anyExpired = true;
  }
  if (typeof reference.freshness_validated !== 'boolean') errors.push('freshness_validated_must_be_boolean');
  else if (reference.freshness_validated !== !anyExpired) errors.push('freshness_validated_inconsistent_with_expiration_flags');
  for (const [field, expected] of Object.entries(RUNTIME_READINESS_FRESHNESS_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== RUNTIME_READINESS_FRESHNESS_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  try {
    if (computeFreshnessFingerprint(reference) !== reference.freshness_fingerprint) errors.push('freshness_fingerprint_mismatch');
  } catch (error) {
    errors.push('freshness_fingerprint_mismatch');
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeReadinessFreshnessReference(input = {}) {
  const reference = {
    runtime_readiness_freshness_reference_id: input.runtime_readiness_freshness_reference_id,
    runtime_readiness_freshness_reference_version: Number.isInteger(input.runtime_readiness_freshness_reference_version) ? input.runtime_readiness_freshness_reference_version : 1,
    current_logical_sequence: Number.isInteger(input.current_logical_sequence) ? input.current_logical_sequence : 0,
    freshness_fingerprint: 'pending',
    ...RUNTIME_READINESS_FRESHNESS_REFERENCE_SAFE_FLAGS,
    validator_version: RUNTIME_READINESS_FRESHNESS_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of ID_FIELDS) {
    reference[field] = input[field];
  }
  for (const field of CREATED_SEQUENCE_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  for (const field of MAXIMUM_SEQUENCE_FIELDS) {
    reference[field] = Number.isInteger(input[field]) ? input[field] : 0;
  }
  let anyExpired = false;
  for (const [, createdField, maximumField, expiredField] of FRESHNESS_DIMENSIONS) {
    const expired = (reference.current_logical_sequence - reference[createdField]) > reference[maximumField];
    reference[expiredField] = expired;
    if (expired) anyExpired = true;
  }
  reference.freshness_validated = !anyExpired;
  reference.freshness_fingerprint = computeFreshnessFingerprint(reference);

  const validation = validateRuntimeReadinessFreshnessReference(reference);
  if (!validation.valid) {
    throw new Error(`runtime_readiness_freshness_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  CREATED_SEQUENCE_FIELDS,
  EXPIRED_FLAG_FIELDS,
  FRESHNESS_DIMENSIONS,
  ID_FIELDS,
  MAXIMUM_SEQUENCE_FIELDS,
  RUNTIME_READINESS_FRESHNESS_REFERENCE_FIELDS,
  RUNTIME_READINESS_FRESHNESS_REFERENCE_SAFE_FLAGS,
  RUNTIME_READINESS_FRESHNESS_REFERENCE_VALIDATOR_VERSION,
  buildRuntimeReadinessFreshnessReference,
  computeFreshnessFingerprint,
  validateRuntimeReadinessFreshnessReference
};

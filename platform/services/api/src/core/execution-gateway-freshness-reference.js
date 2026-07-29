'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

// Freshness is evaluated purely from logical sequence numbers the caller already carries --
// never Date.now(), never new Date(), never a timer. "Lógica" here means comparative, not
// wall-clock: current_logical_sequence advancing further than maximum_valid_sequences past
// created_logical_sequence is what "expired" means for this reference.
const EXECUTION_GATEWAY_FRESHNESS_REFERENCE_VALIDATOR_VERSION = 'execution_gateway_freshness_reference_validator_v1';

const EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS = Object.freeze([
  'freshness_reference_id', 'freshness_reference_version', 'execution_plan_id', 'authorization_decision_id',
  'registry_snapshot_reference_id', 'architecture_gate_evidence_reference_id', 'created_logical_sequence',
  'current_logical_sequence', 'maximum_valid_sequences', 'authorization_expired_logically',
  'registry_snapshot_expired_logically', 'architecture_evidence_expired_logically', 'package_expired_logically',
  'freshness_validated', 'freshness_applied', 'freshness_fingerprint', 'simulation', 'production_blocked',
  'validator_version'
]);

const EXPIRATION_FLAG_FIELDS = Object.freeze([
  'authorization_expired_logically', 'registry_snapshot_expired_logically', 'architecture_evidence_expired_logically',
  'package_expired_logically'
]);

const EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS = Object.freeze({
  freshness_applied: false,
  simulation: true,
  production_blocked: true
});

function computeFreshnessFingerprint(reference) {
  const { freshness_fingerprint, ...rest } = reference;
  return stablePayload(rest);
}

function validateExecutionGatewayFreshnessReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['execution_gateway_freshness_reference_must_be_object'] };
  exactFields(reference, EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS, 'execution_gateway_freshness_reference', errors);
  for (const field of [
    'freshness_reference_id', 'execution_plan_id', 'authorization_decision_id', 'registry_snapshot_reference_id',
    'architecture_gate_evidence_reference_id', 'freshness_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.freshness_reference_version) || reference.freshness_reference_version < 1) {
    errors.push('freshness_reference_version_invalid');
  }
  if (!Number.isInteger(reference.created_logical_sequence) || reference.created_logical_sequence < 0) {
    errors.push('created_logical_sequence_invalid');
  }
  if (!Number.isInteger(reference.current_logical_sequence) || reference.current_logical_sequence < reference.created_logical_sequence) {
    errors.push('current_logical_sequence_invalid');
  }
  if (!Number.isInteger(reference.maximum_valid_sequences) || reference.maximum_valid_sequences < 0) {
    errors.push('maximum_valid_sequences_invalid');
  }
  for (const field of EXPIRATION_FLAG_FIELDS) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  const expectedPackageExpired = Number.isInteger(reference.current_logical_sequence) && Number.isInteger(reference.created_logical_sequence)
    && Number.isInteger(reference.maximum_valid_sequences)
    ? (reference.current_logical_sequence - reference.created_logical_sequence) > reference.maximum_valid_sequences
    : true;
  if (reference.package_expired_logically !== expectedPackageExpired) errors.push('package_expired_logically_does_not_match_sequences');

  const anyExpired = EXPIRATION_FLAG_FIELDS.some((field) => reference[field] === true);
  if (typeof reference.freshness_validated !== 'boolean') errors.push('freshness_validated_must_be_boolean');
  if (reference.freshness_validated !== !anyExpired) errors.push('freshness_validated_does_not_match_expiration_flags');

  for (const [field, expected] of Object.entries(EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== EXECUTION_GATEWAY_FRESHNESS_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
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

function buildExecutionGatewayFreshnessReference(input = {}) {
  const created = Number.isInteger(input.created_logical_sequence) ? input.created_logical_sequence : 0;
  const current = Number.isInteger(input.current_logical_sequence) ? input.current_logical_sequence : 0;
  const maximum = Number.isInteger(input.maximum_valid_sequences) ? input.maximum_valid_sequences : 0;
  const packageExpired = (current - created) > maximum;
  const authorizationExpired = input.authorization_expired_logically === true;
  const registrySnapshotExpired = input.registry_snapshot_expired_logically === true;
  const architectureEvidenceExpired = input.architecture_evidence_expired_logically === true;

  const reference = {
    freshness_reference_id: input.freshness_reference_id,
    freshness_reference_version: Number.isInteger(input.freshness_reference_version) ? input.freshness_reference_version : 1,
    execution_plan_id: input.execution_plan_id,
    authorization_decision_id: input.authorization_decision_id,
    registry_snapshot_reference_id: input.registry_snapshot_reference_id,
    architecture_gate_evidence_reference_id: input.architecture_gate_evidence_reference_id,
    created_logical_sequence: created,
    current_logical_sequence: current,
    maximum_valid_sequences: maximum,
    authorization_expired_logically: authorizationExpired,
    registry_snapshot_expired_logically: registrySnapshotExpired,
    architecture_evidence_expired_logically: architectureEvidenceExpired,
    package_expired_logically: packageExpired,
    freshness_validated: !(authorizationExpired || registrySnapshotExpired || architectureEvidenceExpired || packageExpired),
    freshness_fingerprint: 'pending',
    ...EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS,
    validator_version: EXECUTION_GATEWAY_FRESHNESS_REFERENCE_VALIDATOR_VERSION
  };
  reference.freshness_fingerprint = computeFreshnessFingerprint(reference);

  const validation = validateExecutionGatewayFreshnessReference(reference);
  if (!validation.valid) {
    throw new Error(`execution_gateway_freshness_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

module.exports = {
  EXECUTION_GATEWAY_FRESHNESS_REFERENCE_FIELDS,
  EXECUTION_GATEWAY_FRESHNESS_REFERENCE_SAFE_FLAGS,
  EXECUTION_GATEWAY_FRESHNESS_REFERENCE_VALIDATOR_VERSION,
  EXPIRATION_FLAG_FIELDS,
  buildExecutionGatewayFreshnessReference,
  computeFreshnessFingerprint,
  validateExecutionGatewayFreshnessReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION,
  validateRuntimeExecutionAttemptIntent
} = require('./runtime-execution-attempt-intent');

const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_SIMULATION';
const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION = 'runtime_execution_attempt_materialization_simulation_contract_v1';
const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION = 'runtime_execution_attempt_materialization_validator_v1';
const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VERSION = 1;
const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS = 'EXECUTION_ATTEMPT_MATERIALIZED_SIMULATION';

const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

const SAFE_FLAGS = Object.freeze({
  attempt_materialized_simulation: true,
  attempt_created: false,
  attempt_persisted: false,
  claim_issued: false,
  lease_granted: false,
  fencing_token_issued: false,
  worker_ownership_established: false,
  executor_ownership_established: false,
  execution_authorized: false,
  execution_started: false,
  execution_performed: false,
  provider_call_allowed: false,
  provider_called: false,
  network_call_allowed: false,
  network_used: false,
  secrets_materialized: false,
  external_effect_allowed: false,
  external_effect_performed: false,
  simulation: true,
  production_blocked: true
});

const RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_FIELDS = Object.freeze([
  'runtime_execution_attempt_materialization_id',
  'runtime_execution_attempt_materialization_version',
  'runtime_execution_attempt_materialization_fingerprint',
  'runtime_execution_attempt_materialization_digest',
  'contract_name',
  'contract_version',
  'status',
  'input_contract_name',
  'input_contract_version',
  'input_validator_version',
  'input_status',
  'runtime_execution_attempt_intent_reference',
  'durable_job_reference',
  'logical_job_identity_digest',
  'admission_reference',
  'identity_scope',
  'attempt_ordinal',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
]);

function validateReference(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  exactFields(value, REFERENCE_FIELDS, prefix, errors);
  if (!isNonEmptyString(value.id)) errors.push(`${prefix}_id_invalid`);
  if (!Number.isInteger(value.version) || value.version < 1) errors.push(`${prefix}_version_invalid`);
  if (!isNonEmptyString(value.fingerprint)) errors.push(`${prefix}_fingerprint_invalid`);
  if (!isCanonicalContentDigest(value.digest)) errors.push(`${prefix}_digest_invalid`);
}

function validateIdentityScope(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('identity_scope_must_be_object');
    return;
  }
  exactFields(value, IDENTITY_SCOPE_FIELDS, 'identity_scope', errors);
  for (const field of IDENTITY_SCOPE_FIELDS) {
    if (!isNonEmptyString(value[field])) errors.push(`identity_scope_${field}_invalid`);
  }
}

function omitIntegrityFields(materialization) {
  const {
    runtime_execution_attempt_materialization_fingerprint,
    runtime_execution_attempt_materialization_digest,
    ...material
  } = materialization;
  return material;
}

function computeRuntimeExecutionAttemptMaterializationFingerprint(materialization) {
  return stablePayload(omitIntegrityFields(materialization));
}

function computeRuntimeExecutionAttemptMaterializationDigest(materialization) {
  const { runtime_execution_attempt_materialization_digest, ...material } = materialization;
  return computeCanonicalContentDigest(material);
}

function computeRuntimeExecutionAttemptMaterializationIdentitySeed({
  attemptIntentReference,
  durableJobReference,
  logicalJobIdentityDigest,
  admissionReference,
  identityScope,
  attemptOrdinal
}) {
  return computeCanonicalContentDigest({
    contract_name: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
    attempt_intent_reference: attemptIntentReference,
    durable_job_reference: durableJobReference,
    logical_job_identity_digest: logicalJobIdentityDigest,
    admission_reference: admissionReference,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal
  });
}

function computeRuntimeExecutionAttemptMaterializationId({
  attemptIntentReference,
  durableJobReference,
  logicalJobIdentityDigest,
  admissionReference,
  identityScope,
  attemptOrdinal
}) {
  const seed = computeRuntimeExecutionAttemptMaterializationIdentitySeed({
    attemptIntentReference,
    durableJobReference,
    logicalJobIdentityDigest,
    admissionReference,
    identityScope,
    attemptOrdinal
  });
  return `runtime-execution-attempt-materialization-${seed.slice('sha256:'.length)}`;
}

function buildAttemptIntentReference(intent) {
  return {
    id: intent.runtime_execution_attempt_intent_id,
    version: intent.runtime_execution_attempt_intent_version,
    fingerprint: intent.runtime_execution_attempt_intent_fingerprint,
    digest: intent.runtime_execution_attempt_intent_digest
  };
}

function validatePredecessor(intent) {
  const validation = validateRuntimeExecutionAttemptIntent(intent);
  if (!validation.valid) return validation;
  return { valid: true, errors: [] };
}

function buildRuntimeExecutionAttemptMaterialization(intent) {
  const predecessorValidation = validatePredecessor(intent);
  if (!predecessorValidation.valid) {
    throw new Error(`runtime_execution_attempt_materialization_predecessor_invalid::${JSON.stringify(predecessorValidation.errors)}`);
  }

  const attemptIntentReference = buildAttemptIntentReference(intent);
  const materialization = {
    runtime_execution_attempt_materialization_id: computeRuntimeExecutionAttemptMaterializationId({
      attemptIntentReference,
      durableJobReference: intent.durable_job_reference,
      logicalJobIdentityDigest: intent.logical_job_identity_digest,
      admissionReference: intent.admission_reference,
      identityScope: intent.identity_scope,
      attemptOrdinal: intent.attempt_ordinal
    }),
    runtime_execution_attempt_materialization_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VERSION,
    runtime_execution_attempt_materialization_fingerprint: 'pending',
    runtime_execution_attempt_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS,
    runtime_execution_attempt_intent_reference: cloneFrozen(attemptIntentReference),
    durable_job_reference: cloneFrozen(intent.durable_job_reference),
    logical_job_identity_digest: intent.logical_job_identity_digest,
    admission_reference: cloneFrozen(intent.admission_reference),
    identity_scope: cloneFrozen(intent.identity_scope),
    attempt_ordinal: intent.attempt_ordinal,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION
  };
  materialization.runtime_execution_attempt_materialization_fingerprint =
    computeRuntimeExecutionAttemptMaterializationFingerprint(materialization);
  materialization.runtime_execution_attempt_materialization_digest =
    computeRuntimeExecutionAttemptMaterializationDigest(materialization);

  const validation = validateRuntimeExecutionAttemptMaterialization(materialization);
  if (!validation.valid) {
    throw new Error(`runtime_execution_attempt_materialization_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(materialization);
}

function validateRuntimeExecutionAttemptMaterialization(materialization) {
  const errors = [];
  if (!isPlainObject(materialization)) {
    return { valid: false, errors: ['runtime_execution_attempt_materialization_must_be_object'] };
  }
  exactFields(materialization, RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_FIELDS, 'runtime_execution_attempt_materialization', errors);
  if (materialization.contract_name !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (materialization.contract_version !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (materialization.runtime_execution_attempt_materialization_version !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VERSION) errors.push('materialization_version_invalid');
  if (materialization.status !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS) errors.push('status_invalid');
  if (materialization.input_contract_name !== RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME) errors.push('input_contract_name_invalid');
  if (materialization.input_contract_version !== RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION) errors.push('input_contract_version_invalid');
  if (materialization.input_validator_version !== RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION) errors.push('input_validator_version_invalid');
  if (materialization.input_status !== RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS) errors.push('input_status_invalid');

  validateReference(materialization.runtime_execution_attempt_intent_reference, 'runtime_execution_attempt_intent_reference', errors);
  validateReference(materialization.durable_job_reference, 'durable_job_reference', errors);
  validateReference(materialization.admission_reference, 'admission_reference', errors);
  validateIdentityScope(materialization.identity_scope, errors);
  if (!isCanonicalContentDigest(materialization.logical_job_identity_digest)) errors.push('logical_job_identity_digest_invalid');
  if (!Number.isInteger(materialization.attempt_ordinal) || !Number.isFinite(materialization.attempt_ordinal) || materialization.attempt_ordinal < 1) {
    errors.push('attempt_ordinal_invalid');
  }
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (materialization[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(materialization.runtime_execution_attempt_materialization_id)) errors.push('materialization_id_invalid');
  if (!isNonEmptyString(materialization.runtime_execution_attempt_materialization_fingerprint)) errors.push('materialization_fingerprint_invalid');
  if (!isCanonicalContentDigest(materialization.runtime_execution_attempt_materialization_digest)) errors.push('materialization_digest_invalid');

  try {
    const intentReference = materialization.runtime_execution_attempt_intent_reference;
    const expectedMaterializationId = computeRuntimeExecutionAttemptMaterializationId({
      attemptIntentReference: intentReference,
      durableJobReference: materialization.durable_job_reference,
      logicalJobIdentityDigest: materialization.logical_job_identity_digest,
      admissionReference: materialization.admission_reference,
      identityScope: materialization.identity_scope,
      attemptOrdinal: materialization.attempt_ordinal
    });
    if (materialization.runtime_execution_attempt_materialization_id !== expectedMaterializationId) errors.push('materialization_id_mismatch');
    if (computeRuntimeExecutionAttemptMaterializationFingerprint(materialization)
      !== materialization.runtime_execution_attempt_materialization_fingerprint) errors.push('materialization_fingerprint_mismatch');
    if (computeRuntimeExecutionAttemptMaterializationDigest(materialization)
      !== materialization.runtime_execution_attempt_materialization_digest) errors.push('materialization_digest_mismatch');
  } catch {
    errors.push('materialization_integrity_invalid');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function compareRuntimeExecutionAttemptMaterializationReplay(existingMaterialization, candidateMaterialization) {
  const existingValidation = validateRuntimeExecutionAttemptMaterialization(existingMaterialization);
  const candidateValidation = validateRuntimeExecutionAttemptMaterialization(candidateMaterialization);
  if (!existingValidation.valid || !candidateValidation.valid) return { status: 'CONFLICT' };
  if (existingMaterialization.runtime_execution_attempt_materialization_id
    !== candidateMaterialization.runtime_execution_attempt_materialization_id) return { status: 'NOT_SAME_MATERIALIZATION' };
  if (existingMaterialization.runtime_execution_attempt_materialization_fingerprint
    === candidateMaterialization.runtime_execution_attempt_materialization_fingerprint
    && existingMaterialization.runtime_execution_attempt_materialization_digest
    === candidateMaterialization.runtime_execution_attempt_materialization_digest) {
    return { status: 'IDENTICAL_REPLAY' };
  }
  return { status: 'CONFLICT' };
}

module.exports = {
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_FIELDS,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionAttemptMaterialization,
  compareRuntimeExecutionAttemptMaterializationReplay,
  computeRuntimeExecutionAttemptMaterializationDigest,
  computeRuntimeExecutionAttemptMaterializationFingerprint,
  computeRuntimeExecutionAttemptMaterializationId,
  computeRuntimeExecutionAttemptMaterializationIdentitySeed,
  validateRuntimeExecutionAttemptMaterialization
};

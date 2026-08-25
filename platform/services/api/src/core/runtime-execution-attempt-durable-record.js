'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION,
  validateRuntimeExecutionAttemptMaterialization
} = require('./runtime-execution-attempt-materialization');

const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD';
const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION = 'runtime_execution_attempt_durable_record_contract_v1';
const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION = 'runtime_execution_attempt_durable_record_validator_v1';
const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VERSION = 1;
const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS = 'EXECUTION_ATTEMPT_DURABLE_RECORD_PREPARED_SIMULATION';

const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

const SAFE_FLAGS = Object.freeze({
  attempt_durable_record_prepared_simulation: true,
  attempt_created: false,
  attempt_persisted: false,
  attempt_admitted: false,
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

const RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_FIELDS = Object.freeze([
  'runtime_execution_attempt_durable_record_id',
  'runtime_execution_attempt_durable_record_version',
  'runtime_execution_attempt_durable_record_fingerprint',
  'runtime_execution_attempt_durable_record_digest',
  'contract_name',
  'contract_version',
  'status',
  'input_contract_name',
  'input_contract_version',
  'input_validator_version',
  'input_status',
  'runtime_execution_attempt_materialization_reference',
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

function omitIntegrityFields(record) {
  const {
    runtime_execution_attempt_durable_record_fingerprint,
    runtime_execution_attempt_durable_record_digest,
    ...material
  } = record;
  return material;
}

function computeRuntimeExecutionAttemptDurableRecordFingerprint(record) {
  return stablePayload(omitIntegrityFields(record));
}

function computeRuntimeExecutionAttemptDurableRecordDigest(record) {
  const { runtime_execution_attempt_durable_record_digest, ...material } = record;
  return computeCanonicalContentDigest(material);
}

function computeRuntimeExecutionAttemptDurableRecordIdentitySeed({
  materializationReference,
  intentReference,
  durableJobReference,
  logicalJobIdentityDigest,
  admissionReference,
  identityScope,
  attemptOrdinal
}) {
  return computeCanonicalContentDigest({
    contract_name: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
    materialization_reference: materializationReference,
    intent_reference: intentReference,
    durable_job_reference: durableJobReference,
    logical_job_identity_digest: logicalJobIdentityDigest,
    admission_reference: admissionReference,
    identity_scope: identityScope,
    attempt_ordinal: attemptOrdinal
  });
}

function computeRuntimeExecutionAttemptDurableRecordId({
  materializationReference,
  intentReference,
  durableJobReference,
  logicalJobIdentityDigest,
  admissionReference,
  identityScope,
  attemptOrdinal
}) {
  const seed = computeRuntimeExecutionAttemptDurableRecordIdentitySeed({
    materializationReference,
    intentReference,
    durableJobReference,
    logicalJobIdentityDigest,
    admissionReference,
    identityScope,
    attemptOrdinal
  });
  return `runtime-execution-attempt-durable-record-${seed.slice('sha256:'.length)}`;
}

function buildReference(value, fields) {
  return {
    id: value[fields.id],
    version: value[fields.version],
    fingerprint: value[fields.fingerprint],
    digest: value[fields.digest]
  };
}

function buildRuntimeExecutionAttemptDurableRecord(materialization) {
  const predecessorValidation = validateRuntimeExecutionAttemptMaterialization(materialization);
  if (!predecessorValidation.valid) {
    throw new Error(`runtime_execution_attempt_durable_record_predecessor_invalid::${JSON.stringify(predecessorValidation.errors)}`);
  }

  const materializationReference = buildReference(materialization, {
    id: 'runtime_execution_attempt_materialization_id',
    version: 'runtime_execution_attempt_materialization_version',
    fingerprint: 'runtime_execution_attempt_materialization_fingerprint',
    digest: 'runtime_execution_attempt_materialization_digest'
  });
  const intentReference = cloneFrozen(materialization.runtime_execution_attempt_intent_reference);
  const durableJobReference = cloneFrozen(materialization.durable_job_reference);
  const admissionReference = cloneFrozen(materialization.admission_reference);
  const identityScope = cloneFrozen(materialization.identity_scope);
  const record = {
    runtime_execution_attempt_durable_record_id: computeRuntimeExecutionAttemptDurableRecordId({
      materializationReference,
      intentReference,
      durableJobReference,
      logicalJobIdentityDigest: materialization.logical_job_identity_digest,
      admissionReference,
      identityScope,
      attemptOrdinal: materialization.attempt_ordinal
    }),
    runtime_execution_attempt_durable_record_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VERSION,
    runtime_execution_attempt_durable_record_fingerprint: 'pending',
    runtime_execution_attempt_durable_record_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS,
    input_contract_name: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
    runtime_execution_attempt_materialization_reference: cloneFrozen(materializationReference),
    runtime_execution_attempt_intent_reference: intentReference,
    durable_job_reference: durableJobReference,
    logical_job_identity_digest: materialization.logical_job_identity_digest,
    admission_reference: admissionReference,
    identity_scope: identityScope,
    attempt_ordinal: materialization.attempt_ordinal,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION
  };
  record.runtime_execution_attempt_durable_record_fingerprint =
    computeRuntimeExecutionAttemptDurableRecordFingerprint(record);
  record.runtime_execution_attempt_durable_record_digest =
    computeRuntimeExecutionAttemptDurableRecordDigest(record);

  const validation = validateRuntimeExecutionAttemptDurableRecord(record);
  if (!validation.valid) {
    throw new Error(`runtime_execution_attempt_durable_record_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(record);
}

function validateRuntimeExecutionAttemptDurableRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) {
    return { valid: false, errors: ['runtime_execution_attempt_durable_record_must_be_object'] };
  }
  exactFields(record, RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_FIELDS, 'runtime_execution_attempt_durable_record', errors);
  if (record.contract_name !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (record.contract_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (record.runtime_execution_attempt_durable_record_version !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VERSION) errors.push('durable_record_version_invalid');
  if (record.status !== RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS) errors.push('status_invalid');
  if (record.input_contract_name !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME) errors.push('input_contract_name_invalid');
  if (record.input_contract_version !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION) errors.push('input_contract_version_invalid');
  if (record.input_validator_version !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION) errors.push('input_validator_version_invalid');
  if (record.input_status !== RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS) errors.push('input_status_invalid');

  validateReference(record.runtime_execution_attempt_materialization_reference, 'runtime_execution_attempt_materialization_reference', errors);
  validateReference(record.runtime_execution_attempt_intent_reference, 'runtime_execution_attempt_intent_reference', errors);
  validateReference(record.durable_job_reference, 'durable_job_reference', errors);
  validateReference(record.admission_reference, 'admission_reference', errors);
  validateIdentityScope(record.identity_scope, errors);
  if (!isCanonicalContentDigest(record.logical_job_identity_digest)) errors.push('logical_job_identity_digest_invalid');
  if (!Number.isInteger(record.attempt_ordinal) || !Number.isFinite(record.attempt_ordinal) || record.attempt_ordinal < 1) {
    errors.push('attempt_ordinal_invalid');
  }
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (record[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(record.runtime_execution_attempt_durable_record_id)) errors.push('durable_record_id_invalid');
  if (!isNonEmptyString(record.runtime_execution_attempt_durable_record_fingerprint)) errors.push('durable_record_fingerprint_invalid');
  if (!isCanonicalContentDigest(record.runtime_execution_attempt_durable_record_digest)) errors.push('durable_record_digest_invalid');

  try {
    const expectedId = computeRuntimeExecutionAttemptDurableRecordId({
      materializationReference: record.runtime_execution_attempt_materialization_reference,
      intentReference: record.runtime_execution_attempt_intent_reference,
      durableJobReference: record.durable_job_reference,
      logicalJobIdentityDigest: record.logical_job_identity_digest,
      admissionReference: record.admission_reference,
      identityScope: record.identity_scope,
      attemptOrdinal: record.attempt_ordinal
    });
    if (record.runtime_execution_attempt_durable_record_id !== expectedId) errors.push('durable_record_id_mismatch');
    if (computeRuntimeExecutionAttemptDurableRecordFingerprint(record)
      !== record.runtime_execution_attempt_durable_record_fingerprint) errors.push('durable_record_fingerprint_mismatch');
    if (computeRuntimeExecutionAttemptDurableRecordDigest(record)
      !== record.runtime_execution_attempt_durable_record_digest) errors.push('durable_record_digest_mismatch');
  } catch {
    errors.push('durable_record_integrity_invalid');
  }

  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function compareRuntimeExecutionAttemptDurableRecordReplay(existingRecord, candidateRecord) {
  const existingValidation = validateRuntimeExecutionAttemptDurableRecord(existingRecord);
  const candidateValidation = validateRuntimeExecutionAttemptDurableRecord(candidateRecord);
  if (!existingValidation.valid || !candidateValidation.valid) return { status: 'CONFLICT' };
  if (existingRecord.runtime_execution_attempt_durable_record_id
    !== candidateRecord.runtime_execution_attempt_durable_record_id) return { status: 'NOT_SAME_DURABLE_RECORD' };
  if (existingRecord.runtime_execution_attempt_durable_record_fingerprint
    === candidateRecord.runtime_execution_attempt_durable_record_fingerprint
    && existingRecord.runtime_execution_attempt_durable_record_digest
    === candidateRecord.runtime_execution_attempt_durable_record_digest) {
    return { status: 'IDENTICAL_REPLAY' };
  }
  return { status: 'CONFLICT' };
}

module.exports = {
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_FIELDS,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionAttemptDurableRecord,
  compareRuntimeExecutionAttemptDurableRecordReplay,
  computeRuntimeExecutionAttemptDurableRecordDigest,
  computeRuntimeExecutionAttemptDurableRecordFingerprint,
  computeRuntimeExecutionAttemptDurableRecordId,
  computeRuntimeExecutionAttemptDurableRecordIdentitySeed,
  validateRuntimeExecutionAttemptDurableRecord
};

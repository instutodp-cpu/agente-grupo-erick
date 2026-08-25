'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  ADMITTED_STATE,
  validateRuntimeExecutionJobDurableRecord
} = require('./runtime-execution-job-durable-contract');

const RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME = 'RUNTIME_EXECUTION_ATTEMPT_INTENT';
const RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION = 'runtime_execution_attempt_intent_contract_v1';
const RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION = 'runtime_execution_attempt_intent_validator_v1';
const RUNTIME_EXECUTION_ATTEMPT_INTENT_VERSION = 1;
const RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS = 'EXECUTION_ATTEMPT_INTENT_PREPARED_SIMULATION';

const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const IDENTITY_SCOPE_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);

const SAFE_FLAGS = Object.freeze({
  attempt_intent_formed: true,
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

const RUNTIME_EXECUTION_ATTEMPT_INTENT_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'runtime_execution_attempt_intent_version',
  'runtime_execution_attempt_intent_id',
  'runtime_execution_attempt_intent_fingerprint',
  'runtime_execution_attempt_intent_digest',
  'status',
  'predecessor_contract_name',
  'predecessor_contract_version',
  'predecessor_validator_version',
  'job_reference',
  'durable_job_reference',
  'durable_job_status',
  'durable_job_state',
  'durable_job_revision',
  'logical_job_identity_digest',
  'admission_reference',
  'identity_scope',
  'attempt_ordinal',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
]);

const DURABLE_JOB_REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);

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

function validateIdentityScope(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_must_be_object`);
    return;
  }
  exactFields(value, IDENTITY_SCOPE_FIELDS, prefix, errors);
  for (const field of IDENTITY_SCOPE_FIELDS) {
    if (!isNonEmptyString(value[field])) errors.push(`${prefix}_${field}_invalid`);
  }
}

function validateDurableJobReference(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('durable_job_reference_must_be_object');
    return;
  }
  exactFields(value, DURABLE_JOB_REFERENCE_FIELDS, 'durable_job_reference', errors);
  if (!isNonEmptyString(value.id)) errors.push('durable_job_reference_id_invalid');
  if (value.version !== 1) errors.push('durable_job_reference_version_invalid');
  if (!isNonEmptyString(value.fingerprint)) errors.push('durable_job_reference_fingerprint_invalid');
  if (!isCanonicalContentDigest(value.digest)) errors.push('durable_job_reference_digest_invalid');
}

function buildDurableJobReference(durableJobRecord) {
  return {
    id: durableJobRecord.job_reference.id,
    version: durableJobRecord.runtime_execution_job_durable_version,
    fingerprint: durableJobRecord.runtime_execution_job_durable_fingerprint,
    digest: durableJobRecord.runtime_execution_job_durable_digest
  };
}

function intentMaterial(intent) {
  const { runtime_execution_attempt_intent_fingerprint, runtime_execution_attempt_intent_digest, ...material } = intent;
  return material;
}

function computeRuntimeExecutionAttemptIntentFingerprint(intent) {
  return stablePayload(intentMaterial(intent));
}

function computeRuntimeExecutionAttemptIntentDigest(intent) {
  const { runtime_execution_attempt_intent_digest, ...material } = intent;
  return computeCanonicalContentDigest(material);
}

function computeRuntimeExecutionAttemptIntentIdentitySeed({
  jobReference,
  durableJobDigest,
  logicalJobIdentityDigest,
  admissionReference,
  attemptOrdinal
}) {
  return computeCanonicalContentDigest({
    contract_name: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
    job_reference: jobReference,
    durable_job_digest: durableJobDigest,
    logical_job_identity_digest: logicalJobIdentityDigest,
    admission_reference: admissionReference,
    attempt_ordinal: attemptOrdinal
  });
}

function computeRuntimeExecutionAttemptIntentId({
  jobReference,
  durableJobDigest,
  logicalJobIdentityDigest,
  admissionReference,
  attemptOrdinal
}) {
  const seed = computeRuntimeExecutionAttemptIntentIdentitySeed({
    jobReference,
    durableJobDigest,
    logicalJobIdentityDigest,
    admissionReference,
    attemptOrdinal
  });
  return `runtime-execution-attempt-intent-${seed.slice('sha256:'.length)}`;
}

function validatePredecessor(durableJobRecord) {
  const validation = validateRuntimeExecutionJobDurableRecord(durableJobRecord);
  if (!validation.valid) return validation;
  const errors = [];
  if (durableJobRecord.status !== ADMITTED_STATE) errors.push('predecessor_status_must_be_admitted');
  if (durableJobRecord.state !== ADMITTED_STATE) errors.push('predecessor_state_must_be_admitted');
  if (durableJobRecord.revision !== 1) errors.push('predecessor_revision_must_be_one');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionAttemptIntent(durableJobRecord, attemptOrdinal) {
  if (!Number.isInteger(attemptOrdinal) || !Number.isFinite(attemptOrdinal) || attemptOrdinal < 1) {
    throw new TypeError('runtime_execution_attempt_intent_attempt_ordinal_invalid');
  }
  const predecessorValidation = validatePredecessor(durableJobRecord);
  if (!predecessorValidation.valid) {
    throw new Error(`runtime_execution_attempt_intent_predecessor_invalid::${JSON.stringify(predecessorValidation.errors)}`);
  }

  const intent = {
    contract_name: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
    runtime_execution_attempt_intent_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_VERSION,
    runtime_execution_attempt_intent_id: computeRuntimeExecutionAttemptIntentId({
      jobReference: durableJobRecord.job_reference,
      durableJobDigest: durableJobRecord.runtime_execution_job_durable_digest,
      logicalJobIdentityDigest: durableJobRecord.logical_job_identity.digest,
      admissionReference: durableJobRecord.admission_reference,
      attemptOrdinal
    }),
    runtime_execution_attempt_intent_fingerprint: 'pending',
    runtime_execution_attempt_intent_digest: 'pending',
    status: RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS,
    predecessor_contract_name: durableJobRecord.contract_name,
    predecessor_contract_version: durableJobRecord.contract_version,
    predecessor_validator_version: durableJobRecord.validator_version,
    job_reference: cloneFrozen(durableJobRecord.job_reference),
    durable_job_reference: buildDurableJobReference(durableJobRecord),
    durable_job_status: durableJobRecord.status,
    durable_job_state: durableJobRecord.state,
    durable_job_revision: durableJobRecord.revision,
    logical_job_identity_digest: durableJobRecord.logical_job_identity.digest,
    admission_reference: cloneFrozen(durableJobRecord.admission_reference),
    identity_scope: cloneFrozen(durableJobRecord.identity_scope),
    attempt_ordinal: attemptOrdinal,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION
  };
  intent.runtime_execution_attempt_intent_fingerprint = computeRuntimeExecutionAttemptIntentFingerprint(intent);
  intent.runtime_execution_attempt_intent_digest = computeRuntimeExecutionAttemptIntentDigest(intent);
  const validation = validateRuntimeExecutionAttemptIntent(intent);
  if (!validation.valid) {
    throw new Error(`runtime_execution_attempt_intent_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(intent);
}

function validateRuntimeExecutionAttemptIntent(intent) {
  const errors = [];
  if (!isPlainObject(intent)) return { valid: false, errors: ['runtime_execution_attempt_intent_must_be_object'] };
  exactFields(intent, RUNTIME_EXECUTION_ATTEMPT_INTENT_FIELDS, 'runtime_execution_attempt_intent', errors);
  if (intent.contract_name !== RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (intent.contract_version !== RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (intent.runtime_execution_attempt_intent_version !== RUNTIME_EXECUTION_ATTEMPT_INTENT_VERSION) errors.push('intent_version_invalid');
  if (intent.status !== RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS) errors.push('status_invalid');
  if (intent.validator_version !== RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  for (const field of ['predecessor_contract_name', 'predecessor_contract_version', 'predecessor_validator_version', 'logical_job_identity_digest']) {
    if (!isNonEmptyString(intent[field])) errors.push(`${field}_invalid`);
  }
  if (intent.predecessor_contract_name !== 'RUNTIME_EXECUTION_JOB_DURABLE') errors.push('predecessor_contract_name_invalid');
  if (intent.predecessor_contract_version !== 'runtime_execution_job_durable_contract_v1') errors.push('predecessor_contract_version_invalid');
  if (intent.predecessor_validator_version !== 'runtime_execution_job_durable_validator_v1') errors.push('predecessor_validator_version_invalid');
  validateReference(intent.job_reference, 'job_reference', errors);
  validateDurableJobReference(intent.durable_job_reference, errors);
  if (intent.job_reference?.id !== intent.durable_job_reference?.id) errors.push('job_reference_binding_mismatch');
  if (intent.durable_job_status !== ADMITTED_STATE) errors.push('durable_job_status_invalid');
  if (intent.durable_job_state !== ADMITTED_STATE) errors.push('durable_job_state_invalid');
  if (intent.durable_job_revision !== 1) errors.push('durable_job_revision_invalid');
  validateReference(intent.admission_reference, 'admission_reference', errors);
  validateIdentityScope(intent.identity_scope, 'identity_scope', errors);
  if (!isCanonicalContentDigest(intent.logical_job_identity_digest)) errors.push('logical_job_identity_digest_invalid');
  if (!Number.isInteger(intent.attempt_ordinal) || !Number.isFinite(intent.attempt_ordinal) || intent.attempt_ordinal < 1) {
    errors.push('attempt_ordinal_invalid');
  }
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (intent[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (!isNonEmptyString(intent.runtime_execution_attempt_intent_id)) errors.push('intent_id_invalid');
  if (!isNonEmptyString(intent.runtime_execution_attempt_intent_fingerprint)) errors.push('intent_fingerprint_invalid');
  if (!isCanonicalContentDigest(intent.runtime_execution_attempt_intent_digest)) errors.push('intent_digest_invalid');
  try {
    const expectedIntentId = computeRuntimeExecutionAttemptIntentId({
      jobReference: intent.job_reference,
      durableJobDigest: intent.durable_job_reference?.digest,
      logicalJobIdentityDigest: intent.logical_job_identity_digest,
      admissionReference: intent.admission_reference,
      attemptOrdinal: intent.attempt_ordinal
    });
    if (intent.runtime_execution_attempt_intent_id !== expectedIntentId) errors.push('intent_id_mismatch');
    if (computeRuntimeExecutionAttemptIntentFingerprint(intent) !== intent.runtime_execution_attempt_intent_fingerprint) errors.push('intent_fingerprint_mismatch');
    if (computeRuntimeExecutionAttemptIntentDigest(intent) !== intent.runtime_execution_attempt_intent_digest) errors.push('intent_digest_mismatch');
  } catch {
    errors.push('intent_integrity_invalid');
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function compareRuntimeExecutionAttemptIntentReplay(existingIntent, candidateIntent) {
  const existingValidation = validateRuntimeExecutionAttemptIntent(existingIntent);
  const candidateValidation = validateRuntimeExecutionAttemptIntent(candidateIntent);
  if (!existingValidation.valid || !candidateValidation.valid) return { status: 'CONFLICT' };
  if (existingIntent.runtime_execution_attempt_intent_id !== candidateIntent.runtime_execution_attempt_intent_id) return { status: 'NOT_SAME_INTENT' };
  if (existingIntent.runtime_execution_attempt_intent_fingerprint === candidateIntent.runtime_execution_attempt_intent_fingerprint
    && existingIntent.runtime_execution_attempt_intent_digest === candidateIntent.runtime_execution_attempt_intent_digest) {
    return { status: 'IDENTICAL_REPLAY' };
  }
  return { status: 'CONFLICT' };
}

module.exports = {
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_FIELDS,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionAttemptIntent,
  compareRuntimeExecutionAttemptIntentReplay,
  computeRuntimeExecutionAttemptIntentDigest,
  computeRuntimeExecutionAttemptIntentFingerprint,
  computeRuntimeExecutionAttemptIntentId,
  computeRuntimeExecutionAttemptIntentIdentitySeed,
  validateRuntimeExecutionAttemptIntent
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { computeCanonicalContentDigest, isCanonicalContentDigest } = require('./canonical-content-digest');
const {
  ADMITTED_STATE,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
  computeAdmissionReceiptDigest,
  computeAdmissionReceiptFingerprint,
  validateAdmissionReceipt,
  validateLogicalJobIdentity
} = require('./runtime-execution-job-admission-contract');
const {
  buildRuntimeExecutionJobMaterialization,
  validateRuntimeExecutionJobMaterialization
} = require('./runtime-execution-job-materialization');

// P3A defines the logical Execution Job model that P3B may persist later. This
// module validates/builds references only; it never persists or admits to a
// durable backend.

const RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME = 'RUNTIME_EXECUTION_JOB_DURABLE';
const RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION = 'runtime_execution_job_durable_contract_v1';
const RUNTIME_EXECUTION_JOB_DURABLE_VERSION = 1;
const RUNTIME_EXECUTION_JOB_DURABLE_VALIDATOR_VERSION = 'runtime_execution_job_durable_validator_v1';
const LOGICAL_JOB_IDENTITY_CONTRACT_NAME = 'RUNTIME_EXECUTION_JOB_LOGICAL_IDENTITY';
const LOGICAL_JOB_IDENTITY_VERSION = 1;
const ADMISSION_REFERENCE_VERSION = 1;

const IDENTITY_FIELDS = Object.freeze([
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id'
]);
const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
const PROVENANCE_FIELDS = Object.freeze([
  'upstream_reference_ids',
  'upstream_fingerprints',
  'dispatch_provenance_digest',
  'authorization_reference_ids',
  'authorization_reference_fingerprints'
]);
const IDEMPOTENCY_FIELDS = Object.freeze(['fingerprint', 'validated', 'consumed', 'duplicate_execution_blocked']);
const SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  external_effect_allowed: false,
  provider_call_allowed: false,
  network_call_allowed: false,
  secrets_materialized: false,
  attempt_created: false,
  execution_performed: false,
  durable_job_persisted: false,
  simulation: true,
  production_blocked: true
});

const DURABLE_JOB_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'runtime_execution_job_durable_version',
  'runtime_execution_job_durable_fingerprint',
  'runtime_execution_job_durable_digest',
  'status',
  'state',
  'job_reference',
  'runtime_execution_job_materialization_reference',
  'runtime_execution_job_intent_reference',
  'dispatch_package_reference',
  'identity_scope',
  'idempotency_reference',
  'idempotency_identity',
  'provenance_reference',
  'logical_job_identity',
  'admission_reference',
  'admission_receipt',
  'revision',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateReference(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_invalid`);
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
    errors.push(`${prefix}_invalid`);
    return;
  }
  exactFields(value, IDENTITY_FIELDS, prefix, errors);
  for (const field of IDENTITY_FIELDS) if (!isNonEmptyString(value[field])) errors.push(`${prefix}_${field}_invalid`);
}

function validateIdempotencyReference(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_invalid`);
    return;
  }
  exactFields(value, IDEMPOTENCY_FIELDS, prefix, errors);
  if (!isNonEmptyString(value.fingerprint)) errors.push(`${prefix}_fingerprint_invalid`);
  if (value.validated !== true) errors.push(`${prefix}_must_be_validated`);
  if (value.consumed !== false) errors.push(`${prefix}_must_be_unconsumed`);
  if (value.duplicate_execution_blocked !== true) errors.push(`${prefix}_duplicate_execution_must_be_blocked`);
}

function validateProvenance(value, prefix, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${prefix}_invalid`);
    return;
  }
  exactFields(value, PROVENANCE_FIELDS, prefix, errors);
  if (!isPlainObject(value.upstream_reference_ids)) errors.push(`${prefix}_upstream_reference_ids_invalid`);
  if (!isPlainObject(value.upstream_fingerprints)) errors.push(`${prefix}_upstream_fingerprints_invalid`);
  if (!isCanonicalContentDigest(value.dispatch_provenance_digest)) errors.push(`${prefix}_dispatch_provenance_digest_invalid`);
  for (const field of ['authorization_reference_ids', 'authorization_reference_fingerprints']) {
    if (!Array.isArray(value[field]) || !value[field].every(isNonEmptyString)) errors.push(`${prefix}_${field}_invalid`);
  }
  if (Array.isArray(value.authorization_reference_ids)
    && Array.isArray(value.authorization_reference_fingerprints)
    && value.authorization_reference_ids.length !== value.authorization_reference_fingerprints.length) {
    errors.push(`${prefix}_authorization_cardinality_mismatch`);
  }
}

function logicalIdentityMaterial(materialization) {
  return {
    contract_name: LOGICAL_JOB_IDENTITY_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION,
    identity_scope: clone(materialization.identity_scope),
    job_reference: clone(materialization.job_reference),
    runtime_execution_job_materialization_reference: {
      id: materialization.runtime_execution_job_materialization_id,
      version: materialization.runtime_execution_job_materialization_version,
      fingerprint: materialization.runtime_execution_job_materialization_fingerprint,
      digest: materialization.runtime_execution_job_materialization_digest
    },
    runtime_execution_job_intent_reference: clone(materialization.runtime_execution_job_intent_reference),
    dispatch_package_reference: clone(materialization.dispatch_package_reference),
    idempotency_fingerprint: materialization.idempotency_reference.fingerprint,
    provenance_digest: materialization.provenance_reference.dispatch_provenance_digest
  };
}

function buildLogicalJobIdentity(materialization) {
  const material = {
    ...logicalIdentityMaterial(materialization),
    version: LOGICAL_JOB_IDENTITY_VERSION
  };
  return {
    ...material,
    fingerprint: stablePayload(material),
    digest: computeCanonicalContentDigest(material)
  };
}

function buildIdempotencyIdentity(materialization) {
  const material = {
    contract_name: RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION,
    idempotency_fingerprint: materialization.idempotency_reference.fingerprint,
    identity_scope: clone(materialization.identity_scope),
    version: 1
  };
  return {
    ...material,
    fingerprint: stablePayload(material),
    digest: computeCanonicalContentDigest(material)
  };
}

function buildAdmissionReference(logicalJobIdentity, revision = 1) {
  const material = {
    contract_name: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
    logical_job_identity_digest: logicalJobIdentity.digest,
    state: ADMITTED_STATE,
    revision
  };
  const digest = computeCanonicalContentDigest(material);
  return {
    id: `runtime-execution-job-admission-${digest.slice('sha256:'.length)}`,
    version: ADMISSION_REFERENCE_VERSION,
    fingerprint: stablePayload(material),
    digest
  };
}

function buildAdmissionReceipt(materialization, logicalJobIdentity, admissionReference, reasonCode = 'admitted') {
  const material = {
    contract_name: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
    event: 'EXECUTION_JOB_ADMISSION',
    outcome: 'ADMITTED',
    job_reference: clone(materialization.job_reference),
    materialization_reference: {
      id: materialization.runtime_execution_job_materialization_id,
      version: materialization.runtime_execution_job_materialization_version,
      fingerprint: materialization.runtime_execution_job_materialization_fingerprint,
      digest: materialization.runtime_execution_job_materialization_digest
    },
    identity_scope: clone(materialization.identity_scope),
    idempotency_fingerprint: materialization.idempotency_reference.fingerprint,
    logical_job_identity_digest: logicalJobIdentity.digest,
    admission_reference: clone(admissionReference),
    revision: 1,
    reason_code: reasonCode
  };
  return {
    contract_name: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
    event: material.event,
    outcome: material.outcome,
    job_reference: material.job_reference,
    materialization_reference: material.materialization_reference,
    identity_scope: material.identity_scope,
    idempotency_fingerprint: material.idempotency_fingerprint,
    logical_job_identity_digest: material.logical_job_identity_digest,
    admission_reference: material.admission_reference,
    revision: material.revision,
    reason_code: material.reason_code,
    fingerprint: computeAdmissionReceiptFingerprint(material),
    digest: computeAdmissionReceiptDigest(material)
  };
}

function buildDurableJobRecord(materialization) {
  const inputValidation = validateRuntimeExecutionJobMaterialization(materialization);
  if (!inputValidation.valid) {
    throw new Error(`runtime_execution_job_durable_input_invalid::${JSON.stringify(inputValidation.errors)}`);
  }

  const logicalJobIdentity = buildLogicalJobIdentity(materialization);
  const idempotencyIdentity = buildIdempotencyIdentity(materialization);
  const admissionReference = buildAdmissionReference(logicalJobIdentity);
  const admissionReceipt = buildAdmissionReceipt(materialization, logicalJobIdentity, admissionReference);
  const record = {
    contract_name: RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION,
    runtime_execution_job_durable_version: RUNTIME_EXECUTION_JOB_DURABLE_VERSION,
    runtime_execution_job_durable_fingerprint: 'pending',
    runtime_execution_job_durable_digest: 'pending',
    status: ADMITTED_STATE,
    state: ADMITTED_STATE,
    job_reference: clone(materialization.job_reference),
    runtime_execution_job_materialization_reference: {
      id: materialization.runtime_execution_job_materialization_id,
      version: materialization.runtime_execution_job_materialization_version,
      fingerprint: materialization.runtime_execution_job_materialization_fingerprint,
      digest: materialization.runtime_execution_job_materialization_digest
    },
    runtime_execution_job_intent_reference: clone(materialization.runtime_execution_job_intent_reference),
    dispatch_package_reference: clone(materialization.dispatch_package_reference),
    identity_scope: clone(materialization.identity_scope),
    idempotency_reference: clone(materialization.idempotency_reference),
    idempotency_identity: idempotencyIdentity,
    provenance_reference: clone(materialization.provenance_reference),
    logical_job_identity: logicalJobIdentity,
    admission_reference: admissionReference,
    admission_receipt: admissionReceipt,
    revision: 1,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_JOB_DURABLE_VALIDATOR_VERSION
  };
  record.runtime_execution_job_durable_fingerprint = computeRuntimeExecutionJobDurableFingerprint(record);
  record.runtime_execution_job_durable_digest = computeRuntimeExecutionJobDurableDigest(record);
  const validation = validateRuntimeExecutionJobDurableRecord(record);
  if (!validation.valid) throw new Error(`runtime_execution_job_durable_construction_invalid::${JSON.stringify(validation.errors)}`);
  return cloneFrozen(record);
}

function omitIntegrityFields(record) {
  const { runtime_execution_job_durable_fingerprint, runtime_execution_job_durable_digest, ...material } = record;
  return material;
}

function computeRuntimeExecutionJobDurableFingerprint(record) {
  return stablePayload(omitIntegrityFields(record));
}

function computeRuntimeExecutionJobDurableDigest(record) {
  const { runtime_execution_job_durable_digest, ...material } = record;
  return computeCanonicalContentDigest(material);
}

function validateIdempotencyIdentity(value, errors) {
  if (!isPlainObject(value)) {
    errors.push('idempotency_identity_invalid');
    return;
  }
  if (value.contract_name !== RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME) errors.push('idempotency_identity_contract_invalid');
  if (value.contract_version !== RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION) errors.push('idempotency_identity_contract_version_invalid');
  if (value.version !== 1) errors.push('idempotency_identity_version_invalid');
  if (!isNonEmptyString(value.idempotency_fingerprint)) errors.push('idempotency_identity_fingerprint_source_invalid');
  validateIdentityScope(value.identity_scope, 'idempotency_identity_scope', errors);
  if (!isNonEmptyString(value.fingerprint)) errors.push('idempotency_identity_fingerprint_invalid');
  if (!isCanonicalContentDigest(value.digest)) errors.push('idempotency_identity_digest_invalid');
  try {
    const { fingerprint, digest, ...material } = value;
    if (stablePayload(material) !== fingerprint) errors.push('idempotency_identity_fingerprint_mismatch');
    if (computeCanonicalContentDigest(material) !== digest) errors.push('idempotency_identity_digest_mismatch');
  } catch (error) {
    errors.push(`idempotency_identity_integrity_invalid::${error.message}`);
  }
}

function validateAdmissionReference(value, errors) {
  validateReference(value, 'admission_reference', errors);
  if (!isPlainObject(value)) return;
  const suffix = value.id.startsWith('runtime-execution-job-admission-');
  if (!suffix) errors.push('admission_reference_id_invalid');
}

function compareCanonical(left, right, errorCode, errors) {
  try {
    if (stablePayload(left) !== stablePayload(right)) errors.push(errorCode);
  } catch (error) {
    errors.push(`${errorCode}_comparison_invalid`);
  }
}

function compareReference(left, right, errorCode, errors) {
  if (!isPlainObject(left) || !isPlainObject(right)
    || REFERENCE_FIELDS.some((field) => left[field] !== right[field])) {
    errors.push(errorCode);
  }
}

function compareIdentityScope(left, right, errorCode, errors) {
  if (!isPlainObject(left) || !isPlainObject(right)
    || IDENTITY_FIELDS.some((field) => left[field] !== right[field])) {
    errors.push(errorCode);
  }
}

function compareValue(left, right, errorCode, errors) {
  if (left !== right) errors.push(errorCode);
}

function validateCrossFieldConsistency(record, errors) {
  const logical = record.logical_job_identity;
  const idempotency = record.idempotency_identity;
  const receipt = record.admission_receipt;

  if (isPlainObject(logical)) {
    compareIdentityScope(logical.identity_scope, record.identity_scope, 'logical_job_identity_identity_scope_mismatch', errors);
    compareReference(logical.job_reference, record.job_reference, 'logical_job_identity_job_reference_mismatch', errors);
    compareReference(logical.runtime_execution_job_materialization_reference, record.runtime_execution_job_materialization_reference, 'logical_job_identity_materialization_reference_mismatch', errors);
    compareReference(logical.runtime_execution_job_intent_reference, record.runtime_execution_job_intent_reference, 'logical_job_identity_intent_reference_mismatch', errors);
    compareReference(logical.dispatch_package_reference, record.dispatch_package_reference, 'logical_job_identity_dispatch_reference_mismatch', errors);
    compareValue(logical.idempotency_fingerprint, record.idempotency_reference && record.idempotency_reference.fingerprint, 'logical_job_identity_idempotency_mismatch', errors);
    compareValue(logical.provenance_digest, record.provenance_reference && record.provenance_reference.dispatch_provenance_digest, 'logical_job_identity_provenance_mismatch', errors);
  }
  if (isPlainObject(idempotency)) {
    compareIdentityScope(idempotency.identity_scope, record.identity_scope, 'idempotency_identity_scope_mismatch', errors);
    compareValue(idempotency.idempotency_fingerprint, record.idempotency_reference && record.idempotency_reference.fingerprint, 'idempotency_identity_fingerprint_source_mismatch', errors);
  }
  if (isPlainObject(receipt)) {
    compareReference(receipt.job_reference, record.job_reference, 'admission_receipt_job_reference_mismatch', errors);
    compareReference(receipt.materialization_reference, record.runtime_execution_job_materialization_reference, 'admission_receipt_materialization_reference_mismatch', errors);
    compareIdentityScope(receipt.identity_scope, record.identity_scope, 'admission_receipt_identity_scope_mismatch', errors);
    compareValue(receipt.idempotency_fingerprint, record.idempotency_reference && record.idempotency_reference.fingerprint, 'admission_receipt_idempotency_mismatch', errors);
    compareValue(receipt.logical_job_identity_digest, logical && logical.digest, 'admission_receipt_logical_job_identity_digest_mismatch', errors);
    compareReference(receipt.admission_reference, record.admission_reference, 'admission_receipt_admission_reference_mismatch', errors);
    compareValue(receipt.revision, record.revision, 'admission_receipt_revision_mismatch', errors);
  }
  if (isPlainObject(logical) && isPlainObject(record.admission_reference)) {
    compareCanonical(
      buildAdmissionReference(logical, record.revision),
      record.admission_reference,
      'admission_reference_canonical_mismatch',
      errors
    );
  }
}

function validateRuntimeExecutionJobDurableRecord(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['runtime_execution_job_durable_must_be_object'] };
  exactFields(record, DURABLE_JOB_FIELDS, 'runtime_execution_job_durable', errors);
  if (record.contract_name !== RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (record.contract_version !== RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (record.runtime_execution_job_durable_version !== RUNTIME_EXECUTION_JOB_DURABLE_VERSION) errors.push('durable_version_invalid');
  if (record.status !== ADMITTED_STATE) errors.push('status_invalid');
  if (record.state !== ADMITTED_STATE) errors.push('state_invalid');
  if (record.revision !== 1) errors.push('revision_invalid');
  validateReference(record.job_reference, 'job_reference', errors);
  validateReference(record.runtime_execution_job_materialization_reference, 'materialization_reference', errors);
  validateReference(record.runtime_execution_job_intent_reference, 'intent_reference', errors);
  validateReference(record.dispatch_package_reference, 'dispatch_reference', errors);
  validateIdentityScope(record.identity_scope, 'identity_scope', errors);
  validateIdempotencyReference(record.idempotency_reference, 'idempotency_reference', errors);
  validateIdempotencyIdentity(record.idempotency_identity, errors);
  validateProvenance(record.provenance_reference, 'provenance_reference', errors);
  validateLogicalJobIdentity(record.logical_job_identity, errors);
  validateAdmissionReference(record.admission_reference, errors);
  validateAdmissionReceipt(record.admission_receipt, errors);
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (record[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  for (const field of ['runtime_execution_job_durable_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(record[field])) errors.push(`${field}_invalid`);
  }
  if (!isCanonicalContentDigest(record.runtime_execution_job_durable_digest)) errors.push('runtime_execution_job_durable_digest_invalid');
  if (record.validator_version !== RUNTIME_EXECUTION_JOB_DURABLE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  validateCrossFieldConsistency(record, errors);
  try {
    if (computeRuntimeExecutionJobDurableFingerprint(record) !== record.runtime_execution_job_durable_fingerprint) errors.push('durable_fingerprint_mismatch');
    if (computeRuntimeExecutionJobDurableDigest(record) !== record.runtime_execution_job_durable_digest) errors.push('durable_digest_mismatch');
    stablePayload(record);
  } catch (error) {
    errors.push(`durable_integrity_invalid::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ADMITTED_STATE,
  DURABLE_JOB_FIELDS,
  IDENTITY_FIELDS,
  RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_DURABLE_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_DURABLE_VERSION,
  SAFE_FLAGS,
  buildAdmissionReceipt,
  buildAdmissionReference,
  buildDurableJobRecord,
  buildLogicalJobIdentity,
  computeAdmissionReceiptDigest,
  computeAdmissionReceiptFingerprint,
  computeRuntimeExecutionJobDurableDigest,
  computeRuntimeExecutionJobDurableFingerprint,
  validateRuntimeExecutionJobDurableRecord
};

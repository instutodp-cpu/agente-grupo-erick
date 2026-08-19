'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { isCanonicalContentDigest } = require('./canonical-content-digest');

const RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME = 'RUNTIME_EXECUTION_JOB_ATOMIC_ADMISSION';
const RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION = 'runtime_execution_job_atomic_admission_contract_v1';
const RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION = 1;
const RUNTIME_EXECUTION_JOB_ADMISSION_VALIDATOR_VERSION = 'runtime_execution_job_admission_validator_v1';

const ADMISSION_OUTCOMES = Object.freeze(['CREATED', 'EXISTING_IDENTICAL', 'CONFLICT', 'REJECTED']);
const ADMITTED_STATE = 'ADMITTED';

const REFERENCE_FIELDS = Object.freeze(['id', 'version', 'fingerprint', 'digest']);
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

const RUNTIME_EXECUTION_JOB_ADMISSION_RESULT_FIELDS = Object.freeze([
  'contract_name',
  'contract_version',
  'outcome',
  'job_reference',
  'logical_job_identity',
  'admission_reference',
  'revision',
  'job_fingerprint',
  'job_digest',
  'admission_receipt',
  'reason_code',
  ...Object.keys(SAFE_FLAGS),
  'validator_version'
]);

function validateReference(value, prefix, errors, nullable = false) {
  if (nullable && value === null) return;
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

function validateRuntimeExecutionJobAdmissionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['admission_result_must_be_object'] };
  exactFields(result, RUNTIME_EXECUTION_JOB_ADMISSION_RESULT_FIELDS, 'runtime_execution_job_admission_result', errors);

  if (result.contract_name !== RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME) errors.push('contract_name_invalid');
  if (result.contract_version !== RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION) errors.push('contract_version_invalid');
  if (!ADMISSION_OUTCOMES.includes(result.outcome)) errors.push('outcome_invalid');
  if (!Number.isInteger(result.revision) || result.revision < 0) errors.push('revision_invalid');
  if (result.outcome === 'REJECTED' && result.revision !== 0) errors.push('rejected_revision_must_be_zero');
  if (result.outcome !== 'REJECTED' && result.revision !== 1) errors.push('admission_revision_must_be_one');
  if (result.outcome === 'REJECTED') {
    if (result.job_reference !== null) errors.push('rejected_job_reference_must_be_null');
    if (result.logical_job_identity !== null) errors.push('rejected_logical_identity_must_be_null');
    if (result.admission_reference !== null) errors.push('rejected_admission_reference_must_be_null');
    if (result.admission_receipt !== null) errors.push('rejected_receipt_must_be_null');
    if (result.job_fingerprint !== null) errors.push('rejected_job_fingerprint_must_be_null');
    if (result.job_digest !== null) errors.push('rejected_job_digest_must_be_null');
  } else {
    validateReference(result.job_reference, 'job_reference', errors);
    validateReference(result.admission_reference, 'admission_reference', errors);
    if (!isPlainObject(result.logical_job_identity)) errors.push('logical_job_identity_invalid');
    if (!isNonEmptyString(result.job_fingerprint)) errors.push('job_fingerprint_invalid');
    if (!isCanonicalContentDigest(result.job_digest)) errors.push('job_digest_invalid');
    if (!isPlainObject(result.admission_receipt)) errors.push('admission_receipt_invalid');
  }
  if (result.reason_code !== null && !isNonEmptyString(result.reason_code)) errors.push('reason_code_invalid');

  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.validator_version !== RUNTIME_EXECUTION_JOB_ADMISSION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`result_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionJobAdmissionResult(input = {}) {
  const result = {
    contract_name: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
    outcome: input.outcome,
    job_reference: input.job_reference ?? null,
    logical_job_identity: input.logical_job_identity ?? null,
    admission_reference: input.admission_reference ?? null,
    revision: input.revision ?? 0,
    job_fingerprint: input.job_fingerprint ?? null,
    job_digest: input.job_digest ?? null,
    admission_receipt: input.admission_receipt ?? null,
    reason_code: input.reason_code ?? null,
    ...SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_JOB_ADMISSION_VALIDATOR_VERSION
  };
  const validation = validateRuntimeExecutionJobAdmissionResult(result);
  if (!validation.valid) throw new Error(`runtime_execution_job_admission_result_invalid::${JSON.stringify(validation.errors)}`);
  return cloneFrozen(result);
}

function createRuntimeExecutionJobAdmissionPort({ admit } = {}) {
  if (typeof admit !== 'function') throw new TypeError('runtime_execution_job_admission_port_admit_missing');
  return Object.freeze({
    interface_version: RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
    port_version: RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION,
    admit
  });
}

module.exports = {
  ADMITTED_STATE,
  ADMISSION_OUTCOMES,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION,
  RUNTIME_EXECUTION_JOB_ADMISSION_RESULT_FIELDS,
  RUNTIME_EXECUTION_JOB_ADMISSION_VALIDATOR_VERSION,
  SAFE_FLAGS,
  buildRuntimeExecutionJobAdmissionResult,
  createRuntimeExecutionJobAdmissionPort,
  validateRuntimeExecutionJobAdmissionResult
};

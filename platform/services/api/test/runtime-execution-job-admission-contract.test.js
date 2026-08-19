'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const { evaluateRuntimeExecutionJobIntent } = require('../src/core/runtime-execution-job-intent');
const { buildRuntimeExecutionJobMaterialization } = require('../src/core/runtime-execution-job-materialization');
const {
  buildDurableJobRecord,
  computeAdmissionReceiptDigest,
  computeAdmissionReceiptFingerprint
} = require('../src/core/runtime-execution-job-durable-contract');
const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');

const {
  ADMISSION_OUTCOMES,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION,
  buildRuntimeExecutionJobAdmissionResult,
  createRuntimeExecutionJobAdmissionPort,
  validateRuntimeExecutionJobAdmissionResult
} = require('../src/core/runtime-execution-job-admission-contract');

const golden = buildGoldenDispatchBundle();
const dispatchPackage = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {}).package;
const baseIntent = evaluateRuntimeExecutionJobIntent(dispatchPackage).intent;
const baseMaterialization = buildRuntimeExecutionJobMaterialization(baseIntent);
const baseRecord = buildDurableJobRecord(baseMaterialization);

function reference(id) {
  return { id, version: 1, fingerprint: `fingerprint-${id}`, digest: `sha256:${'1'.repeat(64)}` };
}

function validResult() {
  const record = baseRecord;
  return buildRuntimeExecutionJobAdmissionResult({
    outcome: 'CREATED',
    job_reference: record.job_reference,
    logical_job_identity: record.logical_job_identity,
    admission_reference: record.admission_reference,
    revision: record.revision,
    job_fingerprint: record.runtime_execution_job_durable_fingerprint,
    job_digest: record.runtime_execution_job_durable_digest,
    admission_receipt: record.admission_receipt,
    reason_code: null
  });
}

function mutableResult() {
  return JSON.parse(JSON.stringify(validResult()));
}

function recomputeLogicalIdentity(value) {
  const { fingerprint, digest, ...material } = value;
  value.fingerprint = stablePayload(material);
  value.digest = computeCanonicalContentDigest(material);
}

function recomputeReceipt(value) {
  value.fingerprint = computeAdmissionReceiptFingerprint(value);
  value.digest = computeAdmissionReceiptDigest(value);
}

test('defines the explicit synchronous-independent Atomic Admission port', () => {
  const admit = () => 'sentinel';
  const port = createRuntimeExecutionJobAdmissionPort({ admit });
  assert.equal(port.interface_version, RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION);
  assert.equal(port.port_version, RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION);
  assert.equal(port.admit, admit);
  assert.throws(() => createRuntimeExecutionJobAdmissionPort(), /admit_missing/);
});

test('admission outcomes are intentionally limited to the P3A model', () => {
  assert.deepEqual(ADMISSION_OUTCOMES, ['CREATED', 'EXISTING_IDENTICAL', 'CONFLICT', 'REJECTED']);
  const rejected = buildRuntimeExecutionJobAdmissionResult({
    outcome: 'REJECTED',
    reason_code: 'invalid_p2_materialization'
  });
  assert.equal(rejected.contract_name, RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME);
  assert.equal(rejected.revision, 0);
  assert.equal(rejected.durable_job_persisted, false);
  assert.equal(validateRuntimeExecutionJobAdmissionResult(rejected).valid, true);
});

test('non-rejected result requires complete and consistent nested contracts', () => {
  const value = validResult();
  assert.equal(value.outcome, 'CREATED');
  assert.equal(value.execution_authorized, false);
  assert.equal(validateRuntimeExecutionJobAdmissionResult({ ...value, execution_authorized: true }).valid, false);
  assert.equal(validateRuntimeExecutionJobAdmissionResult({ ...value, unknown: true }).valid, false);
});

test('rejects an AdmissionResult whose logical identity diverges from job_reference', () => {
  const value = mutableResult();
  value.logical_job_identity.job_reference = { ...value.logical_job_identity.job_reference, id: 'tampered-result-job' };
  recomputeLogicalIdentity(value.logical_job_identity);
  const validation = validateRuntimeExecutionJobAdmissionResult(value);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('job_reference_logical_identity_mismatch'), true, validation.errors.join(', '));
});

test('rejects an AdmissionResult whose receipt diverges from the result references', () => {
  const value = mutableResult();
  value.admission_receipt.job_reference = { ...value.admission_receipt.job_reference, id: 'tampered-result-receipt-job' };
  recomputeReceipt(value.admission_receipt);
  const validation = validateRuntimeExecutionJobAdmissionResult(value);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('job_reference_receipt_mismatch'), true, validation.errors.join(', '));
});

test('rejects an AdmissionResult whose revision diverges from its receipt', () => {
  const value = mutableResult();
  value.admission_receipt.revision = 2;
  recomputeReceipt(value.admission_receipt);
  const validation = validateRuntimeExecutionJobAdmissionResult(value);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes('admission_receipt_revision_invalid'), true, validation.errors.join(', '));
});

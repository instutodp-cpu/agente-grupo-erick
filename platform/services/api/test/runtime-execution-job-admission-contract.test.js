'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  ADMISSION_OUTCOMES,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_ADMISSION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_ADMISSION_PORT_VERSION,
  buildRuntimeExecutionJobAdmissionResult,
  createRuntimeExecutionJobAdmissionPort,
  validateRuntimeExecutionJobAdmissionResult
} = require('../src/core/runtime-execution-job-admission-contract');

function reference(id) {
  return { id, version: 1, fingerprint: `fingerprint-${id}`, digest: `sha256:${'1'.repeat(64)}` };
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

test('non-rejected result requires references, revision and safe flags', () => {
  const value = buildRuntimeExecutionJobAdmissionResult({
    outcome: 'CREATED',
    job_reference: reference('job'),
    logical_job_identity: { digest: `sha256:${'2'.repeat(64)}` },
    admission_reference: reference('admission'),
    revision: 1,
    job_fingerprint: 'job-fingerprint',
    job_digest: `sha256:${'3'.repeat(64)}`,
    admission_receipt: { event: 'EXECUTION_JOB_ADMISSION' }
  });
  assert.equal(value.outcome, 'CREATED');
  assert.equal(value.execution_authorized, false);
  assert.equal(validateRuntimeExecutionJobAdmissionResult({ ...value, execution_authorized: true }).valid, false);
  assert.equal(validateRuntimeExecutionJobAdmissionResult({ ...value, unknown: true }).valid, false);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const {
  buildRuntimeExecutionJobIntent,
  computeRuntimeExecutionJobIntentDigest,
  computeRuntimeExecutionJobIntentFingerprint,
  evaluateRuntimeExecutionJobIntent
} = require('../src/core/runtime-execution-job-intent');
const { buildRuntimeExecutionJobMaterialization } = require('../src/core/runtime-execution-job-materialization');
const {
  ADMITTED_STATE,
  RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION,
  buildAdmissionReference,
  buildDurableJobRecord,
  computeAdmissionReceiptDigest,
  computeAdmissionReceiptFingerprint,
  computeRuntimeExecutionJobDurableDigest,
  computeRuntimeExecutionJobDurableFingerprint,
  validateRuntimeExecutionJobDurableRecord
} = require('../src/core/runtime-execution-job-durable-contract');
const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');

const golden = buildGoldenDispatchBundle();
const dispatchPackage = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {}).package;
const BASE_INTENT = evaluateRuntimeExecutionJobIntent(dispatchPackage).intent;
const BASE_MATERIALIZATION = buildRuntimeExecutionJobMaterialization(BASE_INTENT);

function validIntent(changes = {}) {
  const intent = { ...BASE_INTENT, ...changes };
  intent.runtime_execution_job_intent_fingerprint = computeRuntimeExecutionJobIntentFingerprint(intent);
  intent.runtime_execution_job_intent_digest = computeRuntimeExecutionJobIntentDigest(intent);
  return intent;
}

function materialize(changes = {}) {
  return Object.keys(changes).length === 0 ? BASE_MATERIALIZATION : buildRuntimeExecutionJobMaterialization(validIntent(changes));
}

const BASE_RECORD = buildDurableJobRecord(materialize());

function mutableRecord() {
  return JSON.parse(JSON.stringify(BASE_RECORD));
}

function recomputeLogicalIdentity(record) {
  const { fingerprint, digest, ...material } = record.logical_job_identity;
  record.logical_job_identity.fingerprint = stablePayload(material);
  record.logical_job_identity.digest = computeCanonicalContentDigest(material);
}

function recomputeIdempotencyIdentity(record) {
  const { fingerprint, digest, ...material } = record.idempotency_identity;
  record.idempotency_identity.fingerprint = stablePayload(material);
  record.idempotency_identity.digest = computeCanonicalContentDigest(material);
}

function recomputeReceipt(record, { fingerprint = true, digest = true } = {}) {
  if (fingerprint) record.admission_receipt.fingerprint = computeAdmissionReceiptFingerprint(record.admission_receipt);
  if (digest) record.admission_receipt.digest = computeAdmissionReceiptDigest(record.admission_receipt);
}

function recomputeOuter(record) {
  record.runtime_execution_job_durable_fingerprint = computeRuntimeExecutionJobDurableFingerprint(record);
  record.runtime_execution_job_durable_digest = computeRuntimeExecutionJobDurableDigest(record);
}

function assertInvalid(record, expectedError) {
  const validation = validateRuntimeExecutionJobDurableRecord(record);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors.includes(expectedError), true, validation.errors.join(', '));
}

test('builds the canonical admitted logical Execution Job record from valid P2', () => {
  const record = buildDurableJobRecord(materialize());
  assert.equal(record.contract_name, RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_NAME);
  assert.equal(record.contract_version, RUNTIME_EXECUTION_JOB_DURABLE_CONTRACT_VERSION);
  assert.equal(record.status, ADMITTED_STATE);
  assert.equal(record.state, ADMITTED_STATE);
  assert.equal(record.revision, 1);
  assert.equal(validateRuntimeExecutionJobDurableRecord(record).valid, true);
});

test('logical identity is deterministic and binds scope, references, idempotency and provenance', () => {
  const first = buildDurableJobRecord(materialize());
  const second = buildDurableJobRecord(materialize());
  assert.deepEqual(first, second);
  assert.equal(first.logical_job_identity.digest, second.logical_job_identity.digest);
  assert.equal(first.idempotency_identity.identity_scope.tenant_id, first.identity_scope.tenant_id);
  assert.equal(first.logical_job_identity.job_reference.digest, first.job_reference.digest);
  assert.equal(first.logical_job_identity.provenance_digest, first.provenance_reference.dispatch_provenance_digest);
});

test('scope or semantic predecessor changes produce a different logical identity', () => {
  const first = buildDurableJobRecord(materialize());
  const changed = buildDurableJobRecord(materialize({
    identity_scope: { ...validIntent().identity_scope, project_id: 'project-p3a-different' }
  }));
  assert.notEqual(first.logical_job_identity.digest, changed.logical_job_identity.digest);
  assert.equal(first.idempotency_reference.fingerprint, changed.idempotency_reference.fingerprint);
});

test('record is reference-safe, frozen and contains no operational payload', () => {
  const record = buildDurableJobRecord(materialize());
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.job_reference), true);
  assert.equal(record.execution_authorized, false);
  assert.equal(record.external_effect_allowed, false);
  assert.equal(record.provider_call_allowed, false);
  assert.equal(record.network_call_allowed, false);
  assert.equal(record.secrets_materialized, false);
  assert.equal(record.attempt_created, false);
  assert.equal(record.execution_performed, false);
  assert.equal(record.durable_job_persisted, false);
  assert.equal(record.simulation, true);
  assert.equal(record.production_blocked, true);
  assert.equal('payload' in record, false);
  assert.equal('provider' in record, false);
  assert.equal('credentials' in record, false);
  assert.equal('secret' in record, false);
  assert.throws(() => { record.execution_authorized = true; }, TypeError);
});

test('invalid P2 input fails closed without constructing a record', () => {
  assert.throws(
    () => buildDurableJobRecord(null),
    (error) => error.message.includes('runtime_execution_job_durable_input_invalid')
  );
  assert.throws(
    () => buildDurableJobRecord({ contract_name: 'UNKNOWN' }),
    (error) => error.message.includes('runtime_execution_job_durable_input_invalid')
  );
});

test('rejects logical job identity job_reference divergence after nested and outer recomputation', () => {
  const record = mutableRecord();
  record.logical_job_identity.job_reference = { ...record.logical_job_identity.job_reference, id: 'tampered-logical-job' };
  recomputeLogicalIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'logical_job_identity_job_reference_mismatch');
});

test('rejects logical job identity scope divergence after nested and outer recomputation', () => {
  const record = mutableRecord();
  record.logical_job_identity.identity_scope = { ...record.logical_job_identity.identity_scope, project_id: 'tampered-project' };
  recomputeLogicalIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'logical_job_identity_identity_scope_mismatch');
});

test('rejects logical job identity materialization reference divergence', () => {
  const record = mutableRecord();
  record.logical_job_identity.runtime_execution_job_materialization_reference = {
    ...record.logical_job_identity.runtime_execution_job_materialization_reference,
    id: 'tampered-materialization'
  };
  recomputeLogicalIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'logical_job_identity_materialization_reference_mismatch');
});

test('rejects logical job identity provenance divergence', () => {
  const record = mutableRecord();
  record.logical_job_identity.provenance_digest = `sha256:${'0'.repeat(64)}`;
  recomputeLogicalIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'logical_job_identity_provenance_mismatch');
});

test('rejects idempotency identity scope divergence after recomputation', () => {
  const record = mutableRecord();
  record.idempotency_identity.identity_scope = { ...record.idempotency_identity.identity_scope, actor_id: 'tampered-actor' };
  recomputeIdempotencyIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'idempotency_identity_scope_mismatch');
});

test('rejects idempotency identity fingerprint source divergence after recomputation', () => {
  const record = mutableRecord();
  record.idempotency_identity.idempotency_fingerprint = 'tampered-idempotency-fingerprint';
  recomputeIdempotencyIdentity(record);
  recomputeOuter(record);
  assertInvalid(record, 'idempotency_identity_fingerprint_source_mismatch');
});

test('rejects admission receipt job_reference divergence after receipt and outer recomputation', () => {
  const record = mutableRecord();
  record.admission_receipt.job_reference = { ...record.admission_receipt.job_reference, id: 'tampered-receipt-job' };
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_job_reference_mismatch');
});

test('rejects admission receipt materialization reference divergence', () => {
  const record = mutableRecord();
  record.admission_receipt.materialization_reference = {
    ...record.admission_receipt.materialization_reference,
    id: 'tampered-receipt-materialization'
  };
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_materialization_reference_mismatch');
});

test('rejects admission receipt scope divergence', () => {
  const record = mutableRecord();
  record.admission_receipt.identity_scope = { ...record.admission_receipt.identity_scope, tenant_id: 'tampered-tenant' };
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_identity_scope_mismatch');
});

test('rejects admission receipt logical identity digest divergence', () => {
  const record = mutableRecord();
  record.admission_receipt.logical_job_identity_digest = `sha256:${'0'.repeat(64)}`;
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_logical_job_identity_digest_mismatch');
});

test('rejects admission receipt admission_reference divergence', () => {
  const record = mutableRecord();
  record.admission_receipt.admission_reference = buildAdmissionReference(record.logical_job_identity, 2);
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_admission_reference_mismatch');
});

test('rejects admission receipt revision divergence', () => {
  const record = mutableRecord();
  record.admission_receipt.revision = 2;
  recomputeReceipt(record);
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_revision_invalid');
});

test('rejects semantically mutated admission receipt with the old fingerprint and digest', () => {
  const record = mutableRecord();
  record.admission_receipt.reason_code = 'tampered-reason';
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_fingerprint_mismatch');
  assertInvalid(record, 'admission_receipt_digest_mismatch');
});

test('rejects semantically mutated admission receipt with the old digest', () => {
  const record = mutableRecord();
  record.admission_receipt.reason_code = 'tampered-reason';
  recomputeReceipt(record, { fingerprint: true, digest: false });
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_digest_mismatch');
});

test('rejects an altered admission reference after outer durable integrity is recomputed', () => {
  const record = mutableRecord();
  record.admission_reference = buildAdmissionReference(record.logical_job_identity, 2);
  recomputeOuter(record);
  assertInvalid(record, 'admission_reference_canonical_mismatch');
});

test('outer durable fingerprint and digest cannot legitimize a nested inconsistency', () => {
  const record = mutableRecord();
  record.admission_receipt.job_reference = { ...record.admission_receipt.job_reference, id: 'nested-only-tamper' };
  recomputeOuter(record);
  assertInvalid(record, 'admission_receipt_job_reference_mismatch');
});

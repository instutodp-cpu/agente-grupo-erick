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
  buildDurableJobRecord,
  validateRuntimeExecutionJobDurableRecord
} = require('../src/core/runtime-execution-job-durable-contract');

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

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const {
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  buildRuntimeExecutionJobIntent,
  computeRuntimeExecutionJobIntentDigest,
  computeRuntimeExecutionJobIntentFingerprint,
  evaluateRuntimeExecutionJobIntent
} = require('../src/core/runtime-execution-job-intent');
const {
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  buildRuntimeExecutionJobMaterialization,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint,
  validateRuntimeExecutionJobMaterialization
} = require('../src/core/runtime-execution-job-materialization');

const golden = buildGoldenDispatchBundle();
const dispatchPackage = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {}).package;

function validIntent() {
  const outcome = evaluateRuntimeExecutionJobIntent(dispatchPackage);
  assert.equal(outcome.status, RUNTIME_EXECUTION_JOB_INTENT_STATUS);
  return outcome.intent;
}

function materialize(intent = validIntent()) {
  return buildRuntimeExecutionJobMaterialization(intent);
}

function mutateValidIntent(changes) {
  const value = { ...validIntent(), ...changes };
  value.runtime_execution_job_intent_fingerprint = computeRuntimeExecutionJobIntentFingerprint(value);
  value.runtime_execution_job_intent_digest = computeRuntimeExecutionJobIntentDigest(value);
  return value;
}

function assertInputBlocked(value, reason) {
  assert.throws(
    () => buildRuntimeExecutionJobMaterialization(value),
    (error) => error.message.includes('runtime_execution_job_materialization_input_invalid')
      && (!reason || error.message.includes(reason))
  );
}

test('happy path produces the canonical simulation materialization', () => {
  const output = materialize();
  assert.equal(output.contract_name, RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME);
  assert.equal(output.contract_version, RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION);
  assert.equal(output.status, RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS);
  assert.equal(validateRuntimeExecutionJobMaterialization(output).valid, true);
});

test('identical P1 input produces deep-equal deterministic output', () => {
  const first = materialize();
  const second = materialize();
  assert.deepEqual(first, second);
  assert.equal(first.job_reference.id, second.job_reference.id);
  assert.equal(first.runtime_execution_job_materialization_fingerprint, second.runtime_execution_job_materialization_fingerprint);
});

test('semantic predecessor mutation changes job identity and materialization fingerprint', () => {
  const first = materialize();
  const changed = materialize(mutateValidIntent({
    identity_scope: { ...validIntent().identity_scope, project_id: 'project-p2-different' }
  }));
  assert.notEqual(first.job_reference.id, changed.job_reference.id);
  assert.notEqual(first.runtime_execution_job_materialization_fingerprint, changed.runtime_execution_job_materialization_fingerprint);
});

test('canonicalization is stable across equivalent JSON serialization', () => {
  const first = materialize();
  const equivalent = JSON.parse(JSON.stringify(validIntent()));
  const second = materialize(equivalent);
  assert.deepEqual(first, second);
  assert.equal(computeRuntimeExecutionJobMaterializationFingerprint(first), first.runtime_execution_job_materialization_fingerprint);
  assert.equal(computeRuntimeExecutionJobMaterializationDigest(first), first.runtime_execution_job_materialization_digest);
});

test('null input fails closed', () => assertInputBlocked(null, 'must_be_object'));
test('undefined input fails closed', () => assertInputBlocked(undefined, 'must_be_object'));
test('wrong input type fails closed', () => assertInputBlocked('intent', 'must_be_object'));

test('contract mutation in the predecessor fails closed', () => {
  assertInputBlocked({ ...validIntent(), input_contract_name: 'UNKNOWN_CONTRACT' }, 'input_contract_name_invalid');
});

test('validator version mutation in the predecessor fails closed', () => {
  assertInputBlocked({ ...validIntent(), validator_version: 'unknown_validator' }, 'validator_version_invalid');
});

test('missing predecessor fingerprint fails closed', () => {
  const value = { ...validIntent() };
  delete value.runtime_execution_job_intent_fingerprint;
  assertInputBlocked(value, 'runtime_execution_job_intent_fingerprint_invalid');
});

test('predecessor fingerprint mismatch fails closed', () => {
  assertInputBlocked({ ...validIntent(), runtime_execution_job_intent_fingerprint: 'tampered' }, 'intent_fingerprint_mismatch');
});

test('predecessor digest mismatch fails closed', () => {
  assertInputBlocked({ ...validIntent(), runtime_execution_job_intent_digest: 'sha256:' + '0'.repeat(64) }, 'intent_digest_mismatch');
});

test('inadequate predecessor state fails closed', () => {
  assertInputBlocked({ ...validIntent(), execution_job_state: 'RUNNING' }, 'execution_job_state_invalid');
});

test('provenance binding mismatch fails closed', () => {
  const value = { ...validIntent(), upstream_reference_ids: { ...validIntent().upstream_reference_ids, runtime_dispatch_request_id: 'tampered' } };
  assertInputBlocked(value, 'intent_fingerprint_mismatch');
});

test('identity mutation in a valid predecessor changes the canonical job identity', () => {
  const first = materialize();
  const changed = materialize(mutateValidIntent({
    identity_scope: { ...validIntent().identity_scope, tenant_id: 'tenant-p2-different' }
  }));
  assert.notEqual(first.identity_scope.tenant_id, changed.identity_scope.tenant_id);
  assert.notEqual(first.job_reference.id, changed.job_reference.id);
});

test('authorization state mutation fails closed', () => {
  assertInputBlocked({ ...validIntent(), external_effect_authorization_state: 'AUTHORIZED' }, 'external_effect_authorization_state_invalid');
});

test('unknown field injection fails closed', () => {
  assertInputBlocked({ ...validIntent(), provider_slug: 'provider-example' }, 'unexpected_field');
});

test('secret-like field injection fails closed', () => {
  assertInputBlocked({ ...validIntent(), api_key: 'secret-like-test-value' }, 'unexpected_field');
});

test('output contains only references and no raw operational payload', () => {
  const output = materialize();
  assert.equal('payload' in output, false);
  assert.equal('rawPayload' in output, false);
  assert.equal('provider' in output, false);
  assert.equal('credentials' in output, false);
  assert.equal('token' in output, false);
  assert.equal('secret' in output, false);
  assert.equal('dispatch_provenance' in output, false);
  assert.ok(output.provenance_reference.dispatch_provenance_digest.startsWith('sha256:'));
});

test('all execution and external-effect flags remain false', () => {
  const output = materialize();
  assert.equal(output.execution_authorized, false);
  assert.equal(output.external_effect_allowed, false);
  assert.equal(output.provider_call_allowed, false);
  assert.equal(output.network_call_allowed, false);
  assert.equal(output.secrets_materialized, false);
  assert.equal(output.attempt_created, false);
  assert.equal(output.execution_performed, false);
  assert.equal(output.durable_job_persisted, false);
  assert.equal(output.output_persisted, false);
  assert.equal(output.simulation, true);
  assert.equal(output.production_blocked, true);
});

test('output state remains blocked for external effect authorization', () => {
  const output = materialize();
  assert.equal(output.execution_job_state, 'WAITING_EXTERNAL_EFFECT_AUTHORIZATION');
  assert.equal(output.external_effect_authorization_state, 'NOT_AUTHORIZED');
});

test('output is deeply frozen and cannot become operational by mutation', () => {
  const output = materialize();
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.job_reference), true);
  assert.throws(() => { output.execution_authorized = true; }, TypeError);
  assert.equal(output.execution_authorized, false);
});

test('output validator rejects unknown fields and promoted authorization', () => {
  const output = materialize();
  assert.equal(validateRuntimeExecutionJobMaterialization({ ...output, unexpected: true }).valid, false);
  assert.equal(validateRuntimeExecutionJobMaterialization({ ...output, execution_authorized: true }).valid, false);
});

test('reference fields preserve P1 identity and dispatch binding', () => {
  const input = validIntent();
  const output = materialize(input);
  assert.equal(output.runtime_execution_job_intent_reference.id, input.runtime_execution_job_intent_id);
  assert.equal(output.runtime_execution_job_intent_reference.fingerprint, input.runtime_execution_job_intent_fingerprint);
  assert.equal(output.dispatch_package_reference.id, input.dispatch_package_reference.id);
  assert.deepEqual(output.identity_scope, input.identity_scope);
  assert.equal(output.idempotency_reference.fingerprint, input.idempotency_reference.fingerprint);
});

test('repeated pure calls do not create operational objects or counters', () => {
  const outputs = Array.from({ length: 5 }, () => materialize());
  for (const output of outputs) {
    assert.equal(output.attempt_created, false);
    assert.equal(output.durable_job_persisted, false);
    assert.equal(output.output_persisted, false);
  }
  assert.deepEqual(outputs[0], outputs[4]);
});

test('module has no prohibited side-effect imports or write paths', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runtime-execution-job-materialization.js'), 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|http|https|net|tls|pg|child_process|worker_threads)['"]\)/);
  assert.doesNotMatch(source, /\b(fetch|axios|writeFile|createWriteStream|createConnection|spawn|execFile)\s*\(/);
  assert.doesNotMatch(source, /\bnew\s+Map\s*\(/);
});

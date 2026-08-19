'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildGoldenDispatchBundle } = require('./helpers/runtime-dispatch-simulation-test-data');
const { evaluateRuntimeDispatchRequest } = require('../src/core/runtime-dispatch-boundary');
const {
  RUNTIME_EXECUTION_JOB_INTENT_BLOCKED_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  buildRuntimeExecutionJobIntent,
  compareRuntimeExecutionJobIntentReplay,
  computeRuntimeExecutionJobIntentDigest,
  computeRuntimeExecutionJobIntentFingerprint,
  evaluateRuntimeExecutionJobIntent,
  validateRuntimeExecutionJobIntent
} = require('../src/core/runtime-execution-job-intent');

const golden = buildGoldenDispatchBundle();
const dispatchOutcome = evaluateRuntimeDispatchRequest(golden.dispatchRequest, {});
const dispatchPackage = dispatchOutcome.package;

function intent() {
  const outcome = evaluateRuntimeExecutionJobIntent(dispatchPackage);
  assert.equal(outcome.status, RUNTIME_EXECUTION_JOB_INTENT_STATUS);
  return outcome.intent;
}

function tamperPackage(changes) {
  return { ...dispatchPackage, ...changes };
}

function assertBlocked(packageValue, expectedReason) {
  const outcome = evaluateRuntimeExecutionJobIntent(packageValue);
  assert.equal(outcome.status, RUNTIME_EXECUTION_JOB_INTENT_BLOCKED_STATUS);
  if (expectedReason) assert.ok(outcome.blockers.some((reason) => reason.includes(expectedReason)), JSON.stringify(outcome.blockers));
  return outcome;
}

test('happy path produces a deterministic blocked-for-effect intent', () => {
  const first = intent();
  const second = intent();
  assert.deepEqual(first, second);
  assert.equal(first.execution_job_state, RUNTIME_EXECUTION_JOB_INTENT_STATE);
  assert.equal(validateRuntimeExecutionJobIntent(first).valid, true);
});

test('replay of the identical intent is accepted', () => {
  const first = intent();
  assert.deepEqual(compareRuntimeExecutionJobIntentReplay(first, intent()), { status: 'REPLAY_ACCEPTED' });
});

test('dispatch package fingerprint mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ dispatch_package_fingerprint: 'tampered-fingerprint' }), 'dispatch_package_fingerprint_mismatch');
});

test('dispatch package digest mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ dispatch_package_digest: 'sha256:' + '0'.repeat(64) }), 'dispatch_package_digest_mismatch');
});

test('tenant identity mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ tenant_id: 'tenant-other' }), 'fingerprint_mismatch');
});

test('organization identity mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ organization_id: 'tenant-a:org-other' }), 'fingerprint_mismatch');
});

test('authorization provenance reference mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ dispatch_approval_gate_reference_ids: ['approval-gate-tampered'] }), 'dispatch_package_fingerprint_mismatch');
});

test('dispatch provenance reference mismatch blocks admission', () => {
  assertBlocked(tamperPackage({ dispatch_order_reference_id: 'dispatch-order-tampered' }), 'dispatch_package_fingerprint_mismatch');
});

test('missing upstream reference blocks admission', () => {
  assertBlocked(tamperPackage({ runtime_scheduler_package_id: undefined }), 'runtime_scheduler_package_id');
});

test('simulation false blocks admission', () => {
  assertBlocked(tamperPackage({ simulation: false }), 'simulation');
});

test('production blocked false blocks admission', () => {
  assertBlocked(tamperPackage({ production_blocked: false }), 'production_blocked');
});

test('unknown dispatch contract validator version blocks admission', () => {
  assertBlocked(tamperPackage({ validator_version: 'unknown_dispatch_validator' }), 'validator_version');
});

test('divergent replay with the same idempotency identity is rejected', () => {
  const first = intent();
  const divergent = { ...first, identity_scope: { ...first.identity_scope, project_id: 'project-divergent' } };
  divergent.runtime_execution_job_intent_fingerprint = computeRuntimeExecutionJobIntentFingerprint(divergent);
  divergent.runtime_execution_job_intent_digest = computeRuntimeExecutionJobIntentDigest(divergent);
  assert.equal(validateRuntimeExecutionJobIntent(divergent).valid, true);
  assert.deepEqual(compareRuntimeExecutionJobIntentReplay(first, divergent), { status: 'IDEMPOTENCY_CONFLICT' });
});

test('provider-specific field injection is rejected by the exact input contract', () => {
  assertBlocked(tamperPackage({ provider_slug: 'provider-example' }), 'unexpected_field');
});

test('network URL material is rejected and never copied', () => {
  assertBlocked(tamperPackage({ endpoint_url: 'https://example.invalid' }), 'unexpected_field');
});

test('credential-like material is rejected and never copied', () => {
  assertBlocked(tamperPackage({ api_key: 'secret-like-test-value' }), 'unexpected_field');
});

test('output remains in WAITING_EXTERNAL_EFFECT_AUTHORIZATION', () => {
  const value = intent();
  assert.equal(value.execution_job_state, 'WAITING_EXTERNAL_EFFECT_AUTHORIZATION');
  assert.equal(value.external_effect_authorization_state, 'NOT_AUTHORIZED');
  assert.equal(value.job_created, false);
});

test('provider_call_allowed is structurally forced false', () => {
  const value = intent();
  assert.equal(value.provider_call_allowed, false);
  assert.equal(value.provider_called, false);
  assert.equal(validateRuntimeExecutionJobIntent({ ...value, provider_call_allowed: true }).valid, false);
});

test('production_effect_allowed is structurally forced false', () => {
  const value = intent();
  assert.equal(value.production_effect_allowed, false);
  assert.equal(value.external_effect_authorized, false);
  assert.equal(validateRuntimeExecutionJobIntent({ ...value, production_effect_allowed: true }).valid, false);
});

test('module contains no network operation or persistence adapter', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'runtime-execution-job-intent.js'), 'utf8');
  assert.doesNotMatch(source, /\b(fetch|axios|http|https|net|tls|pg|fs\.write|writeFile|createWriteStream)\b/i);
  assert.doesNotMatch(source, /\bMap\s*\(/, 'P1 must not introduce a registry or persistence store');
});

test('module is pure and does not add operational persistence', () => {
  const value = buildRuntimeExecutionJobIntent(dispatchPackage);
  assert.equal(value.simulation, true);
  assert.equal(value.production_blocked, true);
  assert.equal(value.network_used, false);
  assert.equal(value.secret_resolved, false);
  assert.equal(value.executed, false);
  assert.equal(value.job_created, false);
});

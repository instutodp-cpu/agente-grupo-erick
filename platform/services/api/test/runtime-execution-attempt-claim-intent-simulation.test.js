'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const {
  CONTRACT_NAME,
  FIELDS,
  SAFE_FLAGS,
  STATUS,
  buildClaimIntent,
  validateClaimIntent,
  validateInput
} = require('../src/core/runtime-execution-attempt-claim-intent-simulation');

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildInput() {
  const p8 = buildAdmissionInput();
  const p9 = buildAdmissionResult({
    outcome: 'ADMITTED',
    record: p8.p7_durable_record,
    decision: p8.p8_admission_decision,
    finalState: 'ADMITTED',
    finalRevision: 2,
    transitionApplied: true,
    reasonCode: 'prepared_to_admitted'
  });
  return { p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 };
}

function rebuildP9(input, changes = {}) {
  return {
    ...input,
    p9_durable_admission: {
      ...input.p9_durable_admission,
      ...changes
    }
  };
}

test('canonical ADMITTED/2 predecessor creates an immutable claim intent', () => {
  const input = buildInput();
  const intent = buildClaimIntent(input);
  assert.equal(intent.contract_name, CONTRACT_NAME);
  assert.equal(intent.status, STATUS);
  assert.equal(intent.attempt_state, 'ADMITTED');
  assert.equal(intent.attempt_revision, 2);
  assert.equal(intent.claim_intent_created, true);
  assert.equal(intent.claim_eligibility_decided, false);
  assert.equal(intent.claim_eligible, false);
  assert.equal(intent.claim_issued, false);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal(validateClaimIntent(intent).valid, true);
});

test('invalid lifecycle, identity, scope, fingerprint and predecessor evidence fail closed', () => {
  const cases = [
    ['PREPARED/1', rebuildP9(buildInput(), { final_state: 'PREPARED', final_revision: 1 })],
    ['wrong revision', rebuildP9(buildInput(), { final_revision: 3 })],
    ['missing identity', (() => { const input = mutable(buildInput()); delete input.p7_durable_record.runtime_execution_attempt_durable_record_id; return input; })()],
    ['identity mismatch', (() => { const input = mutable(buildInput()); input.p9_durable_admission.runtime_execution_attempt_durable_record_reference.id = 'other'; return input; })()],
    ['scope mismatch', (() => { const input = mutable(buildInput()); input.p7_durable_record.identity_scope.tenant_id = 'other-tenant'; return input; })()],
    ['fingerprint mismatch', (() => { const input = mutable(buildInput()); input.p9_durable_admission.runtime_execution_attempt_durable_record_reference.fingerprint = 'other'; return input; })()],
    ['digest mismatch', (() => { const input = mutable(buildInput()); input.p9_durable_admission.runtime_execution_attempt_durable_record_reference.digest = 'sha256:' + '0'.repeat(64); return input; })()],
    ['malformed predecessor', (() => { const input = buildInput(); input.p9_durable_admission = { malformed: true }; return input; })()]
  ];
  for (const [name, input] of cases) assert.equal(validateInput(input).valid, false, name);
});

test('identical replay is byte-equivalent and deterministic', () => {
  const input = buildInput();
  const first = buildClaimIntent(input);
  const second = buildClaimIntent(mutable(input));
  assert.deepEqual(second, first);
  assert.equal(second.runtime_execution_attempt_claim_intent_id, first.runtime_execution_attempt_claim_intent_id);
  assert.equal(second.runtime_execution_attempt_claim_intent_fingerprint, first.runtime_execution_attempt_claim_intent_fingerprint);
  assert.equal(second.runtime_execution_attempt_claim_intent_digest, first.runtime_execution_attempt_claim_intent_digest);
});

test('divergent evidence is rejected without reconciliation or mutation', () => {
  const input = mutable(buildInput());
  const before = mutable(input);
  input.p9_durable_admission.final_revision = 3;
  const validation = validateInput(input);
  assert.equal(validation.valid, false);
  assert.notDeepEqual(input, before);
  assert.equal(validateInput(before).valid, true);
});

test('property ordering does not change the canonical intent', () => {
  const input = buildInput();
  const reordered = { p9_durable_admission: input.p9_durable_admission, p7_durable_record: input.p7_durable_record };
  assert.deepEqual(buildClaimIntent(reordered), buildClaimIntent(input));
});

test('all ownership, execution, capacity and external-effect flags remain safely false', () => {
  const intent = buildClaimIntent(buildInput());
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) assert.equal(intent[field], expected, field);
  assert.equal(intent.simulation, true);
  assert.equal(intent.production_blocked, true);
});

test('P10 has no PostgreSQL, adapter, migration or runtime wiring dependency', () => {
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-claim-intent-simulation'), 'utf8');
  assert.doesNotMatch(source, /require\(['"].*pg|pool|client\.query|UPDATE |INSERT INTO|fetch\(|axios|http\.request|https\.request/);
  assert.deepEqual(FIELDS.includes('claim_eligibility_decided'), true);
  const intent = buildClaimIntent(buildInput());
  assert.equal(Object.hasOwn(intent, 'worker_id'), false);
  assert.equal(Object.hasOwn(intent, 'executor_id'), false);
  assert.equal(Object.hasOwn(intent, 'lease_id'), false);
  assert.equal(Object.hasOwn(intent, 'fencing_token'), false);
  assert.equal(Object.hasOwn(intent, 'claim_id'), false);
});

test('P7 remains the original canonical record and P9 remains the admitted predecessor', () => {
  const input = buildInput();
  const before = mutable(input);
  const intent = buildClaimIntent(input);
  assert.equal(input.p9_durable_admission.final_state, 'ADMITTED');
  assert.equal(input.p9_durable_admission.final_revision, 2);
  assert.equal(input.p7_durable_record.attempt_admitted, false);
  assert.equal(intent.attempt_state, 'ADMITTED');
  assert.equal(intent.attempt_revision, 2);
  assert.deepEqual(input, before);
});

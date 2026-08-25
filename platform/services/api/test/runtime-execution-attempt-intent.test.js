'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint,
  validateRuntimeExecutionJobMaterialization
} = require('../src/core/runtime-execution-job-materialization');
const {
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
} = require('../src/core/runtime-execution-job-intent');
const {
  buildDurableJobRecord,
  validateRuntimeExecutionJobDurableRecord
} = require('../src/core/runtime-execution-job-durable-contract');
const {
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_INTENT_VALIDATOR_VERSION,
  buildRuntimeExecutionAttemptIntent,
  compareRuntimeExecutionAttemptIntentReplay,
  computeRuntimeExecutionAttemptIntentDigest,
  computeRuntimeExecutionAttemptIntentFingerprint,
  validateRuntimeExecutionAttemptIntent
} = require('../src/core/runtime-execution-attempt-intent');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function compactReference(id) {
  return {
    id,
    version: 1,
    fingerprint: `${id}-fingerprint`,
    digest: ZERO_DIGEST
  };
}

function buildCompactDurableFixture() {
  const identityScope = {
    tenant_id: 'tenant-compact',
    organization_id: 'organization-compact',
    project_id: 'project-compact',
    session_reference_id: 'session-compact',
    agent_id: 'agent-compact',
    actor_id: 'actor-compact'
  };
  const runtimeExecutionJobIntentReference = compactReference('intent-compact');
  const dispatchPackageReference = compactReference('dispatch-compact');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-compact-fingerprint',
    validated: true,
    consumed: false,
    duplicate_execution_blocked: true
  };
  const jobIdentity = {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: runtimeExecutionJobIntentReference,
    dispatch_package_reference: dispatchPackageReference,
    identity_scope: identityScope,
    idempotency_fingerprint: idempotencyReference.fingerprint,
    dispatch_provenance_digest: provenanceReference.dispatch_provenance_digest
  };
  const jobDigest = computeCanonicalContentDigest(jobIdentity);
  const jobReference = {
    id: `runtime-execution-job-${jobDigest.slice('sha256:'.length)}`,
    version: 1,
    fingerprint: stablePayload(jobIdentity),
    digest: jobDigest
  };
  const materialization = {
    runtime_execution_job_materialization_id: 'materialization-compact',
    runtime_execution_job_materialization_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
    runtime_execution_job_materialization_fingerprint: 'pending',
    runtime_execution_job_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_JOB_INTENT_STATUS,
    input_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    input_external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    runtime_execution_job_intent_reference: runtimeExecutionJobIntentReference,
    job_reference: jobReference,
    dispatch_package_reference: dispatchPackageReference,
    provenance_reference: provenanceReference,
    identity_scope: identityScope,
    idempotency_reference: idempotencyReference,
    execution_job_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    execution_authorized: false,
    external_effect_allowed: false,
    provider_call_allowed: false,
    network_call_allowed: false,
    secrets_materialized: false,
    attempt_created: false,
    execution_performed: false,
    durable_job_persisted: false,
    output_persisted: false,
    simulation: true,
    production_blocked: true,
    validator_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION
  };
  materialization.runtime_execution_job_materialization_fingerprint =
    computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest =
    computeRuntimeExecutionJobMaterializationDigest(materialization);
  const materializationValidation = validateRuntimeExecutionJobMaterialization(materialization);
  assert.equal(materializationValidation.valid, true, materializationValidation.errors.join('; '));
  return buildDurableJobRecord(materialization);
}

let cachedDurableFixture;

function getValidDurableFixture() {
  if (!cachedDurableFixture) {
    cachedDurableFixture = buildCompactDurableFixture();
    const validation = validateRuntimeExecutionJobDurableRecord(cachedDurableFixture);
    assert.equal(validation.valid, true, validation.errors.join('; '));
    assert.deepEqual(validation.errors, []);
    assert.equal(Object.isFrozen(cachedDurableFixture), true);
  }
  return cachedDurableFixture;
}

const BASE_RECORD = getValidDurableFixture();

function mutableRecord() {
  return JSON.parse(JSON.stringify(BASE_RECORD));
}

function assertBuildRejected(record, ordinal = 1) {
  assert.throws(
    () => buildRuntimeExecutionAttemptIntent(record, ordinal),
    /runtime_execution_attempt_intent_(?:predecessor|attempt_ordinal)_invalid/
  );
}

function mutableIntent(value) {
  return JSON.parse(JSON.stringify(value));
}

test('valid ADMITTED durable job and positive ordinal produce a prepared intent', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.equal(output.contract_name, RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_NAME);
  assert.equal(output.contract_version, RUNTIME_EXECUTION_ATTEMPT_INTENT_CONTRACT_VERSION);
  assert.equal(output.status, RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS);
  assert.equal(output.attempt_ordinal, 1);
  assert.equal(output.durable_job_status, 'ADMITTED');
  assert.equal(output.durable_job_state, 'ADMITTED');
  assert.equal(output.durable_job_revision, 1);
  assert.equal(validateRuntimeExecutionAttemptIntent(output).valid, true);
});

test('same durable job and ordinal are exactly deterministic', () => {
  const first = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  const second = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.deepEqual(second, first);
  assert.equal(second.runtime_execution_attempt_intent_id, first.runtime_execution_attempt_intent_id);
  assert.equal(second.runtime_execution_attempt_intent_fingerprint, first.runtime_execution_attempt_intent_fingerprint);
  assert.equal(second.runtime_execution_attempt_intent_digest, first.runtime_execution_attempt_intent_digest);
});

test('different attempt ordinals produce distinct deterministic identities', () => {
  const first = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  const second = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 2);
  assert.notEqual(second.runtime_execution_attempt_intent_id, first.runtime_execution_attempt_intent_id);
  assert.notEqual(second.runtime_execution_attempt_intent_fingerprint, first.runtime_execution_attempt_intent_fingerprint);
  assert.notEqual(second.runtime_execution_attempt_intent_digest, first.runtime_execution_attempt_intent_digest);
});

test('intent and nested references are deeply immutable', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.job_reference), true);
  assert.equal(Object.isFrozen(output.identity_scope), true);
  assert.throws(() => { output.attempt_ordinal = 2; }, TypeError);
  assert.throws(() => { output.identity_scope.project_id = 'mutated'; }, TypeError);
});

test('mutating the predecessor after build cannot mutate the intent', () => {
  const record = mutableRecord();
  const output = buildRuntimeExecutionAttemptIntent(record, 1);
  const snapshot = stablePayload(output);
  record.identity_scope.project_id = 'project-mutated-after-build';
  record.job_reference.id = 'job-mutated-after-build';
  assert.equal(stablePayload(output), snapshot);
});

test('malformed predecessor is rejected before intent construction', () => {
  assertBuildRejected(null);
  assertBuildRejected({});
});

test('durable fingerprint corruption is rejected', () => {
  const record = mutableRecord();
  record.runtime_execution_job_durable_fingerprint = 'corrupt-fingerprint';
  assertBuildRejected(record);
});

test('durable digest corruption is rejected', () => {
  const record = mutableRecord();
  record.runtime_execution_job_durable_digest = `sha256:${'0'.repeat(64)}`;
  assertBuildRejected(record);
});

test('non-ADMITTED predecessor state and status are rejected', () => {
  const stateChanged = mutableRecord();
  stateChanged.state = 'RUNNING';
  assertBuildRejected(stateChanged);
  const statusChanged = mutableRecord();
  statusChanged.status = 'RUNNING';
  assertBuildRejected(statusChanged);
});

test('revision other than one is rejected', () => {
  const record = mutableRecord();
  record.revision = 2;
  assertBuildRejected(record);
});

test('malformed admission reference is rejected', () => {
  const record = mutableRecord();
  record.admission_reference.id = '';
  assertBuildRejected(record);
});

test('logical identity mismatch is rejected', () => {
  const record = mutableRecord();
  record.logical_job_identity.digest = `sha256:${'0'.repeat(64)}`;
  assertBuildRejected(record);
});

for (const field of ['tenant_id', 'organization_id', 'project_id', 'agent_id']) {
  test(`${field} scope mutation is rejected`, () => {
    const record = mutableRecord();
    record.identity_scope[field] = `${record.identity_scope[field]}-other`;
    assertBuildRejected(record);
  });
}

for (const ordinal of [0, -1, 1.5, '1', Infinity, NaN]) {
  test(`invalid attempt ordinal ${String(ordinal)} is rejected`, () => {
    assert.throws(
      () => buildRuntimeExecutionAttemptIntent(BASE_RECORD, ordinal),
      /runtime_execution_attempt_intent_attempt_ordinal_invalid/
    );
  });
}

test('unsupported contract, validator, status and predecessor metadata fail closed', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  for (const [field, value] of [
    ['contract_name', 'FUTURE_CONTRACT'],
    ['contract_version', 'runtime_execution_attempt_intent_contract_v2'],
    ['runtime_execution_attempt_intent_version', 2],
    ['validator_version', 'runtime_execution_attempt_intent_validator_v2'],
    ['status', 'EXECUTION_ATTEMPT_INTENT_FUTURE'],
    ['predecessor_contract_version', 'runtime_execution_job_durable_contract_v2']
  ]) {
    const candidate = mutableIntent(output);
    candidate[field] = value;
    assert.equal(validateRuntimeExecutionAttemptIntent(candidate).valid, false, field);
  }
});

test('unsafe flags, simulation promotion and extra fields fail closed', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  for (const field of ['attempt_created', 'claim_issued', 'lease_granted', 'execution_authorized', 'provider_called']) {
    const candidate = mutableIntent(output);
    candidate[field] = true;
    assert.equal(validateRuntimeExecutionAttemptIntent(candidate).valid, false, field);
  }
  const nonSimulation = mutableIntent(output);
  nonSimulation.simulation = false;
  assert.equal(validateRuntimeExecutionAttemptIntent(nonSimulation).valid, false);
  const nonProductionBlocked = mutableIntent(output);
  nonProductionBlocked.production_blocked = false;
  assert.equal(validateRuntimeExecutionAttemptIntent(nonProductionBlocked).valid, false);
  assert.equal(validateRuntimeExecutionAttemptIntent({ ...mutableIntent(output), unexpected: true }).valid, false);
});

test('all authority, ownership and effect flags remain false', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.equal(output.attempt_intent_formed, true);
  for (const field of [
    'attempt_created', 'attempt_persisted', 'claim_issued', 'lease_granted', 'fencing_token_issued',
    'worker_ownership_established', 'executor_ownership_established', 'execution_authorized',
    'execution_started', 'execution_performed', 'provider_call_allowed', 'provider_called',
    'network_call_allowed', 'network_used', 'secrets_materialized', 'external_effect_allowed',
    'external_effect_performed'
  ]) assert.equal(output[field], false, field);
  assert.equal('attempt_id' in output, false);
  assert.equal('lease' in output, false);
  assert.equal('owner_reference' in output, false);
});

test('the predecessor remains unchanged and no database boundary is imported', () => {
  const record = mutableRecord();
  const before = stablePayload(record);
  buildRuntimeExecutionAttemptIntent(record, 1);
  assert.equal(stablePayload(record), before);
  const source = fs.readFileSync(path.resolve(__dirname, '../src/core/runtime-execution-attempt-intent.js'), 'utf8');
  assert.doesNotMatch(source, /\/adapters\//);
  assert.doesNotMatch(source, /\b(?:postgres|pg)\b/i);
});

test('pure replay comparison accepts identical material and rejects divergence', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.deepEqual(compareRuntimeExecutionAttemptIntentReplay(output, output), { status: 'IDENTICAL_REPLAY' });
  const candidate = mutableIntent(output);
  candidate.logical_job_identity_digest = `sha256:${'1'.repeat(64)}`;
  candidate.runtime_execution_attempt_intent_fingerprint = computeRuntimeExecutionAttemptIntentFingerprint(candidate);
  candidate.runtime_execution_attempt_intent_digest = computeRuntimeExecutionAttemptIntentDigest(candidate);
  assert.deepEqual(compareRuntimeExecutionAttemptIntentReplay(output, candidate), { status: 'CONFLICT' });
});

test('output integrity fingerprints and digests are canonical', () => {
  const output = buildRuntimeExecutionAttemptIntent(BASE_RECORD, 1);
  assert.equal(output.runtime_execution_attempt_intent_fingerprint, computeRuntimeExecutionAttemptIntentFingerprint(output));
  assert.equal(output.runtime_execution_attempt_intent_digest, computeRuntimeExecutionAttemptIntentDigest(output));
  assert.equal(output.logical_job_identity_digest, BASE_RECORD.logical_job_identity.digest);
  assert.equal(output.admission_reference.id, BASE_RECORD.admission_reference.id);
});

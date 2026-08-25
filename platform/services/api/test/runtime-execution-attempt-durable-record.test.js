'use strict';

const assert = require('node:assert/strict');
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
const { buildDurableJobRecord, validateRuntimeExecutionJobDurableRecord } =
  require('../src/core/runtime-execution-job-durable-contract');
const {
  buildRuntimeExecutionAttemptIntent,
  validateRuntimeExecutionAttemptIntent
} = require('../src/core/runtime-execution-attempt-intent');
const {
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION,
  buildRuntimeExecutionAttemptMaterialization,
  validateRuntimeExecutionAttemptMaterialization
} = require('../src/core/runtime-execution-attempt-materialization');
const {
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_VALIDATOR_VERSION,
  buildRuntimeExecutionAttemptDurableRecord,
  compareRuntimeExecutionAttemptDurableRecordReplay,
  computeRuntimeExecutionAttemptDurableRecordDigest,
  computeRuntimeExecutionAttemptDurableRecordFingerprint,
  validateRuntimeExecutionAttemptDurableRecord
} = require('../src/core/runtime-execution-attempt-durable-record');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function compactReference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildCompactDurableFixture() {
  const identityScope = {
    tenant_id: 'tenant-p6-compact',
    organization_id: 'organization-p6-compact',
    project_id: 'project-p6-compact',
    session_reference_id: 'session-p6-compact',
    agent_id: 'agent-p6-compact',
    actor_id: 'actor-p6-compact'
  };
  const runtimeExecutionJobIntentReference = compactReference('intent-p6-compact');
  const dispatchPackageReference = compactReference('dispatch-p6-compact');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p6-compact-fingerprint',
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
    runtime_execution_job_materialization_id: 'materialization-p6-compact',
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
  const validation = validateRuntimeExecutionJobMaterialization(materialization);
  assert.equal(validation.valid, true, validation.errors.join('; '));
  return buildDurableJobRecord(materialization);
}

let cachedP5;

function getValidP5() {
  if (!cachedP5) {
    const durable = buildCompactDurableFixture();
    const durableValidation = validateRuntimeExecutionJobDurableRecord(durable);
    assert.equal(durableValidation.valid, true, durableValidation.errors.join('; '));
    const intent = buildRuntimeExecutionAttemptIntent(durable, 1);
    assert.equal(validateRuntimeExecutionAttemptIntent(intent).valid, true);
    cachedP5 = buildRuntimeExecutionAttemptMaterialization(intent);
    const p5Validation = validateRuntimeExecutionAttemptMaterialization(cachedP5);
    assert.equal(p5Validation.valid, true, p5Validation.errors.join('; '));
  }
  return cachedP5;
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('valid P5 produces a prepared canonical durable attempt record', () => {
  const output = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  assert.equal(output.contract_name, RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_NAME);
  assert.equal(output.contract_version, RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_CONTRACT_VERSION);
  assert.equal(output.status, RUNTIME_EXECUTION_ATTEMPT_DURABLE_RECORD_STATUS);
  assert.equal(output.input_status, RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS);
  assert.equal(output.attempt_ordinal, 1);
  assert.equal(validateRuntimeExecutionAttemptDurableRecord(output).valid, true);
});

test('same P5 predecessor deterministically reproduces the same durable record', () => {
  const first = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  const second = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  assert.deepEqual(second, first);
  assert.equal(second.runtime_execution_attempt_durable_record_id, first.runtime_execution_attempt_durable_record_id);
});

test('durable-record ID is rejected when changed before recomputing integrity', () => {
  const candidate = mutable(buildRuntimeExecutionAttemptDurableRecord(getValidP5()));
  candidate.runtime_execution_attempt_durable_record_id = 'arbitrary-durable-record-id';
  candidate.runtime_execution_attempt_durable_record_fingerprint =
    computeRuntimeExecutionAttemptDurableRecordFingerprint(candidate);
  candidate.runtime_execution_attempt_durable_record_digest =
    computeRuntimeExecutionAttemptDurableRecordDigest(candidate);
  const validation = validateRuntimeExecutionAttemptDurableRecord(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('durable_record_id_mismatch'));
});

test('tampered P5 predecessor is rejected by the official P5 validator', () => {
  const candidate = mutable(getValidP5());
  candidate.attempt_ordinal = 2;
  assert.throws(
    () => buildRuntimeExecutionAttemptDurableRecord(candidate),
    /runtime_execution_attempt_durable_record_predecessor_invalid/
  );
});

test('all predecessor references and semantic bindings are preserved', () => {
  const p5 = getValidP5();
  const output = buildRuntimeExecutionAttemptDurableRecord(p5);
  assert.deepEqual(output.runtime_execution_attempt_materialization_reference, {
    id: p5.runtime_execution_attempt_materialization_id,
    version: p5.runtime_execution_attempt_materialization_version,
    fingerprint: p5.runtime_execution_attempt_materialization_fingerprint,
    digest: p5.runtime_execution_attempt_materialization_digest
  });
  assert.deepEqual(output.runtime_execution_attempt_intent_reference, p5.runtime_execution_attempt_intent_reference);
  assert.deepEqual(output.durable_job_reference, p5.durable_job_reference);
  assert.equal(output.logical_job_identity_digest, p5.logical_job_identity_digest);
  assert.deepEqual(output.admission_reference, p5.admission_reference);
  assert.deepEqual(output.identity_scope, p5.identity_scope);
  assert.equal(output.attempt_ordinal, p5.attempt_ordinal);
});

test('invalid metadata, references, digests, and unknown fields fail closed', () => {
  const output = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  assert.equal(validateRuntimeExecutionAttemptDurableRecord({ ...mutable(output), unexpected: true }).valid, false);
  for (const [field, value] of [
    ['contract_name', 'FUTURE'],
    ['contract_version', 'future_v2'],
    ['runtime_execution_attempt_durable_record_version', 2],
    ['status', 'EXECUTION_ATTEMPT_DURABLE_RECORD'],
    ['validator_version', 'future_validator_v2'],
    ['attempt_ordinal', 0]
  ]) {
    assert.equal(validateRuntimeExecutionAttemptDurableRecord({ ...mutable(output), [field]: value }).valid, false, field);
  }
  const malformedDigest = mutable(output);
  malformedDigest.durable_job_reference.digest = 'not-a-digest';
  assert.equal(validateRuntimeExecutionAttemptDurableRecord(malformedDigest).valid, false);
  const malformedReference = mutable(output);
  malformedReference.admission_reference = { id: 'missing-fields' };
  assert.equal(validateRuntimeExecutionAttemptDurableRecord(malformedReference).valid, false);
});

test('output is immutable and all authority/effect flags remain false', () => {
  const output = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.runtime_execution_attempt_materialization_reference), true);
  assert.equal(Object.isFrozen(output.runtime_execution_attempt_intent_reference), true);
  assert.equal(Object.isFrozen(output.durable_job_reference), true);
  assert.equal(Object.isFrozen(output.admission_reference), true);
  assert.equal(Object.isFrozen(output.identity_scope), true);
  for (const field of [
    'attempt_created', 'attempt_persisted', 'attempt_admitted', 'claim_issued', 'lease_granted',
    'fencing_token_issued', 'worker_ownership_established', 'executor_ownership_established',
    'execution_authorized', 'execution_started', 'execution_performed', 'provider_call_allowed',
    'provider_called', 'network_call_allowed', 'network_used', 'secrets_materialized',
    'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(output[field], false, field);
  assert.equal(output.attempt_durable_record_prepared_simulation, true);
  assert.equal(output.simulation, true);
  assert.equal(output.production_blocked, true);
});

test('replay comparison is deterministic and pure', () => {
  const output = buildRuntimeExecutionAttemptDurableRecord(getValidP5());
  assert.deepEqual(compareRuntimeExecutionAttemptDurableRecordReplay(output, mutable(output)), { status: 'IDENTICAL_REPLAY' });
  const divergent = mutable(output);
  divergent.attempt_ordinal = 2;
  assert.deepEqual(compareRuntimeExecutionAttemptDurableRecordReplay(output, divergent), { status: 'CONFLICT' });
});

test('P6 source is Core-only and contains no persistence or effect clients', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve(__dirname, '../src/core/runtime-execution-attempt-durable-record.js'), 'utf8');
  assert.doesNotMatch(source, /\/adapters\/|\bpostgres\b|\bpg\b|INSERT|UPSERT|transaction|child_process|worker_threads|fetch\s*\(/i);
});

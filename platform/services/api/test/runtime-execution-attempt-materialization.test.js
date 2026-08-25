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
  validateRuntimeExecutionAttemptIntent
} = require('../src/core/runtime-execution-attempt-intent');
const {
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_VALIDATOR_VERSION,
  computeRuntimeExecutionAttemptMaterializationDigest,
  computeRuntimeExecutionAttemptMaterializationFingerprint,
  compareRuntimeExecutionAttemptMaterializationReplay,
  buildRuntimeExecutionAttemptMaterialization,
  validateRuntimeExecutionAttemptMaterialization
} = require('../src/core/runtime-execution-attempt-materialization');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function compactReference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildCompactDurableFixture() {
  const identityScope = {
    tenant_id: 'tenant-p5-compact',
    organization_id: 'organization-p5-compact',
    project_id: 'project-p5-compact',
    session_reference_id: 'session-p5-compact',
    agent_id: 'agent-p5-compact',
    actor_id: 'actor-p5-compact'
  };
  const runtimeExecutionJobIntentReference = compactReference('intent-p5-compact');
  const dispatchPackageReference = compactReference('dispatch-p5-compact');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p5-compact-fingerprint',
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
    runtime_execution_job_materialization_id: 'materialization-p5-compact',
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

let cachedIntent;

function getValidP4Intent() {
  if (!cachedIntent) {
    const durableRecord = buildCompactDurableFixture();
    const durableValidation = validateRuntimeExecutionJobDurableRecord(durableRecord);
    assert.equal(durableValidation.valid, true, durableValidation.errors.join('; '));
    assert.deepEqual(durableValidation.errors, []);
    const intent = buildRuntimeExecutionAttemptIntent(durableRecord, 1);
    const intentValidation = validateRuntimeExecutionAttemptIntent(intent);
    assert.equal(intentValidation.valid, true, intentValidation.errors.join('; '));
    cachedIntent = intent;
  }
  return cachedIntent;
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('valid P4 intent produces a prepared P5 materialization simulation', () => {
  const output = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  assert.equal(output.contract_name, RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_NAME);
  assert.equal(output.contract_version, RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_CONTRACT_VERSION);
  assert.equal(output.status, RUNTIME_EXECUTION_ATTEMPT_MATERIALIZATION_STATUS);
  assert.equal(output.input_status, RUNTIME_EXECUTION_ATTEMPT_INTENT_STATUS);
  assert.equal(output.attempt_ordinal, 1);
  assert.equal(validateRuntimeExecutionAttemptMaterialization(output).valid, true);
});

test('same P4 intent deterministically reproduces the same materialization', () => {
  const first = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  const second = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  assert.deepEqual(second, first);
  assert.equal(second.runtime_execution_attempt_materialization_id, first.runtime_execution_attempt_materialization_id);
  assert.equal(second.runtime_execution_attempt_materialization_fingerprint, first.runtime_execution_attempt_materialization_fingerprint);
  assert.equal(second.runtime_execution_attempt_materialization_digest, first.runtime_execution_attempt_materialization_digest);
});

test('materialization output is deeply immutable', () => {
  const output = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.isFrozen(output.runtime_execution_attempt_intent_reference), true);
  assert.equal(Object.isFrozen(output.durable_job_reference), true);
  assert.equal(Object.isFrozen(output.admission_reference), true);
  assert.equal(Object.isFrozen(output.identity_scope), true);
});

test('tampered materialization ID is rejected even when integrity is recomputed', () => {
  const candidate = mutable(buildRuntimeExecutionAttemptMaterialization(getValidP4Intent()));
  candidate.runtime_execution_attempt_materialization_id = 'arbitrary-materialization-id';
  candidate.runtime_execution_attempt_materialization_fingerprint =
    computeRuntimeExecutionAttemptMaterializationFingerprint(candidate);
  candidate.runtime_execution_attempt_materialization_digest =
    computeRuntimeExecutionAttemptMaterializationDigest(candidate);
  const validation = validateRuntimeExecutionAttemptMaterialization(candidate);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.includes('materialization_id_mismatch'));
});

test('tampered P4 predecessor reference is rejected', () => {
  const candidate = mutable(getValidP4Intent());
  candidate.attempt_ordinal = 2;
  assert.throws(
    () => buildRuntimeExecutionAttemptMaterialization(candidate),
    /runtime_execution_attempt_materialization_predecessor_invalid/
  );
});

test('attempt ordinal, scope, durable job reference, and admission reference remain bound', () => {
  const intent = mutable(getValidP4Intent());
  const materialization = buildRuntimeExecutionAttemptMaterialization(intent);
  assert.equal(materialization.attempt_ordinal, intent.attempt_ordinal);
  assert.deepEqual(materialization.identity_scope, intent.identity_scope);
  assert.deepEqual(materialization.durable_job_reference, intent.durable_job_reference);
  assert.deepEqual(materialization.admission_reference, intent.admission_reference);
});

test('authority, ownership, and effect flags remain false', () => {
  const output = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  for (const field of [
    'attempt_created', 'attempt_persisted', 'claim_issued', 'lease_granted', 'fencing_token_issued',
    'worker_ownership_established', 'executor_ownership_established', 'execution_authorized',
    'execution_started', 'execution_performed', 'provider_call_allowed', 'provider_called',
    'network_call_allowed', 'network_used', 'secrets_materialized', 'external_effect_allowed',
    'external_effect_performed'
  ]) {
    assert.equal(output[field], false, field);
  }
  assert.equal(output.attempt_materialized_simulation, true);
  assert.equal(output.simulation, true);
  assert.equal(output.production_blocked, true);
});

test('unknown fields and invalid metadata fail closed', () => {
  const output = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  assert.equal(validateRuntimeExecutionAttemptMaterialization({ ...mutable(output), unexpected: true }).valid, false);
  for (const [field, value] of [
    ['contract_name', 'FUTURE'],
    ['contract_version', 'future_v2'],
    ['status', 'EXECUTION_ATTEMPT_MATERIALIZED'],
    ['validator_version', 'future_validator_v2']
  ]) {
    assert.equal(validateRuntimeExecutionAttemptMaterialization({ ...mutable(output), [field]: value }).valid, false, field);
  }
});

test('replay comparison is pure and fail closed', () => {
  const output = buildRuntimeExecutionAttemptMaterialization(getValidP4Intent());
  assert.deepEqual(compareRuntimeExecutionAttemptMaterializationReplay(output, mutable(output)), { status: 'IDENTICAL_REPLAY' });
  const divergent = mutable(output);
  divergent.attempt_ordinal = 2;
  assert.deepEqual(compareRuntimeExecutionAttemptMaterializationReplay(output, divergent), { status: 'CONFLICT' });
});

test('P5 source remains Core-only and has no side-effect imports', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').resolve(__dirname, '../src/core/runtime-execution-attempt-materialization.js'),
    'utf8'
  );
  assert.doesNotMatch(source, /\/adapters\/|\bpostgres\b|\bpg\b|child_process|worker_threads|fetch\s*\(/i);
});

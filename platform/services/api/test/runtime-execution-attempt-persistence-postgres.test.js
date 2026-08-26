'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { cloneFrozen, stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
} = require('../src/core/runtime-execution-job-intent');
const {
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint
} = require('../src/core/runtime-execution-job-materialization');
const { buildDurableJobRecord, validateRuntimeExecutionJobDurableRecord } =
  require('../src/core/runtime-execution-job-durable-contract');
const {
  buildRuntimeExecutionAttemptIntent,
  validateRuntimeExecutionAttemptIntent
} = require('../src/core/runtime-execution-attempt-intent');
const {
  buildRuntimeExecutionAttemptMaterialization,
  computeRuntimeExecutionAttemptMaterializationDigest,
  computeRuntimeExecutionAttemptMaterializationFingerprint,
  computeRuntimeExecutionAttemptMaterializationId,
  validateRuntimeExecutionAttemptMaterialization
} = require('../src/core/runtime-execution-attempt-materialization');
const {
  buildRuntimeExecutionAttemptDurableRecord,
  validateRuntimeExecutionAttemptDurableRecord
} = require('../src/core/runtime-execution-attempt-durable-record');
const {
  INSERT_SQL,
  READINESS_SQL,
  ROW_FIELDS,
  SELECT_BY_ID_SQL,
  SELECT_BY_JOB_ORDINAL_SQL,
  createRuntimeExecutionAttemptPersistencePostgres
} = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function compactReference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildCompactDurableFixture() {
  const identityScope = {
    tenant_id: 'tenant-p7-compact',
    organization_id: 'organization-p7-compact',
    project_id: 'project-p7-compact',
    session_reference_id: 'session-p7-compact',
    agent_id: 'agent-p7-compact',
    actor_id: 'actor-p7-compact'
  };
  const intentReference = compactReference('intent-p7-compact');
  const dispatchReference = compactReference('dispatch-p7-compact');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p7-compact-fingerprint',
    validated: true,
    consumed: false,
    duplicate_execution_blocked: true
  };
  const jobIdentity = {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: intentReference,
    dispatch_package_reference: dispatchReference,
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
    runtime_execution_job_materialization_id: 'materialization-p7-compact',
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
    runtime_execution_job_intent_reference: intentReference,
    job_reference: jobReference,
    dispatch_package_reference: dispatchReference,
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
  assert.equal(validateRuntimeExecutionJobMaterializationForFixture(materialization).valid, true);
  return buildDurableJobRecord(cloneFrozen(materialization));
}

function validateRuntimeExecutionJobMaterializationForFixture(materialization) {
  return require('../src/core/runtime-execution-job-materialization')
    .validateRuntimeExecutionJobMaterialization(materialization);
}

const cachedP6 = new Map();

function getP6(attemptOrdinal = 1) {
  if (!cachedP6.has(attemptOrdinal)) {
    const durableJob = buildCompactDurableFixture();
    assert.equal(validateRuntimeExecutionJobDurableRecord(durableJob).valid, true);
    const intent = buildRuntimeExecutionAttemptIntent(durableJob, attemptOrdinal);
    assert.equal(validateRuntimeExecutionAttemptIntent(intent).valid, true);
    const materialization = buildRuntimeExecutionAttemptMaterialization(intent);
    assert.equal(validateRuntimeExecutionAttemptMaterialization(materialization).valid, true);
    const record = buildRuntimeExecutionAttemptDurableRecord(materialization);
    assert.equal(validateRuntimeExecutionAttemptDurableRecord(record).valid, true);
    cachedP6.set(attemptOrdinal, record);
  }
  return cachedP6.get(attemptOrdinal);
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

function getDivergentP6SameJobOrdinal(attemptOrdinal) {
  const p6 = getP6(attemptOrdinal);
  const p5 = mutable(buildRuntimeExecutionAttemptMaterialization(
    buildRuntimeExecutionAttemptIntent(buildCompactDurableFixture(), attemptOrdinal)
  ));
  p5.runtime_execution_attempt_intent_reference.fingerprint = 'divergent-intent-fingerprint';
  p5.runtime_execution_attempt_intent_reference.digest = computeCanonicalContentDigest({ divergent: true });
  p5.runtime_execution_attempt_materialization_id = computeRuntimeExecutionAttemptMaterializationId({
    attemptIntentReference: p5.runtime_execution_attempt_intent_reference,
    durableJobReference: p5.durable_job_reference,
    logicalJobIdentityDigest: p5.logical_job_identity_digest,
    admissionReference: p5.admission_reference,
    identityScope: p5.identity_scope,
    attemptOrdinal: p5.attempt_ordinal
  });
  p5.runtime_execution_attempt_materialization_fingerprint =
    computeRuntimeExecutionAttemptMaterializationFingerprint(p5);
  p5.runtime_execution_attempt_materialization_digest =
    computeRuntimeExecutionAttemptMaterializationDigest(p5);
  assert.equal(validateRuntimeExecutionAttemptMaterialization(p5).valid, true);
  const divergent = buildRuntimeExecutionAttemptDurableRecord(p5);
  assert.notEqual(divergent.runtime_execution_attempt_durable_record_id, p6.runtime_execution_attempt_durable_record_id);
  assert.equal(divergent.durable_job_reference.id, p6.durable_job_reference.id);
  assert.equal(divergent.attempt_ordinal, p6.attempt_ordinal);
  return divergent;
}

function makeRow(values) {
  return Object.fromEntries(ROW_FIELDS.map((field, index) => [field, values[index]]));
}

function createFakePool() {
  const rows = new Map();
  const calls = { connect: 0, readiness: 0, released: 0, rollback: 0 };
  return {
    rows,
    calls,
    async query(sql) {
      assert.equal(sql, READINESS_SQL);
      calls.readiness += 1;
      return { rows: [{ schema_exists: true, table_exists: true, columns_exist: true, primary_key_exists: true, job_ordinal_key_exists: true, state_check_exists: true }] };
    },
    async connect() {
      calls.connect += 1;
      let pending = null;
      return {
        async query(sql, values) {
          if (sql === 'BEGIN' || sql.startsWith('SET LOCAL')) return { rows: [] };
          if (sql === 'COMMIT') {
            if (pending) rows.set(pending.attempt_durable_record_id, pending);
            pending = null;
            return { rows: [] };
          }
          if (sql === 'ROLLBACK') {
            calls.rollback += 1;
            pending = null;
            return { rows: [] };
          }
          if (sql === INSERT_SQL) {
            const candidate = makeRow(values);
            const ordinalConflict = [...rows.values()].some((row) =>
              row.durable_job_reference_id === candidate.durable_job_reference_id
              && Number(row.attempt_ordinal) === Number(candidate.attempt_ordinal));
            if (rows.has(candidate.attempt_durable_record_id) || ordinalConflict) return { rows: [] };
            pending = candidate;
            return { rows: [candidate] };
          }
          if (sql === SELECT_BY_ID_SQL) {
            const row = rows.get(values[0]);
            return { rows: row ? [row] : [] };
          }
          if (sql === SELECT_BY_JOB_ORDINAL_SQL) {
            const row = [...rows.values()].find((candidate) =>
              candidate.durable_job_reference_id === values[0]
              && Number(candidate.attempt_ordinal) === Number(values[1]));
            return { rows: row ? [row] : [] };
          }
          throw new Error(`unexpected_fake_sql:${sql}`);
        },
        release() {
          calls.released += 1;
        }
      };
    }
  };
}

test('P7 persists valid P6, converges identical replay, and keeps authority blocked', async () => {
  const pool = createFakePool();
  const adapter = createRuntimeExecutionAttemptPersistencePostgres({ pool });
  const first = await adapter.persistDurably(getP6(1));
  assert.equal(first.persistence_result.outcome, 'CREATED');
  assert.equal(first.persistence_result.attempt_created, true);
  assert.equal(first.persistence_result.attempt_persisted, true);
  assert.equal(first.persistence_result.attempt_admitted, false);
  assert.equal(first.persistence_result.persistence_real, true);
  assert.equal(first.persistence_result.execution_simulation, true);
  assert.equal(first.persistence_result.production_execution_blocked, true);
  for (const field of [
    'claim_issued', 'lease_granted', 'fencing_token_issued', 'worker_ownership_established',
    'executor_ownership_established', 'execution_authorized', 'execution_started',
    'execution_performed', 'provider_call_allowed', 'provider_called', 'network_call_allowed',
    'network_used', 'secrets_materialized', 'external_effect_allowed', 'external_effect_performed'
  ]) assert.equal(first.persistence_result[field], false, field);
  assert.equal(adapter.validatePersistenceProof(first.persistence_proof).valid, true);
  assert.equal(pool.rows.size, 1);

  const replay = await adapter.persistDurably(getP6(1));
  assert.equal(replay.persistence_result.outcome, 'EXISTING_IDENTICAL');
  assert.equal(replay.persistence_result.attempt_created, false);
  assert.equal(replay.persistence_result.attempt_persisted, true);
  assert.equal(replay.persistence_result.attempt_admitted, false);
  assert.equal(pool.rows.size, 1);
  assert.equal(adapter.validatePersistenceProof(replay.persistence_proof).valid, true);
});
test('P7 rejects invalid P6 without touching PostgreSQL and conflicts on divergent job ordinal', async () => {
  const pool = createFakePool();
  const adapter = createRuntimeExecutionAttemptPersistencePostgres({ pool });
  const invalid = mutable(getP6(2));
  invalid.attempt_admitted = true;
  const rejected = await adapter.persistDurably(invalid);
  assert.equal(rejected.persistence_result.outcome, 'REJECTED');
  assert.equal(pool.calls.connect, 0);

  const first = await adapter.persistDurably(getP6(3));
  assert.equal(first.persistence_result.outcome, 'CREATED');
  const conflict = await adapter.persistDurably(getDivergentP6SameJobOrdinal(3));
  assert.equal(conflict.persistence_result.outcome, 'CONFLICT');
  assert.equal(conflict.persistence_result.attempt_created, false);
  assert.equal(conflict.persistence_result.attempt_persisted, false);
  assert.equal(conflict.persistence_result.attempt_admitted, false);
  assert.equal(conflict.persistence_proof, null);
  assert.equal(pool.rows.size, 1);
});

test('P7 uses a single readiness check and releases every acquired client', async () => {
  const pool = createFakePool();
  const adapter = createRuntimeExecutionAttemptPersistencePostgres({ pool });
  await adapter.persistDurably(getP6(4));
  await adapter.persistDurably(getP6(4));
  assert.equal(pool.calls.readiness, 1);
  assert.equal(pool.calls.connect, 2);
  assert.equal(pool.calls.released, 2);
  assert.equal(pool.calls.rollback, 0);
});

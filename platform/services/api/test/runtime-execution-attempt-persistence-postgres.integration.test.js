'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
  createRuntimeExecutionAttemptPersistencePostgres
} = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/004_create_execution_attempts.sql');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const P7_TEST_SCHEMA = 'hermes_execution_attempts_p7_test';
const P7_TEST_TABLE = `${P7_TEST_SCHEMA}.execution_attempts`;
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function safeTestDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    const url = new URL(value);
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return ['postgres:', 'postgresql:'].includes(url.protocol)
      && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
      && /^hermes_test(?:_[a-z0-9_-]+)?$/i.test(database);
  } catch {
    return false;
  }
}

const REAL_POSTGRES_ENABLED = safeTestDatabaseUrl(TEST_DATABASE_URL);

function compactReference(id) {
  return { id, version: 1, fingerprint: `${id}-fingerprint`, digest: ZERO_DIGEST };
}

function buildCompactDurableFixture() {
  const identityScope = {
    tenant_id: 'tenant-p7-integration',
    organization_id: 'organization-p7-integration',
    project_id: 'project-p7-integration',
    session_reference_id: 'session-p7-integration',
    agent_id: 'agent-p7-integration',
    actor_id: 'actor-p7-integration'
  };
  const intentReference = compactReference('intent-p7-integration');
  const dispatchReference = compactReference('dispatch-p7-integration');
  const provenanceReference = {
    upstream_reference_ids: {},
    upstream_fingerprints: {},
    dispatch_provenance_digest: ZERO_DIGEST,
    authorization_reference_ids: [],
    authorization_reference_fingerprints: []
  };
  const idempotencyReference = {
    fingerprint: 'idempotency-p7-integration-fingerprint',
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
    runtime_execution_job_materialization_id: 'materialization-p7-integration',
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
  return buildDurableJobRecord(cloneFrozen(materialization));
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
  const p5 = mutable(buildRuntimeExecutionAttemptMaterialization(
    buildRuntimeExecutionAttemptIntent(buildCompactDurableFixture(), attemptOrdinal)
  ));
  p5.runtime_execution_attempt_intent_reference.fingerprint = 'divergent-integration-intent-fingerprint';
  p5.runtime_execution_attempt_intent_reference.digest = computeCanonicalContentDigest({ divergent: 'integration' });
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
  return buildRuntimeExecutionAttemptDurableRecord(p5);
}

function bounded(operation, label, timeoutMs = 30000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function isolatedMigration(sql) {
  return sql
    .replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${P7_TEST_SCHEMA};`)
    .replaceAll('hermes.execution_attempts', P7_TEST_TABLE);
}

test('P7 PostgreSQL adapter defaults to the production table and rejects unsafe table names', () => {
  const pool = { query() {}, connect() {} };
  const adapter = createRuntimeExecutionAttemptPersistencePostgres({ pool });
  assert.equal(adapter.table_name, 'hermes.execution_attempts');
  assert.throws(
    () => createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: 'hermes.execution_attempts; DROP SCHEMA hermes CASCADE' }),
    /table_name_invalid/
  );
});

test('P7 real PostgreSQL persistence proves PREPARED replay, conflicts, concurrency, and rollback', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const { Pool } = require('pg');
  const migration = isolatedMigration(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
  try {
    await bounded(pool.query(`DROP SCHEMA IF EXISTS ${P7_TEST_SCHEMA} CASCADE`), 'drop_previous_attempts');
    await bounded(pool.query(migration), 'apply_p7_migration');

    const metadata = await bounded(pool.query(`
      SELECT
        to_regclass('${P7_TEST_TABLE}') AS table_name,
        EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = '${P7_TEST_SCHEMA}' AND r.relname = 'execution_attempts' AND c.conname = 'execution_attempts_pkey') AS has_primary_key,
        EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
          JOIN pg_namespace n ON n.oid = r.relnamespace
          WHERE n.nspname = '${P7_TEST_SCHEMA}' AND r.relname = 'execution_attempts' AND c.conname = 'execution_attempts_job_ordinal_key') AS has_job_ordinal_key
    `), 'inspect_p7_schema');
    assert.equal(metadata.rows[0].table_name, P7_TEST_TABLE);
    assert.equal(metadata.rows[0].has_primary_key, true);
    assert.equal(metadata.rows[0].has_job_ordinal_key, true);

    const adapter = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: P7_TEST_TABLE });
    const first = await bounded(adapter.persistDurably(getP6(1)), 'first_insert');
    assert.equal(first.persistence_result.outcome, 'CREATED');
    assert.equal(first.persistence_result.attempt_created, true);
    assert.equal(first.persistence_result.attempt_persisted, true);
    assert.equal(first.persistence_result.attempt_admitted, false);
    assert.equal(first.persistence_result.persistence_real, true);
    assert.equal(adapter.validatePersistenceProof(first.persistence_proof).valid, true);

    const persisted = await bounded(pool.query(`
      SELECT state, revision, durable_record->>'attempt_admitted' AS attempt_admitted, attempt_durable_record_id,
             durable_record_fingerprint, durable_record_digest,
             tenant_id, organization_id, project_id, session_reference_id, agent_id, actor_id,
             durable_record->>'status' AS record_status
      FROM ${P7_TEST_TABLE}
    `), 'read_persisted_attempt');
    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0].state, 'PREPARED');
    assert.equal(Number(persisted.rows[0].revision), 1);
    assert.equal(persisted.rows[0].attempt_admitted, 'false');
    assert.equal(persisted.rows[0].record_status, 'EXECUTION_ATTEMPT_DURABLE_RECORD_PREPARED_SIMULATION');
    assert.equal(persisted.rows[0].attempt_durable_record_id, getP6(1).runtime_execution_attempt_durable_record_id);
    assert.equal(persisted.rows[0].durable_record_fingerprint, getP6(1).runtime_execution_attempt_durable_record_fingerprint);
    assert.equal(persisted.rows[0].durable_record_digest, getP6(1).runtime_execution_attempt_durable_record_digest);
    assert.equal(persisted.rows[0].tenant_id, getP6(1).identity_scope.tenant_id);

    const replay = await bounded(adapter.persistDurably(getP6(1)), 'identical_replay');
    assert.equal(replay.persistence_result.outcome, 'EXISTING_IDENTICAL');
    assert.equal(replay.persistence_result.attempt_created, false);
    assert.equal(replay.persistence_result.attempt_persisted, true);
    assert.equal(replay.persistence_result.attempt_admitted, false);
    const countAfterReplay = await bounded(pool.query(`SELECT count(*)::int AS count FROM ${P7_TEST_TABLE}`), 'count_after_replay');
    assert.equal(countAfterReplay.rows[0].count, 1);

    const divergent = getDivergentP6SameJobOrdinal(2);
    assert.equal((await bounded(adapter.persistDurably(getP6(2)), 'second_insert')).persistence_result.outcome, 'CREATED');
    const conflict = await bounded(adapter.persistDurably(divergent), 'divergent_replay');
    assert.equal(conflict.persistence_result.outcome, 'CONFLICT');
    assert.equal(conflict.persistence_result.attempt_created, false);
    assert.equal(conflict.persistence_result.attempt_persisted, false);
    assert.equal(conflict.persistence_result.attempt_admitted, false);
    assert.equal(conflict.persistence_proof, null);

    const exactConcurrent = await Promise.all(
      Array.from({ length: 8 }, () => bounded(adapter.persistDurably(getP6(3)), 'concurrent_exact'))
    );
    assert.equal(exactConcurrent.filter((result) => result.persistence_result.outcome === 'CREATED').length, 1);
    assert.equal(exactConcurrent.filter((result) => result.persistence_result.outcome === 'EXISTING_IDENTICAL').length, 7);

    const divergentConcurrent = getDivergentP6SameJobOrdinal(4);
    const divergentResults = await Promise.all([
      bounded(adapter.persistDurably(getP6(4)), 'concurrent_divergent_base'),
      bounded(adapter.persistDurably(divergentConcurrent), 'concurrent_divergent_variant')
    ]);
    assert.equal(divergentResults.filter((result) => result.persistence_result.outcome === 'CREATED').length, 1);
    assert.equal(divergentResults.filter((result) => result.persistence_result.outcome === 'CONFLICT').length, 1);

    const faultyPool = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        const originalQuery = client.query.bind(client);
        client.query = (sql, values) => {
          if (typeof sql === 'string' && sql.startsWith(`INSERT INTO ${P7_TEST_TABLE}`)) {
            return Promise.reject(new Error('forced_insert_failure'));
          }
          return values === undefined ? originalQuery(sql) : originalQuery(sql, values);
        };
        return client;
      }
    };
    const faultyAdapter = createRuntimeExecutionAttemptPersistencePostgres({ pool: faultyPool, tableName: P7_TEST_TABLE });
    await assert.rejects(() => bounded(faultyAdapter.persistDurably(getP6(5)), 'rollback_failure'), /postgres_persistence_failed/);
    const afterRollback = await bounded(pool.query(
      `SELECT count(*)::int AS count FROM ${P7_TEST_TABLE} WHERE attempt_ordinal = 5`
    ), 'count_after_rollback');
    assert.equal(afterRollback.rows[0].count, 0);

    const total = await bounded(pool.query(`SELECT count(*)::int AS count FROM ${P7_TEST_TABLE}`), 'final_count');
    assert.equal(total.rows[0].count, 4);
  } finally {
    try { await bounded(pool.query(`DROP SCHEMA IF EXISTS ${P7_TEST_SCHEMA} CASCADE`), 'cleanup_p7_schema'); } finally {
      await bounded(pool.end(), 'cleanup_p7_pool');
    }
  }
});

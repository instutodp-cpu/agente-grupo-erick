'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');
const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_execution_attempt_admission_p9_test';
const TEST_TABLE = `${TEST_SCHEMA}.execution_attempts`;
const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/004_create_execution_attempts.sql');
const P9A_MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/005_enable_execution_attempt_admission_lifecycle.sql');

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

function bounded(operation, label, timeoutMs = 30000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

function isolatedMigration(sql) {
  return sql
    .replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll('hermes.execution_attempts', TEST_TABLE);
}

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
}

test('P9 real PostgreSQL admission atomically transitions PREPARED/1 to ADMITTED/2', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 8, connectionTimeoutMillis: 5000 });
  const migration = isolatedMigration(fs.readFileSync(MIGRATION_PATH, 'utf8'));
  const lifecycleMigration = isolatedMigration(fs.readFileSync(P9A_MIGRATION_PATH, 'utf8'));
  try {
    await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'drop_p9_schema');
    await bounded(pool.query(migration), 'apply_p7_migration');
    await bounded(pool.query(lifecycleMigration), 'apply_p9a_migration');

    const p7 = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_TABLE });
    const input = buildAdmissionInput(1);
    const persisted = await bounded(p7.persistDurably(input.p7_durable_record), 'persist_prepared');
    assert.equal(persisted.persistence_result.outcome, 'CREATED');
    assert.equal(persisted.persistence_result.state, 'PREPARED');
    assert.equal(persisted.persistence_result.revision, 1);
    assert.equal(persisted.persistence_result.attempt_admitted, false);

    const adapter = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_TABLE });
    const admitted = await bounded(adapter.admitDurably(input), 'admit_prepared');
    assert.equal(admitted.admission_result.outcome, 'ADMITTED');
    assert.equal(admitted.admission_result.final_state, 'ADMITTED');
    assert.equal(admitted.admission_result.final_revision, 2);
    assert.equal(admitted.admission_result.transition_applied, true);
    assert.equal(admitted.admission_result.attempt_admitted, true);
    assert.equal(admitted.admission_result.execution_authorized, false);
    assert.equal(admitted.admission_result.claim_issued, false);
    assert.equal(admitted.admission_result.lease_granted, false);
    assert.equal(admitted.admission_result.fencing_token_issued, false);

    const row = await bounded(pool.query(`
      SELECT state, revision, attempt_durable_record_id, durable_record_fingerprint,
             durable_record_digest, tenant_id, organization_id, project_id,
             session_reference_id, agent_id, actor_id, durable_record->>'attempt_admitted' AS artifact_admitted
      FROM ${TEST_TABLE} WHERE attempt_durable_record_id = $1
    `, [input.p7_durable_record.runtime_execution_attempt_durable_record_id]), 'read_admitted');
    assert.equal(row.rows.length, 1);
    assert.deepEqual({ state: row.rows[0].state, revision: Number(row.rows[0].revision) }, { state: 'ADMITTED', revision: 2 });
    assert.equal(row.rows[0].durable_record_fingerprint, input.p7_durable_record.runtime_execution_attempt_durable_record_fingerprint);
    assert.equal(row.rows[0].durable_record_digest, input.p7_durable_record.runtime_execution_attempt_durable_record_digest);
    for (const field of ['tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id']) {
      assert.equal(row.rows[0][field], input.p7_durable_record.identity_scope[field], field);
    }
    assert.equal(row.rows[0].artifact_admitted, 'false');

    const replay = await bounded(adapter.admitDurably(input), 'admit_identical_replay');
    assert.equal(replay.admission_result.outcome, 'ALREADY_ADMITTED');
    assert.equal(replay.admission_result.final_revision, 2);
    assert.equal(replay.admission_result.transition_applied, false);

    const divergent = mutable(input);
    divergent.p8_admission_decision.attempt_ordinal = 2;
    const divergentResult = await bounded(adapter.admitDurably(divergent), 'reject_divergent_replay');
    assert.equal(divergentResult.admission_result.outcome, 'INVALID');
    const unchanged = await bounded(pool.query(`SELECT state, revision FROM ${TEST_TABLE} WHERE attempt_durable_record_id = $1`, [input.p7_durable_record.runtime_execution_attempt_durable_record_id]), 'read_after_divergent');
    assert.equal(unchanged.rows[0].state, 'ADMITTED');
    assert.equal(Number(unchanged.rows[0].revision), 2);

    const wrongScope = mutable(input);
    wrongScope.p8_admission_decision.identity_scope.tenant_id = 'wrong-tenant';
    assert.equal((await adapter.admitDurably(wrongScope)).admission_result.outcome, 'INVALID');

    const missing = buildAdmissionInput(99);
    const missingResult = await bounded(adapter.admitDurably(missing), 'missing_attempt');
    assert.equal(missingResult.admission_result.outcome, 'NOT_FOUND');
    const missingCount = await bounded(pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE} WHERE attempt_ordinal = 99`), 'missing_attempt_count');
    assert.equal(missingCount.rows[0].count, 0);

    const concurrentInput = buildAdmissionInput(2);
    assert.equal((await p7.persistDurably(concurrentInput.p7_durable_record)).persistence_result.outcome, 'CREATED');
    const concurrentResults = await Promise.all([
      createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_TABLE }).admitDurably(concurrentInput),
      createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_TABLE }).admitDurably(concurrentInput)
    ]);
    assert.equal(concurrentResults.filter((result) => result.admission_result.outcome === 'ADMITTED').length, 1);
    assert.equal(concurrentResults.filter((result) => result.admission_result.outcome === 'ALREADY_ADMITTED').length, 1);
    const revisionCount = await bounded(pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE} WHERE state = 'ADMITTED' AND revision = 2`), 'admitted_count');
    assert.equal(revisionCount.rows[0].count, 2);

    const rollbackInput = buildAdmissionInput(3);
    assert.equal((await p7.persistDurably(rollbackInput.p7_durable_record)).persistence_result.outcome, 'CREATED');
    const faultyPool = {
      query: (...args) => pool.query(...args),
      async connect() {
        const client = await pool.connect();
        return {
          query(sql, values) {
            if (typeof sql === 'string' && sql.trimStart().startsWith('UPDATE ')) return Promise.reject(new Error('forced_admission_failure'));
            return values === undefined ? client.query(sql) : client.query(sql, values);
          },
          release: () => client.release()
        };
      }
    };
    await assert.rejects(
      () => bounded(createRuntimeExecutionAttemptAdmissionPostgres({ pool: faultyPool, tableName: TEST_TABLE }).admitDurably(rollbackInput), 'rollback_admission'),
      /forced_admission_failure/
    );
    const rolledBack = await bounded(pool.query(`SELECT state, revision FROM ${TEST_TABLE} WHERE attempt_ordinal = 3`), 'read_rollback');
    assert.equal(rolledBack.rows[0].state, 'PREPARED');
    assert.equal(Number(rolledBack.rows[0].revision), 1);
  } finally {
    try { await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'cleanup_p9_schema'); }
    finally { await bounded(pool.end(), 'cleanup_p9_pool'); }
  }
});

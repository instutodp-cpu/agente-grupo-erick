'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createPublicWebCanaryThirdAtomicResourceCommitPostgres
} = require('../src/adapters/postgres/public-web-canary-third-atomic-resource-commit-postgres');

const DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const ENABLED = typeof DATABASE_URL === 'string' && /(?:127\.0\.0\.1|localhost)/.test(DATABASE_URL);
const SCHEMA = 'hermes_public_web_canary_atomic_commit_test';
const RESOURCES = `${SCHEMA}.public_web_canary_single_use_resources`;
const COMMITS = `${SCHEMA}.public_web_canary_atomic_commits`;

function plan(trial = 'trial-3') {
  return {
    ok: true,
    status: 'THIRD_CANARY_ATOMIC_RESOURCE_TRANSACTION_RESERVATION_PLAN_READY_NOT_COMMITTED_NOT_EXECUTED',
    transaction_plan_ready: true,
    transaction_started: false,
    state_written: false,
    resources_consumed: false,
    execution_reserved: false,
    execution_started: false,
    external_network_called: false,
    production_allowed: false,
    atomic_resource_transaction_plan: {
      trial_id: trial,
      official_authorization_id: 'official-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3'
    }
  };
}

test('adapter validates pool and table identifiers', () => {
  assert.throws(() => createPublicWebCanaryThirdAtomicResourceCommitPostgres(), /pool_invalid/);
  const pool = { connect() {} };
  assert.throws(() => createPublicWebCanaryThirdAtomicResourceCommitPostgres({ pool, resourceTableName: 'hermes.x;drop' }), /table_name_invalid/);
});

test('real PostgreSQL atomically consumes single-use resources, reserves execution and blocks replay', { skip: !ENABLED }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 6, connectionTimeoutMillis: 5000 });
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/017_create_public_web_canary_single_use_resources.sql'), 'utf8')
    .replaceAll('hermes.public_web_canary_single_use_resources', RESOURCES)
    .replaceAll('hermes.public_web_canary_atomic_commits', COMMITS)
    .replaceAll('hermes;', `${SCHEMA};`);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(migration);
    await pool.query(`
      INSERT INTO ${RESOURCES} (resource_type, resource_id, trial_id, state, expires_at) VALUES
      ('OFFICIAL_AUTHORIZATION','official-3','trial-3','AVAILABLE',CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
      ('GRANT','grant-3','trial-3','AVAILABLE',CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
      ('RESERVATION','reservation-3','trial-3','AVAILABLE',NULL)
    `);
    const adapter = createPublicWebCanaryThirdAtomicResourceCommitPostgres({ pool, resourceTableName: RESOURCES, commitTableName: COMMITS });
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => adapter.commitAtomicResources({
      transaction_plan_result: plan(),
      production_allowed: false
    })));
    assert.equal(concurrent.filter((r) => r.ok).length, 1);
    assert.equal(concurrent.filter((r) => !r.ok).length, 5);
    const states = await pool.query(`SELECT resource_type, state FROM ${RESOURCES} ORDER BY resource_type`);
    assert.deepEqual(states.rows, [
      { resource_type: 'GRANT', state: 'CONSUMED' },
      { resource_type: 'OFFICIAL_AUTHORIZATION', state: 'CONSUMED' },
      { resource_type: 'RESERVATION', state: 'EXECUTION_RESERVED' }
    ]);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${COMMITS}`)).rows[0].count, 1);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  }
});

test('real PostgreSQL rolls back every mutation when the durable commit cannot be written', { skip: !ENABLED }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/017_create_public_web_canary_single_use_resources.sql'), 'utf8')
    .replaceAll('hermes.public_web_canary_single_use_resources', RESOURCES)
    .replaceAll('hermes.public_web_canary_atomic_commits', COMMITS)
    .replaceAll('hermes;', `${SCHEMA};`);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(migration);
    await pool.query(`
      INSERT INTO ${RESOURCES} (resource_type, resource_id, trial_id, state, expires_at) VALUES
      ('OFFICIAL_AUTHORIZATION','official-3','trial-3','AVAILABLE',CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
      ('GRANT','grant-3','trial-3','AVAILABLE',CURRENT_TIMESTAMP + INTERVAL '2 minutes'),
      ('RESERVATION','reservation-3','trial-3','AVAILABLE',NULL)
    `);
    await pool.query(`DROP TABLE ${COMMITS}`);
    const adapter = createPublicWebCanaryThirdAtomicResourceCommitPostgres({ pool, resourceTableName: RESOURCES, commitTableName: COMMITS });
    const result = await adapter.commitAtomicResources({ transaction_plan_result: plan(), production_allowed: false });
    assert.equal(result.ok, false);
    const states = await pool.query(`SELECT state FROM ${RESOURCES} ORDER BY resource_type`);
    assert.deepEqual(states.rows.map((r) => r.state), ['AVAILABLE', 'AVAILABLE', 'AVAILABLE']);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  }
});

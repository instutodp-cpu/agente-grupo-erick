'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  createPublicWebCanaryThirdDurableResourceMaterializationPostgres
} = require('../src/adapters/postgres/public-web-canary-third-durable-resource-materialization-postgres');

const DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const ENABLED = typeof DATABASE_URL === 'string' && /(?:127\.0\.0\.1|localhost)/.test(DATABASE_URL);
const SCHEMA = 'hermes_public_web_canary_materialization_test';
const RESOURCES = `${SCHEMA}.public_web_canary_single_use_resources`;

function fixture() {
  return {
    trial_id: 'trial-3',
    official_authorization_issuance: {
      ok: true,
      status: 'THIRD_CANARY_OFFICIAL_EXECUTION_AUTHORIZATION_ISSUED_NOT_CONSUMED_NOT_EXECUTED',
      trial_id: 'trial-3',
      grant_id: 'grant-3',
      reservation_id: 'reservation-3',
      official_execution_authorization_issued: true,
      execution_started: false,
      external_network_called: false,
      official_execution_authorization: {
        authorization_id: 'official-3',
        trial_id: 'trial-3',
        expires_at: new Date(Date.now() + 120000).toISOString()
      }
    },
    grant_materialization: {
      ok: true,
      status: 'THIRD_CANARY_GRANT_MATERIALIZED_NOT_AUTHORIZED_FOR_EXECUTION',
      trial_id: 'trial-3',
      grant_materialized: true,
      execution_started: false,
      external_network_called: false,
      grant: {
        grant_id: 'grant-3', trial_id: 'trial-3', environment: 'staging',
        target_origin: 'https://example.com', target_path: '/', method: 'GET', port: 443,
        maximum_requests: 1, rollout_percentage: 1, single_use: true, used: false, revoked: false,
        expires_at: new Date(Date.now() + 120000).toISOString()
      }
    },
    reservation_materialization: {
      ok: true,
      status: 'THIRD_CANARY_RESERVATION_MATERIALIZED_NOT_RESERVED_FOR_EXECUTION',
      trial_id: 'trial-3',
      reservation_materialized: true,
      execution_reserved: false,
      execution_started: false,
      external_network_called: false,
      reservation: {
        reservation_id: 'reservation-3', trial_id: 'trial-3', grant_id: 'grant-3',
        environment: 'staging', target_origin: 'https://example.com', target_path: '/', method: 'GET', port: 443,
        maximum_requests: 1, rollout_percentage: 1, single_use: true, used: false, execution_reserved: false
      }
    },
    production_allowed: false
  };
}

test('adapter validates pool and table identifiers', () => {
  assert.throws(() => createPublicWebCanaryThirdDurableResourceMaterializationPostgres(), /pool_invalid/);
  assert.throws(() => createPublicWebCanaryThirdDurableResourceMaterializationPostgres({
    pool: { connect() {} }, resourceTableName: 'hermes.x;drop'
  }), /table_name_invalid/);
});

test('real PostgreSQL materializes exactly three AVAILABLE resources and blocks replay', { skip: !ENABLED }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/017_create_public_web_canary_single_use_resources.sql'), 'utf8')
    .replaceAll('hermes.public_web_canary_single_use_resources', RESOURCES)
    .replaceAll('hermes.public_web_canary_atomic_commits', `${SCHEMA}.public_web_canary_atomic_commits`)
    .replaceAll('hermes;', `${SCHEMA};`);
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.query(migration);
    const adapter = createPublicWebCanaryThirdDurableResourceMaterializationPostgres({ pool, resourceTableName: RESOURCES });
    const first = await adapter.materializeDurableResources(fixture());
    assert.equal(first.ok, true);
    assert.equal(first.durable_resources_materialized, true);
    assert.equal(first.execution_started, false);
    assert.equal(first.external_network_called, false);
    const rows = await pool.query(`SELECT resource_type, state FROM ${RESOURCES} ORDER BY resource_type`);
    assert.deepEqual(rows.rows, [
      { resource_type: 'GRANT', state: 'AVAILABLE' },
      { resource_type: 'OFFICIAL_AUTHORIZATION', state: 'AVAILABLE' },
      { resource_type: 'RESERVATION', state: 'AVAILABLE' }
    ]);
    const replay = await adapter.materializeDurableResources(fixture());
    assert.equal(replay.ok, false);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM ${RESOURCES}`)).rows[0].count, 3);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
    await pool.end();
  }
});

test('materialization fails closed on binding, scope and runtime-action drift', async () => {
  const pool = { connect() { throw new Error('database_must_not_be_reached'); } };
  const adapter = createPublicWebCanaryThirdDurableResourceMaterializationPostgres({ pool });
  const mismatch = fixture();
  mismatch.reservation_materialization.reservation.grant_id = 'other';
  assert.equal((await adapter.materializeDurableResources(mismatch)).ok, false);
  const production = fixture();
  production.production_allowed = true;
  assert.equal((await adapter.materializeDurableResources(production)).ok, false);
  const execute = fixture();
  execute.execute = true;
  assert.equal((await adapter.materializeDurableResources(execute)).ok, false);
});

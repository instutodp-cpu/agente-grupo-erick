'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createMemoryConfirmationPersistence } = require('../src/core/memory-confirmation-persistence');
const {
  CONFIRMATION_TABLE,
  DELETE_SQL,
  INSERT_SQL,
  LIST_SQL,
  SELECT_SQL,
  TRANSITION_SQL,
  createPostgresConfirmationPersistence,
  validateTableName
} = require('../src/core/postgres-confirmation-persistence');

function record(overrides = {}) {
  return {
    confirmation_id: overrides.confirmation_id || 'confirmation-postgres',
    trace_id: overrides.trace_id || 'trace-postgres',
    domain: overrides.domain || 'financeiro',
    intent: overrides.intent || 'consultar_financeiro',
    status: overrides.status || 'pending',
    expires_at: overrides.expires_at || '2026-01-01T00:15:00.000Z'
  };
}

function row(value) {
  return { ...value, expires_at: new Date(value.expires_at) };
}

class ScriptedPool {
  constructor(handler) {
    this.handler = handler;
    this.queries = [];
  }

  async query(sql, params) {
    this.queries.push({ sql, params });
    return this.handler(sql, params);
  }
}

function scriptedAdapter() {
  const stored = new Map();
  const pool = new ScriptedPool((sql, params) => {
    if (sql === INSERT_SQL) {
      const value = {
        confirmation_id: params[0], trace_id: params[1], domain: params[2],
        intent: params[3], status: params[4], expires_at: params[5]
      };
      if (stored.has(value.confirmation_id)) {
        const error = new Error('duplicate key');
        error.code = '23505';
        throw error;
      }
      stored.set(value.confirmation_id, value);
      return { rows: [row(value)] };
    }
    if (sql === SELECT_SQL) {
      const value = stored.get(params[0]);
      return { rows: value ? [row(value)] : [] };
    }
    if (sql === TRANSITION_SQL) {
      const value = stored.get(params[0]);
      if (!value || value.status !== params[2]) return { rows: [] };
      value.status = params[1];
      return { rows: [row(value)] };
    }
    if (sql === LIST_SQL) return { rows: [...stored.values()].map(row) };
    if (sql === DELETE_SQL) {
      stored.clear();
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`unexpected_sql:${sql}`);
  });
  return { adapter: createPostgresConfirmationPersistence({ pool }), pool };
}

test('PostgreSQL adapter implements the v2 contract without owning the pool', async () => {
  const { adapter, pool } = scriptedAdapter();
  const initial = record();
  assert.deepEqual(await adapter.create(initial), initial);
  assert.deepEqual(await adapter.get(initial.confirmation_id), initial);
  assert.deepEqual(await adapter.compareAndTransition({
    confirmation_id: initial.confirmation_id, expected_status: 'pending', next_status: 'approved'
  }), { outcome: 'transitioned', record: { ...initial, status: 'approved' } });
  assert.deepEqual(await adapter.compareAndTransition({
    confirmation_id: initial.confirmation_id, expected_status: 'approved', next_status: 'approved'
  }), { outcome: 'unchanged', record: { ...initial, status: 'approved' } });
  assert.deepEqual(await adapter.compareAndTransition({
    confirmation_id: initial.confirmation_id, expected_status: 'pending', next_status: 'rejected'
  }), { outcome: 'state_mismatch', record: { ...initial, status: 'approved' } });
  assert.deepEqual(await adapter.compareAndTransition({
    confirmation_id: 'missing', expected_status: 'pending', next_status: 'approved'
  }), { outcome: 'not_found', record: null });
  assert.deepEqual(await adapter.list(), [{ ...initial, status: 'approved' }]);
  await adapter.reset();
  assert.equal(await adapter.get(initial.confirmation_id), null);
  assert.equal(typeof adapter.close, 'undefined');
  assert.equal(pool.queries.some(({ sql }) => sql.includes('SELECT') && sql.includes('$1')), true);
});

test('PostgreSQL adapter maps dates, clones rows, and propagates duplicate errors', async () => {
  const { adapter } = scriptedAdapter();
  const initial = record();
  const created = await adapter.create(initial);
  created.status = 'rejected';
  assert.equal((await adapter.get(initial.confirmation_id)).status, 'pending');
  await assert.rejects(() => adapter.create(initial), { code: '23505' });
});

test('malformed rows and database failures fail closed', async () => {
  const malformed = new ScriptedPool((sql) => {
    if (sql === SELECT_SQL) return { rows: [row({ ...record(), status: 'corrupted' })] };
    throw new Error('unexpected_sql');
  });
  const malformedAdapter = createPostgresConfirmationPersistence({ pool: malformed });
  await assert.rejects(() => malformedAdapter.get('confirmation-postgres'), /malformed_status/);

  const unavailable = new ScriptedPool(() => {
    throw new Error('database unavailable');
  });
  const unavailableAdapter = createPostgresConfirmationPersistence({ pool: unavailable });
  await assert.rejects(() => unavailableAdapter.get('confirmation-postgres'), /database unavailable/);
});

test('PostgreSQL adapter binds values and uses one conditional CAS statement', async () => {
  const { adapter, pool } = scriptedAdapter();
  const initial = record({ confirmation_id: "id' OR '1'='1" });
  await adapter.create(initial);
  await adapter.compareAndTransition({
    confirmation_id: initial.confirmation_id,
    expected_status: "pending' OR '1'='1",
    next_status: 'approved'
  }).catch(() => {});
  const transition = pool.queries.find(({ sql }) => sql === TRANSITION_SQL);
  assert.ok(transition);
  assert.equal(transition.sql.includes(initial.confirmation_id), false);
  assert.deepEqual(transition.params.slice(0, 3), [initial.confirmation_id, 'approved', "pending' OR '1'='1"]);
  assert.equal(CONFIRMATION_TABLE, 'hermes.confirmations');
});

test('configurable test table names are strict identifiers', () => {
  assert.equal(validateTableName('hermes.confirmations'), 'hermes.confirmations');
  assert.equal(validateTableName('hermes_confirmation_test.confirmations'), 'hermes_confirmation_test.confirmations');
  assert.throws(() => validateTableName('hermes.confirmations; DROP SCHEMA hermes CASCADE'), /table_name_invalid/);
  assert.throws(() => validateTableName('hermes.confirmations--'), /table_name_invalid/);
});

test('confirmation migration contains only the contractual durable fields', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/002_create_confirmations.sql'), 'utf8');
  for (const field of ['confirmation_id', 'trace_id', 'domain', 'intent', 'status', 'expires_at']) {
    assert.match(migration, new RegExp(`\\b${field}\\b`));
  }
  assert.doesNotMatch(migration, /tenant_id|workspace_id|company_id|database_url|password|secret/i);
});

test('memory and PostgreSQL adapters expose equivalent transition outcomes', async () => {
  const memory = createMemoryConfirmationPersistence();
  const { adapter: postgres } = scriptedAdapter();
  const initial = record({ confirmation_id: 'equivalence' });
  memory.create(initial);
  await postgres.create(initial);
  const operations = [
    { expected_status: 'pending', next_status: 'approved' },
    { expected_status: 'pending', next_status: 'rejected' },
    { expected_status: 'approved', next_status: 'approved' }
  ];
  for (const operation of operations) {
    assert.deepEqual(
      await postgres.compareAndTransition({ confirmation_id: initial.confirmation_id, ...operation }),
      memory.compareAndTransition({ confirmation_id: initial.confirmation_id, ...operation })
    );
  }
});

test('real PostgreSQL integration proves persistence and atomic CAS', { skip: !process.env.HERMES_POSTGRES_TEST_DATABASE_URL }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.HERMES_POSTGRES_TEST_DATABASE_URL,
    ssl: process.env.HERMES_POSTGRES_TEST_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 4
  });
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/002_create_confirmations.sql'), 'utf8');
  const testSchema = 'hermes_confirmation_test';
  const testTable = `${testSchema}.confirmations`;
  const isolatedMigration = migration.replaceAll('hermes.confirmations', `${testSchema}.confirmations`).replaceAll('hermes;', `${testSchema};`);
  const adapter = createPostgresConfirmationPersistence({ pool, table_name: testTable });
  try {
    await pool.query(isolatedMigration);
    await adapter.reset();
    const initial = record({ confirmation_id: 'real-confirmation' });
    assert.deepEqual(await adapter.create(initial), initial);
    assert.deepEqual(await adapter.get(initial.confirmation_id), initial);
    assert.deepEqual(await adapter.list(), [initial]);
    await assert.rejects(() => adapter.create(initial), { code: '23505' });

    const results = await Promise.all([
      adapter.compareAndTransition({ confirmation_id: initial.confirmation_id, expected_status: 'pending', next_status: 'approved' }),
      adapter.compareAndTransition({ confirmation_id: initial.confirmation_id, expected_status: 'pending', next_status: 'rejected' })
    ]);
    assert.equal(results.filter((value) => value.outcome === 'transitioned').length, 1);
    assert.equal(results.filter((value) => value.outcome === 'state_mismatch').length, 1);
    const winner = await adapter.get(initial.confirmation_id);
    assert.ok(['approved', 'rejected'].includes(winner.status));

    await adapter.reset();
    const expiration = record({ confirmation_id: 'real-expiration' });
    await adapter.create(expiration);
    const expirationResults = await Promise.all([
      adapter.compareAndTransition({ confirmation_id: expiration.confirmation_id, expected_status: 'pending', next_status: 'expired' }),
      adapter.compareAndTransition({ confirmation_id: expiration.confirmation_id, expected_status: 'pending', next_status: 'approved' })
    ]);
    assert.equal(expirationResults.filter((value) => value.outcome === 'transitioned').length, 1);
    assert.equal(expirationResults.filter((value) => value.outcome === 'state_mismatch').length, 1);
    assert.equal((await adapter.get(expiration.confirmation_id)).status === 'expired' || (await adapter.get(expiration.confirmation_id)).status === 'approved', true);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${testSchema} CASCADE`);
    await pool.end();
  }
});

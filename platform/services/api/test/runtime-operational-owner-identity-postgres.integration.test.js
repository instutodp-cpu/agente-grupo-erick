'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildOperationalOwnerIdentity } = require('../src/core/runtime-operational-owner-identity');
const { createRuntimeOperationalOwnerIdentityPostgres } = require('../src/adapters/postgres/runtime-operational-owner-identity-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/012_create_runtime_operational_owners.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_operational_owner_p14pre_test';
const TABLE = `${TEST_SCHEMA}.runtime_operational_owners`;

function safeDatabaseUrl(value) {
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

function isolatedMigration(sql) {
  return sql.replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll('hermes.runtime_operational_owners', TABLE);
}

function input(overrides = {}) {
  return {
    operational_owner_type: 'operational_owner',
    owner_reference_id: 'machine-principal-1',
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1',
    ...overrides
  };
}

test('real PostgreSQL P14-PRE registers, replays, conflicts and arbitrates concurrent identities', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(isolatedMigration(migration));
    await pool.query(isolatedMigration(migration));

    const authority = createRuntimeOperationalOwnerIdentityPostgres({ pool, tableName: TABLE });
    const created = await authority.registerOperationalOwner(input());
    assert.equal(created.operational_owner_result.outcome, 'CREATED');
    assert.equal(created.operational_owner_result.operational_owner_identity_registered, true);

    const persisted = await pool.query(`SELECT * FROM ${TABLE} WHERE owner_reference_id = $1`, ['machine-principal-1']);
    assert.equal(persisted.rowCount, 1);
    assert.equal(persisted.rows[0].owner_identity_artifact.identity_establishes_ownership, false);

    const replay = await authority.registerOperationalOwner(input());
    assert.equal(replay.operational_owner_result.outcome, 'EXISTING_IDENTICAL');

    const conflict = await authority.registerOperationalOwner(input({ project_id: 'project-2' }));
    assert.equal(conflict.operational_owner_result.outcome, 'CONFLICT');

    const identical = await Promise.all(Array.from({ length: 8 }, () => authority.registerOperationalOwner(input({ owner_reference_id: 'machine-concurrent-identical' }))));
    assert.equal(identical.filter((entry) => entry.operational_owner_result.outcome === 'CREATED').length, 1);
    assert.equal(identical.filter((entry) => entry.operational_owner_result.outcome === 'EXISTING_IDENTICAL').length, 7);

    const divergent = await Promise.all([
      authority.registerOperationalOwner(input({ owner_reference_id: 'machine-concurrent-divergent', organization_id: 'organization-1' })),
      authority.registerOperationalOwner(input({ owner_reference_id: 'machine-concurrent-divergent', organization_id: 'organization-2' }))
    ]);
    assert.equal(divergent.filter((entry) => entry.operational_owner_result.outcome === 'CREATED').length, 1);
    assert.equal(divergent.filter((entry) => entry.operational_owner_result.outcome === 'CONFLICT').length, 1);

    const brokenAuthority = createRuntimeOperationalOwnerIdentityPostgres({ pool, tableName: `${TEST_SCHEMA}.missing_table` });
    const rollback = await brokenAuthority.registerOperationalOwner(input({ owner_reference_id: 'machine-rollback' }));
    assert.equal(rollback.operational_owner_result.outcome, 'TECHNICAL_FAILURE');
    const rollbackRows = await pool.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE owner_reference_id = $1`, ['machine-rollback']);
    assert.equal(rollbackRows.rows[0].count, 0);

    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'runtime_operational_owners'
      ORDER BY ordinal_position
    `, [TEST_SCHEMA]);
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.includes('owner_identity_digest'), true);
    assert.equal(names.some((name) => /binding|lease|fenc|capacity|execution|ownership/i.test(name)), false);
  } finally {
    try {
      await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

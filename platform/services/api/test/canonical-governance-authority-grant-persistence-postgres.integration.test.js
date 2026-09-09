'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-contract');
const {
  createCanonicalGovernanceAuthorityGrantPersistencePostgres,
  AuthorityGrantPostgresPersistenceError
} = require('../src/adapters/postgres/canonical-governance-authority-grant-persistence-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/017_create_canonical_governance_authority_grants.sql');
const MIGRATION = fs.readFileSync(MIGRATION_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_governance_authority_grant_persistence_test';
const TEST_TABLE = `${TEST_SCHEMA}.governance_authority_grants`;
const INSTALLATION_ID = 'installation-grant-persistence-integration';

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

function isolatedMigration(sql) {
  return sql
    .replace('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll('hermes.', `${TEST_SCHEMA}.`);
}

function grant(overrides = {}) {
  return buildAuthorityGrant({
    authority_grant_id: 'authority-grant-integration-1',
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: `governance-root::${INSTALLATION_ID}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'1'.repeat(64)}`,
    issuer_root_key_id: 'root-key-integration-0',
    issuer_root_key_fingerprint: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'3'.repeat(64)}`,
    subject_type: 'AGENT',
    subject_id: 'agent-delegate-integration-1',
    authority_scope: {
      scope_type: 'installation',
      installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-integration-1'],
      organization_ids: [],
      project_ids: [],
      cross_tenant: false,
      cross_organization: false,
      cross_project: false
    },
    capabilities: ['GOVERNANCE_AUDIT_READ', 'GOVERNANCE_REVOKE_AUTHORITY'],
    restrictions: {
      allow_further_delegation: false,
      allow_cross_tenant: false,
      allow_cross_organization: false,
      allow_cross_project: false
    },
    issued_at: '2026-09-09T12:00:00.000Z',
    not_before: '2026-09-09T12:00:00.000Z',
    expires_at: '2026-09-10T12:00:00.000Z',
    ...overrides
  });
}

async function countRows(pool) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE}`);
  return result.rows[0].count;
}

async function createPool() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await pool.query(isolatedMigration(MIGRATION));
  await pool.query(isolatedMigration(MIGRATION));
  return pool;
}

async function adapterFor(pool) {
  return createCanonicalGovernanceAuthorityGrantPersistencePostgres({ pool, tableName: TEST_TABLE });
}

test('migration installs cleanly twice with canonical constraints, indexes and mutation trigger', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'governance_authority_grants'
      ORDER BY ordinal_position
    `, [TEST_SCHEMA]);
    assert.equal(columns.rows.length, 20);
    const constraints = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = $1 AND table_name = 'governance_authority_grants'
      ORDER BY constraint_name
    `, [TEST_SCHEMA]);
    assert.deepEqual(constraints.rows.map((row) => row.constraint_name), [
      'governance_authority_grants_capabilities_check',
      'governance_authority_grants_contract_version_check',
      'governance_authority_grants_digest_check',
      'governance_authority_grants_domain_check',
      'governance_authority_grants_generation_check',
      'governance_authority_grants_identifier_check',
      'governance_authority_grants_pkey',
      'governance_authority_grants_restrictions_check',
      'governance_authority_grants_scope_object_check',
      'governance_authority_grants_subject_type_check',
      'governance_authority_grants_validity_window_check',
      'governance_authority_grants_grant_digest_key'
    ].sort());
    const triggers = await pool.query(`
      SELECT tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = 'governance_authority_grants' AND NOT t.tgisinternal
    `, [TEST_SCHEMA]);
    assert.deepEqual(triggers.rows.map((row) => row.tgname), ['governance_authority_grants_mutation_trigger']);
  } finally {
    await pool.end();
  }
});

test('real PostgreSQL persistence is durable, reconstructs the contract, and is idempotent', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const candidate = grant();
    const first = await adapter.persistAuthorityGrant(candidate);
    assert.equal(first.persistence_result.outcome, 'PERSISTED');
    assert.equal(first.persistence_result.write_performed, true);
    assert.deepEqual(first.persistence_result.persisted_grant, candidate);

    const replay = await adapter.persistAuthorityGrant(candidate);
    assert.equal(replay.persistence_result.outcome, 'ALREADY_PERSISTED_IDENTICAL');
    assert.equal(replay.persistence_result.write_performed, false);
    assert.deepEqual(replay.persistence_result.persisted_grant, candidate);
    assert.equal(await countRows(pool), 1);

    const reopened = await createPoolConnectionOnly();
    try {
      const readBack = await reopened.query(`SELECT authority_grant_id, grant_digest FROM ${TEST_TABLE}`);
      assert.deepEqual(readBack.rows, [{ authority_grant_id: candidate.authority_grant_id, grant_digest: candidate.grant_digest }]);
    } finally {
      await reopened.end();
    }
  } finally {
    await pool.end();
  }
});

async function createPoolConnectionOnly() {
  const { Pool } = require('pg');
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
}

test('same ID with conflicting canonical content is rejected without overwrite', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const first = grant();
    await adapter.persistAuthorityGrant(first);
    const conflicting = grant({ subject_id: 'agent-delegate-integration-conflict' });
    const result = await adapter.persistAuthorityGrant(conflicting);
    assert.equal(result.persistence_result.outcome, 'REJECTED');
    assert.equal(result.persistence_result.write_performed, false);
    assert.equal(result.persistence_result.reason_code, 'authority_grant_id_conflict');
    assert.equal(await countRows(pool), 1);
    const stored = await pool.query(`SELECT subject_id, grant_digest FROM ${TEST_TABLE}`);
    assert.deepEqual(stored.rows, [{ subject_id: first.subject_id, grant_digest: first.grant_digest }]);
  } finally {
    await pool.end();
  }
});

test('tampered or invalid contracts are rejected before any write', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const tampered = { ...grant(), grant_digest: `sha256:${'f'.repeat(64)}` };
    const invalid = { ...grant(), authority_grant_id: '' };
    assert.equal((await adapter.persistAuthorityGrant(tampered)).persistence_result.outcome, 'REJECTED');
    assert.equal((await adapter.persistAuthorityGrant(invalid)).persistence_result.outcome, 'REJECTED');
    assert.equal(await countRows(pool), 0);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL blocks semantic UPDATE and DELETE', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const candidate = grant();
    await adapter.persistAuthorityGrant(candidate);
    await assert.rejects(
      pool.query(`UPDATE ${TEST_TABLE} SET subject_id = 'tampered' WHERE authority_grant_id = $1`, [candidate.authority_grant_id]),
      /governance_authority_grant_update_forbidden/
    );
    await assert.rejects(
      pool.query(`DELETE FROM ${TEST_TABLE} WHERE authority_grant_id = $1`, [candidate.authority_grant_id]),
      /governance_authority_grant_delete_forbidden/
    );
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('concurrent identical inserts converge to one persisted row and one identical replay', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = grant({ authority_grant_id: 'authority-grant-concurrent-identical' });
    const adapterA = await adapterFor(pool);
    const adapterB = await adapterFor(pool);
    const results = await Promise.all([
      adapterA.persistAuthorityGrant(candidate),
      adapterB.persistAuthorityGrant(candidate)
    ]);
    assert.deepEqual(results.map((result) => result.persistence_result.outcome).sort(), ['ALREADY_PERSISTED_IDENTICAL', 'PERSISTED']);
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('concurrent conflicting inserts converge to one canonical row and one rejection', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidateA = grant({ authority_grant_id: 'authority-grant-concurrent-conflict', subject_id: 'agent-concurrent-a' });
    const candidateB = grant({ authority_grant_id: 'authority-grant-concurrent-conflict', subject_id: 'agent-concurrent-b' });
    const [resultA, resultB] = await Promise.all([
      (await adapterFor(pool)).persistAuthorityGrant(candidateA),
      (await adapterFor(pool)).persistAuthorityGrant(candidateB)
    ]);
    assert.deepEqual([resultA.persistence_result.outcome, resultB.persistence_result.outcome].sort(), ['PERSISTED', 'REJECTED']);
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('database failure rolls back the insert and never becomes persistence success', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${TEST_SCHEMA}.reject_authority_grant_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'authority_grant_test_insert_failure'; END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER authority_grant_test_insert_failure_trigger
      BEFORE INSERT ON ${TEST_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${TEST_SCHEMA}.reject_authority_grant_insert()
    `);
    const adapter = await adapterFor(pool);
    await assert.rejects(adapter.persistAuthorityGrant(grant()), (error) => {
      assert.ok(error instanceof AuthorityGrantPostgresPersistenceError);
      assert.equal(error.code, 'POSTGRES_PERSISTENCE_FAILED');
      return true;
    });
    assert.equal(await countRows(pool), 0);
  } finally {
    await pool.end();
  }
});

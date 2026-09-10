'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAuthorityGrantRevocation } = require('../src/core/canonical-governance-authority-grant-revocation-contract');
const {
  AuthorityGrantRevocationPostgresPersistenceError,
  createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres,
  rowValues
} = require('../src/adapters/postgres/canonical-governance-authority-grant-revocation-persistence-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/018_create_canonical_governance_authority_grant_revocations.sql');
const MIGRATION = fs.readFileSync(MIGRATION_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_governance_authority_grant_revocation_persistence_test';
const TEST_TABLE = `${TEST_SCHEMA}.governance_authority_grant_revocations`;
const INSTALLATION_ID = 'installation-revocation-persistence-integration';

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

function revocation(overrides = {}) {
  return buildAuthorityGrantRevocation({
    authority_grant_revocation_id: 'authority-grant-revocation-integration-1',
    installation_id: INSTALLATION_ID,
    target_authority_grant_id: 'authority-grant-integration-1',
    target_grant_digest: `sha256:${'1'.repeat(64)}`,
    issuer_root_subject_id: `governance-root::${INSTALLATION_ID}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_id: 'root-key-integration-0',
    issuer_root_key_fingerprint: `sha256:${'3'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'4'.repeat(64)}`,
    reason_code: 'SECURITY',
    issued_at: '2026-09-09T12:00:00.000Z',
    effective_at: '2026-09-09T12:00:00.000Z',
    ...overrides
  });
}

async function createPool() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await pool.query(isolatedMigration(MIGRATION));
  await pool.query(isolatedMigration(MIGRATION));
  return pool;
}

async function createPoolConnectionOnly() {
  const { Pool } = require('pg');
  return new Pool({ connectionString: TEST_DATABASE_URL, max: 2, connectionTimeoutMillis: 5000 });
}

async function adapterFor(pool) {
  return createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool, tableName: TEST_TABLE });
}

async function countRows(pool) {
  const result = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_TABLE}`);
  return result.rows[0].count;
}

test('migration installs cleanly twice with canonical constraints and mutation trigger', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'governance_authority_grant_revocations'
      ORDER BY ordinal_position
    `, [TEST_SCHEMA]);
    assert.equal(columns.rows.length, 17);
    const constraints = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = $1 AND table_name = 'governance_authority_grant_revocations'
        AND constraint_name LIKE 'governance_authority_grant_revocations_%'
      ORDER BY constraint_name
    `, [TEST_SCHEMA]);
    assert.deepEqual(constraints.rows.map((row) => row.constraint_name), [
      'governance_authority_grant_revocations_contract_version_check',
      'governance_authority_grant_revocations_digest_check',
      'governance_authority_grant_revocations_domain_check',
      'governance_authority_grant_revocations_generation_check',
      'governance_authority_grant_revocations_identifier_check',
      'governance_authority_grant_revocations_pkey',
      'governance_authority_grant_revocations_reason_code_check',
      'governance_authority_grant_revocations_revocation_digest_key',
      'governance_authority_grant_revocations_validity_window_check'
    ].sort());
    const foreignKeys = await pool.query(`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = $1 AND table_name = 'governance_authority_grant_revocations'
        AND constraint_type = 'FOREIGN KEY'
    `, [TEST_SCHEMA]);
    assert.equal(foreignKeys.rows.length, 0);
    const indexes = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE schemaname = $1 AND tablename = 'governance_authority_grant_revocations'
    `, [TEST_SCHEMA]);
    assert.ok(indexes.rows.some((row) => row.indexname.endsWith('_installation_target_idx')));
    assert.ok(indexes.rows.some((row) => row.indexname.endsWith('_root_binding_idx')));
    const triggers = await pool.query(`
      SELECT tgname FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = 'governance_authority_grant_revocations' AND NOT t.tgisinternal
    `, [TEST_SCHEMA]);
    assert.deepEqual(triggers.rows.map((row) => row.tgname), ['governance_authority_grant_revocations_mutation_trigger']);
  } finally {
    await pool.end();
  }
});

test('real PostgreSQL persistence is durable, reconstructs the contract, and is idempotent', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const candidate = revocation();
    const first = await adapter.persistAuthorityGrantRevocation(candidate);
    assert.equal(first.persistence_result.outcome, 'PERSISTED');
    assert.equal(first.persistence_result.write_performed, true);
    assert.deepEqual(first.persistence_result.persisted_revocation, candidate);

    const replay = await adapter.persistAuthorityGrantRevocation(candidate);
    assert.equal(replay.persistence_result.outcome, 'ALREADY_PERSISTED_IDENTICAL');
    assert.equal(replay.persistence_result.write_performed, false);
    assert.deepEqual(replay.persistence_result.persisted_revocation, candidate);
    assert.equal(await countRows(pool), 1);

    const reopened = await createPoolConnectionOnly();
    try {
      const readBack = await reopened.query(`SELECT authority_grant_revocation_id, revocation_digest FROM ${TEST_TABLE}`);
      assert.deepEqual(readBack.rows, [{ authority_grant_revocation_id: candidate.authority_grant_revocation_id, revocation_digest: candidate.revocation_digest }]);
    } finally {
      await reopened.end();
    }
  } finally {
    await pool.end();
  }
});

test('same revocation ID with conflicting canonical content is rejected without overwrite', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const first = revocation();
    await adapter.persistAuthorityGrantRevocation(first);
    const conflicting = revocation({ reason_code: 'COMPROMISED' });
    const result = await adapter.persistAuthorityGrantRevocation(conflicting);
    assert.equal(result.persistence_result.outcome, 'REJECTED');
    assert.equal(result.persistence_result.write_performed, false);
    assert.equal(result.persistence_result.reason_code, 'authority_grant_revocation_identity_conflict');
    assert.equal(await countRows(pool), 1);
    const stored = await pool.query(`SELECT reason_code, revocation_digest FROM ${TEST_TABLE}`);
    assert.deepEqual(stored.rows, [{ reason_code: first.reason_code, revocation_digest: first.revocation_digest }]);
  } finally {
    await pool.end();
  }
});

test('invalid contract and tampered digest produce zero writes', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const tampered = { ...revocation(), revocation_digest: `sha256:${'f'.repeat(64)}` };
    const invalid = { ...revocation(), target_authority_grant_id: '' };
    assert.equal((await adapter.persistAuthorityGrantRevocation(tampered)).persistence_result.outcome, 'REJECTED');
    assert.equal((await adapter.persistAuthorityGrantRevocation(invalid)).persistence_result.outcome, 'REJECTED');
    assert.equal(await countRows(pool), 0);
  } finally {
    await pool.end();
  }
});

test('PostgreSQL blocks UPDATE and DELETE', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const candidate = revocation();
    await adapter.persistAuthorityGrantRevocation(candidate);
    await assert.rejects(
      pool.query(`UPDATE ${TEST_TABLE} SET reason_code = 'OTHER' WHERE authority_grant_revocation_id = $1`, [candidate.authority_grant_revocation_id]),
      /governance_authority_grant_revocation_update_forbidden/
    );
    await assert.rejects(
      pool.query(`DELETE FROM ${TEST_TABLE} WHERE authority_grant_revocation_id = $1`, [candidate.authority_grant_revocation_id]),
      /governance_authority_grant_revocation_delete_forbidden/
    );
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('concurrent identical inserts converge to one row and one identical replay', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-concurrent-identical' });
    const [resultA, resultB] = await Promise.all([
      (await adapterFor(pool)).persistAuthorityGrantRevocation(candidate),
      (await adapterFor(pool)).persistAuthorityGrantRevocation(candidate)
    ]);
    assert.deepEqual([resultA.persistence_result.outcome, resultB.persistence_result.outcome].sort(), ['ALREADY_PERSISTED_IDENTICAL', 'PERSISTED']);
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('concurrent conflicting inserts converge to one canonical row and one rejection', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidateA = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-concurrent-conflict', reason_code: 'SECURITY' });
    const candidateB = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-concurrent-conflict', reason_code: 'COMPROMISED' });
    const [resultA, resultB] = await Promise.all([
      (await adapterFor(pool)).persistAuthorityGrantRevocation(candidateA),
      (await adapterFor(pool)).persistAuthorityGrantRevocation(candidateB)
    ]);
    assert.deepEqual([resultA.persistence_result.outcome, resultB.persistence_result.outcome].sort(), ['PERSISTED', 'REJECTED']);
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('concurrent same-digest different-identity submissions are rejected and never overwrite', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const first = revocation();
    const differentIdentity = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-different-id' });
    const tampered = { ...differentIdentity, revocation_digest: first.revocation_digest };
    const [resultA, resultB] = await Promise.all([
      (await adapterFor(pool)).persistAuthorityGrantRevocation(first),
      (await adapterFor(pool)).persistAuthorityGrantRevocation(tampered)
    ]);
    assert.deepEqual([resultA.persistence_result.outcome, resultB.persistence_result.outcome].sort(), ['PERSISTED', 'REJECTED']);
    assert.equal(resultB.persistence_result.write_performed, false);
    assert.equal(await countRows(pool), 1);

    await assert.rejects(
      pool.query(`INSERT INTO ${TEST_TABLE} (
        authority_grant_revocation_id, contract_version, revocation_domain, installation_id,
        target_authority_grant_id, target_grant_digest, issuer_root_subject_id, issuer_root_generation,
        issuer_root_digest, issuer_root_key_id, issuer_root_key_fingerprint, issuer_root_key_digest,
        reason_code, issued_at, effective_at, revocation_digest
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      rowValues({ ...differentIdentity, revocation_digest: first.revocation_digest })
      ), /duplicate key/);
    assert.equal(await countRows(pool), 1);
  } finally {
    await pool.end();
  }
});

test('multiple distinct revocations for one target are preserved as immutable evidence', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const adapter = await adapterFor(pool);
    const first = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-target-1', reason_code: 'SECURITY' });
    const second = revocation({ authority_grant_revocation_id: 'authority-grant-revocation-target-2', reason_code: 'SCOPE_CHANGED', effective_at: '2026-09-09T12:00:01.000Z' });
    assert.equal(first.target_authority_grant_id, second.target_authority_grant_id);
    assert.notEqual(first.revocation_digest, second.revocation_digest);
    assert.equal((await adapter.persistAuthorityGrantRevocation(first)).persistence_result.outcome, 'PERSISTED');
    assert.equal((await adapter.persistAuthorityGrantRevocation(second)).persistence_result.outcome, 'PERSISTED');
    assert.equal(await countRows(pool), 2);
  } finally {
    await pool.end();
  }
});

test('database failure rolls back the insert and never becomes persistence success', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION ${TEST_SCHEMA}.reject_authority_grant_revocation_insert()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'authority_grant_revocation_test_insert_failure'; END;
      $$
    `);
    await pool.query(`
      CREATE TRIGGER authority_grant_revocation_test_insert_failure_trigger
      BEFORE INSERT ON ${TEST_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${TEST_SCHEMA}.reject_authority_grant_revocation_insert()
    `);
    const adapter = await adapterFor(pool);
    await assert.rejects(adapter.persistAuthorityGrantRevocation(revocation()), (error) => {
      assert.ok(error instanceof AuthorityGrantRevocationPostgresPersistenceError);
      assert.equal(error.code, 'POSTGRES_PERSISTENCE_FAILED');
      return true;
    });
    assert.equal(await countRows(pool), 0);
  } finally {
    await pool.end();
  }
});

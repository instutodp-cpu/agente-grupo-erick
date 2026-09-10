'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAuthorityGrantRevocation } = require('../src/core/canonical-governance-authority-grant-revocation-contract');
const {
  AuthorityGrantRevocationPostgresPersistenceError,
  INSERT_SQL,
  READINESS_SQL,
  ROW_FIELDS,
  SELECT_BY_ID_OR_DIGEST_SQL,
  createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres,
  parseRow,
  rowValues
} = require('../src/adapters/postgres/canonical-governance-authority-grant-revocation-persistence-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/018_create_canonical_governance_authority_grant_revocations.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const valid = buildAuthorityGrantRevocation({
  authority_grant_revocation_id: 'authority-grant-revocation-unit-1',
  installation_id: 'installation-revocation-persistence-unit',
  target_authority_grant_id: 'authority-grant-unit-1',
  target_grant_digest: `sha256:${'1'.repeat(64)}`,
  issuer_root_subject_id: 'governance-root::installation-revocation-persistence-unit',
  issuer_root_generation: 0,
  issuer_root_digest: `sha256:${'2'.repeat(64)}`,
  issuer_root_key_id: 'root-key-unit-0',
  issuer_root_key_fingerprint: `sha256:${'3'.repeat(64)}`,
  issuer_root_key_digest: `sha256:${'4'.repeat(64)}`,
  reason_code: 'SECURITY',
  issued_at: '2026-09-09T12:00:00.000Z',
  effective_at: '2026-09-09T12:00:00.000Z'
});

test('adapter construction is pure and rejects unsafe table names', () => {
  const pool = { query() {}, connect() {} };
  const adapter = createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool });
  assert.equal(Object.isFrozen(adapter), true);
  assert.equal(adapter.table_name, 'hermes.governance_authority_grant_revocations');
  assert.throws(() => createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool, tableName: 'hermes.bad-name' }), /table_name_invalid/);
  assert.throws(() => createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool, tableName: 'hermes.governance_authority_grant_revocations;DROP' }), /table_name_invalid/);
});

test('invalid revocations are rejected before readiness, connection or database writes', async () => {
  let queryCalls = 0;
  let connectCalls = 0;
  const pool = {
    query: async () => { queryCalls += 1; return { rows: [] }; },
    connect: async () => { connectCalls += 1; throw new Error('must not connect'); }
  };
  const adapter = createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool });
  const result = await adapter.persistAuthorityGrantRevocation({ ...valid, revocation_digest: `sha256:${'f'.repeat(64)}` });
  assert.equal(result.persistence_result.outcome, 'REJECTED');
  assert.equal(result.persistence_result.write_performed, false);
  assert.equal(queryCalls, 0);
  assert.equal(connectCalls, 0);
});

test('row reconstruction is contract-validated, frozen and canonical', () => {
  const row = Object.fromEntries(ROW_FIELDS.map((field) => [field, valid[field]]));
  row.issuer_root_generation = '0';
  row.issued_at = new Date(valid.issued_at);
  row.effective_at = new Date(valid.effective_at);
  row.created_at = new Date('2026-09-09T12:00:01.000Z');
  const reconstructed = parseRow(row);
  assert.deepEqual(reconstructed, valid);
  assert.equal(Object.isFrozen(reconstructed), true);
  assert.throws(() => { reconstructed.reason_code = 'OTHER'; }, TypeError);
  assert.throws(() => parseRow({ ...row, target_grant_digest: 'not-a-digest' }), (error) => {
    assert.ok(error instanceof AuthorityGrantRevocationPostgresPersistenceError);
    assert.equal(error.code, 'CORRUPT_ROW');
    return true;
  });
});

test('SQL uses insert-or-read semantics and never performs update or delete', () => {
  assert.match(INSERT_SQL, /INSERT INTO hermes\.governance_authority_grant_revocations/);
  assert.match(INSERT_SQL, /ON CONFLICT DO NOTHING/);
  assert.match(INSERT_SQL, /RETURNING/);
  assert.match(SELECT_BY_ID_OR_DIGEST_SQL, /authority_grant_revocation_id = \$1 OR revocation_digest = \$2/);
  assert.match(SELECT_BY_ID_OR_DIGEST_SQL, /FOR UPDATE/);
  assert.doesNotMatch(INSERT_SQL, /UPDATE|DELETE/i);
  assert.doesNotMatch(READINESS_SQL, /INSERT|UPDATE|DELETE/i);
});

test('migration is append-only, has no grant-target foreign key, and permits multiple target declarations', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.governance_authority_grant_revocations/);
  assert.match(migration, /authority_grant_revocation_id TEXT PRIMARY KEY/);
  assert.match(migration, /revocation_digest TEXT NOT NULL UNIQUE/);
  assert.match(migration, /BEFORE UPDATE OR DELETE/);
  assert.match(migration, /governance_authority_grant_revocation_update_forbidden/);
  assert.match(migration, /governance_authority_grant_revocation_delete_forbidden/);
  assert.doesNotMatch(migration, /REFERENCES hermes\.governance_authority_grants/);
  assert.doesNotMatch(migration, /UNIQUE\s*\(\s*target_authority_grant_id/);
});

test('row values contain only the #188 contract fields and no runtime semantics', () => {
  assert.deepEqual(rowValues(valid), [
    valid.authority_grant_revocation_id, valid.contract_version, valid.revocation_domain,
    valid.installation_id, valid.target_authority_grant_id, valid.target_grant_digest,
    valid.issuer_root_subject_id, valid.issuer_root_generation, valid.issuer_root_digest,
    valid.issuer_root_key_id, valid.issuer_root_key_fingerprint, valid.issuer_root_key_digest,
    valid.reason_code, valid.issued_at, valid.effective_at, valid.revocation_digest
  ]);
  assert.doesNotMatch(JSON.stringify(valid), /active|authorized|runtime|revoked/i);
});

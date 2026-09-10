'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAuthorityGrant } = require('../src/core/canonical-governance-authority-grant-contract');
const { buildAuthorityGrantRevocation } = require('../src/core/canonical-governance-authority-grant-revocation-contract');
const { canonicalAuthorityGrantResolutionBytes } = require('../src/core/canonical-governance-authority-grant-resolution');
const { createCanonicalGovernanceAuthorityGrantPersistencePostgres } = require('../src/adapters/postgres/canonical-governance-authority-grant-persistence-postgres');
const { createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres } = require('../src/adapters/postgres/canonical-governance-authority-grant-revocation-persistence-postgres');
const { createCanonicalGovernanceAuthorityGrantResolutionPostgres } = require('../src/adapters/postgres/canonical-governance-authority-grant-resolution-postgres');

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_governance_authority_grant_resolution_test';
const GRANT_TABLE = `${TEST_SCHEMA}.governance_authority_grants`;
const REVOCATION_TABLE = `${TEST_SCHEMA}.governance_authority_grant_revocations`;
const INSTALLATION_ID = 'installation-grant-resolution-integration';

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
    authority_grant_id: 'authority-grant-resolution-integration',
    installation_id: INSTALLATION_ID,
    issuer_root_subject_id: `governance-root::${INSTALLATION_ID}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'2'.repeat(64)}`,
    issuer_root_key_id: 'root-key-resolution-integration',
    issuer_root_key_fingerprint: `sha256:${'3'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'4'.repeat(64)}`,
    subject_type: 'AGENT',
    subject_id: 'agent-resolution-integration',
    authority_scope: {
      scope_type: 'installation', installation_id: INSTALLATION_ID,
      tenant_ids: ['tenant-integration'], organization_ids: [], project_ids: [],
      cross_tenant: false, cross_organization: false, cross_project: false
    },
    capabilities: ['GOVERNANCE_AUDIT_READ'],
    restrictions: {
      allow_further_delegation: false, allow_cross_tenant: false,
      allow_cross_organization: false, allow_cross_project: false
    },
    issued_at: '2026-09-10T12:00:00.000Z',
    not_before: '2026-09-10T12:00:00.000Z',
    expires_at: '2026-09-10T12:10:00.000Z',
    ...overrides
  });
}

function revocation(target, overrides = {}) {
  return buildAuthorityGrantRevocation({
    authority_grant_revocation_id: 'revocation-resolution-integration',
    installation_id: target.installation_id,
    target_authority_grant_id: target.authority_grant_id,
    target_grant_digest: target.grant_digest,
    issuer_root_subject_id: `governance-root::${target.installation_id}`,
    issuer_root_generation: 0,
    issuer_root_digest: `sha256:${'5'.repeat(64)}`,
    issuer_root_key_id: 'root-key-resolution-integration',
    issuer_root_key_fingerprint: `sha256:${'6'.repeat(64)}`,
    issuer_root_key_digest: `sha256:${'7'.repeat(64)}`,
    reason_code: 'SECURITY',
    issued_at: '2026-09-10T12:00:00.000Z',
    effective_at: '2026-09-10T12:04:00.000Z',
    ...overrides
  });
}

async function createPool() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  const migration017 = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/017_create_canonical_governance_authority_grants.sql'), 'utf8');
  const migration018 = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/018_create_canonical_governance_authority_grant_revocations.sql'), 'utf8');
  await pool.query(isolatedMigration(migration017));
  await pool.query(isolatedMigration(migration018));
  await pool.query(isolatedMigration(migration017));
  await pool.query(isolatedMigration(migration018));
  return pool;
}

function adapters(pool) {
  return {
    grants: createCanonicalGovernanceAuthorityGrantPersistencePostgres({ pool, tableName: GRANT_TABLE }),
    revocations: createCanonicalGovernanceAuthorityGrantRevocationPersistencePostgres({ pool, tableName: REVOCATION_TABLE }),
    resolver: createCanonicalGovernanceAuthorityGrantResolutionPostgres({ pool, grantTableName: GRANT_TABLE, revocationTableName: REVOCATION_TABLE })
  };
}

async function rowCounts(pool) {
  return (await pool.query(`SELECT
    (SELECT count(*)::int FROM ${GRANT_TABLE}) AS grants,
    (SELECT count(*)::int FROM ${REVOCATION_TABLE}) AS revocations`)).rows[0];
}

async function tableStats(pool) {
  return (await pool.query(`
    SELECT n_tup_ins::bigint, n_tup_upd::bigint, n_tup_del::bigint
    FROM pg_stat_user_tables WHERE relid = $1::regclass
  `, [GRANT_TABLE])).rows[0];
}

test('real PostgreSQL installs predecessor schemas idempotently and resolves persisted evidence read-only', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = grant();
    const { grants, resolver } = adapters(pool);
    assert.equal((await grants.persistAuthorityGrant(candidate)).persistence_result.outcome, 'PERSISTED');
    const beforeCounts = await rowCounts(pool);
    const beforeStats = await tableStats(pool);
    const result = await resolver.resolve({
      installation_id: INSTALLATION_ID,
      authority_grant_id: candidate.authority_grant_id,
      evaluation_time: '2026-09-10T12:05:00.000Z'
    });
    assert.equal(result.status, 'RESOLVED_ACTIVE');
    assert.deepEqual(result.resolved_grant, candidate);
    assert.deepEqual(await rowCounts(pool), beforeCounts);
    assert.deepEqual(await tableStats(pool), beforeStats);
  } finally {
    await pool.end();
  }
});

test('real PostgreSQL resolution applies temporal states and effective revocation without hidden clock', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = grant();
    const { grants, revocations, resolver } = adapters(pool);
    await grants.persistAuthorityGrant(candidate);
    const future = revocation(candidate, { authority_grant_revocation_id: 'revocation-resolution-future', effective_at: '2026-09-10T12:07:00.000Z' });
    const effective = revocation(candidate, { authority_grant_revocation_id: 'revocation-resolution-effective', effective_at: '2026-09-10T12:04:00.000Z' });
    await revocations.persistAuthorityGrantRevocation(future);
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:06:00.000Z' })).status, 'RESOLVED_ACTIVE');
    await revocations.persistAuthorityGrantRevocation(effective);
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:06:00.000Z' })).status, 'RESOLVED_REVOKED');
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T11:59:59.999Z' })).status, 'RESOLVED_NOT_YET_ACTIVE');
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:10:00.001Z' })).status, 'RESOLVED_EXPIRED');
  } finally {
    await pool.end();
  }
});

test('multiple revocations are ordered deterministically and target digest isolation rejects mismatched evidence', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = grant();
    const { grants, revocations, resolver } = adapters(pool);
    await grants.persistAuthorityGrant(candidate);
    const first = revocation(candidate, { authority_grant_revocation_id: 'revocation-resolution-a', effective_at: '2026-09-10T12:03:00.000Z' });
    const second = revocation(candidate, { authority_grant_revocation_id: 'revocation-resolution-b', reason_code: 'SCOPE_CHANGED', effective_at: '2026-09-10T12:04:00.000Z' });
    await revocations.persistAuthorityGrantRevocation(second);
    await revocations.persistAuthorityGrantRevocation(first);
    const request = { installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:05:00.000Z' };
    const resultA = await resolver.resolve(request);
    const resultB = await resolver.resolve(request);
    assert.equal(resultA.status, 'RESOLVED_REVOKED');
    assert.deepEqual(resultA, resultB);
    assert.deepEqual(canonicalAuthorityGrantResolutionBytes(resultA), canonicalAuthorityGrantResolutionBytes(resultB));

    const mismatched = revocation(candidate, { authority_grant_revocation_id: 'revocation-resolution-mismatch', target_grant_digest: `sha256:${'9'.repeat(64)}` });
    await revocations.persistAuthorityGrantRevocation(mismatched);
    const isolated = await resolver.resolve(request);
    assert.equal(isolated.status, 'REJECTED');
    assert.equal(isolated.reason_code, 'revocation_target_digest_mismatch');
  } finally {
    await pool.end();
  }
});

test('missing, expected digest mismatch, installation mismatch, and corrupt persisted evidence fail closed', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const pool = await createPool();
  try {
    const candidate = grant();
    const { grants, resolver } = adapters(pool);
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:05:00.000Z' })).status, 'NOT_FOUND');
    await grants.persistAuthorityGrant(candidate);
    assert.equal((await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, expected_grant_digest: `sha256:${'f'.repeat(64)}`, evaluation_time: '2026-09-10T12:05:00.000Z' })).status, 'REJECTED');
    assert.equal((await resolver.resolve({ installation_id: 'other-installation', authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:05:00.000Z' })).status, 'REJECTED');

    await pool.query(`ALTER TABLE ${GRANT_TABLE} DISABLE TRIGGER USER`);
    await pool.query(`UPDATE ${GRANT_TABLE} SET subject_id = 'corrupt-subject' WHERE authority_grant_id = $1`, [candidate.authority_grant_id]);
    await pool.query(`ALTER TABLE ${GRANT_TABLE} ENABLE TRIGGER USER`);
    const corrupt = await resolver.resolve({ installation_id: INSTALLATION_ID, authority_grant_id: candidate.authority_grant_id, evaluation_time: '2026-09-10T12:05:00.000Z' });
    assert.equal(corrupt.status, 'REJECTED');
  } finally {
    await pool.end();
  }
});

test('resolution adapter emits no INSERT, UPDATE, or DELETE SQL', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../src/adapters/postgres/canonical-governance-authority-grant-resolution-postgres.js'), 'utf8');
  assert.doesNotMatch(source, /\b(INSERT|UPDATE|DELETE)\b/);
});

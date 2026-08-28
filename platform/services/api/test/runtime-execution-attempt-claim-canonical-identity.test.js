'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CLAIM_CONTRACT_NAME,
  CLAIM_CONTRACT_VERSION,
  buildCanonicalClaimIdentity,
  canonicalIdentityFromPersistedRow,
  computeClaimDigest,
  computeClaimFingerprint,
  computeClaimId,
  validatePersistedClaimIdentity
} = require('../src/core/runtime-execution-attempt-durable-claim-contract');
const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');

const P12A_PATH = path.resolve(__dirname, '../../../migrations/hermes/006_create_execution_attempt_claims.sql');
const P12A1_PATH = path.resolve(__dirname, '../../../migrations/hermes/007_complete_execution_attempt_claim_canonical_identity.sql');
const P7_PATH = path.resolve(__dirname, '../../../migrations/hermes/004_create_execution_attempts.sql');
const P9A_PATH = path.resolve(__dirname, '../../../migrations/hermes/005_enable_execution_attempt_admission_lifecycle.sql');
const p12a = fs.readFileSync(P12A_PATH, 'utf8');
const p12a1 = fs.readFileSync(P12A1_PATH, 'utf8');
const p7 = fs.readFileSync(P7_PATH, 'utf8');
const p9a = fs.readFileSync(P9A_PATH, 'utf8');
const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;

function baseIdentity(overrides = {}) {
  return {
    claim_contract_version: CLAIM_CONTRACT_VERSION,
    claim_ordinal: 1,
    attempt_durable_record_id: 'attempt-canonical-identity-1',
    attempt_state: 'ADMITTED',
    attempt_revision: 2,
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1',
    session_reference_id: 'session-1',
    agent_id: 'agent-1',
    actor_id: 'actor-1',
    attempt_ordinal: 1,
    claim_intent_contract_name: 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_INTENT_SIMULATION',
    claim_intent_contract_version: 'runtime_execution_attempt_claim_intent_simulation_contract_v1',
    claim_intent_reference_id: 'claim-intent-1',
    claim_intent_reference_version: 1,
    claim_intent_reference_fingerprint: 'claim-intent-fingerprint-1',
    claim_intent_reference_digest: ZERO_DIGEST,
    claim_eligibility_contract_name: 'RUNTIME_EXECUTION_ATTEMPT_CLAIM_ELIGIBILITY_DECISION_SIMULATION',
    claim_eligibility_contract_version: 'runtime_execution_attempt_claim_eligibility_decision_simulation_contract_v1',
    claim_eligibility_decision_status: 'EXECUTION_ATTEMPT_CLAIM_ELIGIBLE_SIMULATION',
    claim_eligibility_decision_reference_id: 'claim-eligibility-1',
    claim_eligibility_decision_reference_version: 1,
    claim_eligibility_decision_reference_fingerprint: 'claim-eligibility-fingerprint-1',
    claim_eligibility_decision_reference_digest: ZERO_DIGEST,
    ...overrides
  };
}

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

const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const REAL_POSTGRES_ENABLED = safeTestDatabaseUrl(TEST_DATABASE_URL);
const TEST_SCHEMA = 'hermes_execution_attempt_claim_identity_p12a1_test';
const TEST_ATTEMPTS = `${TEST_SCHEMA}.execution_attempts`;
const TEST_CLAIMS = `${TEST_SCHEMA}.execution_attempt_claims`;

function isolatedMigration(sql) {
  return sql
    .replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll("n.nspname = 'hermes'", `n.nspname = '${TEST_SCHEMA}'`)
    .replaceAll('hermes.execution_attempts', TEST_ATTEMPTS)
    .replaceAll('hermes.execution_attempt_claims', TEST_CLAIMS);
}

function bounded(operation, label, timeoutMs = 30000) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

test('P12A.1 migration is additive, idempotent-compatible and contains no runtime write', () => {
  assert.match(p12a1, /BEGIN;/);
  assert.match(p12a1, /COMMIT;\s*$/);
  assert.match(p12a1, /ADD CONSTRAINT execution_attempt_claims_claim_id_format_check/);
  assert.match(p12a1, /ADD CONSTRAINT execution_attempt_claims_digest_format_check/);
  assert.match(p12a1, /ADD CONSTRAINT execution_attempt_claims_artifact_identity_binding_check/);
  assert.match(p12a1, /ADD CONSTRAINT execution_attempt_claims_receipt_identity_binding_check/);
  assert.match(p12a1, /NOT VALID/);
  assert.match(p12a1, /IF NOT EXISTS/);
  assert.doesNotMatch(p12a1, /CREATE TABLE|DROP TABLE|DROP SCHEMA|INSERT INTO|UPDATE\s|DELETE FROM/i);
  assert.match(p12a, /UNIQUE \(attempt_durable_record_id, claim_ordinal\)/);
  assert.match(p12a, /UNIQUE \(attempt_durable_record_id, claim_fingerprint, claim_digest\)/);
  assert.match(p12a, /WHERE claim_state = 'ACTIVE'/);
});

test('canonical claim identity is stable, complete and excludes non-authority metadata', () => {
  const first = buildCanonicalClaimIdentity(baseIdentity());
  const reordered = buildCanonicalClaimIdentity(Object.fromEntries(Object.entries(baseIdentity()).reverse()));
  assert.equal(computeClaimFingerprint(first), computeClaimFingerprint(reordered));
  assert.equal(computeClaimDigest(first), computeClaimDigest(reordered));
  assert.equal(computeClaimId(first), computeClaimId(reordered));
  assert.equal(CLAIM_CONTRACT_NAME, 'RUNTIME_EXECUTION_ATTEMPT_DURABLE_CLAIM');

  const withMetadata = canonicalIdentityFromPersistedRow({
    ...baseIdentity(),
    claim_id: computeClaimId(first),
    claim_state: 'ACTIVE',
    created_at: 'database-generated-timestamp',
    claim_artifact: { response_metadata: 'ignored' },
    claim_receipt: { response_metadata: 'ignored' }
  });
  assert.equal(computeClaimFingerprint(withMetadata), computeClaimFingerprint(first));
  assert.equal(computeClaimDigest(withMetadata), computeClaimDigest(first));
});

test('authority-relevant canonical evidence changes identity and persisted rows are verifiable', () => {
  const identity = buildCanonicalClaimIdentity(baseIdentity());
  const persisted = {
    ...identity,
    claim_id: computeClaimId(identity),
    claim_fingerprint: computeClaimFingerprint(identity),
    claim_digest: computeClaimDigest(identity),
    claim_state: 'ACTIVE'
  };
  assert.equal(validatePersistedClaimIdentity(persisted).valid, true);

  const divergent = buildCanonicalClaimIdentity({
    ...baseIdentity(),
    claim_eligibility_decision_reference_fingerprint: 'claim-eligibility-fingerprint-2'
  });
  assert.notEqual(computeClaimFingerprint(divergent), computeClaimFingerprint(identity));
  assert.notEqual(computeClaimDigest(divergent), computeClaimDigest(identity));
  assert.equal(validatePersistedClaimIdentity({ ...persisted, claim_fingerprint: 'caller-controlled' }).valid, false);
});

test('missing canonical predecessor evidence fails closed before replay comparison', () => {
  const identity = buildCanonicalClaimIdentity(baseIdentity());
  const persisted = {
    ...identity,
    claim_id: computeClaimId(identity),
    claim_fingerprint: computeClaimFingerprint(identity),
    claim_digest: computeClaimDigest(identity),
    claim_state: 'ACTIVE'
  };
  const missing = { ...persisted };
  delete missing.claim_eligibility_decision_reference_digest;
  assert.equal(validatePersistedClaimIdentity(missing).valid, false);
});

test('P12A.1 keeps P7/P9A lifecycle and authority boundaries unchanged', () => {
  assert.match(p7, /CREATE TABLE IF NOT EXISTS hermes\.execution_attempts/);
  assert.match(p9a, /state = 'ADMITTED' AND revision = 2/);
  assert.doesNotMatch(p12a1, /ALTER TABLE .*execution_attempts|CLAIMED|revision = 3|worker_id|lease_id|fencing_token|execution_authorized/i);
});

test('real PostgreSQL applies P12A and P12A.1 and enforces canonical identity bindings', { skip: !REAL_POSTGRES_ENABLED }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000 });
  try {
    await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'drop_p12a1_schema');
    await bounded(pool.query(isolatedMigration(p7)), 'apply_p7');
    await bounded(pool.query(isolatedMigration(p9a)), 'apply_p9a');
    await bounded(pool.query(isolatedMigration(p12a)), 'apply_p12a');
    await bounded(pool.query(isolatedMigration(p12a1)), 'apply_p12a1');
    await bounded(pool.query(isolatedMigration(p12a1)), 'reapply_p12a1');

    const input = buildAdmissionInput(1);
    const persistence = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_ATTEMPTS });
    const admission = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_ATTEMPTS });
    assert.equal((await persistence.persistDurably(input.p7_durable_record)).persistence_result.outcome, 'CREATED');
    assert.equal((await admission.admitDurably(input)).admission_result.outcome, 'ADMITTED');

    const record = input.p7_durable_record;
    const identity = buildCanonicalClaimIdentity({
      ...baseIdentity(),
      attempt_durable_record_id: record.runtime_execution_attempt_durable_record_id,
      tenant_id: record.identity_scope.tenant_id,
      organization_id: record.identity_scope.organization_id,
      project_id: record.identity_scope.project_id,
      session_reference_id: record.identity_scope.session_reference_id,
      agent_id: record.identity_scope.agent_id,
      actor_id: record.identity_scope.actor_id,
      attempt_ordinal: record.attempt_ordinal,
      claim_intent_reference_id: 'claim-intent-db-1',
      claim_eligibility_decision_reference_id: 'claim-eligibility-db-1'
    });
    const claimId = computeClaimId(identity);
    const claimFingerprint = computeClaimFingerprint(identity);
    const claimDigest = computeClaimDigest(identity);
    const artifact = {
      claim_id: claimId,
      attempt_durable_record_id: identity.attempt_durable_record_id,
      claim_state: 'ACTIVE',
      claim_eligibility_decision_reference_id: identity.claim_eligibility_decision_reference_id,
      claim_eligibility_decision_reference_digest: identity.claim_eligibility_decision_reference_digest,
      claim_fingerprint: claimFingerprint,
      claim_digest: claimDigest
    };
    const receipt = { ...artifact };
    const columns = [
      'claim_id', 'claim_ordinal', 'attempt_durable_record_id', 'attempt_state', 'attempt_revision',
      'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'agent_id', 'actor_id',
      'attempt_ordinal', 'claim_intent_contract_name', 'claim_intent_contract_version',
      'claim_intent_reference_id', 'claim_intent_reference_version', 'claim_intent_reference_fingerprint',
      'claim_intent_reference_digest', 'claim_eligibility_contract_name', 'claim_eligibility_contract_version',
      'claim_eligibility_decision_status', 'claim_eligibility_decision_reference_id',
      'claim_eligibility_decision_reference_version', 'claim_eligibility_decision_reference_fingerprint',
      'claim_eligibility_decision_reference_digest', 'claim_contract_version', 'claim_state',
      'claim_fingerprint', 'claim_digest', 'claim_artifact', 'claim_receipt', 'schema_version'
    ];
    const values = columns.map((column) => {
      if (column === 'claim_id') return claimId;
      if (column === 'claim_fingerprint') return claimFingerprint;
      if (column === 'claim_digest') return claimDigest;
      if (column === 'claim_state') return 'ACTIVE';
      if (column === 'claim_artifact') return JSON.stringify(artifact);
      if (column === 'claim_receipt') return JSON.stringify(receipt);
      if (column === 'schema_version') return 1;
      return identity[column];
    });
    const placeholders = values.map((_, index) => `$${index + 1}${['claim_artifact', 'claim_receipt'].includes(columns[index]) ? '::jsonb' : ''}`).join(', ');
    const inserted = await bounded(pool.query(
      `INSERT INTO ${TEST_CLAIMS} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING claim_id`,
      values
    ), 'insert_valid_claim');
    assert.equal(inserted.rows.length, 1);

    const constraints = await bounded(pool.query(`
      SELECT c.conname FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = $1 AND r.relname = 'execution_attempt_claims'
    `, [TEST_SCHEMA]), 'read_constraints');
    const names = new Set(constraints.rows.map((row) => row.conname));
    for (const name of [
      'execution_attempt_claims_attempt_ordinal_key',
      'execution_attempt_claims_identity_key',
      'execution_attempt_claims_claim_id_format_check',
      'execution_attempt_claims_digest_format_check',
      'execution_attempt_claims_artifact_identity_binding_check',
      'execution_attempt_claims_receipt_identity_binding_check'
    ]) assert.equal(names.has(name), true, name);

    await assert.rejects(
      pool.query(
        `INSERT INTO ${TEST_CLAIMS} (${columns.join(', ')}) VALUES (${placeholders})`,
        values.map((value, index) => columns[index] === 'claim_digest' ? 'not-a-digest' : value)
      ),
      /execution_attempt_claims_digest_format_check|execution_attempt_claims_artifact_identity_binding_check/
    );
    const count = await bounded(pool.query(`SELECT count(*)::int AS count FROM ${TEST_CLAIMS}`), 'count_claims');
    assert.equal(count.rows[0].count, 1);
  } finally {
    try { await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'cleanup_p12a1_schema'); }
    finally { await bounded(pool.end(), 'close_p12a1_pool'); }
  }
});

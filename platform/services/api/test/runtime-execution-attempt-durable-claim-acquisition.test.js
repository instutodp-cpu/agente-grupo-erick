'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildAdmissionInput } = require('./helpers/runtime-execution-attempt-p9-fixtures');
const { buildAdmissionResult } = require('../src/core/runtime-execution-attempt-durable-admission');
const { buildClaimIntent } = require('../src/core/runtime-execution-attempt-claim-intent-simulation');
const {
  buildClaimEligibilityDecision,
  computeDecisionDigest,
  computeDecisionFingerprint
} = require('../src/core/runtime-execution-attempt-claim-eligibility-decision-simulation');
const {
  buildAcquisitionPlan,
  classifyPersistedClaim,
  planToInsertRow,
  validateInput
} = require('../src/core/runtime-execution-attempt-durable-claim-acquisition');
const {
  createRuntimeExecutionAttemptClaimAcquisitionPostgres
} = require('../src/adapters/postgres/runtime-execution-attempt-claim-acquisition-postgres');
const { createRuntimeExecutionAttemptPersistencePostgres } = require('../src/adapters/postgres/runtime-execution-attempt-persistence-postgres');
const { createRuntimeExecutionAttemptAdmissionPostgres } = require('../src/adapters/postgres/runtime-execution-attempt-admission-postgres');
const {
  buildGoldenWorkerAssignmentBundle,
  evaluateRuntimeWorkerAssignmentRequest
} = require('./helpers/runtime-worker-assignment-test-data');
const {
  computeWorkerAssignmentPackageDigest,
  computeWorkerAssignmentPackageFingerprint
} = require('../src/core/runtime-worker-assignment-package');

const {
  computeHealthFingerprint
} = require('../src/core/runtime-worker-health-reference');
const {
  computeCapacityDigest,
  computeCapacityFingerprint
} = require('../src/core/runtime-worker-capacity-reference');
const { computeFreshnessFingerprint } = require('../src/core/runtime-readiness-freshness-reference');

const P7_PATH = path.resolve(__dirname, '../../../migrations/hermes/004_create_execution_attempts.sql');
const P9A_PATH = path.resolve(__dirname, '../../../migrations/hermes/005_enable_execution_attempt_admission_lifecycle.sql');
const P12A_PATH = path.resolve(__dirname, '../../../migrations/hermes/006_create_execution_attempt_claims.sql');
const P12A1_PATH = path.resolve(__dirname, '../../../migrations/hermes/007_complete_execution_attempt_claim_canonical_identity.sql');
const P12B_SCHEMA_PATH = path.resolve(__dirname, '../../../migrations/hermes/008_replace_claim_identity_index_with_digest.sql');
const p7 = fs.readFileSync(P7_PATH, 'utf8');
const p9a = fs.readFileSync(P9A_PATH, 'utf8');
const p12a = fs.readFileSync(P12A_PATH, 'utf8');
const p12a1 = fs.readFileSync(P12A1_PATH, 'utf8');
const p12bSchema = fs.readFileSync(P12B_SCHEMA_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_execution_attempt_claim_acquisition_p12b_test';
const TEST_ATTEMPTS = `${TEST_SCHEMA}.execution_attempts`;
const TEST_CLAIMS = `${TEST_SCHEMA}.execution_attempt_claims`;

function mutable(value) {
  return JSON.parse(JSON.stringify(value));
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

function isolatedMigration(sql) {
  return sql
    .replaceAll('CREATE SCHEMA IF NOT EXISTS hermes;', `CREATE SCHEMA IF NOT EXISTS ${TEST_SCHEMA};`)
    .replaceAll("n.nspname = 'hermes'", `n.nspname = '${TEST_SCHEMA}'`)
    .replaceAll('hermes.execution_attempts', TEST_ATTEMPTS)
    .replaceAll('hermes.execution_attempt_claims', TEST_CLAIMS);
}

function buildWorkerEvidence(scope) {
  const golden = buildGoldenWorkerAssignmentBundle();
  const outcome = evaluateRuntimeWorkerAssignmentRequest(golden.workerAssignmentRequest, {});
  const assignmentPackage = mutable(outcome.package);
  const assignmentDecision = mutable(outcome.decision);
  const health = mutable(golden.pool.health);
  const capacity = mutable(golden.pool.capacity);
  const freshness = mutable(golden.freshnessRef);
  Object.assign(assignmentPackage, scope);
  Object.assign(assignmentDecision, scope);
  health.health_fingerprint = computeHealthFingerprint(health);
  capacity.capacity_fingerprint = computeCapacityFingerprint(capacity);
  capacity.capacity_digest = computeCapacityDigest(capacity);
  freshness.freshness_fingerprint = computeFreshnessFingerprint(freshness);
  assignmentPackage.worker_health_fingerprints = [health.health_fingerprint].sort();
  assignmentPackage.worker_capacity_fingerprints = [capacity.capacity_fingerprint].sort();
  assignmentPackage.freshness_fingerprint = freshness.freshness_fingerprint;
  assignmentPackage.worker_assignment_package_fingerprint = computeWorkerAssignmentPackageFingerprint(assignmentPackage);
  assignmentPackage.worker_assignment_package_digest = computeWorkerAssignmentPackageDigest(assignmentPackage);
  assignmentDecision.runtime_worker_assignment_package_fingerprint = assignmentPackage.worker_assignment_package_fingerprint;
  assignmentDecision.runtime_worker_assignment_package_digest = assignmentPackage.worker_assignment_package_digest;
  return {
    runtime_worker_assignment_decision: assignmentDecision,
    runtime_worker_assignment_package: assignmentPackage,
    runtime_worker_health_reference: health,
    runtime_worker_capacity_reference: capacity,
    runtime_freshness_reference: freshness
  };
}

function buildAcquisitionInput(attemptOrdinal = 1) {
  const p8 = buildAdmissionInput(attemptOrdinal, { compact: true });
  const p9 = buildAdmissionResult({
    outcome: 'ADMITTED',
    record: p8.p7_durable_record,
    decision: p8.p8_admission_decision,
    finalState: 'ADMITTED',
    finalRevision: 2,
    transitionApplied: true,
    reasonCode: 'prepared_to_admitted'
  });
  const intent = buildClaimIntent({ p7_durable_record: p8.p7_durable_record, p9_durable_admission: p9 });
  const evidence = buildWorkerEvidence(p8.p7_durable_record.identity_scope);
  const decision = buildClaimEligibilityDecision({
    runtime_execution_attempt_claim_intent: intent,
    ...evidence
  });
  return {
    runtime_execution_attempt_claim_intent: intent,
    runtime_execution_attempt_claim_eligibility_decision: decision,
    p7_durable_record: p8.p7_durable_record
  };
}

function divergentInput(input) {
  const copy = mutable(input);
  const decision = copy.runtime_execution_attempt_claim_eligibility_decision;
  decision.runtime_worker_assignment_decision_id = 'worker-assignment-decision-divergent';
  decision.runtime_execution_attempt_claim_eligibility_decision_fingerprint = computeDecisionFingerprint(decision);
  decision.runtime_execution_attempt_claim_eligibility_decision_digest = computeDecisionDigest(decision);
  return {
    runtime_execution_attempt_claim_intent: copy.runtime_execution_attempt_claim_intent,
    runtime_execution_attempt_claim_eligibility_decision: decision,
    p7_durable_record: copy.p7_durable_record
  };
}

function acquisitionInput(input) {
  return {
    runtime_execution_attempt_claim_intent: input.runtime_execution_attempt_claim_intent,
    runtime_execution_attempt_claim_eligibility_decision: input.runtime_execution_attempt_claim_eligibility_decision
  };
}

function fakeUnavailablePool() {
  return {
    query: async () => { throw new Error('database_should_not_be_touched'); },
    connect: async () => { throw new Error('database_should_not_be_touched'); }
  };
}

test('valid P11 ELIGIBLE input creates a deterministic P12B acquisition plan', () => {
  const input = buildAcquisitionInput();
  const canonicalInput = acquisitionInput(input);
  const before = mutable(input);
  const validation = validateInput(canonicalInput);
  const plan = buildAcquisitionPlan(canonicalInput);
  assert.deepEqual(validation, { valid: true, outcome: null, errors: [] });
  assert.match(plan.claim_id, /^runtime-execution-attempt-durable-claim-[0-9a-f]{64}$/);
  assert.equal(plan.claim_state, 'ACTIVE');
  assert.equal(plan.claim_ordinal, 1);
  assert.equal(plan.identity.attempt_state, 'ADMITTED');
  assert.equal(plan.identity.attempt_revision, 2);
  assert.equal(plan.claim_artifact.worker_bound, false);
  assert.equal(plan.claim_artifact.lease_created, false);
  assert.equal(plan.claim_artifact.execution_authorized, false);
  assert.deepEqual(input, before);
});

test('P11 INELIGIBLE is rejected before PostgreSQL and is not CONFLICT', async () => {
  const input = buildAcquisitionInput();
  const ineligible = buildClaimEligibilityDecision({
    runtime_execution_attempt_claim_intent: input.runtime_execution_attempt_claim_intent,
    ...buildWorkerEvidence(input.p7_durable_record.identity_scope),
    runtime_worker_health_reference: undefined
  });
  assert.equal(ineligible.claim_eligible, false);
  const adapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool: fakeUnavailablePool() });
  const result = await adapter.acquireDurably({
    runtime_execution_attempt_claim_intent: input.runtime_execution_attempt_claim_intent,
    runtime_execution_attempt_claim_eligibility_decision: ineligible
  });
  assert.equal(result.acquisition_result.outcome, 'INELIGIBLE');
  assert.equal(result.acquisition_result.claim_issued, false);
});

test('malformed, substituted, or mismatched predecessors fail closed before PostgreSQL', async () => {
  const input = buildAcquisitionInput();
  const cases = [
    { ...acquisitionInput(input), runtime_execution_attempt_claim_eligibility_decision: { ...input.runtime_execution_attempt_claim_eligibility_decision, runtime_execution_attempt_claim_eligibility_decision_digest: 'invalid' } },
    { ...acquisitionInput(input), runtime_execution_attempt_claim_intent: { ...input.runtime_execution_attempt_claim_intent, runtime_execution_attempt_claim_intent_id: 'substituted' } },
    { ...acquisitionInput(input), runtime_execution_attempt_claim_eligibility_decision: { ...input.runtime_execution_attempt_claim_eligibility_decision, attempt_ordinal: 2 } }
  ];
  const adapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool: fakeUnavailablePool() });
  for (const candidate of cases) {
    const result = await adapter.acquireDurably(candidate);
    assert.equal(result.acquisition_result.outcome, 'INVALID');
    assert.equal(result.acquisition_result.claim_issued, false);
  }
});

test('persisted canonical identity distinguishes identical replay from divergent replay without mutation', () => {
  const input = buildAcquisitionInput();
  const plan = buildAcquisitionPlan(acquisitionInput(input));
  const persisted = planToInsertRow(plan);
  const before = mutable(persisted);
  assert.equal(classifyPersistedClaim(persisted, plan).outcome, 'EXISTING_IDENTICAL');
  assert.deepEqual(persisted, before);

  const divergentPlan = buildAcquisitionPlan(acquisitionInput(divergentInput(input)));
  const conflict = classifyPersistedClaim(planToInsertRow(divergentPlan), plan);
  assert.equal(conflict.outcome, 'CONFLICT');
  assert.deepEqual(persisted, before);
});

test('PostgreSQL BIGINT claim fields normalize before canonical replay comparison', () => {
  const input = buildAcquisitionInput();
  const plan = buildAcquisitionPlan(acquisitionInput(input));
  const persisted = planToInsertRow(plan);
  const adapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({ pool: fakeUnavailablePool() });
  const databaseRow = {
    ...persisted,
    claim_ordinal: String(persisted.claim_ordinal),
    attempt_revision: String(persisted.attempt_revision),
    attempt_ordinal: String(persisted.attempt_ordinal),
    created_at: new Date('2026-01-01T00:00:00.000Z')
  };
  assert.equal(classifyPersistedClaim(databaseRow, plan).outcome, 'TECHNICAL_FAILURE');
  const normalized = adapter.normalizeClaimRow(databaseRow);
  assert.equal(normalized.created_at, '2026-01-01T00:00:00.000Z');
  assert.equal(classifyPersistedClaim(normalized, plan).outcome, 'EXISTING_IDENTICAL');
});

test('P12B contract contains no attempt lifecycle, worker, lease, fencing, or execution mutation', () => {
  const source = fs.readFileSync(require.resolve('../src/core/runtime-execution-attempt-durable-claim-acquisition'), 'utf8');
  assert.doesNotMatch(source, /UPDATE |DELETE FROM|INSERT INTO|pool|client\.query|fetch\(|axios|http\.request|https\.request/);
  assert.doesNotMatch(source, /CLAIMED|revision\s*=\s*3|worker_id|lease_id|Math\.random|Date\.now/);
});

test('P12B schema migration removes only the oversized identity index and preserves canonical identity storage', () => {
  assert.match(p12bSchema, /BEGIN;/);
  assert.match(p12bSchema, /COMMIT;\s*$/);
  assert.match(p12bSchema, /GROUP BY attempt_durable_record_id, claim_digest/);
  assert.match(p12bSchema, /execution_attempt_claims_digest_identity_key/);
  assert.match(p12bSchema, /UNIQUE \(attempt_durable_record_id, claim_digest\)/);
  assert.match(p12bSchema, /DROP CONSTRAINT IF EXISTS execution_attempt_claims_identity_key/);
  assert.doesNotMatch(p12bSchema, /CREATE TABLE|DROP TABLE|DELETE FROM|TRUNCATE|UPDATE\s|INSERT INTO/i);
  assert.match(p12bSchema, /octet_length\(claim_digest\) > 8191/);
  assert.match(p12a, /claim_fingerprint TEXT NOT NULL/);
  assert.match(p12a, /claim_digest TEXT NOT NULL/);
});

test('real PostgreSQL acquires, replays, conflicts, and serializes concurrent claims', { skip: !safeTestDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  const bounded = (operation, label, timeoutMs = 30000) => Promise.race([
    operation,
    new Promise((resolve, reject) => setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs))
  ]);
  try {
    await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'drop_schema');
    await bounded(pool.query(isolatedMigration(p7)), 'apply_p7');
    await bounded(pool.query(isolatedMigration(p9a)), 'apply_p9a');
    await bounded(pool.query(isolatedMigration(p12a)), 'apply_p12a');
    await bounded(pool.query(isolatedMigration(p12a1)), 'apply_p12a1');
    await bounded(pool.query(isolatedMigration(p12bSchema)), 'apply_p12b_schema');
    await bounded(pool.query(isolatedMigration(p12bSchema)), 'reapply_p12b_schema');

    const identityConstraints = await bounded(pool.query(`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
      WHERE n.nspname = $1 AND r.relname = 'execution_attempt_claims'
    `, [TEST_SCHEMA]), 'read_identity_constraints');
    const identityConstraintNames = new Set(identityConstraints.rows.map((row) => row.conname));
    assert.equal(identityConstraintNames.has('execution_attempt_claims_identity_key'), false);
    assert.equal(identityConstraintNames.has('execution_attempt_claims_digest_identity_key'), true);

    const input = buildAcquisitionInput(1);
    const persistence = createRuntimeExecutionAttemptPersistencePostgres({ pool, tableName: TEST_ATTEMPTS });
    const admission = createRuntimeExecutionAttemptAdmissionPostgres({ pool, tableName: TEST_ATTEMPTS });
    const p8 = buildAdmissionInput(1, { compact: true });
    assert.equal((await persistence.persistDurably(input.p7_durable_record)).persistence_result.outcome, 'CREATED');
    assert.equal((await admission.admitDurably({
      p7_durable_record: input.p7_durable_record,
      p8_admission_decision: p8.p8_admission_decision
    })).admission_result.outcome, 'ADMITTED');

    const adapter = createRuntimeExecutionAttemptClaimAcquisitionPostgres({
      pool,
      attemptTableName: TEST_ATTEMPTS,
      claimTableName: TEST_CLAIMS
    });
    const first = await adapter.acquireDurably(acquisitionInput(input));
    assert.equal(first.acquisition_result.outcome, 'CREATED');
    assert.equal(first.acquisition_result.claim_issued, true);
    assert.equal(first.acquisition_result.claim_artifact_created, true);

    const replay = await adapter.acquireDurably(acquisitionInput(input));
    assert.equal(replay.acquisition_result.outcome, 'EXISTING_IDENTICAL');
    assert.equal(replay.acquisition_result.claim_issued, true);
    assert.equal(replay.acquisition_result.claim_artifact_created, false);

    const beforeConflict = await pool.query(`SELECT claim_id, claim_digest, claim_fingerprint FROM ${TEST_CLAIMS}`);
    const conflict = await adapter.acquireDurably(acquisitionInput(divergentInput(input)));
    assert.equal(conflict.acquisition_result.outcome, 'CONFLICT');
    const afterConflict = await pool.query(`SELECT claim_id, claim_digest, claim_fingerprint FROM ${TEST_CLAIMS}`);
    assert.deepEqual(afterConflict.rows, beforeConflict.rows);

    const concurrentInput = buildAcquisitionInput(2);
    const concurrentP8 = buildAdmissionInput(2, { compact: true });
    assert.equal((await persistence.persistDurably(concurrentInput.p7_durable_record)).persistence_result.outcome, 'CREATED');
    assert.equal((await admission.admitDurably({
      p7_durable_record: concurrentInput.p7_durable_record,
      p8_admission_decision: concurrentP8.p8_admission_decision
    })).admission_result.outcome, 'ADMITTED');
    const identicalResults = await Promise.all(
      Array.from({ length: 6 }, () => adapter.acquireDurably(acquisitionInput(concurrentInput)))
    );
    assert.equal(identicalResults.filter((result) => result.acquisition_result.outcome === 'CREATED').length, 1);
    assert.equal(identicalResults.filter((result) => result.acquisition_result.outcome === 'EXISTING_IDENTICAL').length, 5);
    assert.equal(identicalResults.filter((result) => result.acquisition_result.outcome === 'CONFLICT').length, 0);
    const identicalCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_CLAIMS} WHERE attempt_durable_record_id = $1`, [concurrentInput.p7_durable_record.runtime_execution_attempt_durable_record_id]);
    assert.equal(identicalCount.rows[0].count, 1);

    const divergentConcurrentInput = buildAcquisitionInput(3);
    const divergentP8 = buildAdmissionInput(3, { compact: true });
    assert.equal((await persistence.persistDurably(divergentConcurrentInput.p7_durable_record)).persistence_result.outcome, 'CREATED');
    assert.equal((await admission.admitDurably({
      p7_durable_record: divergentConcurrentInput.p7_durable_record,
      p8_admission_decision: divergentP8.p8_admission_decision
    })).admission_result.outcome, 'ADMITTED');
    const divergentResults = await Promise.all([
      adapter.acquireDurably(acquisitionInput(divergentConcurrentInput)),
      adapter.acquireDurably(acquisitionInput(divergentInput(divergentConcurrentInput)))
    ]);
    assert.equal(divergentResults.filter((result) => result.acquisition_result.outcome === 'CREATED').length, 1);
    assert.equal(divergentResults.filter((result) => result.acquisition_result.outcome === 'CONFLICT').length, 1);
    const divergentCount = await pool.query(`SELECT count(*)::int AS count FROM ${TEST_CLAIMS} WHERE attempt_durable_record_id = $1`, [divergentConcurrentInput.p7_durable_record.runtime_execution_attempt_durable_record_id]);
    assert.equal(divergentCount.rows[0].count, 1);

    const missingAttempt = await adapter.acquireDurably(acquisitionInput(buildAcquisitionInput(4)));
    assert.equal(missingAttempt.acquisition_result.outcome, 'NOT_FOUND');
  } finally {
    await bounded(pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`), 'cleanup_schema');
    await bounded(pool.end(), 'close_pool');
  }
});

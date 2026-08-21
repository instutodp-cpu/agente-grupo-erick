'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
  computeRuntimeExecutionJobMaterializationDigest,
  computeRuntimeExecutionJobMaterializationFingerprint
} = require('../src/core/runtime-execution-job-materialization');
const {
  EXTERNAL_EFFECT_AUTHORIZATION_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
  RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
  RUNTIME_EXECUTION_JOB_INTENT_STATE,
  RUNTIME_EXECUTION_JOB_INTENT_STATUS,
  RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION
} = require('../src/core/runtime-execution-job-intent');
const { cloneFrozen, stablePayload } = require('../src/core/agent-identity-contract');
const { computeCanonicalContentDigest } = require('../src/core/canonical-content-digest');
const { buildDurableJobRecord } = require('../src/core/runtime-execution-job-durable-contract');
const {
  CONNECTION_TIMEOUT_MS,
  INSERT_SQL,
  POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME,
  POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION,
  READINESS_SQL,
  RuntimeExecutionJobPostgresAdmissionError,
  buildPersistenceProof,
  createRuntimeExecutionJobAdmissionPostgres,
  rowToDurableRecord,
  validatePersistenceProof
} = require('../src/adapters/postgres/runtime-execution-job-admission-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/003_create_execution_jobs.sql');
const ADAPTER_PATH = path.resolve(__dirname, '../src/adapters/postgres/runtime-execution-job-admission-postgres.js');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const SHA = (digit) => `sha256:${digit.repeat(64)}`;

function buildCompactMaterialization() {
  const identityScope = {
    actor_id: 'actor-001',
    agent_id: 'agent-1',
    organization_id: 'tenant-a:org-1',
    project_id: 'proj-1',
    session_reference_id: 'session-1',
    tenant_id: 'tenant-a'
  };
  const runtimeExecutionJobIntentReference = {
    id: 'runtime-execution-job-intent-p3b-compact',
    version: 1,
    fingerprint: 'compact-intent-fingerprint',
    digest: SHA('1')
  };
  const dispatchPackageReference = {
    id: 'runtime-dispatch-package-p3b-compact',
    version: 1,
    fingerprint: 'compact-dispatch-fingerprint',
    digest: SHA('2')
  };
  const idempotencyReference = {
    fingerprint: 'compact-idempotency-fingerprint',
    validated: true,
    consumed: false,
    duplicate_execution_blocked: true
  };
  const upstreamReferenceIds = Object.fromEntries([
    'dispatch_order_reference_id', 'runtime_dispatch_replay_reference_id',
    'runtime_dispatch_request_id', 'runtime_execution_package_id',
    'runtime_scheduler_decision_id', 'runtime_scheduler_package_id',
    'runtime_scheduler_request_id', 'runtime_scheduler_result_id',
    'runtime_worker_assignment_decision_id', 'runtime_worker_assignment_package_id',
    'runtime_worker_assignment_request_id', 'runtime_worker_assignment_result_id'
  ].map((field) => [field, `compact-upstream-id-${field}`]));
  const upstreamFingerprints = Object.fromEntries([
    'capacity_snapshot_fingerprint', 'concurrency_fingerprint',
    'dispatch_order_fingerprint', 'dispatch_replay_fingerprint',
    'freshness_fingerprint', 'idempotency_fingerprint',
    'registry_snapshot_fingerprint', 'runtime_budget_fingerprint',
    'runtime_execution_package_digest', 'runtime_execution_package_fingerprint',
    'scheduler_package_digest', 'scheduler_package_fingerprint',
    'worker_assignment_package_digest', 'worker_assignment_package_fingerprint'
  ].map((field) => [field, `compact-upstream-${field}`]));
  const authorizationReferenceIds = [
    'compact-dispatch-approval-gate-0',
    'compact-dispatch-approval-gate-1'
  ];
  const provenanceReference = {
    upstream_reference_ids: upstreamReferenceIds,
    upstream_fingerprints: upstreamFingerprints,
    dispatch_provenance_digest: SHA('3'),
    authorization_reference_ids: authorizationReferenceIds,
    authorization_reference_fingerprints: authorizationReferenceIds.map((_, index) => `compact-auth-fingerprint-${index}`)
  };
  const jobIdentity = {
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    runtime_execution_job_intent_reference: runtimeExecutionJobIntentReference,
    dispatch_package_reference: dispatchPackageReference,
    identity_scope: identityScope,
    idempotency_fingerprint: idempotencyReference.fingerprint,
    dispatch_provenance_digest: provenanceReference.dispatch_provenance_digest
  };
  const jobReference = {
    id: `runtime-execution-job-${computeCanonicalContentDigest(jobIdentity).slice('sha256:'.length)}`,
    version: 1,
    fingerprint: stablePayload(jobIdentity),
    digest: computeCanonicalContentDigest(jobIdentity)
  };
  const materialization = {
    runtime_execution_job_materialization_id: 'runtime-execution-job-materialization-p3b-compact',
    runtime_execution_job_materialization_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VERSION,
    runtime_execution_job_materialization_fingerprint: 'pending',
    runtime_execution_job_materialization_digest: 'pending',
    contract_name: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_NAME,
    contract_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_CONTRACT_VERSION,
    status: RUNTIME_EXECUTION_JOB_MATERIALIZATION_STATUS,
    input_contract_name: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_NAME,
    input_contract_version: RUNTIME_EXECUTION_JOB_INTENT_CONTRACT_VERSION,
    input_validator_version: RUNTIME_EXECUTION_JOB_INTENT_VALIDATOR_VERSION,
    input_status: RUNTIME_EXECUTION_JOB_INTENT_STATUS,
    input_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    input_external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    runtime_execution_job_intent_reference: runtimeExecutionJobIntentReference,
    job_reference: jobReference,
    dispatch_package_reference: dispatchPackageReference,
    provenance_reference: provenanceReference,
    identity_scope: identityScope,
    idempotency_reference: idempotencyReference,
    execution_job_state: RUNTIME_EXECUTION_JOB_INTENT_STATE,
    external_effect_authorization_state: EXTERNAL_EFFECT_AUTHORIZATION_STATE,
    execution_authorized: false,
    external_effect_allowed: false,
    provider_call_allowed: false,
    network_call_allowed: false,
    secrets_materialized: false,
    attempt_created: false,
    execution_performed: false,
    durable_job_persisted: false,
    output_persisted: false,
    simulation: true,
    production_blocked: true,
    validator_version: RUNTIME_EXECUTION_JOB_MATERIALIZATION_VALIDATOR_VERSION
  };
  materialization.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(materialization);
  materialization.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(materialization);
  return cloneFrozen(materialization);
}

const BASE_MATERIALIZATION = buildCompactMaterialization();
// Building a durable record canonicalizes the complete dispatch package. Keep
// one immutable baseline for the deterministic adapter tests so the suite does
// not repeat that expensive work for every corruption/proof scenario.
const BASE_RECORD = buildDurableJobRecord(BASE_MATERIALIZATION);

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
const TEST_OPERATION_TIMEOUT_MS = 30000;

function boundedTestOperation(operation, label) {
  let timer;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), TEST_OPERATION_TIMEOUT_MS);
    timer.unref?.();
  });
  return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
}

function changedScope(materialization, field, value) {
  const output = JSON.parse(JSON.stringify(materialization));
  output.identity_scope[field] = value;
  const identity = {
    contract_name: output.contract_name,
    contract_version: output.contract_version,
    runtime_execution_job_intent_reference: output.runtime_execution_job_intent_reference,
    dispatch_package_reference: output.dispatch_package_reference,
    identity_scope: output.identity_scope,
    idempotency_fingerprint: output.idempotency_reference.fingerprint,
    dispatch_provenance_digest: output.provenance_reference.dispatch_provenance_digest
  };
  const fingerprint = stablePayload(identity);
  const digest = computeCanonicalContentDigest(identity);
  output.job_reference = {
    id: `runtime-execution-job-${digest.slice('sha256:'.length)}`,
    version: 1,
    fingerprint,
    digest
  };
  output.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(output);
  output.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(output);
  return cloneFrozen(output);
}

function changedMaterializationReference(materialization, value) {
  const output = JSON.parse(JSON.stringify(materialization));
  output.runtime_execution_job_materialization_id = `runtime-execution-job-materialization-${value}`;
  output.runtime_execution_job_materialization_fingerprint = computeRuntimeExecutionJobMaterializationFingerprint(output);
  output.runtime_execution_job_materialization_digest = computeRuntimeExecutionJobMaterializationDigest(output);
  return cloneFrozen(output);
}

function rowFromRecord(record) {
  return {
    job_reference_id: record.job_reference.id,
    tenant_id: record.identity_scope.tenant_id,
    organization_id: record.identity_scope.organization_id,
    project_id: record.identity_scope.project_id,
    session_reference_id: record.identity_scope.session_reference_id,
    agent_id: record.identity_scope.agent_id,
    actor_id: record.identity_scope.actor_id,
    logical_identity_digest: record.logical_job_identity.digest,
    idempotency_fingerprint: record.idempotency_reference.fingerprint,
    record_fingerprint: record.runtime_execution_job_durable_fingerprint,
    record_digest: record.runtime_execution_job_durable_digest,
    admission_reference_id: record.admission_reference.id,
    revision: 1,
    state: record.state,
    contract_version: record.contract_version,
    schema_version: 3,
    durable_record: record
  };
}

function readinessResponse() {
  return {
    rows: [{
      schema_exists: true,
      table_exists: true,
      columns_exist: true,
      critical_types_exist: true,
      primary_key_exists: true,
      logical_key_exists: true,
      idempotency_key_exists: true,
      schema_version_check_exists: true
    }]
  };
}

test('P3B migration is versioned, transactional, scoped and contains no execution tables', () => {
  assert.match(migration, /BEGIN;/);
  assert.match(migration, /CREATE SCHEMA IF NOT EXISTS hermes;/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.execution_jobs/);
  assert.match(migration, /COMMIT;\s*$/);
  assert.match(migration, /job_reference_id TEXT PRIMARY KEY/);
  assert.match(migration, /durable_record JSONB NOT NULL/);
  assert.match(migration, /CONSTRAINT execution_jobs_logical_identity_key/);
  assert.match(migration, /CONSTRAINT execution_jobs_idempotency_key/);
  assert.match(migration, /CHECK \(schema_version = 3\)/);
  assert.doesNotMatch(migration, /attempt|claim|lease|fencing|worker|executor|provider/i);
  assert.doesNotMatch(migration, /postgres(?:ql)?:\/\/|DATABASE_URL|password\s*=|secret\s*=/i);
});

test('P3B adapter is pool-injected and has no environment or external effect wiring', () => {
  const source = fs.readFileSync(ADAPTER_PATH, 'utf8');
  assert.doesNotMatch(source, /process\.env|require\(['"]pg['"]\)/);
  assert.doesNotMatch(source, /\b(?:fetch|axios|http|https|worker|executor|provider|secret)\b/i);
  assert.match(source, /createRuntimeExecutionJobAdmissionPostgres\(\{ pool \}/);
});

test('persistence proof is deterministic, frozen and separate from P3A', () => {
  const record = BASE_RECORD;
  const proof = buildPersistenceProof('CREATED', record, true, true);
  assert.equal(proof.contract_name, POSTGRES_PERSISTENCE_PROOF_CONTRACT_NAME);
  assert.equal(proof.contract_version, POSTGRES_PERSISTENCE_PROOF_CONTRACT_VERSION);
  assert.equal(proof.write_performed, true);
  assert.equal(proof.candidate_semantics_persisted, true);
  assert.equal(proof.canonical_record_persisted, true);
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(validatePersistenceProof(proof).valid, true);
  assert.equal(record.durable_job_persisted, false);
  assert.doesNotMatch(JSON.stringify(proof), /DATABASE_URL|password|secret|token|hostname|pid/i);
});

test('invalid input is rejected before any database access', async () => {
  let calls = 0;
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: {
      query: async () => { calls += 1; throw new Error('must not query'); },
      connect: async () => { calls += 1; throw new Error('must not connect'); }
    }
  });
  const durable = await adapter.admitDurably({ invalid: true });
  assert.equal(durable.admission_result.outcome, 'REJECTED');
  assert.equal(durable.persistence_proof, null);
  assert.equal(calls, 0);
});

test('readiness is single-flight across concurrent admissions', async () => {
  let readinessCalls = 0;
  let releaseReadiness;
  const readinessGate = new Promise((resolve) => { releaseReadiness = resolve; });
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: {
      async query(sql) {
        assert.equal(sql, READINESS_SQL);
        readinessCalls += 1;
        await readinessGate;
        return {
          rows: [{
            schema_exists: true,
            table_exists: true,
            columns_exist: true,
            critical_types_exist: true,
            primary_key_exists: true,
            logical_key_exists: true,
            idempotency_key_exists: true,
            schema_version_check_exists: true
          }]
        };
      },
      async connect() {
        throw new Error('stop-after-readiness');
      }
    }
  });
  const callers = Array.from({ length: 20 }, () => adapter.admitDurably(BASE_MATERIALIZATION));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(readinessCalls, 1);
  releaseReadiness();
  const outcomes = await boundedTestOperation(Promise.allSettled(callers), 'single_flight_callers');
  assert.equal(outcomes.every((outcome) => outcome.status === 'rejected'), true);
  assert.equal(outcomes.every((outcome) => outcomes[0].reason.code === outcome.reason.code), true);
});

test('failed readiness is not cached and the next attempt can recover', async () => {
  let readinessCalls = 0;
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: {
      async query(sql) {
        assert.equal(sql, READINESS_SQL);
        readinessCalls += 1;
        if (readinessCalls === 1) throw Object.assign(new Error('readiness timeout'), { code: '57014' });
        return readinessResponse();
      },
      async connect() { throw new Error('stop-after-recovered-readiness'); }
    }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'TIMEOUT');
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'POSTGRES_ADMISSION_FAILED');
  assert.equal(readinessCalls, 2);
});

test('BEGIN failure releases the acquired client', async () => {
  let releases = 0;
  const client = {
    async query(sql) {
      assert.equal(sql, 'BEGIN');
      throw new Error('begin failed');
    },
    release() { releases += 1; }
  };
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: { async query() { return readinessResponse(); }, async connect() { return client; } }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'POSTGRES_ADMISSION_FAILED');
  assert.equal(releases, 1);
});

test('query failure after BEGIN rolls back and releases the client', async () => {
  let rollback = 0;
  let releases = 0;
  const client = {
    async query(sql) {
      if (sql === 'BEGIN' || sql.startsWith('SET LOCAL ')) return { rows: [] };
      if (sql === INSERT_SQL) throw Object.assign(new Error('statement timeout'), { code: '57014' });
      if (sql === 'ROLLBACK') { rollback += 1; return { rows: [] }; }
      throw new Error(`unexpected query ${sql}`);
    },
    release() { releases += 1; }
  };
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: { async query() { return readinessResponse(); }, async connect() { return client; } }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'TIMEOUT');
  assert.equal(rollback, 1);
  assert.equal(releases, 1);
});

test('connection timeout is bounded and returns a sanitized infrastructure failure', async () => {
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: {
      async query() { return readinessResponse(); },
      async connect() { return new Promise(() => {}); }
    }
  });
  const started = Date.now();
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'TIMEOUT');
  assert.equal(Date.now() - started < CONNECTION_TIMEOUT_MS + 2000, true);
});

test('PostgreSQL lock timeout is classified as a bounded timeout', async () => {
  let rollback = 0;
  let releases = 0;
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.includes('lock_timeout')) throw Object.assign(new Error('lock not available'), { code: '55P03' });
      if (sql === 'ROLLBACK') { rollback += 1; return { rows: [] }; }
      throw new Error(`unexpected query ${sql}`);
    },
    release() { releases += 1; }
  };
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: { async query() { return readinessResponse(); }, async connect() { return client; } }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'TIMEOUT');
  assert.equal(rollback, 1);
  assert.equal(releases, 1);
});

test('PostgreSQL statement timeout is classified as a bounded timeout', async () => {
  let rollback = 0;
  let releases = 0;
  const client = {
    async query(sql) {
      if (sql === 'BEGIN' || sql.includes('lock_timeout')) return { rows: [] };
      if (sql.includes('statement_timeout')) throw Object.assign(new Error('statement timeout'), { code: '57014' });
      if (sql === 'ROLLBACK') { rollback += 1; return { rows: [] }; }
      throw new Error(`unexpected query ${sql}`);
    },
    release() { releases += 1; }
  };
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: { async query() { return readinessResponse(); }, async connect() { return client; } }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error.code === 'TIMEOUT');
  assert.equal(rollback, 1);
  assert.equal(releases, 1);
});

test('row reconstruction rejects typed-column and P3A corruption', () => {
  const record = BASE_RECORD;
  const row = rowFromRecord(record);
  assert.equal(rowToDurableRecord(row).runtime_execution_job_durable_digest, record.runtime_execution_job_durable_digest);
  assert.throws(() => rowToDurableRecord({ ...row, record_digest: 'sha256:' + '0'.repeat(64) }), /typed_record_digest_mismatch/);
  const corrupt = { ...row, durable_record: { ...row.durable_record, state: 'CORRUPTED' } };
  assert.throws(() => rowToDurableRecord(corrupt), (error) => error.code === 'CORRUPT_ROW');
});

test('unknown commit outcome is fail-closed without positive proof', async () => {
  const record = BASE_RECORD;
  let rollbackCalled = false;
  const client = {
    async query(sql) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql.startsWith('SET LOCAL ')) return { rows: [] };
      if (sql === INSERT_SQL) return { rows: [rowFromRecord(record)] };
      if (sql === 'COMMIT') throw new Error('commit connection lost');
      if (sql === 'ROLLBACK') { rollbackCalled = true; return { rows: [] }; }
      throw new Error(`unexpected query ${sql}`);
    },
    release() {}
  };
  const adapter = createRuntimeExecutionJobAdmissionPostgres({
    pool: {
      async query(sql) {
        assert.equal(sql, READINESS_SQL);
        return { rows: [{ schema_exists: true, table_exists: true, columns_exist: true, critical_types_exist: true, primary_key_exists: true, logical_key_exists: true, idempotency_key_exists: true, schema_version_check_exists: true }] };
      },
      async connect() { return client; }
    }
  });
  await assert.rejects(() => adapter.admitDurably(BASE_MATERIALIZATION), (error) => error instanceof RuntimeExecutionJobPostgresAdmissionError && error.code === 'UNKNOWN_COMMIT_OUTCOME');
  assert.equal(rollbackCalled, true);
});

test('real PostgreSQL P3B admission, replay, migration re-entry, recovery, scopes and concurrency', {
  timeout: TEST_OPERATION_TIMEOUT_MS,
  skip: REAL_POSTGRES_ENABLED ? false : 'SKIPPED_SAFE_NO_TEST_URL'
}, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 24 });
  const { createRuntimeExecutionJobAdmissionPostgres: createAdapter } = require('../src/adapters/postgres/runtime-execution-job-admission-postgres');
  try {
    await pool.query('DROP TABLE IF EXISTS hermes.execution_jobs');
    await pool.query(migration);
    await pool.query(migration);

    const adapter = createAdapter({ pool });
    const first = await adapter.admitDurably(BASE_MATERIALIZATION);
    assert.equal(first.admission_result.outcome, 'CREATED');
    assert.equal(first.persistence_proof.canonical_record_persisted, true);
    assert.equal(first.persistence_proof.write_performed, true);
    assert.equal(first.persistence_proof.candidate_semantics_persisted, true);
    assert.equal(adapter.validatePersistenceProof(first.persistence_proof).valid, true);
    assert.equal(first.admission_result.durable_job_persisted, false);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM hermes.execution_jobs')).rows[0].count, 1);

    const replay = await adapter.admitDurably(BASE_MATERIALIZATION);
    assert.equal(replay.admission_result.outcome, 'EXISTING_IDENTICAL');
    assert.equal(replay.persistence_proof.write_performed, false);
    assert.equal(replay.persistence_proof.candidate_semantics_persisted, true);
    assert.equal(replay.admission_result.revision, 1);
    assert.equal(replay.admission_result.job_reference.id, first.admission_result.job_reference.id);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM hermes.execution_jobs')).rows[0].count, 1);

    const divergent = await adapter.admitDurably(changedMaterializationReference(BASE_MATERIALIZATION, 'p3b-divergent'));
    assert.equal(divergent.admission_result.outcome, 'CONFLICT');
    assert.equal(divergent.persistence_proof.write_performed, false);
    assert.equal(divergent.persistence_proof.candidate_semantics_persisted, false);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM hermes.execution_jobs')).rows[0].count, 1);

    const restarted = createAdapter({ pool });
    const recovered = await restarted.admit(BASE_MATERIALIZATION);
    assert.equal(recovered.outcome, 'EXISTING_IDENTICAL');

    const concurrentIdentity = changedScope(BASE_MATERIALIZATION, 'project_id', 'project-p3b-concurrent-identical');
    const identicalResults = await boundedTestOperation(
      Promise.all(Array.from({ length: 20 }, () => adapter.admitDurably(concurrentIdentity))),
      'identical_concurrency'
    );
    assert.equal(identicalResults.filter((value) => value.admission_result.outcome === 'CREATED').length, 1);
    assert.equal(identicalResults.filter((value) => value.admission_result.outcome === 'EXISTING_IDENTICAL').length, 19);
    assert.equal(identicalResults.filter((value) => value.admission_result.outcome === 'CONFLICT').length, 0);

    const divergentBase = changedScope(BASE_MATERIALIZATION, 'project_id', 'project-p3b-concurrent-divergent');
    const divergentCandidate = changedMaterializationReference(divergentBase, 'p3b-concurrent-divergent');
    const divergentResults = await boundedTestOperation(
      Promise.all(Array.from({ length: 20 }, (_, index) => adapter.admitDurably(index % 2 === 0 ? divergentBase : divergentCandidate))),
      'divergent_concurrency'
    );
    const createdCount = divergentResults.filter((value) => value.admission_result.outcome === 'CREATED').length;
    const existingIdenticalCount = divergentResults.filter((value) => value.admission_result.outcome === 'EXISTING_IDENTICAL').length;
    const conflictCount = divergentResults.filter((value) => value.admission_result.outcome === 'CONFLICT').length;
    const unexpectedCount = divergentResults.filter((value) => !['CREATED', 'EXISTING_IDENTICAL', 'CONFLICT'].includes(value.admission_result.outcome)).length;
    assert.equal(createdCount, 1);
    assert.equal(existingIdenticalCount, 9);
    assert.equal(conflictCount, 10);
    assert.equal(createdCount + existingIdenticalCount + conflictCount, 20);
    assert.equal(unexpectedCount, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS count FROM hermes.execution_jobs')).rows[0].count, 3);

    const scopedReplay = await adapter.admit(changedScope(BASE_MATERIALIZATION, 'project_id', 'project-p3b-concurrent-identical'));
    assert.equal(scopedReplay.outcome, 'EXISTING_IDENTICAL');

    await pool.query(`UPDATE hermes.execution_jobs
      SET durable_record = jsonb_set(durable_record, '{state}', '"CORRUPTED"'::jsonb)
      WHERE job_reference_id = $1`, [first.admission_result.job_reference.id]);
    await assert.rejects(() => restarted.admit(BASE_MATERIALIZATION), (error) => error.code === 'CORRUPT_ROW');
  } finally {
    try {
      await boundedTestOperation(pool.query('DROP TABLE IF EXISTS hermes.execution_jobs'), 'cleanup_drop');
    } catch { /* cleanup is bounded; preserve the primary test result */ }
    try {
      await boundedTestOperation(pool.end(), 'cleanup_pool_end');
    } catch { /* cleanup is bounded; preserve the primary test result */ }
  }
});

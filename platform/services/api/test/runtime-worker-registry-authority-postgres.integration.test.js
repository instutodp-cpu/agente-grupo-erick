'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildWorkerRegistration } = require('../src/core/runtime-worker-registry-contract');
const { createRuntimeWorkerRegistryPostgres } = require('../src/adapters/postgres/runtime-worker-registry-postgres');

const MIGRATION_PATH = path.resolve(__dirname, '../../../migrations/hermes/009_create_runtime_workers.sql');
const migration = fs.readFileSync(MIGRATION_PATH, 'utf8');
const TEST_DATABASE_URL = process.env.HERMES_POSTGRES_TEST_DATABASE_URL;
const TEST_SCHEMA = 'hermes_runtime_workers_p13a_test';
const TABLE = `${TEST_SCHEMA}.runtime_workers`;

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
    .replaceAll('hermes.runtime_workers', TABLE);
}

function input(overrides = {}) {
  return buildWorkerRegistration({
    worker_id: 'worker-authority-1',
    tenant_id: 'tenant-1',
    organization_id: 'organization-1',
    project_id: 'project-1',
    worker_type: 'DEDICATED_REFERENCE',
    lifecycle_state: 'ACTIVE',
    worker_capability_reference_id: 'capability-1',
    worker_compatibility_reference_ids: ['compatibility-1'],
    supported_stage_types: ['MODEL'],
    supported_modalities: ['TEXT'],
    supported_model_provider_ids: ['prov1'],
    supported_model_ids: ['mdl1'],
    supported_tool_ids: [],
    supported_workflow_ids: [],
    ...overrides
  });
}

const registrationAuthority = async () => true;

test('real PostgreSQL P13A registry creates, replays, conflicts, scopes and serializes registrations', { skip: !safeDatabaseUrl(TEST_DATABASE_URL) }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 20, connectionTimeoutMillis: 5000 });
  try {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.query(isolatedMigration(migration));
    await pool.query(isolatedMigration(migration));

    const registry = createRuntimeWorkerRegistryPostgres({ pool, tableName: TABLE, authorizeRegistration: registrationAuthority });
    const worker = input();
    const created = await registry.registerWorker(worker);
    assert.equal(created.outcome, 'CREATED');
    assert.equal(created.registry_authority_created, true);
    assert.equal(created.worker.lifecycle_state, 'ACTIVE');

    const lookedUp = await registry.getWorker({ workerId: worker.worker_id, tenantId: worker.tenant_id, organizationId: worker.organization_id, projectId: worker.project_id });
    assert.equal(lookedUp.outcome, 'EXISTING_IDENTICAL');
    assert.deepEqual(lookedUp.worker, created.worker);

    const replay = await registry.registerWorker(worker);
    assert.equal(replay.outcome, 'EXISTING_IDENTICAL');
    assert.deepEqual(replay.worker, created.worker);

    const conflict = await registry.registerWorker(input({ worker_type: 'REMOTE_REFERENCE' }));
    assert.equal(conflict.outcome, 'CONFLICT');
    assert.equal(conflict.worker.canonical_digest, created.worker.canonical_digest);

    const scopeMismatch = await registry.getWorker({ workerId: worker.worker_id, tenantId: 'other-tenant', organizationId: worker.organization_id, projectId: worker.project_id });
    assert.equal(scopeMismatch.outcome, 'INVALID');
    assert.equal(scopeMismatch.reason_code, 'worker_scope_mismatch');

    const disabled = await registry.transitionLifecycle({ workerId: worker.worker_id, expectedState: 'ACTIVE', nextState: 'DISABLED' });
    assert.equal(disabled.outcome, 'UPDATED');
    assert.equal(disabled.worker.lifecycle_state, 'DISABLED');
    assert.equal(disabled.worker.canonical_digest, created.worker.canonical_digest);
    const replayAfterDisable = await registry.registerWorker(worker);
    assert.equal(replayAfterDisable.outcome, 'EXISTING_IDENTICAL');
    assert.equal(replayAfterDisable.worker.lifecycle_state, 'DISABLED');

    const concurrentIdentical = await Promise.all(Array.from({ length: 8 }, () => registry.registerWorker(input({ worker_id: 'worker-concurrent-identical' }))));
    assert.equal(concurrentIdentical.filter((entry) => entry.outcome === 'CREATED').length, 1);
    assert.equal(concurrentIdentical.filter((entry) => entry.outcome === 'EXISTING_IDENTICAL').length, 7);
    assert.equal(concurrentIdentical.filter((entry) => entry.outcome === 'CONFLICT').length, 0);

    const concurrentDivergent = await Promise.all([
      registry.registerWorker(input({ worker_id: 'worker-concurrent-divergent', worker_type: 'DEDICATED_REFERENCE' })),
      registry.registerWorker(input({ worker_id: 'worker-concurrent-divergent', worker_type: 'REMOTE_REFERENCE' }))
    ]);
    assert.equal(concurrentDivergent.filter((entry) => entry.outcome === 'CREATED').length, 1);
    assert.equal(concurrentDivergent.filter((entry) => entry.outcome === 'CONFLICT').length, 1);
    const physical = await pool.query(`SELECT count(*)::int AS count FROM ${TABLE} WHERE worker_id IN ('worker-authority-1', 'worker-concurrent-identical', 'worker-concurrent-divergent')`);
    assert.equal(physical.rows[0].count, 3);

    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'runtime_workers'
      ORDER BY ordinal_position
    `, [TEST_SCHEMA]);
    const names = columns.rows.map((row) => row.column_name);
    assert.equal(names.includes('worker_id'), true);
    assert.equal(names.some((name) => /claim|lease|fenc|execution|selection|binding|ownership|capacity|queue/i.test(name)), false);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
    await pool.end();
  }
});

test('P13A requires an explicit trusted registration boundary', async () => {
  const fakePool = { connect: async () => { throw new Error('database_should_not_be_touched'); } };
  const registry = createRuntimeWorkerRegistryPostgres({ pool: fakePool });
  const result = await registry.registerWorker(input());
  assert.equal(result.outcome, 'INVALID');
  assert.equal(result.reason_code, 'registration_authority_required');
});

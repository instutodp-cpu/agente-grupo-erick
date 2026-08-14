'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const { buildHermesVpsExecutionAuthorization } = require('../src/core/hermes-vps-execution-authorization-contract');
const {
  createDurableLifecycleReceipt,
  createDeterministicDurableLifecycleTestStore,
  createHermesVpsDurableAuthorizationLifecycleRegistry
} = require('../src/core/hermes-vps-durable-authorization-lifecycle-registry');
const {
  INSERT_SQL,
  SELECT_FOR_UPDATE_SQL,
  SELECT_SQL,
  UPDATE_SQL,
  createPostgresHermesVpsAuthorizationLifecyclePersistence,
  createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv
} = require('../src/core/hermes-vps-postgres-authorization-lifecycle-persistence');

const provenance = { repository: 'instutodp-cpu/agente-grupo-erick', branch: 'hermes/vps-durable-authorization-lifecycle-registry-v1', commit_sha: 'a815b28f425de85bc9abbb518f458ab984b6310e' };
const bootstrap = buildHermesVpsBootstrapContract({ provenance });
const plan = buildHermesVpsProvisioningPlan({ bootstrap_contract: bootstrap });

function authorization(id = 'authorization-A', overrides = {}) {
  return buildHermesVpsExecutionAuthorization({
    provisioning_plan: plan,
    authorization_id: id,
    issued_at: '2026-08-12T10:00:00.000Z',
    expires_at: '2026-08-12T10:05:00.000Z',
    issued_by: { authority_id: 'owner-1', authority_type: 'human_owner' },
    target_id: 'approved-staging-host-reference',
    phase_ids: ['P0_HOST_VALIDATION'],
    step_ids: ['validate_host'],
    provenance,
    ...overrides
  });
}

function context(overrides = {}) {
  return { execution_scope: { phase_id: 'P0_HOST_VALIDATION', step_id: 'validate_host' }, now: '2026-08-12T10:01:00.000Z', ...overrides };
}

function lifecycleFixture() {
  const store = createDeterministicDurableLifecycleTestStore();
  const registry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: store });
  assert.equal(registry.registerAuthorization(authorization()).status, 'REGISTERED');
  return { store, registry, entry: store.inspect('authorization-A'), receipt: store.read('authorization-A').receipt };
}

function rowFrom(entry, receipt, revision = 0) {
  return {
    authorization_id: entry.authorization_id,
    authorization_payload: entry.authorization,
    authorization_hash: entry.authorization.authorization_hash,
    provisioning_plan_version: entry.authorization.provisioning_plan_reference.plan_version,
    provisioning_plan_hash: entry.authorization.provisioning_plan_hash,
    execution_scope: entry.authorization.execution_scope,
    state: entry.state,
    sequence: String(entry.sequence),
    revision: String(revision),
    consumption_reference: entry.consumption_reference,
    revocation_reference: entry.revocation_reference,
    fingerprint: entry.fingerprint,
    receipt_reference: receipt.receipt_reference,
    receipt_hash: receipt.receipt_hash,
    created_at: '2026-08-12T10:00:00.000Z',
    updated_at: '2026-08-12T10:00:00.000Z'
  };
}

class ScriptedClient {
  constructor(pool) {
    this.pool = pool;
    this.released = false;
  }

  async query(sql, params) {
    this.pool.queries.push({ sql, params });
    const response = this.pool.next(sql);
    if (response instanceof Error) throw response;
    return response;
  }

  release() {
    this.released = true;
  }
}

class ScriptedPool {
  constructor({ transactionResponses = [], readResponse, connectErrors = [], queryErrors = [], transactionScripts = [] } = {}) {
    this.transactionResponses = [...transactionResponses];
    this.readResponse = readResponse;
    this.connectErrors = [...connectErrors];
    this.queryErrors = [...queryErrors];
    this.transactionScripts = [...transactionScripts];
    this.queries = [];
    this.clients = [];
  }

  async connect() {
    if (this.connectErrors.length) throw this.connectErrors.shift();
    const script = this.transactionScripts.length ? this.transactionScripts.shift() : null;
    const client = new ScriptedClient(this);
    client.script = script;
    this.clients.push(client);
    return client;
  }

  async query(sql, params) {
    this.queries.push({ sql, params });
    if (this.queryErrors.length) throw this.queryErrors.shift();
    if (sql === SELECT_SQL) return this.readResponse || { rows: [] };
    throw new Error(`unexpected_pool_query:${sql}`);
  }

  next(sql) {
    if (sql === 'BEGIN') return { rows: [] };
    if (sql === 'ROLLBACK') return { rows: [] };
    if (sql === 'COMMIT') {
      if (this.transactionResponses.length) return this.transactionResponses.shift();
      return { rows: [] };
    }
    if (this.transactionResponses.length) return this.transactionResponses.shift();
    throw new Error(`missing_scripted_response:${sql}`);
  }
}

function adapterFor(pool, options = {}) {
  return createPostgresHermesVpsAuthorizationLifecyclePersistence({ pool, provisioning_plan: plan, ...options });
}

test('production factory requires durable configuration and never selects Map', () => {
  assert.throws(() => createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv({ env: {}, PoolClass: class {} }), /configuration_missing/);
  class FakePool {
    constructor(options) { this.options = options; }
  }
  const configured = createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv({ env: { HERMES_DURABLE_DATABASE_URL: 'test-only-placeholder' }, PoolClass: FakePool });
  assert.equal(configured.pool.options.connectionString, 'test-only-placeholder');
  assert.deepEqual(configured.pool.options.ssl, { rejectUnauthorized: true });
  assert.equal(configured.pool.options.max, 4);
});

test('read reconstructs lifecycle and receipt from the PR-B row', async () => {
  const fixture = lifecycleFixture();
  const pool = new ScriptedPool({ readResponse: { rows: [rowFrom(fixture.entry, fixture.receipt)] } });
  const outcome = await adapterFor(pool).read('authorization-A');
  assert.equal(outcome.status, 'READ');
  assert.deepEqual(outcome.entry, fixture.entry);
  assert.deepEqual(outcome.receipt, fixture.receipt);
  assert.equal(pool.queries[0].sql, SELECT_SQL);
});

test('malformed lifecycle or receipt rows fail closed instead of becoming not found', async () => {
  const fixture = lifecycleFixture();
  const row = rowFrom(fixture.entry, fixture.receipt);
  row.receipt_hash = 'corrupted';
  const pool = new ScriptedPool({ readResponse: { rows: [row] } });
  const outcome = await adapterFor(pool).read('authorization-A');
  assert.equal(outcome.status, 'READ_FAILED');
});

test('insert persists lifecycle and receipt in one transaction', async () => {
  const fixture = lifecycleFixture();
  const pool = new ScriptedPool({ transactionResponses: [{ rows: [rowFrom(fixture.entry, fixture.receipt)] }, { rows: [] }] });
  const outcome = await adapterFor(pool).insert(fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'INSERTED');
  assert.deepEqual(outcome.receipt, fixture.receipt);
  assert.equal(pool.queries[0].sql, 'BEGIN');
  assert.equal(pool.queries.some((query) => query.sql === INSERT_SQL), true);
  assert.equal(pool.queries.at(-1).sql, 'COMMIT');
});

test('duplicate identity returns the durable row for deterministic replay/conflict classification', async () => {
  const fixture = lifecycleFixture();
  const pool = new ScriptedPool({ transactionResponses: [
    { rows: [] },
    { rows: [rowFrom(fixture.entry, fixture.receipt)] },
    { rows: [] }
  ] });
  const outcome = await adapterFor(pool).insert(fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'CONFLICT');
  assert.deepEqual(outcome.entry, fixture.entry);
  assert.deepEqual(outcome.receipt, fixture.receipt);
  assert.equal(pool.queries.some((query) => query.sql === SELECT_FOR_UPDATE_SQL), true);
});

test('compareAndConsume uses fingerprint/revision CAS and persists receipt atomically', async () => {
  const fixture = lifecycleFixture();
  const consumed = { ...fixture.entry, state: 'CONSUMED', sequence: 1, consumption_reference: { authorization_id: 'authorization-A', reference_id: 'consume-A' }, fingerprint: 'pending' };
  const { computeLifecycleFingerprint } = require('../src/core/hermes-vps-authorization-lifecycle-registry');
  consumed.fingerprint = computeLifecycleFingerprint(consumed);
  const consumedReceipt = fixture.registry.consumeAuthorization('authorization-A', context({ reference_id: 'consume-A' })).receipt;
  const pool = new ScriptedPool({ transactionResponses: [
    { rows: [rowFrom(fixture.entry, fixture.receipt)] },
    { rows: [rowFrom(consumed, consumedReceipt, 1)] },
    { rows: [] }
  ] });
  const outcome = await adapterFor(pool).compareAndConsume('authorization-A', fixture.entry.fingerprint, consumed, consumedReceipt);
  assert.equal(outcome.status, 'CONSUMED');
  assert.equal(pool.queries.some((query) => query.sql === UPDATE_SQL), true);
  assert.match(pool.queries.find((query) => query.sql === UPDATE_SQL).sql, /fingerprint = \$10/);
});

test('revoke uses the same atomic CAS boundary', async () => {
  const fixture = lifecycleFixture();
  const revoked = { ...fixture.entry, state: 'REVOKED', sequence: 1, revocation_reference: { authorization_id: 'authorization-A', reference_id: 'revoke-A' }, fingerprint: 'pending' };
  const { computeLifecycleFingerprint } = require('../src/core/hermes-vps-authorization-lifecycle-registry');
  revoked.fingerprint = computeLifecycleFingerprint(revoked);
  const revokedReceipt = fixture.registry.revokeAuthorization('authorization-A', 'revoke-A').receipt;
  const pool = new ScriptedPool({ transactionResponses: [
    { rows: [rowFrom(fixture.entry, fixture.receipt)] },
    { rows: [rowFrom(revoked, revokedReceipt, 1)] },
    { rows: [] }
  ] });
  const outcome = await adapterFor(pool).revoke('authorization-A', fixture.entry.fingerprint, revoked, revokedReceipt);
  assert.equal(outcome.status, 'REVOKED');
});

test('stale fingerprint and invalid transition fail closed', async () => {
  const fixture = lifecycleFixture();
  const pool = new ScriptedPool({ transactionResponses: [{ rows: [rowFrom(fixture.entry, fixture.receipt)] }, { rows: [] }] });
  const outcome = await adapterFor(pool).compareAndConsume('authorization-A', 'stale-fingerprint', fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'CONFLICT');
});

test('storage failure rolls back and does not become success', async () => {
  const error = new Error('database unavailable');
  const pool = new ScriptedPool({ connectErrors: [error] });
  const fixture = lifecycleFixture();
  const outcome = await adapterFor(pool).insert(fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'WRITE_FAILED');
  assert.equal(pool.clients.length, 0);
});

test('serialization failure retries at most the configured bound', async () => {
  const retryable = Object.assign(new Error('serialization failure'), { code: '40001' });
  const fixture = lifecycleFixture();
  const pool = new ScriptedPool({
    transactionResponses: [retryable, { rows: [rowFrom(fixture.entry, fixture.receipt)] }, { rows: [] }, { rows: [] }],
    transactionScripts: [null, null]
  });
  const outcome = await adapterFor(pool, { max_retries: 1 }).insert(fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'INSERTED');
  assert.equal(pool.clients.length, 2);
});

test('unknown commit outcome is never reported as success', async () => {
  const commitError = new Error('connection lost during commit');
  const pool = new ScriptedPool({ transactionResponses: [{ rows: [rowFrom(lifecycleFixture().entry, lifecycleFixture().receipt)] }, commitError] });
  const fixture = lifecycleFixture();
  pool.transactionResponses = [{ rows: [rowFrom(fixture.entry, fixture.receipt)] }, commitError];
  const outcome = await adapterFor(pool).insert(fixture.entry, fixture.receipt);
  assert.equal(outcome.status, 'WRITE_FAILED');
  assert.equal(outcome.error, 'unknown_commit_outcome');
});

test('Map adapter remains the explicit reference adapter and preserves async parity', async () => {
  const fixture = lifecycleFixture();
  assert.equal(fixture.store.interface_version, 'hermes-vps-authorization-lifecycle-persistence-v2');
  const adapter = {
    ...fixture.store,
    read: async (...args) => fixture.store.read(...args),
    insert: async (...args) => fixture.store.insert(...args),
    compareAndConsume: async (...args) => fixture.store.compareAndConsume(...args),
    revoke: async (...args) => fixture.store.revoke(...args)
  };
  const registry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: adapter });
  assert.equal((await registry.registerAuthorization(authorization('authorization-B'))).status, 'REGISTERED');
});

test('real PostgreSQL integration is isolated and ephemeral', { skip: !process.env.HERMES_POSTGRES_TEST_DATABASE_URL }, async () => {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.HERMES_POSTGRES_TEST_DATABASE_URL,
    ssl: process.env.HERMES_POSTGRES_TEST_SSL === 'true' ? { rejectUnauthorized: true } : false,
    max: 2
  });
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/001_create_authorization_lifecycle.sql'), 'utf8');
  try {
    await pool.query(migration);
    const first = lifecycleFixture();
    const adapter = adapterFor(pool);
    const { computeLifecycleFingerprint } = require('../src/core/hermes-vps-authorization-lifecycle-registry');
    const registration = await adapter.insert(first.entry, first.receipt);
    assert.equal(registration.status, 'INSERTED');
    const reconstructed = await adapter.read(first.entry.authorization_id);
    assert.equal(reconstructed.status, 'READ');
    assert.deepEqual(reconstructed.entry, first.entry);
    assert.deepEqual(reconstructed.receipt, first.receipt);

    const replay = await adapter.insert(first.entry, first.receipt);
    assert.equal(replay.status, 'CONFLICT');
    assert.deepEqual(replay.entry, first.entry);
    assert.deepEqual(replay.receipt, first.receipt);

    const conflicting = { ...first.entry, authorization: authorization('authorization-A', { target_id: 'different-target' }) };
    conflicting.fingerprint = computeLifecycleFingerprint(conflicting);
    const conflict = await adapter.insert(conflicting, createDurableLifecycleReceipt(conflicting, 'REGISTER', null));
    assert.equal(conflict.status, 'CONFLICT');

    const consumedRegistry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: adapter });
    const consumed = await consumedRegistry.consumeAuthorization(first.entry.authorization_id, context({ reference_id: 'consume-real' }));
    assert.equal(consumed.status, 'AUTHORIZED');
    const consumedRead = await adapter.read(first.entry.authorization_id);
    assert.equal(consumedRead.entry.state, 'CONSUMED');
    assert.equal(consumedRead.receipt.reference_id, 'consume-real');
    assert.equal(consumedRead.receipt.receipt_hash, consumed.receipt.receipt_hash);

    const revokeEntry = authorization('authorization-revoke');
    const revokeRegistry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: adapter });
    assert.equal((await revokeRegistry.registerAuthorization(revokeEntry)).status, 'REGISTERED');
    const revoked = await revokeRegistry.revokeAuthorization(revokeEntry.authorization_id, 'revoke-real');
    assert.equal(revoked.status, 'REVOKED');
    const revokedRead = await adapter.read(revokeEntry.authorization_id);
    assert.equal(revokedRead.entry.state, 'REVOKED');
    assert.equal(revokedRead.receipt.reference_id, 'revoke-real');

    const rollbackEntry = authorization('authorization-rollback');
    const rollbackRegistry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: adapter });
    assert.equal((await rollbackRegistry.registerAuthorization(rollbackEntry)).status, 'REGISTERED');
    await pool.query(`
      CREATE OR REPLACE FUNCTION hermes_test_fail_consume() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.state = 'CONSUMED' THEN RAISE EXCEPTION 'integration rollback'; END IF;
        RETURN NEW;
      END; $$;
      CREATE TRIGGER hermes_test_fail_consume_trigger
      BEFORE UPDATE ON hermes.authorization_lifecycle
      FOR EACH ROW EXECUTE FUNCTION hermes_test_fail_consume();
    `);
    try {
      const failedConsume = await rollbackRegistry.consumeAuthorization(rollbackEntry.authorization_id, context({ reference_id: 'consume-rollback' }));
      assert.equal(failedConsume.status, 'ATOMICITY_FAILED');
    } finally {
      await pool.query('DROP TRIGGER hermes_test_fail_consume_trigger ON hermes.authorization_lifecycle; DROP FUNCTION hermes_test_fail_consume();');
    }
    const rollbackRead = await adapter.read(rollbackEntry.authorization_id);
    assert.equal(rollbackRead.entry.state, 'REGISTERED');
    assert.equal(rollbackRead.receipt.event, 'REGISTER');

    const concurrentEntry = authorization('authorization-concurrent');
    const concurrentLifecycle = {
      authorization_id: concurrentEntry.authorization_id,
      authorization: concurrentEntry,
      state: 'REGISTERED',
      consumption_reference: null,
      revocation_reference: null,
      sequence: 0,
      fingerprint: 'pending'
    };
    concurrentLifecycle.fingerprint = computeLifecycleFingerprint(concurrentLifecycle);
    const realReceipt = createDurableLifecycleReceipt(concurrentLifecycle, 'REGISTER', null);
    const concurrentResults = await Promise.all([
      adapter.insert(concurrentLifecycle, realReceipt),
      adapter.insert(concurrentLifecycle, realReceipt)
    ]);
    assert.deepEqual(concurrentResults.map((value) => value.status).sort(), ['CONFLICT', 'INSERTED']);
    const count = await pool.query('SELECT count(*)::int AS count FROM hermes.authorization_lifecycle WHERE authorization_id = $1', [concurrentEntry.authorization_id]);
    assert.equal(count.rows[0].count, 1);

    const consumeEntry = authorization('authorization-consume-race');
    const raceRegistry = createHermesVpsDurableAuthorizationLifecycleRegistry({ provisioning_plan: plan, persistence: adapter });
    assert.equal((await raceRegistry.registerAuthorization(consumeEntry)).status, 'REGISTERED');
    const raceResults = await Promise.all([
      raceRegistry.consumeAuthorization(consumeEntry.authorization_id, context({ reference_id: 'consume-race-a' })),
      raceRegistry.consumeAuthorization(consumeEntry.authorization_id, context({ reference_id: 'consume-race-b' }))
    ]);
    assert.equal(raceResults.filter((value) => value.status === 'AUTHORIZED').length, 1);
    assert.equal(raceResults.some((value) => ['ALREADY_CONSUMED', 'CONFLICT'].includes(value.status)), true);
    const raceRead = await adapter.read(consumeEntry.authorization_id);
    assert.equal(raceRead.entry.state, 'CONSUMED');

    const tables = await pool.query("SELECT to_regclass('hermes.authorization_lifecycle') AS table_name");
    assert.equal(tables.rows[0].table_name, 'hermes.authorization_lifecycle');
  } finally {
    await pool.query('DROP SCHEMA IF EXISTS hermes CASCADE');
    await pool.end();
  }
});

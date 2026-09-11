'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  INSERT_SQL,
  READINESS_SQL,
  SELECT_BY_IDENTITY_SQL,
  createPostgresPublicWebCanaryAuditPersistence
} = require('../src/adapters/postgres/public-web-canary-audit-persistence-postgres');
const { createPublicWebCanaryPersistentAuditSink } = require('../src/core/public-web-canary-persistent-audit-sink');
const { MAX_PERSISTED_EVENT_BYTES, PERSISTENT_AUDIT_TABLE } = require('../src/core/public-web-canary-durable-audit-contract');
const { createPublicWebCanaryAuditSink } = require('../src/core/public-web-canary-audit-sink');
const { createPublicWebCanaryOperationalTrial } = require('../src/pilots/public-web-canary-operational-trial');
const {
  acceptedConfirmationReader,
  validPreflightContext,
  validTrialConfig
} = require('./helpers/public-web-canary-trial-test-data');

function auditEvent(overrides = {}) {
  return {
    event_name: 'public_web_canary_request_started',
    trace_id: 'trace-durable-audit',
    request_id: 'request-durable-audit',
    change_id: 'change-durable-audit',
    canary_session_id: 'session-durable-audit',
    tenant_id: 'tenant-durable-audit',
    workspace_type: 'corporate',
    user_id: 'user-durable-audit',
    operator_id: 'operator-durable-audit',
    approved_by: 'approver-durable-audit',
    operation: 'fetch_public_page_summary',
    status: 'public_web_canary_request_started',
    occurred_at: '2026-09-10T12:00:00.000Z',
    simulated: true,
    executed: false,
    real_provider_called: false,
    ...overrides
  };
}

function rowFromParams(params, createdAt = '2026-09-10T12:00:01.000Z') {
  return {
    event_id: params[0],
    event_digest: params[1],
    contract_version: params[2],
    canary_session_id: params[3],
    trace_id: params[4],
    request_id: params[5],
    change_id: params[6],
    tenant_id: params[7],
    workspace_type: params[8],
    user_id: params[9],
    operator_id: params[10],
    approved_by: params[11],
    event_name: params[12],
    event_sequence: params[13],
    occurred_at: params[14],
    event_payload: params[15],
    created_at: createdAt
  };
}

class ScriptedPool {
  constructor() {
    this.rows = [];
    this.queries = [];
  }

  async query(sql, params = []) {
    this.queries.push({ sql, params });
    if (sql === READINESS_SQL) return { rows: [{ schema_exists: true, table_exists: true, columns_exist: true }] };
    if (sql === INSERT_SQL) {
      if (this.rows.some((row) => row.event_id === params[0] || row.event_digest === params[1])) return { rows: [] };
      const row = rowFromParams(params);
      this.rows.push(row);
      return { rows: [row] };
    }
    if (sql === SELECT_BY_IDENTITY_SQL) {
      return { rows: this.rows.filter((row) => row.event_id === params[0] || row.event_digest === params[1]) };
    }
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
    throw new Error(`unexpected_sql:${sql}`);
  }

  async connect() {
    return {
      query: (sql, params) => this.query(sql, params),
      release: () => {}
    };
  }
}

function adapterWithPool() {
  const pool = new ScriptedPool();
  return { pool, adapter: createPostgresPublicWebCanaryAuditPersistence({ pool }) };
}

test('migration is namespaced, append-only, bounded and contains no credential material', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../../../migrations/hermes/019_create_public_web_canary_audit_events.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS hermes\.public_web_canary_audit_events/);
  assert.match(migration, /UNIQUE/);
  assert.match(migration, /public_web_canary_audit_update_trigger/);
  assert.match(migration, /public_web_canary_audit_delete_trigger/);
  assert.match(migration, /octet_length\(event_payload::text\) <= 16384/);
  assert.doesNotMatch(migration, /postgres(?:ql)?:\/\/|SERVICE_ROLE|password\s*=|secret\s*=/i);
  assert.equal(PERSISTENT_AUDIT_TABLE, 'hermes.public_web_canary_audit_events');
  assert.equal(MAX_PERSISTED_EVENT_BYTES, 16 * 1024);
});

test('PostgreSQL audit adapter persists pre-network and post-network events durably', async () => {
  const { adapter, pool } = adapterWithPool();
  const started = await adapter.append(auditEvent({ event_sequence: 1 }));
  const succeeded = await adapter.append(auditEvent({
    event_name: 'public_web_canary_request_succeeded',
    status: 'public_web_canary_request_succeeded',
    event_sequence: 2,
    executed: true,
    real_provider_called: true
  }));

  assert.equal(started.ok, true);
  assert.equal(started.status, 'INSERTED');
  assert.equal(started.receipt.append_only, true);
  assert.equal(succeeded.ok, true);
  assert.equal(succeeded.status, 'INSERTED');
  assert.equal(pool.rows.length, 2);
  assert.equal(pool.rows[0].event_payload.includes('"target_origin":'), false);
  assert.equal(pool.rows[0].event_payload.includes('https://'), false);
  assert.equal(pool.rows[0].event_payload.includes('secret'), false);
  assert.equal(pool.queries.filter(({ sql }) => sql === 'BEGIN').length, 2);
});

test('duplicate canonical event is accepted as replay without a second row', async () => {
  const { adapter, pool } = adapterWithPool();
  const event = auditEvent({ event_sequence: 7 });
  const first = await adapter.append(event);
  const replay = await adapter.append(event);

  assert.equal(first.status, 'INSERTED');
  assert.equal(replay.status, 'REPLAY_ACCEPTED');
  assert.deepEqual(replay.receipt.event_digest, first.receipt.event_digest);
  assert.equal(pool.rows.length, 1);
});

test('persistent sink keeps memory behavior for local inspection but requires durable append explicitly', async () => {
  const { adapter } = adapterWithPool();
  const sink = createPublicWebCanaryPersistentAuditSink({ persistence: adapter });
  const local = sink.append(auditEvent({ event_sequence: 1 }));
  assert.equal(local.event_name, 'public_web_canary_request_started');
  assert.equal(sink.list().length, 1);

  const durable = await sink.appendDurably(auditEvent({ event_sequence: 2 }));
  assert.equal(durable.ok, true);
  assert.equal(sink.durable, true);
  assert.equal(sink.list({ canary_session_id: 'session-durable-audit' }).length, 2);
});

test('sanitization removes secret, token, body, headers and full target before persistence', async () => {
  const { adapter, pool } = adapterWithPool();
  const result = await adapter.append(auditEvent({
    secret: 'must-not-persist',
    token: 'must-not-persist',
    body: 'must-not-persist',
    headers: { authorization: 'must-not-persist' },
    target_origin: 'https://owner-target.invalid'
  }));
  assert.equal(result.ok, true);
  assert.equal(pool.rows[0].event_payload.includes('must-not-persist'), false);
  assert.equal(pool.rows[0].event_payload.includes('owner-target.invalid'), false);
});

test('in-memory sink is not accepted by operational bootstrap and no fake provider is called', async () => {
  const context = validPreflightContext({ injectedConfirmationReader: acceptedConfirmationReader });
  const trial = createPublicWebCanaryOperationalTrial({
    ...context,
    operationalBootstrapConfigured: true,
    clock: context.clock
  });
  const result = await trial.executeTrial({
    config: validTrialConfig(),
    operationalBootstrapConfigured: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.preflight.blocking_reasons.includes('persistent_audit_unavailable'), true);
  assert.equal(context.nodeHttpsClient.calls(), 0);
});

test('persistent audit failure blocks before DNS/HTTP in the operational path', async () => {
  const failingAuditSink = {
    durable: true,
    append(event) { return event; },
    async appendDurably() { return { ok: false, status: 'PERSISTENT_AUDIT_FAILED' }; },
    list() { return []; }
  };
  const context = validPreflightContext({
    auditSink: failingAuditSink,
    injectedConfirmationReader: acceptedConfirmationReader
  });
  const trial = createPublicWebCanaryOperationalTrial({
    ...context,
    operationalBootstrapConfigured: true,
    clock: context.clock
  });
  const result = await trial.executeTrial({
    config: validTrialConfig(),
    operationalBootstrapConfigured: true
  });
  assert.equal(result.ok, false);
  assert.equal(result.executed, false);
  assert.equal(result.real_provider_called, false);
  assert.equal(context.nodeHttpsClient.calls(), 0);
});

test('adapter has no update or delete operation and never opens an external network client', () => {
  const { adapter } = adapterWithPool();
  assert.equal(typeof adapter.update, 'undefined');
  assert.equal(typeof adapter.delete, 'undefined');
  assert.equal(typeof adapter.executeHttp, 'undefined');
  assert.equal(typeof createPublicWebCanaryAuditSink, 'function');
});

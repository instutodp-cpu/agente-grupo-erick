'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../scripts/public-web-canary-staging-audit-transaction-probe');
const { buildDurableAuditRecord } = require('../src/core/public-web-canary-durable-audit-contract');
const { rowValues } = require('../src/adapters/postgres/public-web-canary-audit-persistence-postgres');

const readCA = () => '-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----';
const env = Object.freeze({
  POSTGRES_PORT: '5432', POSTGRES_USER: 'probe', POSTGRES_PASSWORD: 'dummy',
  POSTGRES_DB: 'postgres', POSTGRES_HOST: 'db.vvzvqinbzdqzcwrfoomd.supabase.co', HERMES_ENVIRONMENT: 'staging',
  HERMES_AUDIT_PROBE_CONFIRM_STAGING: 'YES', HERMES_STAGING_CA_FILE: '/home/hermesadmin/supabase-staging-root-ca.pem'
});
function fakePool({ target = '17.6', rollbackFails = false, persistedAfterRollback = false } = {}) {
  const queries = [];
  class PoolClass {
    async connect() {
      return {
        async query(sql) {
          queries.push(sql);
          if (sql.includes('SELECT count(*)::int AS persisted_count')) return { rows: [{ persisted_count: persistedAfterRollback ? 1 : 0 }] };
          if (sql.includes('current_database()')) return { rows: [{ audit_exists: true, db: 'postgres', server_version: target }] };
          if (sql === 'ROLLBACK') {
            if (rollbackFails) throw Error('rollback_failed');
            return { rows: [] };
          }
          if (sql === 'BEGIN READ WRITE') return { rows: [] };
          if (typeof sql === 'string' && sql.includes('information_schema')) return { rows: [{ schema_exists: true, table_exists: true, columns_exist: true }] };
          return { rows: [{ schema_exists: true, table_exists: true, columns_exist: true }] };
        },
        release() {}
      };
    }
    async end() {}
  }
  return { PoolClass, queries };
}
test('requires explicit staging before connecting', async () => {
  let connected = false;
  class PoolClass { constructor() { connected = true; } }
  const result = await run({ env: { ...env, HERMES_ENVIRONMENT: 'production' }, PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.equal(connected, false);
});
test('rejects missing confirmation before connecting', async () => {
  let connected = false;
  class PoolClass { constructor() { connected = true; } }
  const result = await run({ env: { ...env, HERMES_AUDIT_PROBE_CONFIRM_STAGING: '' }, PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.equal(connected, false);
});
test('blocks unverified database identity without beginning write', async () => {
  const fake = fakePool({ target: null });
  const result = await run({ env, PoolClass: fake.PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'database_staging_identity_unverified');
  assert.equal(fake.queries.includes('BEGIN READ WRITE'), false);
});
test('never reports success if rollback fails', async () => {
  const fake = fakePool({ rollbackFails: true });
  const result = await run({ env, PoolClass: fake.PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.notEqual(result.rollback_confirmed, true);
});

test('successful staging probe confirms rollback after insert without commit', async () => {
  const fake = fakePool();
  const result = await run({ env, PoolClass: fake.PoolClass, readCA });
  assert.equal(result.ok, true);
  assert.equal(result.rollback_confirmed, true);
  assert.equal(result.external_network_called, false);
  assert.equal(fake.queries.includes('BEGIN READ WRITE'), true);
  assert.equal(fake.queries.includes('ROLLBACK'), true);
  assert.equal(fake.queries.includes('COMMIT'), false);
  assert.ok(fake.queries.indexOf('ROLLBACK') > fake.queries.indexOf('BEGIN READ WRITE'));
});
test('rejects production NODE_ENV even when staging flags are present', async () => {
  let constructed = false;
  class PoolClass { constructor() { constructed = true; } }
  const result = await run({ env: { ...env, NODE_ENV: 'production' }, PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.equal(constructed, false);
});

test('rejects local postgres before connecting', async () => {
  let constructed = false;
  class PoolClass { constructor() { constructed = true; } }
  const result = await run({ env: { ...env, POSTGRES_HOST: '127.0.0.1' }, PoolClass, readCA });
  assert.equal(result.reason, 'staging_database_target_required');
  assert.equal(constructed, false);
});
test('requires TLS certificate verification for official staging host', async () => {
  let config;
  class PoolClass { constructor(c) { config = c; } async connect() { throw Error('intentional_stop'); } async end() {} }
  await run({ env, PoolClass, readCA });
  assert.equal(config.host, 'db.vvzvqinbzdqzcwrfoomd.supabase.co');
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.servername, config.host);
  assert.equal(config.ssl.ca, readCA());
});

test('fails closed before connection when CA file is not approved', async () => {
  let constructed = false;
  class PoolClass { constructor() { constructed = true; } }
  const result = await run({ env: { ...env, HERMES_STAGING_CA_FILE: '/tmp/other.pem' }, PoolClass, readCA });
  assert.equal(result.reason, 'staging_ca_unavailable');
  assert.equal(constructed, false);
});

test('rejects rollback when inserted event remains persisted', async () => {
  const fake = fakePool({ persistedAfterRollback: true });
  const result = await run({ env, PoolClass: fake.PoolClass, readCA });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'audit_rollback_not_verified');
  assert.equal(fake.queries.includes('COMMIT'), false);
});

test('shared serializer includes event_id in JSON while preserving canonical event digest', () => {
  const record = buildDurableAuditRecord({ event_name: 'public_web_canary_validation_blocked', trace_id: 't', request_id: 'r', change_id: 'c', canary_session_id: 's', tenant_id: 'tenant', workspace_type: 'staging', operator_id: 'operator', occurred_at: '2026-10-08T00:00:00.000Z', event_sequence: 0 });
  assert.equal(record.valid, true);
  const payload = JSON.parse(rowValues(record)[15]);
  assert.equal(payload.event_id, record.event_id);
  assert.equal(payload.event_name, record.event.event_name);
  assert.equal(payload.tenant_id, record.event.tenant_id);
  assert.equal(record.event.event_id, undefined);
  assert.equal(JSON.parse(record.serialized).event_id, undefined);
});

test('audit identity satisfies staging CHECK format and payload identity', () => {
  const record = buildDurableAuditRecord({ event_name: 'public_web_canary_validation_blocked', trace_id: 't', request_id: 'r', change_id: 'c', canary_session_id: 's', tenant_id: 'tenant', workspace_type: 'staging', operator_id: 'operator', occurred_at: '2026-10-08T00:00:00.000Z', event_sequence: 0 });
  assert.equal(record.valid, true);
  assert.match(record.event_id, /^[0-9a-f]{64}$/);
  assert.match(record.event_digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.event_digest, `sha256:${record.event_id}`);
  const params = rowValues(record);
  assert.equal(params[0], record.event_id);
  assert.equal(params[1], record.event_digest);
  assert.equal(JSON.parse(params[15]).event_id, params[0]);
});

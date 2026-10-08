'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../scripts/public-web-canary-staging-audit-transaction-probe');

const env = Object.freeze({
  POSTGRES_PORT: '5432', POSTGRES_USER: 'probe', POSTGRES_PASSWORD: 'dummy',
  POSTGRES_DB: 'staging_test', HERMES_ENVIRONMENT: 'staging',
  HERMES_AUDIT_PROBE_CONFIRM_STAGING: 'YES'
});
function fakePool({ target = 'staging', rollbackFails = false } = {}) {
  const queries = [];
  class PoolClass {
    async connect() {
      return {
        async query(sql) {
          queries.push(sql);
          if (sql.includes('current_database()')) return { rows: [{ audit_exists: true }] };
          if (sql.includes("current_setting('hermes.environment'")) return { rows: [{ target_environment: target }] };
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
  const result = await run({ env: { ...env, HERMES_ENVIRONMENT: 'production' }, PoolClass });
  assert.equal(result.ok, false);
  assert.equal(connected, false);
});
test('rejects missing confirmation before connecting', async () => {
  let connected = false;
  class PoolClass { constructor() { connected = true; } }
  const result = await run({ env: { ...env, HERMES_AUDIT_PROBE_CONFIRM_STAGING: '' }, PoolClass });
  assert.equal(result.ok, false);
  assert.equal(connected, false);
});
test('blocks unverified database identity without beginning write', async () => {
  const fake = fakePool({ target: null });
  const result = await run({ env, PoolClass: fake.PoolClass });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'database_staging_identity_unverified');
  assert.equal(fake.queries.includes('BEGIN READ WRITE'), false);
});
test('never reports success if rollback fails', async () => {
  const fake = fakePool({ rollbackFails: true });
  const result = await run({ env, PoolClass: fake.PoolClass });
  assert.equal(result.ok, false);
  assert.notEqual(result.rollback_confirmed, true);
});

test('successful staging probe confirms rollback after insert without commit', async () => {
  const fake = fakePool();
  const result = await run({ env, PoolClass: fake.PoolClass });
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
  const result = await run({ env: { ...env, NODE_ENV: 'production' }, PoolClass });
  assert.equal(result.ok, false);
  assert.equal(constructed, false);
});

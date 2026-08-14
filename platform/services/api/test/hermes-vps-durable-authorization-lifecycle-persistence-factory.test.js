'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');

const {
  DEFAULT_PERSISTENCE_MODE,
  MODE_ENV,
  PERSISTENCE_MODES,
  createHermesVpsDurableAuthorizationLifecyclePersistence,
  createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig
} = require('../src/core/hermes-vps-durable-authorization-lifecycle-persistence-factory');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/vps-durable-persistence-runtime-selection-v1',
  commit_sha: 'a815b28f425de85bc9abbb518f458ab984b6310e'
};
const plan = buildHermesVpsProvisioningPlan({
  bootstrap_contract: buildHermesVpsBootstrapContract({ provenance })
});

class FakePool {
  constructor(options) {
    this.options = options;
  }

  async query() {
    throw new Error('test_pool_must_not_connect');
  }

  async connect() {
    throw new Error('test_pool_must_not_connect');
  }

  async end() {}
}

test('default selection preserves the existing memory behavior', () => {
  const selected = createHermesVpsDurableAuthorizationLifecyclePersistence({ env: {} });

  assert.equal(DEFAULT_PERSISTENCE_MODE, 'memory');
  assert.deepEqual(PERSISTENCE_MODES, ['memory', 'postgres']);
  assert.equal(MODE_ENV, 'HERMES_DURABLE_PERSISTENCE_MODE');
  assert.equal(selected.mode, 'memory');
  assert.equal(selected.production_durable, false);
  assert.equal(selected.durability_claim, 'REFERENCE_TEST_ONLY');
  assert.equal(typeof selected.persistence.read, 'function');
});

test('memory can be selected explicitly', () => {
  const selected = createHermesVpsDurableAuthorizationLifecyclePersistence({
    mode: 'memory',
    env: { HERMES_DURABLE_DATABASE_URL: 'must-not-be-read' }
  });

  assert.equal(selected.mode, 'memory');
  assert.equal(selected.production_durable, false);
  assert.equal(selected.durability_claim, 'REFERENCE_TEST_ONLY');
});

test('postgres can be selected explicitly and uses the existing server-side factory', async () => {
  const selected = createHermesVpsDurableAuthorizationLifecyclePersistence({
    mode: 'postgres',
    env: { HERMES_DURABLE_DATABASE_URL: 'postgresql://test-only-placeholder' },
    provisioning_plan: plan,
    PoolClass: FakePool
  });

  assert.equal(selected.mode, 'postgres');
  assert.equal(selected.production_durable, true);
  assert.equal(selected.persistence.interface_version, 'hermes-vps-authorization-lifecycle-persistence-v2');
  assert.equal(selected.persistence.pool.options.connectionString, 'postgresql://test-only-placeholder');
  assert.deepEqual(selected.persistence.pool.options.ssl, { rejectUnauthorized: true });
  await selected.close();
});

test('missing mode defaults to memory and does not inspect generic DATABASE_URL', () => {
  const selected = createHermesVpsDurableAuthorizationLifecyclePersistence({
    env: { DATABASE_URL: 'not-a-hermes-selection' }
  });

  assert.equal(selected.mode, 'memory');
});

test('unknown mode fails closed', () => {
  assert.throws(
    () => createHermesVpsDurableAuthorizationLifecyclePersistence({ env: { [MODE_ENV]: 'redis' } }),
    /mode_invalid/
  );
});

test('postgres without a durable URL fails closed without returning memory', () => {
  assert.throws(
    () => createHermesVpsDurableAuthorizationLifecyclePersistence({ mode: 'postgres', env: {}, provisioning_plan: plan, PoolClass: FakePool }),
    /database_url_missing/
  );
});

test('postgres with an invalid durable URL fails closed', () => {
  assert.throws(
    () => createHermesVpsDurableAuthorizationLifecyclePersistence({ mode: 'postgres', env: { HERMES_DURABLE_DATABASE_URL: 'not-a-database-url' }, provisioning_plan: plan, PoolClass: FakePool }),
    /database_url_invalid/
  );
});

test('postgres requires the lifecycle plan before constructing a client', () => {
  assert.throws(
    () => createHermesVpsDurableAuthorizationLifecyclePersistence({ mode: 'postgres', env: { HERMES_DURABLE_DATABASE_URL: 'postgresql://test-only-placeholder' }, PoolClass: FakePool }),
    /provisioning_plan_required/
  );
});

test('postgres factory errors are not converted to memory fallback', () => {
  class FailingPool {
    constructor() {
      throw new Error('connection_unavailable');
    }
  }

  assert.throws(
    () => createHermesVpsDurableAuthorizationLifecyclePersistence({ mode: 'postgres', env: { HERMES_DURABLE_DATABASE_URL: 'postgresql://test-only-placeholder' }, provisioning_plan: plan, PoolClass: FailingPool }),
    /connection_unavailable/
  );
});

test('selection composes the existing lifecycle registry without runtime activation', () => {
  const selected = createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig({
    provisioning_plan: plan,
    env: {}
  });

  assert.equal(selected.mode, 'memory');
  assert.equal(selected.registry.registry_version, 'hermes-vps-durable-authorization-lifecycle-registry-v1');
  assert.equal(selected.registry.persistence_interface_version, 'hermes-vps-authorization-lifecycle-persistence-v2');
  assert.equal(selected.registry.production_persistence_implemented, false);
});

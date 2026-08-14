'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const {
  COMPOSITION_VERSION,
  createHermesVpsDurablePersistenceComposition
} = require('../src/core/hermes-vps-durable-persistence-composition');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/pr-d2-durable-persistence-composition-boundary',
  commit_sha: 'd97e09fc196b078c92c6b205ef4e5ae9b6745260'
};
const plan = buildHermesVpsProvisioningPlan({
  bootstrap_contract: buildHermesVpsBootstrapContract({ provenance })
});

class FakePool {
  constructor(options) {
    this.options = options;
    this.endCalls = 0;
  }

  async query() {
    throw new Error('composition_tests_must_not_query');
  }

  async connect() {
    throw new Error('composition_tests_must_not_connect');
  }

  async end() {
    this.endCalls += 1;
  }
}

test('memory composition is explicit, safe, and locally closable', async () => {
  const composition = createHermesVpsDurablePersistenceComposition({ env: {}, provisioning_plan: plan });

  assert.equal(COMPOSITION_VERSION, 'hermes-vps-durable-persistence-composition-v1');
  assert.equal(composition.mode, 'memory');
  assert.equal(composition.production_durable, false);
  assert.equal(composition.durability_claim, 'REFERENCE_TEST_ONLY');
  assert.equal(composition.owns_persistence_lifecycle, false);
  await assert.doesNotReject(composition.close());
  await assert.doesNotReject(composition.close());
});

test('postgres composition is selected only through the existing factory', async () => {
  const composition = createHermesVpsDurablePersistenceComposition({
    mode: 'postgres',
    env: { HERMES_DURABLE_DATABASE_URL: 'postgresql://test-only-placeholder' },
    provisioning_plan: plan,
    PoolClass: FakePool
  });

  assert.equal(composition.mode, 'postgres');
  assert.equal(composition.production_durable, true);
  assert.equal(composition.owns_persistence_lifecycle, true);
  assert.equal(composition.persistence.pool.options.connectionString, 'postgresql://test-only-placeholder');
  await composition.close();
  await composition.close();
  assert.equal(composition.persistence.pool.endCalls, 1);
});

test('postgres without configuration fails closed', () => {
  assert.throws(
    () => createHermesVpsDurablePersistenceComposition({ mode: 'postgres', provisioning_plan: plan }),
    /database_url_missing/
  );
});

test('invalid mode fails closed', () => {
  assert.throws(
    () => createHermesVpsDurablePersistenceComposition({ mode: 'sqlite', env: {} }),
    /mode_invalid/
  );
});

test('generic DATABASE_URL does not select postgres', () => {
  const composition = createHermesVpsDurablePersistenceComposition({
    env: { DATABASE_URL: 'postgresql://must-not-select' },
    provisioning_plan: plan
  });

  assert.equal(composition.mode, 'memory');
});

test('pool construction errors are not converted to memory', () => {
  class FailingPool {
    constructor() {
      throw new Error('pool_construction_failed');
    }
  }

  assert.throws(
    () => createHermesVpsDurablePersistenceComposition({
      mode: 'postgres',
      env: { HERMES_DURABLE_DATABASE_URL: 'postgresql://test-only-placeholder' },
      provisioning_plan: plan,
      PoolClass: FailingPool
    }),
    /pool_construction_failed/
  );
});

test('composition does not initialize the API runtime or execution components', () => {
  const composition = createHermesVpsDurablePersistenceComposition({ env: {}, provisioning_plan: plan });

  assert.equal(composition.registry.production_persistence_implemented, false);
  assert.equal(composition.registry.logical_atomicity, true);
  assert.equal(composition.registry.durable_semantics_contract, true);
  assert.equal(Object.hasOwn(composition, 'server'), false);
  assert.equal(Object.hasOwn(composition, 'worker'), false);
  assert.equal(Object.hasOwn(composition, 'provider'), false);
});

test('composition preserves the selected persistence interface and registry contract', () => {
  const composition = createHermesVpsDurablePersistenceComposition({ env: {}, provisioning_plan: plan });

  assert.equal(composition.persistence.interface_version, 'hermes-vps-authorization-lifecycle-persistence-v2');
  assert.equal(composition.registry.persistence_interface_version, composition.persistence.interface_version);
  assert.equal(typeof composition.registry.registerAuthorization, 'function');
  assert.equal(typeof composition.registry.consumeAuthorization, 'function');
  assert.equal(typeof composition.registry.revokeAuthorization, 'function');
});

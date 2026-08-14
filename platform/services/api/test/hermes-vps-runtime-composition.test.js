'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const {
  RUNTIME_COMPOSITION_VERSION,
  createHermesVpsRuntimeComposition
} = require('../src/core/hermes-vps-runtime-composition');

const plan = buildHermesVpsProvisioningPlan({
  bootstrap_contract: buildHermesVpsBootstrapContract({
    provenance: {
      repository: 'instutodp-cpu/agente-grupo-erick',
      branch: 'hermes/pr-d4a-runtime-composition-root',
      commit_sha: 'aed2b4506731bd8cfd59bf2842163fdb2af2667f'
    }
  })
});

function fakeComposition({ persistence = {}, registry = {}, close = async () => {} } = {}) {
  return {
    composition_version: 'hermes-vps-durable-persistence-composition-v1',
    persistence,
    registry,
    close
  };
}

test('runtime composition delegates selection to the D2 composition and creates one D3 owner', async () => {
  let compositionCalls = 0;
  let ownerCalls = 0;
  let closeCalls = 0;
  const persistence = {};
  const registry = {};

  const runtime = createHermesVpsRuntimeComposition({
    provisioning_plan: plan,
    composition_factory: (options) => {
      compositionCalls += 1;
      assert.equal(options.provisioning_plan, plan);
      assert.deepEqual(options.env, {});
      return fakeComposition({ persistence, registry, close: async () => { closeCalls += 1; } });
    },
    composition_options: { env: {} },
    lifecycle_owner_factory: ({ composition }) => {
      ownerCalls += 1;
      assert.equal(composition.persistence, persistence);
      return {
        persistence: composition.persistence,
        registry: composition.registry,
        close: composition.close
      };
    }
  });

  assert.equal(RUNTIME_COMPOSITION_VERSION, 'hermes-vps-runtime-composition-v1');
  assert.equal(compositionCalls, 1);
  assert.equal(ownerCalls, 1);
  assert.equal(runtime.persistence, persistence);
  assert.equal(runtime.registry, registry);
  await runtime.close();
  assert.equal(closeCalls, 1);
});

test('memory runtime composition requires no environment or external connection', async () => {
  const runtime = createHermesVpsRuntimeComposition({
    provisioning_plan: plan,
    composition_options: { env: {} }
  });

  assert.equal(runtime.lifecycle_owner.persistence, runtime.persistence);
  assert.equal(runtime.lifecycle_owner.registry, runtime.registry);
  assert.equal(runtime.lifecycle_owner.lifecycle_owner_version, 'hermes-vps-durable-persistence-lifecycle-owner-v1');
  await runtime.close();
});

test('composition close remains shared and idempotent at the runtime boundary', async () => {
  let closeCalls = 0;
  let resolveClose;
  const closeStarted = new Promise((resolve) => { resolveClose = resolve; });
  const runtime = createHermesVpsRuntimeComposition({
    provisioning_plan: plan,
    composition_factory: () => fakeComposition({
      close: async () => {
        closeCalls += 1;
        await closeStarted;
      }
    })
  });

  const first = runtime.close();
  const second = runtime.close();
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(closeCalls, 1);
  resolveClose();
  await Promise.all([first, second, runtime.lifecycle_owner.close()]);
  assert.equal(closeCalls, 1);
});

test('runtime composition does not register process signal handlers or create resources on import', () => {
  const before = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  delete require.cache[require.resolve('../src/core/hermes-vps-runtime-composition')];
  require('../src/core/hermes-vps-runtime-composition');
  const after = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  assert.deepEqual(after, before);
});

test('invalid injected factories fail closed without selecting another backend', () => {
  assert.throws(
    () => createHermesVpsRuntimeComposition({ provisioning_plan: plan, composition_factory: null }),
    /runtime_composition_factory_invalid/
  );
  assert.throws(
    () => createHermesVpsRuntimeComposition({ provisioning_plan: plan, lifecycle_owner_factory: null }),
    /runtime_lifecycle_owner_factory_invalid/
  );
});

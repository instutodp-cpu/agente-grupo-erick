'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  HERMES_RUNTIME_HOST_VERSION,
  createHermesRuntimeHost
} = require('../src/core/hermes-runtime-host');

const runtimeInput = Object.freeze({
  provenance: {
    repository: 'instutodp-cpu/agente-grupo-erick',
    branch: 'hermes/pr-d4d0-runtime-host-boundary',
    commit_sha: 'f6b71a3d291b43160f6175a228f618c876a13d87'
  },
  bootstrap_overrides: {}
});

function fakeComposition({ close = async () => {}, persistence = {}, registry = {} } = {}) {
  return { persistence, registry, close };
}

test('host construction and import have no startup, environment, or process side effects', () => {
  const before = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  let sourceCalls = 0;
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => { sourceCalls += 1; return { provisioning_plan: {} }; },
    runtime_composition_factory: () => fakeComposition()
  });

  assert.equal(host.host_version, HERMES_RUNTIME_HOST_VERSION);
  assert.equal(sourceCalls, 0);
  assert.deepEqual(['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal)), before);
});

test('start acquires provisioning once, composes once, and preserves consumer references', async () => {
  const provisioning = { provisioning_plan: { plan_hash: 'plan' } };
  const persistence = {};
  const registry = {};
  let sourceCalls = 0;
  let compositionCalls = 0;
  let receivedPlan;
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: ({ input }) => {
      sourceCalls += 1;
      assert.equal(input, runtimeInput);
      return provisioning;
    },
    runtime_composition_factory: (options) => {
      compositionCalls += 1;
      receivedPlan = options.provisioning_plan;
      assert.deepEqual(options.composition_options, { env: {} });
      return fakeComposition({ persistence, registry });
    }
  });

  const first = host.start();
  const second = host.start();
  assert.strictEqual(first, second);
  const runtime = await first;
  assert.equal(sourceCalls, 1);
  assert.equal(compositionCalls, 1);
  assert.equal(receivedPlan, provisioning.provisioning_plan);
  assert.equal(runtime.persistence, persistence);
  assert.equal(runtime.registry, registry);
  assert.equal(Object.hasOwn(runtime, 'composition'), false);
  assert.equal(Object.hasOwn(runtime, 'lifecycle_owner'), false);
  await host.close();
});

test('host close before start is safe and prevents later startup', async () => {
  let sourceCalls = 0;
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => { sourceCalls += 1; return { provisioning_plan: {} }; },
    runtime_composition_factory: () => fakeComposition()
  });

  await host.close();
  await assert.rejects(host.start(), /hermes_runtime_host_already_closed/);
  assert.equal(sourceCalls, 0);
});

test('repeated and concurrent close calls close the composition exactly once', async () => {
  let closeCalls = 0;
  let releaseClose;
  let signalCloseEntered;
  const closeStarted = new Promise((resolve) => { releaseClose = resolve; });
  const closeEntered = new Promise((resolve) => { signalCloseEntered = resolve; });
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => ({ provisioning_plan: {} }),
    runtime_composition_factory: () => fakeComposition({
      close: async () => {
        closeCalls += 1;
        signalCloseEntered();
        await closeStarted;
      }
    })
  });

  await host.start();
  const first = host.close();
  const second = host.close();
  const third = host.close();
  assert.strictEqual(first, second);
  assert.strictEqual(second, third);
  await closeEntered;
  assert.equal(closeCalls, 1);
  releaseClose();
  await Promise.all([first, second, third]);
  assert.equal(closeCalls, 1);
});

test('startup failure rolls back a partially created composition', async () => {
  let closeCalls = 0;
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => ({ provisioning_plan: {} }),
    runtime_composition_factory: () => ({
      persistence: {},
      registry: null,
      close: async () => { closeCalls += 1; }
    })
  });

  await assert.rejects(host.start(), /hermes_runtime_host_composition_registry_missing/);
  assert.equal(closeCalls, 1);
});

test('invalid provisioning and composition fail closed without fallback consumers', async () => {
  const invalidProvisioning = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => ({ invalid: true }),
    runtime_composition_factory: () => fakeComposition()
  });
  await assert.rejects(invalidProvisioning.start(), /hermes_runtime_host_provisioning_invalid/);

  const invalidComposition = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => ({ provisioning_plan: {} }),
    runtime_composition_factory: () => ({ persistence: {}, registry: {} })
  });
  await assert.rejects(invalidComposition.start(), /hermes_runtime_host_composition_close_missing/);
});

test('host rejects absent input and never creates a fake consumer', () => {
  assert.throws(() => createHermesRuntimeHost(), /hermes_runtime_host_runtime_input_required/);
  const host = createHermesRuntimeHost({
    runtime_input: runtimeInput,
    provisioning_source_factory: () => ({ provisioning_plan: {} }),
    runtime_composition_factory: () => fakeComposition()
  });
  assert.equal(Object.hasOwn(host, 'consumer'), false);
  assert.equal(Object.hasOwn(host, 'handler'), false);
  assert.equal(Object.hasOwn(host, 'worker'), false);
});

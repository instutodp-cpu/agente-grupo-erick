'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildHermesVpsBootstrapContract } = require('../src/core/hermes-vps-bootstrap-contract');
const { buildHermesVpsProvisioningPlan } = require('../src/core/hermes-vps-provisioning-plan');
const {
  COMPOSITION_VERSION,
  createHermesVpsDurablePersistenceComposition
} = require('../src/core/hermes-vps-durable-persistence-composition');
const {
  LIFECYCLE_OWNER_VERSION,
  createHermesVpsDurablePersistenceLifecycleOwner
} = require('../src/core/hermes-vps-durable-persistence-lifecycle-owner');

const provenance = {
  repository: 'instutodp-cpu/agente-grupo-erick',
  branch: 'hermes/pr-d3-durable-persistence-lifecycle-owner',
  commit_sha: '3cc5f250aeb0611d411c996d776d8b19a57a3e9f'
};
const plan = buildHermesVpsProvisioningPlan({
  bootstrap_contract: buildHermesVpsBootstrapContract({ provenance })
});

function fakeComposition({ close = async () => {}, persistence = {}, registry = {} } = {}) {
  return { composition_version: COMPOSITION_VERSION, close, persistence, registry };
}

test('memory composition is accepted without external resources', async () => {
  const composition = createHermesVpsDurablePersistenceComposition({ env: {}, provisioning_plan: plan });
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition });

  assert.equal(owner.lifecycle_owner_version, LIFECYCLE_OWNER_VERSION);
  assert.equal(owner.persistence, composition.persistence);
  assert.equal(owner.registry, composition.registry);
  await assert.doesNotReject(owner.close());
});

test('owner exposes persistence and registry but owns the composition close', () => {
  const persistence = {};
  const registry = {};
  const composition = fakeComposition({ persistence, registry });
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition });

  assert.equal(owner.persistence, persistence);
  assert.equal(owner.registry, registry);
  assert.equal(Object.hasOwn(owner, 'composition'), false);
  assert.equal(typeof owner.close, 'function');
});

test('first close invokes the underlying composition exactly once', async () => {
  let closeCalls = 0;
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => { closeCalls += 1; } })
  });

  await owner.close();
  assert.equal(closeCalls, 1);
});

test('second close does not invoke the underlying composition again', async () => {
  let closeCalls = 0;
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => { closeCalls += 1; } })
  });

  await owner.close();
  await owner.close();
  assert.equal(closeCalls, 1);
});

test('any number of sequential closes remains exactly once', async () => {
  let closeCalls = 0;
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => { closeCalls += 1; } })
  });

  for (let index = 0; index < 10; index += 1) await owner.close();
  assert.equal(closeCalls, 1);
});

test('concurrent closes share one underlying close operation', async () => {
  let closeCalls = 0;
  let releaseClose;
  const closeStarted = new Promise((resolve) => { releaseClose = resolve; });
  const close = async () => {
    closeCalls += 1;
    await closeStarted;
  };
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition: fakeComposition({ close }) });

  const closes = [owner.close(), owner.close(), owner.close()];
  assert.strictEqual(closes[0], closes[1]);
  assert.strictEqual(closes[1], closes[2]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeCalls, 1);
  releaseClose();
  await Promise.all(closes);
});

test('all concurrent callers observe the same successful close result', async () => {
  const result = { closed: true };
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => result })
  });

  const closes = [owner.close(), owner.close(), owner.close()];
  const results = await Promise.all(closes);
  assert.deepEqual(results, [result, result, result]);
});

test('close failure is propagated and never converted to success', async () => {
  let closeCalls = 0;
  const failure = new Error('close_failed');
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => { closeCalls += 1; throw failure; } })
  });

  const first = owner.close();
  const second = owner.close();
  assert.strictEqual(first, second);
  await assert.rejects(first, (error) => error === failure);
  await assert.rejects(owner.close(), (error) => error === failure);
  assert.equal(closeCalls, 1);
});

test('failed close is not retried indefinitely', async () => {
  let closeCalls = 0;
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({
    composition: fakeComposition({ close: async () => { closeCalls += 1; throw new Error('terminal_close_failure'); } })
  });

  for (let index = 0; index < 5; index += 1) await assert.rejects(owner.close(), /terminal_close_failure/);
  assert.equal(closeCalls, 1);
});

test('module creation has no signal or runtime side effects', () => {
  const signalCounts = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition: fakeComposition() });

  assert.deepEqual(signalCounts, ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal)));
  assert.equal(Object.hasOwn(owner, 'server'), false);
  assert.equal(Object.hasOwn(owner, 'worker'), false);
  assert.equal(Object.hasOwn(owner, 'provider'), false);
});

test('owner creation does not create a composition or a pool', () => {
  let compositionCloseCalls = 0;
  const composition = fakeComposition({ close: async () => { compositionCloseCalls += 1; } });
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition });

  assert.equal(compositionCloseCalls, 0);
  assert.equal(owner.persistence, composition.persistence);
  assert.equal(owner.registry, composition.registry);
});

test('owner registers no process signal handlers', () => {
  const before = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));
  createHermesVpsDurablePersistenceLifecycleOwner({ composition: fakeComposition() });
  const after = ['SIGTERM', 'SIGINT'].map((signal) => process.listenerCount(signal));

  assert.deepEqual(after, before);
});

test('owner receives the PR-D2 composition without duplicating selection', () => {
  let closeCalls = 0;
  const composition = fakeComposition({ close: async () => { closeCalls += 1; } });
  const owner = createHermesVpsDurablePersistenceLifecycleOwner({ composition });

  assert.equal(owner.persistence, composition.persistence);
  assert.equal(owner.registry, composition.registry);
  assert.equal(closeCalls, 0);
});

test('invalid compositions fail closed', () => {
  assert.throws(() => createHermesVpsDurablePersistenceLifecycleOwner(), /lifecycle_composition_invalid/);
  assert.throws(
    () => createHermesVpsDurablePersistenceLifecycleOwner({ composition: { persistence: {}, registry: {}, close() {} } }),
    /lifecycle_composition_version_invalid/
  );
  assert.throws(
    () => createHermesVpsDurablePersistenceLifecycleOwner({ composition: { persistence: {}, registry: {} } }),
    /lifecycle_composition_version_invalid/
  );
});

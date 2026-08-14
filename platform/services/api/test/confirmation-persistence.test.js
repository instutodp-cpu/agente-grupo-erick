'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONFIRMATION_PERSISTENCE_VERSION,
  assertConfirmationPersistence
} = require('../src/core/confirmation-persistence');
const { createMemoryConfirmationPersistence } = require('../src/core/memory-confirmation-persistence');
const { createConfirmationStore } = require('../src/core/confirmation-store');

function record(overrides = {}) {
  return {
    confirmation_id: overrides.confirmation_id || 'confirm_persistence',
    trace_id: overrides.trace_id || 'trace-persistence',
    domain: overrides.domain || 'financeiro',
    intent: overrides.intent || 'consultar_financeiro',
    status: overrides.status || 'pending',
    expires_at: overrides.expires_at || '2026-01-01T00:15:00.000Z'
  };
}

test('confirmation persistence contract is explicit and validates required primitives', () => {
  assert.equal(CONFIRMATION_PERSISTENCE_VERSION, 'confirmation-persistence-v1');
  const persistence = createMemoryConfirmationPersistence();
  assert.strictEqual(assertConfirmationPersistence(persistence), persistence);
  assert.throws(() => assertConfirmationPersistence({}), /confirmation_persistence_create_missing/);
});

test('memory persistence creates, reads, updates, lists, and resets isolated records', () => {
  const first = createMemoryConfirmationPersistence();
  const second = createMemoryConfirmationPersistence();
  const initial = record();

  assert.deepEqual(first.create(initial), initial);
  assert.deepEqual(first.get(initial.confirmation_id), initial);
  assert.equal(second.get(initial.confirmation_id), null);

  const returned = first.get(initial.confirmation_id);
  returned.status = 'approved';
  assert.equal(first.get(initial.confirmation_id).status, 'pending');

  const updated = { ...initial, status: 'approved' };
  assert.deepEqual(first.update(updated), updated);
  assert.deepEqual(first.list(), [updated]);
  assert.equal(first.update({ ...updated, confirmation_id: 'missing' }), null);

  first.reset();
  assert.equal(first.get(initial.confirmation_id), null);
  assert.deepEqual(second.list(), []);
});

test('confirmation store keeps domain transitions above injected persistence', () => {
  const persistence = createMemoryConfirmationPersistence();
  const store = createConfirmationStore({ persistence });
  const created = store.createPendingConfirmation({
    confirmation_id: 'confirm_domain',
    trace_id: 'trace-domain',
    domain: 'marketing',
    intent: 'planejar_marketing',
    expires_in_seconds: 900,
    now: new Date('2026-01-01T00:00:00.000Z')
  });

  assert.equal(created.status, 'pending');
  const beforeExpiration = new Date('2026-01-01T00:01:00.000Z');
  assert.equal(store.resolvePendingConfirmation('confirm_domain', 'unknown', beforeExpiration).status, 'pending');
  assert.equal(store.resolvePendingConfirmation('confirm_domain', 'approved', beforeExpiration).status, 'approved');
  assert.equal(store.resolvePendingConfirmation('confirm_domain', 'rejected', beforeExpiration).status, 'rejected');
  assert.equal(store.getPendingConfirmation('missing', beforeExpiration), null);
});

test('expired confirmation is persisted as expired and cannot be reopened', () => {
  const store = createConfirmationStore();
  store.createPendingConfirmation({
    confirmation_id: 'confirm_expiration',
    trace_id: 'trace-expiration',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    expires_in_seconds: 1,
    now: new Date('2026-01-01T00:00:00.000Z')
  });

  const expired = store.getPendingConfirmation('confirm_expiration', new Date('2026-01-01T00:00:02.000Z'));
  assert.equal(expired.status, 'expired');
  assert.equal(store.resolvePendingConfirmation('confirm_expiration', 'approved', new Date('2026-01-01T00:00:02.000Z')).status, 'expired');
});

test('prune and reset operate only on the injected memory instance', () => {
  const first = createConfirmationStore();
  const second = createConfirmationStore();
  const input = {
    trace_id: 'trace-prune', domain: 'marketing', intent: 'planejar_marketing',
    expires_in_seconds: 1, now: new Date('2026-01-01T00:00:00.000Z')
  };

  first.createPendingConfirmation({ ...input, confirmation_id: 'confirm_prune' });
  second.createPendingConfirmation({ ...input, confirmation_id: 'confirm_second' });
  assert.equal(first.pruneExpiredConfirmations(new Date('2026-01-01T00:00:02.000Z')), 1);
  assert.equal(first.getPendingConfirmation('confirm_prune').status, 'expired');
  const beforeExpiration = new Date('2026-01-01T00:00:00.500Z');
  assert.equal(second.getPendingConfirmation('confirm_second', beforeExpiration).status, 'pending');

  first.resetConfirmationStore();
  assert.equal(first.getPendingConfirmation('confirm_prune'), null);
  assert.equal(second.getPendingConfirmation('confirm_second', beforeExpiration).status, 'pending');
});

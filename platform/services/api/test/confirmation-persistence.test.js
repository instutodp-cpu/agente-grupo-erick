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
  assert.equal(CONFIRMATION_PERSISTENCE_VERSION, 'confirmation-persistence-v2');
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

  const transitioned = first.compareAndTransition({
    confirmation_id: initial.confirmation_id,
    expected_status: 'pending',
    next_status: 'approved'
  });
  assert.deepEqual(transitioned, { outcome: 'transitioned', record: { ...initial, status: 'approved' } });
  assert.deepEqual(first.list(), [{ ...initial, status: 'approved' }]);
  assert.deepEqual(first.compareAndTransition({
    confirmation_id: initial.confirmation_id,
    expected_status: 'pending',
    next_status: 'rejected'
  }), { outcome: 'state_mismatch', record: { ...initial, status: 'approved' } });
  assert.deepEqual(first.compareAndTransition({
    confirmation_id: 'missing',
    expected_status: 'pending',
    next_status: 'approved'
  }), { outcome: 'not_found', record: null });
  assert.deepEqual(first.compareAndTransition({
    confirmation_id: initial.confirmation_id,
    expected_status: 'approved',
    next_status: 'approved'
  }), { outcome: 'unchanged', record: { ...initial, status: 'approved' } });

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

test('duplicate and sequential resolve behavior remains compatible', () => {
  const store = createConfirmationStore();
  const now = new Date('2026-01-01T00:01:00.000Z');
  const input = {
    trace_id: 'trace-duplicate', domain: 'financeiro', intent: 'consultar_financeiro',
    expires_in_seconds: 900, now
  };

  store.createPendingConfirmation({ ...input, confirmation_id: 'confirm_duplicate' });
  assert.equal(store.resolvePendingConfirmation('confirm_duplicate', 'approved', now).status, 'approved');
  assert.equal(store.resolvePendingConfirmation('confirm_duplicate', 'approved', now).status, 'approved');
  assert.equal(store.resolvePendingConfirmation('confirm_duplicate', 'rejected', now).status, 'rejected');

  store.createPendingConfirmation({ ...input, confirmation_id: 'confirm_duplicate_inverse' });
  assert.equal(store.resolvePendingConfirmation('confirm_duplicate_inverse', 'rejected', now).status, 'rejected');
  assert.equal(store.resolvePendingConfirmation('confirm_duplicate_inverse', 'approved', now).status, 'approved');
});

test('a stale competing resolve loses atomically without last-write-wins retry', () => {
  const base = createMemoryConfirmationPersistence();
  let raced = false;
  const persistence = {
    create: base.create,
    get(confirmation_id) {
      const record = base.get(confirmation_id);
      if (record && record.status === 'pending' && !raced) {
        raced = true;
        base.compareAndTransition({
          confirmation_id,
          expected_status: 'pending',
          next_status: 'approved'
        });
      }
      return record;
    },
    compareAndTransition: base.compareAndTransition,
    list: base.list,
    reset: base.reset
  };
  const store = createConfirmationStore({ persistence });
  const now = new Date('2026-01-01T00:01:00.000Z');

  store.createPendingConfirmation({
    confirmation_id: 'confirm_race',
    trace_id: 'trace-race',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    expires_in_seconds: 900,
    now
  });

  const loser = store.resolvePendingConfirmation('confirm_race', 'rejected', now);
  assert.equal(loser.status, 'approved');
  assert.equal(store.getPendingConfirmation('confirm_race', now).status, 'approved');
});

test('expiration can atomically win before a later resolve', () => {
  const store = createConfirmationStore();
  store.createPendingConfirmation({
    confirmation_id: 'confirm_expiration_race',
    trace_id: 'trace-expiration-race',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    expires_in_seconds: 1,
    now: new Date('2026-01-01T00:00:00.000Z')
  });

  assert.equal(store.getPendingConfirmation('confirm_expiration_race', new Date('2026-01-01T00:00:02.000Z')).status, 'expired');
  assert.equal(store.resolvePendingConfirmation('confirm_expiration_race', 'approved', new Date('2026-01-01T00:00:02.000Z')).status, 'expired');
});

test('resolved confirmation still follows the existing expiration behavior', () => {
  const store = createConfirmationStore();
  store.createPendingConfirmation({
    confirmation_id: 'confirm_resolved_expiration',
    trace_id: 'trace-resolved-expiration',
    domain: 'financeiro',
    intent: 'consultar_financeiro',
    expires_in_seconds: 1,
    now: new Date('2026-01-01T00:00:00.000Z')
  });

  assert.equal(store.resolvePendingConfirmation('confirm_resolved_expiration', 'approved', new Date('2026-01-01T00:00:00.500Z')).status, 'approved');
  assert.equal(store.getPendingConfirmation('confirm_resolved_expiration', new Date('2026-01-01T00:00:02.000Z')).status, 'expired');
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

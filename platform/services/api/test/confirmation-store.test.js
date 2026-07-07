'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createPendingConfirmation,
  getPendingConfirmation,
  pruneExpiredConfirmations,
  resetConfirmationStore,
  resolvePendingConfirmation
} = require('../src/core/confirmation-store');

function createRecord(overrides = {}) {
  return createPendingConfirmation({
    confirmation_id: overrides.confirmation_id || 'confirm_store',
    trace_id: overrides.trace_id || 'trace-store',
    domain: overrides.domain || 'financeiro',
    intent: overrides.intent || 'consultar_financeiro',
    expires_in_seconds: overrides.expires_in_seconds ?? 900,
    now: overrides.now || new Date()
  });
}

test('store cria e recupera confirmacao pendente com metadados seguros', () => {
  resetConfirmationStore();

  const record = createRecord();
  const stored = getPendingConfirmation('confirm_store', new Date('2026-01-01T00:01:00.000Z'));

  assert.deepEqual(stored, record);
  assert.deepEqual(
    Object.keys(stored).sort(),
    ['confirmation_id', 'domain', 'expires_at', 'intent', 'status', 'trace_id'].sort()
  );
  assert.equal(Object.hasOwn(stored, 'message'), false);
  assert.equal(Object.hasOwn(stored, 'requiredAdapters'), false);
});

test('resolve approved e rejected, mas unknown mantem pending', () => {
  resetConfirmationStore();

  createRecord({ confirmation_id: 'confirm_approved' });
  assert.equal(resolvePendingConfirmation('confirm_approved', 'approved').status, 'approved');

  createRecord({ confirmation_id: 'confirm_rejected' });
  assert.equal(resolvePendingConfirmation('confirm_rejected', 'rejected').status, 'rejected');

  createRecord({ confirmation_id: 'confirm_unknown' });
  assert.equal(resolvePendingConfirmation('confirm_unknown', 'unknown').status, 'pending');
});

test('pruneExpiredConfirmations marca expiradas', () => {
  resetConfirmationStore();

  createRecord({
    confirmation_id: 'confirm_expired',
    expires_in_seconds: 1,
    now: new Date('2026-01-01T00:00:00.000Z')
  });
  const pruned = pruneExpiredConfirmations(new Date('2026-01-01T00:00:02.000Z'));
  const stored = getPendingConfirmation('confirm_expired', new Date('2026-01-01T00:00:02.000Z'));

  assert.equal(pruned, 1);
  assert.equal(stored.status, 'expired');
});

test('resetConfirmationStore limpa estado', () => {
  resetConfirmationStore();
  createRecord({ confirmation_id: 'confirm_reset' });
  assert.ok(getPendingConfirmation('confirm_reset'));

  resetConfirmationStore();
  assert.equal(getPendingConfirmation('confirm_reset'), null);
});

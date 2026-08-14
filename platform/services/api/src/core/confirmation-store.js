'use strict';

const { assertConfirmationPersistence } = require('./confirmation-persistence');
const { createMemoryConfirmationPersistence } = require('./memory-confirmation-persistence');

function toExpiresAt(expiresInSeconds, now) {
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

function isExpired(record, now = new Date()) {
  return new Date(record.expires_at).getTime() <= now.getTime();
}

function currentAfterTransition(result, persistence) {
  if (result.outcome === 'not_found') return null;
  if (result.record) return { ...result.record };
  return persistence.get(result.confirmation_id);
}

function createConfirmationStore({ persistence = createMemoryConfirmationPersistence() } = {}) {
  assertConfirmationPersistence(persistence);

  function createPendingConfirmation({ confirmation_id, trace_id, domain, intent, expires_in_seconds, now = new Date() }) {
    return persistence.create({
      confirmation_id,
      trace_id,
      domain,
      intent,
      status: 'pending',
      expires_at: toExpiresAt(expires_in_seconds, now)
    });
  }

  function getPendingConfirmation(confirmation_id, now = new Date()) {
    const record = persistence.get(confirmation_id);
    if (!record) return null;

    if (isExpired(record, now)) {
      const result = persistence.compareAndTransition({
        confirmation_id,
        expected_status: record.status,
        next_status: 'expired'
      });
      return currentAfterTransition(result, persistence);
    }

    return { ...record };
  }

  function resolvePendingConfirmation(confirmation_id, decision, now = new Date()) {
    const record = persistence.get(confirmation_id);
    if (!record) return null;

    if (isExpired(record, now)) {
      const expiration = persistence.compareAndTransition({
        confirmation_id,
        expected_status: record.status,
        next_status: 'expired'
      });
      return currentAfterTransition(expiration, persistence);
    }

    if (decision === 'approved' || decision === 'rejected') {
      const result = persistence.compareAndTransition({
        confirmation_id,
        expected_status: record.status,
        next_status: decision
      });
      return currentAfterTransition(result, persistence);
    }

    return { ...record };
  }

  function pruneExpiredConfirmations(now = new Date()) {
    let pruned = 0;

    for (const record of persistence.list()) {
      if (isExpired(record, now)) {
        const result = persistence.compareAndTransition({
          confirmation_id: record.confirmation_id,
          expected_status: record.status,
          next_status: 'expired'
        });
        if (result.outcome === 'transitioned' || result.outcome === 'unchanged') {
          pruned += 1;
        }
      }
    }

    return pruned;
  }

  function resetConfirmationStore() {
    persistence.reset();
  }

  return Object.freeze({
    createPendingConfirmation,
    getPendingConfirmation,
    pruneExpiredConfirmations,
    resetConfirmationStore,
    resolvePendingConfirmation
  });
}

const defaultConfirmationStore = createConfirmationStore();

const {
  createPendingConfirmation,
  getPendingConfirmation,
  pruneExpiredConfirmations,
  resetConfirmationStore,
  resolvePendingConfirmation
} = defaultConfirmationStore;

module.exports = {
  createConfirmationStore,
  createPendingConfirmation,
  getPendingConfirmation,
  pruneExpiredConfirmations,
  resetConfirmationStore,
  resolvePendingConfirmation
};

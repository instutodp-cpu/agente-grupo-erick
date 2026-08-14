'use strict';

const { assertConfirmationPersistence } = require('./confirmation-persistence');
const { createMemoryConfirmationPersistence } = require('./memory-confirmation-persistence');

function toExpiresAt(expiresInSeconds, now) {
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

function isExpired(record, now = new Date()) {
  return new Date(record.expires_at).getTime() <= now.getTime();
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
      const expired = { ...record, status: 'expired' };
      persistence.update(expired);
      return { ...expired };
    }

    return { ...record };
  }

  function resolvePendingConfirmation(confirmation_id, decision, now = new Date()) {
    const record = getPendingConfirmation(confirmation_id, now);
    if (!record || record.status === 'expired') return record;

    if (decision === 'approved' || decision === 'rejected') {
      const resolved = { ...record, status: decision };
      persistence.update(resolved);
      return { ...resolved };
    }

    return { ...record };
  }

  function pruneExpiredConfirmations(now = new Date()) {
    let pruned = 0;

    for (const record of persistence.list()) {
      if (isExpired(record, now)) {
        persistence.update({ ...record, status: 'expired' });
        pruned += 1;
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

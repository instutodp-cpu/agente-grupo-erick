'use strict';

const confirmations = new Map();

function toExpiresAt(expiresInSeconds, now) {
  return new Date(now.getTime() + expiresInSeconds * 1000).toISOString();
}

function isExpired(record, now = new Date()) {
  return new Date(record.expires_at).getTime() <= now.getTime();
}

function createPendingConfirmation({ confirmation_id, trace_id, domain, intent, expires_in_seconds, now = new Date() }) {
  const record = {
    confirmation_id,
    trace_id,
    domain,
    intent,
    status: 'pending',
    expires_at: toExpiresAt(expires_in_seconds, now)
  };

  confirmations.set(confirmation_id, record);
  return { ...record };
}

function getPendingConfirmation(confirmation_id, now = new Date()) {
  const record = confirmations.get(confirmation_id);
  if (!record) return null;

  if (isExpired(record, now)) {
    record.status = 'expired';
    confirmations.set(confirmation_id, record);
    return { ...record };
  }

  return { ...record };
}

function resolvePendingConfirmation(confirmation_id, decision, now = new Date()) {
  const record = getPendingConfirmation(confirmation_id, now);
  if (!record || record.status === 'expired') return record;

  if (decision === 'approved' || decision === 'rejected') {
    record.status = decision;
    confirmations.set(confirmation_id, record);
  }

  return { ...record };
}

function pruneExpiredConfirmations(now = new Date()) {
  let pruned = 0;

  for (const [confirmationId, record] of confirmations.entries()) {
    if (isExpired(record, now)) {
      record.status = 'expired';
      confirmations.set(confirmationId, record);
      pruned += 1;
    }
  }

  return pruned;
}

function resetConfirmationStore() {
  confirmations.clear();
}

module.exports = {
  createPendingConfirmation,
  getPendingConfirmation,
  pruneExpiredConfirmations,
  resetConfirmationStore,
  resolvePendingConfirmation
};

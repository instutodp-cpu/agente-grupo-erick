'use strict';

// Upper bound for in-memory confirmations. POST /message needs no identity,
// so an unbounded Map lets any caller grow the process until it crashes,
// taking down the read pilots served by the same process. Confirmations
// expire after minutes, so the oldest entries are evicted first; an evicted
// confirmation reads as not_found and still never executes anything.
const DEFAULT_MAX_RECORDS = 10_000;

function cloneRecord(record) {
  return record ? { ...record } : null;
}

function createMemoryConfirmationPersistence({ maxRecords = DEFAULT_MAX_RECORDS } = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1) {
    throw new Error('confirmation_memory_max_records_invalid');
  }
  const records = new Map();

  return Object.freeze({
    create(record) {
      const stored = cloneRecord(record);
      // Re-inserting keeps Map order equal to creation order for eviction.
      records.delete(stored.confirmation_id);
      records.set(stored.confirmation_id, stored);
      while (records.size > maxRecords) {
        records.delete(records.keys().next().value);
      }
      return cloneRecord(stored);
    },

    get(confirmation_id) {
      return cloneRecord(records.get(confirmation_id));
    },

    compareAndTransition({ confirmation_id, expected_status, next_status }) {
      const current = records.get(confirmation_id);
      if (!current) return { outcome: 'not_found', record: null };
      if (current.status !== expected_status) {
        return { outcome: 'state_mismatch', record: cloneRecord(current) };
      }

      const transitioned = { ...current, status: next_status };
      records.set(confirmation_id, transitioned);
      return {
        outcome: next_status === expected_status ? 'unchanged' : 'transitioned',
        record: cloneRecord(transitioned)
      };
    },

    list() {
      return [...records.values()].map(cloneRecord);
    },

    reset() {
      records.clear();
    }
  });
}

module.exports = { createMemoryConfirmationPersistence, DEFAULT_MAX_RECORDS };

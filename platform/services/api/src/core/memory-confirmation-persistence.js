'use strict';

function cloneRecord(record) {
  return record ? { ...record } : null;
}

function createMemoryConfirmationPersistence() {
  const records = new Map();

  return Object.freeze({
    create(record) {
      const stored = cloneRecord(record);
      records.set(stored.confirmation_id, stored);
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

module.exports = { createMemoryConfirmationPersistence };

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

    update(record) {
      if (!records.has(record.confirmation_id)) return null;
      const stored = cloneRecord(record);
      records.set(stored.confirmation_id, stored);
      return cloneRecord(stored);
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

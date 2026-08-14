'use strict';

const CONFIRMATION_PERSISTENCE_VERSION = 'confirmation-persistence-v1';
const REQUIRED_METHODS = ['create', 'get', 'update', 'list', 'reset'];

function assertConfirmationPersistence(persistence) {
  if (!persistence || typeof persistence !== 'object') {
    throw new TypeError('confirmation_persistence_invalid');
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof persistence[method] !== 'function') {
      throw new TypeError(`confirmation_persistence_${method}_missing`);
    }
  }

  return persistence;
}

module.exports = {
  CONFIRMATION_PERSISTENCE_VERSION,
  assertConfirmationPersistence
};

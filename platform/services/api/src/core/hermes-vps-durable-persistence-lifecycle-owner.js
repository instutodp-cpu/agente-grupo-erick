'use strict';

const { COMPOSITION_VERSION } = require('./hermes-vps-durable-persistence-composition');

const LIFECYCLE_OWNER_VERSION = 'hermes-vps-durable-persistence-lifecycle-owner-v1';

function validateComposition(composition) {
  if (!composition || typeof composition !== 'object') throw new Error('lifecycle_composition_invalid');
  if (composition.composition_version !== COMPOSITION_VERSION) throw new Error('lifecycle_composition_version_invalid');
  if (!composition.persistence || typeof composition.persistence !== 'object') throw new Error('lifecycle_composition_invalid');
  if (!composition.registry || typeof composition.registry !== 'object') throw new Error('lifecycle_composition_invalid');
  if (typeof composition.close !== 'function') throw new Error('lifecycle_composition_close_missing');
}

function createHermesVpsDurablePersistenceLifecycleOwner({ composition } = {}) {
  validateComposition(composition);
  let closePromise;

  function close() {
    if (!closePromise) {
      closePromise = Promise.resolve().then(() => composition.close());
    }
    return closePromise;
  }

  return Object.freeze({
    lifecycle_owner_version: LIFECYCLE_OWNER_VERSION,
    persistence: composition.persistence,
    registry: composition.registry,
    close
  });
}

module.exports = {
  LIFECYCLE_OWNER_VERSION,
  createHermesVpsDurablePersistenceLifecycleOwner
};

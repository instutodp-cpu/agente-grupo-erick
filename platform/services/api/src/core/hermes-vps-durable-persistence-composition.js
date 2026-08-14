'use strict';

const {
  createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig
} = require('./hermes-vps-durable-authorization-lifecycle-persistence-factory');

const COMPOSITION_VERSION = 'hermes-vps-durable-persistence-composition-v1';

function createHermesVpsDurablePersistenceComposition(options = {}) {
  const selected = createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig(options);
  let closePromise;

  function close() {
    if (!closePromise) {
      closePromise = Promise.resolve().then(() => {
        if (typeof selected.close === 'function') return selected.close();
        return undefined;
      });
    }
    return closePromise;
  }

  return Object.freeze({
    composition_version: COMPOSITION_VERSION,
    mode: selected.mode,
    persistence: selected.persistence,
    registry: selected.registry,
    production_durable: selected.production_durable,
    durability_claim: selected.durability_claim,
    owns_persistence_lifecycle: typeof selected.close === 'function',
    close
  });
}

module.exports = {
  COMPOSITION_VERSION,
  createHermesVpsDurablePersistenceComposition
};

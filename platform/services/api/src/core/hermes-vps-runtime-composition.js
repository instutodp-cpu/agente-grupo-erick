'use strict';

const {
  createHermesVpsDurablePersistenceComposition
} = require('./hermes-vps-durable-persistence-composition');
const {
  createHermesVpsDurablePersistenceLifecycleOwner
} = require('./hermes-vps-durable-persistence-lifecycle-owner');

const RUNTIME_COMPOSITION_VERSION = 'hermes-vps-runtime-composition-v1';

function createHermesVpsRuntimeComposition({
  provisioning_plan,
  composition_options = {},
  composition_factory = createHermesVpsDurablePersistenceComposition,
  lifecycle_owner_factory = createHermesVpsDurablePersistenceLifecycleOwner
} = {}) {
  if (typeof composition_factory !== 'function') throw new Error('runtime_composition_factory_invalid');
  if (typeof lifecycle_owner_factory !== 'function') throw new Error('runtime_lifecycle_owner_factory_invalid');

  const composition = composition_factory({
    ...composition_options,
    provisioning_plan
  });
  const lifecycleOwner = lifecycle_owner_factory({ composition });

  return Object.freeze({
    runtime_composition_version: RUNTIME_COMPOSITION_VERSION,
    persistence: lifecycleOwner.persistence,
    registry: lifecycleOwner.registry,
    lifecycle_owner: lifecycleOwner,
    close: lifecycleOwner.close
  });
}

module.exports = {
  RUNTIME_COMPOSITION_VERSION,
  createHermesVpsRuntimeComposition
};

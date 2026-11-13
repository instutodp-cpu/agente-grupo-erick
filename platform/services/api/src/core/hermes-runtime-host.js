'use strict';

const { isPlainObject } = require('./read-only-adapter-contract');
const {
  createHermesVpsRuntimeProvisioning
} = require('./hermes-vps-runtime-provisioning-source');
const {
  createHermesVpsRuntimeComposition
} = require('./hermes-vps-runtime-composition');

const HERMES_RUNTIME_HOST_VERSION = 'hermes-runtime-host-v1';

function hostError(reason) {
  return new Error(`hermes_runtime_host_${reason}`);
}

function validateComposition(composition) {
  if (!isPlainObject(composition)) throw hostError('composition_invalid');
  if (!isPlainObject(composition.persistence)) throw hostError('composition_persistence_missing');
  if (!isPlainObject(composition.registry)) throw hostError('composition_registry_missing');
  if (typeof composition.close !== 'function') throw hostError('composition_close_missing');
}

function validateProvisioning(provisioning) {
  if (!isPlainObject(provisioning) || !isPlainObject(provisioning.provisioning_plan)) {
    throw hostError('provisioning_invalid');
  }
}

function createHermesRuntimeHost({
  runtime_input,
  provisioning_source_factory = createHermesVpsRuntimeProvisioning,
  runtime_composition_factory = createHermesVpsRuntimeComposition
} = {}) {
  if (!isPlainObject(runtime_input)) throw hostError('runtime_input_required');
  if (typeof provisioning_source_factory !== 'function') throw hostError('provisioning_source_factory_invalid');
  if (typeof runtime_composition_factory !== 'function') throw hostError('runtime_composition_factory_invalid');

  let startPromise;
  let closePromise;
  let composition;
  let closed = false;

  function start() {
    if (closed) return Promise.reject(hostError('already_closed'));
    if (!startPromise) {
      startPromise = Promise.resolve().then(() => {
        const provisioning = provisioning_source_factory({ input: runtime_input });
        validateProvisioning(provisioning);
        composition = runtime_composition_factory({
          provisioning_plan: provisioning.provisioning_plan,
          composition_options: { env: {} }
        });
        validateComposition(composition);
        return Object.freeze({
          host_version: HERMES_RUNTIME_HOST_VERSION,
          provisioning,
          persistence: composition.persistence,
          registry: composition.registry
        });
      }).catch(async (error) => {
        if (composition && typeof composition.close === 'function') {
          try {
            await composition.close();
          } catch {
            // Preserve the startup error; rollback remains best-effort and fail-closed.
          }
        }
        composition = null;
        throw error;
      });
    }
    return startPromise;
  }

  function close() {
    if (!closePromise) {
      closed = true;
      closePromise = Promise.resolve().then(async () => {
        if (!startPromise) return undefined;
        await startPromise;
        return composition.close();
      });
    }
    return closePromise;
  }

  return Object.freeze({
    host_version: HERMES_RUNTIME_HOST_VERSION,
    start,
    close
  });
}

module.exports = {
  HERMES_RUNTIME_HOST_VERSION,
  createHermesRuntimeHost
};

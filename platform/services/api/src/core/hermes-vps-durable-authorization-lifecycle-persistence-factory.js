'use strict';

const {
  createDeterministicDurableLifecycleTestStore,
  createHermesVpsDurableAuthorizationLifecycleRegistry
} = require('./hermes-vps-durable-authorization-lifecycle-registry');
const {
  createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv
} = require('./hermes-vps-postgres-authorization-lifecycle-persistence');

const PERSISTENCE_MODES = Object.freeze(['memory', 'postgres']);
const DEFAULT_PERSISTENCE_MODE = 'memory';
const MODE_ENV = 'HERMES_DURABLE_PERSISTENCE_MODE';

function selectionError(reason) {
  const error = new Error(`hermes_durable_persistence_configuration_${reason}`);
  error.code = `HERMES_DURABLE_PERSISTENCE_CONFIGURATION_${reason.toUpperCase()}`;
  return error;
}

function selectedMode(env, mode) {
  const configured = mode === undefined ? env[MODE_ENV] : mode;
  return configured === undefined || configured === '' ? DEFAULT_PERSISTENCE_MODE : configured;
}

function validPostgresUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const parsed = new URL(value);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && parsed.hostname.length > 0;
  } catch {
    return false;
  }
}

function createHermesVpsDurableAuthorizationLifecyclePersistence({
  mode,
  env = process.env,
  provisioning_plan,
  PoolClass
} = {}) {
  const selected = selectedMode(env, mode);
  if (!PERSISTENCE_MODES.includes(selected)) throw selectionError('mode_invalid');

  if (selected === 'memory') {
    return Object.freeze({
      mode: selected,
      production_durable: false,
      durability_claim: 'REFERENCE_TEST_ONLY',
      persistence: createDeterministicDurableLifecycleTestStore()
    });
  }

  if (!provisioning_plan) throw selectionError('provisioning_plan_required');
  if (typeof env.HERMES_DURABLE_DATABASE_URL !== 'string' || env.HERMES_DURABLE_DATABASE_URL.trim() === '') throw selectionError('database_url_missing');
  if (!validPostgresUrl(env.HERMES_DURABLE_DATABASE_URL)) throw selectionError('database_url_invalid');

  const configured = createPostgresHermesVpsAuthorizationLifecyclePersistenceFromEnv({ env, PoolClass });
  return Object.freeze({
    mode: selected,
    production_durable: true,
    persistence: configured.create(provisioning_plan),
    close: configured.close
  });
}

function createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig(options = {}) {
  const selected = createHermesVpsDurableAuthorizationLifecyclePersistence(options);
  const registry = createHermesVpsDurableAuthorizationLifecycleRegistry({
    provisioning_plan: options.provisioning_plan,
    persistence: selected.persistence
  });
  return Object.freeze({ ...selected, registry });
}

module.exports = {
  DEFAULT_PERSISTENCE_MODE,
  MODE_ENV,
  PERSISTENCE_MODES,
  createHermesVpsDurableAuthorizationLifecyclePersistence,
  createHermesVpsDurableAuthorizationLifecycleRegistryFromConfig
};

'use strict';

const { deepFreeze } = require('./queue-simulation-hardening-test-helpers');

const CACHEABLE_KEYS = Object.freeze(new Set([
  'scenario:prepared-no-llm-plan|overrides:none',
  'scenario:prepared-no-llm-plan|overrides:registrySnapshotRef=null',
  'scenario:sequential-plan|overrides:none'
]));

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyOwnKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function getRuntimeQueueAdmissionGoldenFixtureCacheKey(args) {
  if (args.length > 2) return null;
  const scenarioKey = args.length === 0 || args[0] === undefined ? 'prepared-no-llm-plan' : args[0];
  if (typeof scenarioKey !== 'string' || scenarioKey.length === 0) return null;

  const overrides = args.length >= 2 ? args[1] : undefined;
  let key = null;
  if (overrides === undefined) key = `scenario:${scenarioKey}|overrides:none`;
  if (hasOnlyOwnKeys(overrides, ['registrySnapshotRef']) && overrides.registrySnapshotRef === null) {
    key = `scenario:${scenarioKey}|overrides:registrySnapshotRef=null`;
  }
  return CACHEABLE_KEYS.has(key) ? key : null;
}

function cloneGoldenFixtureForConsumer(fixture) {
  if (typeof structuredClone !== 'function') {
    throw new Error('structured_clone_required_for_queue_admission_fixture_cache');
  }
  return deepFreeze(structuredClone(fixture));
}

function snapshotStats(stats) {
  return {
    cachedBuilds: stats.cachedBuilds,
    cacheHits: stats.cacheHits,
    uncachedBuilds: stats.uncachedBuilds,
    cachedKeys: [...stats.cachedKeys].sort()
  };
}

function createRuntimeQueueAdmissionGoldenFixtureCache(buildGoldenQueueAdmissionBundle) {
  if (typeof buildGoldenQueueAdmissionBundle !== 'function') {
    throw new TypeError('build_golden_queue_admission_bundle_must_be_function');
  }

  const cache = new Map();
  const stats = {
    cachedBuilds: 0,
    cacheHits: 0,
    uncachedBuilds: 0,
    cachedKeys: new Set()
  };

  function build(...args) {
    const key = getRuntimeQueueAdmissionGoldenFixtureCacheKey(args);
    if (key === null) {
      stats.uncachedBuilds += 1;
      return buildGoldenQueueAdmissionBundle(...args);
    }

    if (!cache.has(key)) {
      const fixture = deepFreeze(buildGoldenQueueAdmissionBundle(...args));
      const consumerFixture = cloneGoldenFixtureForConsumer(fixture);
      cache.set(key, fixture);
      stats.cachedBuilds += 1;
      stats.cachedKeys.add(key);
      return consumerFixture;
    } else {
      stats.cacheHits += 1;
    }
    return cloneGoldenFixtureForConsumer(cache.get(key));
  }

  return Object.freeze({
    build,
    getStats: () => snapshotStats(stats)
  });
}

function createRuntimeQueueAdmissionBoundaryProofCache(evaluateRuntimeQueueAdmissionRequest) {
  if (typeof evaluateRuntimeQueueAdmissionRequest !== 'function') {
    throw new TypeError('evaluate_runtime_queue_admission_request_must_be_function');
  }

  const cache = new Map();
  const stats = {
    requests: 0,
    realBoundaryExecutions: 0,
    cacheHits: 0,
    cachedKeys: new Set()
  };

  function evaluate(semanticKey, request, context = {}) {
    if (typeof semanticKey !== 'string' || semanticKey.length === 0) {
      throw new TypeError('queue_admission_boundary_proof_semantic_key_required');
    }

    stats.requests += 1;
    if (!cache.has(semanticKey)) {
      const outcome = evaluateRuntimeQueueAdmissionRequest(request, context);
      cache.set(semanticKey, cloneGoldenFixtureForConsumer(outcome));
      stats.realBoundaryExecutions += 1;
      stats.cachedKeys.add(semanticKey);
    } else {
      stats.cacheHits += 1;
    }

    return cloneGoldenFixtureForConsumer(cache.get(semanticKey));
  }

  return Object.freeze({
    evaluate,
    getStats: () => ({
      requests: stats.requests,
      realBoundaryExecutions: stats.realBoundaryExecutions,
      cacheHits: stats.cacheHits,
      cachedKeys: [...stats.cachedKeys].sort()
    })
  });
}

module.exports = {
  createRuntimeQueueAdmissionBoundaryProofCache,
  createRuntimeQueueAdmissionGoldenFixtureCache,
  getRuntimeQueueAdmissionGoldenFixtureCacheKey
};

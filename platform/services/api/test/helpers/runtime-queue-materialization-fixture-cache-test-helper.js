'use strict';

const { deepFreeze } = require('./queue-simulation-hardening-test-helpers');

const CACHEABLE_SCENARIO_KEYS = Object.freeze(new Set([
  'prepared-no-llm-plan',
  'sequential-plan',
  'parallel-plan'
]));

function getRuntimeQueueMaterializationGoldenFixtureCacheKey(args) {
  if (args.length > 2) {
    throw new Error('unsupported_queue_materialization_fixture_cache_arity');
  }
  const scenarioKey = args.length === 0 || args[0] === undefined ? 'prepared-no-llm-plan' : args[0];
  if (typeof scenarioKey !== 'string' || !CACHEABLE_SCENARIO_KEYS.has(scenarioKey)) {
    throw new Error('unsupported_queue_materialization_fixture_cache_key');
  }
  const overrides = args.length >= 2 ? args[1] : undefined;
  if (overrides !== undefined) return null;
  return `scenario:${scenarioKey}|overrides:none`;
}

function cloneGoldenFixtureForConsumer(fixture) {
  if (typeof structuredClone !== 'function') {
    throw new Error('structured_clone_required_for_queue_materialization_fixture_cache');
  }
  return structuredClone(fixture);
}

function assertMaterializationFixtureShape(fixture) {
  if (!fixture || typeof fixture !== 'object' || !fixture.queueMaterializationRequest || typeof fixture.queueMaterializationRequest !== 'object') {
    throw new Error('invalid_queue_materialization_fixture_cache_baseline');
  }
}

function snapshotStats(stats) {
  return {
    cachedBuilds: stats.cachedBuilds,
    cacheHits: stats.cacheHits,
    uncachedBuilds: stats.uncachedBuilds,
    cachedKeys: [...stats.cachedKeys].sort()
  };
}

function createRuntimeQueueMaterializationGoldenFixtureCache(buildGoldenQueueMaterializationBundle) {
  if (typeof buildGoldenQueueMaterializationBundle !== 'function') {
    throw new TypeError('build_golden_queue_materialization_bundle_must_be_function');
  }

  // Process-local test cache only. Stored baselines are frozen; consumers receive independent clones.
  const cache = new Map();
  const stats = {
    cachedBuilds: 0,
    cacheHits: 0,
    uncachedBuilds: 0,
    cachedKeys: new Set()
  };

  function build(...args) {
    const key = getRuntimeQueueMaterializationGoldenFixtureCacheKey(args);
    if (key === null) {
      stats.uncachedBuilds += 1;
      return buildGoldenQueueMaterializationBundle(...args);
    }

    if (!cache.has(key)) {
      const fixture = buildGoldenQueueMaterializationBundle(...args);
      assertMaterializationFixtureShape(fixture);
      const baseline = deepFreeze(structuredClone(fixture));
      cache.set(key, baseline);
      stats.cachedBuilds += 1;
      stats.cachedKeys.add(key);
      return cloneGoldenFixtureForConsumer(baseline);
    }

    stats.cacheHits += 1;
    return cloneGoldenFixtureForConsumer(cache.get(key));
  }

  return Object.freeze({
    build,
    getStats: () => snapshotStats(stats)
  });
}

module.exports = {
  createRuntimeQueueMaterializationGoldenFixtureCache,
  getRuntimeQueueMaterializationGoldenFixtureCacheKey
};

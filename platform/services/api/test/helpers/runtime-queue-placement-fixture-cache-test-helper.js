'use strict';

const { deepFreeze } = require('./queue-simulation-hardening-test-helpers');

const CACHEABLE_KEYS = Object.freeze(new Set([
  'scenario:prepared-no-llm-plan|overrides:none',
  'scenario:sequential-plan|overrides:none'
]));

function getRuntimeQueuePlacementGoldenFixtureCacheKey(args) {
  if (args.length > 2) return null;
  const scenarioKey = args.length === 0 || args[0] === undefined ? 'prepared-no-llm-plan' : args[0];
  if (typeof scenarioKey !== 'string' || scenarioKey.length === 0) return null;
  const overrides = args.length >= 2 ? args[1] : undefined;
  if (overrides !== undefined) return null;
  const key = `scenario:${scenarioKey}|overrides:none`;
  return CACHEABLE_KEYS.has(key) ? key : null;
}

function cloneGoldenFixtureForConsumer(fixture) {
  if (typeof structuredClone !== 'function') {
    throw new Error('structured_clone_required_for_queue_placement_fixture_cache');
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

function createRuntimeQueuePlacementGoldenFixtureCache(buildGoldenQueuePlacementBundle) {
  if (typeof buildGoldenQueuePlacementBundle !== 'function') {
    throw new TypeError('build_golden_queue_placement_bundle_must_be_function');
  }

  // Process-local test cache only. Every consumer receives a cloned, frozen fixture.
  const cache = new Map();
  const stats = {
    cachedBuilds: 0,
    cacheHits: 0,
    uncachedBuilds: 0,
    cachedKeys: new Set()
  };

  function build(...args) {
    const key = getRuntimeQueuePlacementGoldenFixtureCacheKey(args);
    if (key === null) {
      stats.uncachedBuilds += 1;
      return buildGoldenQueuePlacementBundle(...args);
    }

    if (!cache.has(key)) {
      const fixture = buildGoldenQueuePlacementBundle(...args);
      const consumerFixture = cloneGoldenFixtureForConsumer(fixture);
      cache.set(key, fixture);
      stats.cachedBuilds += 1;
      stats.cachedKeys.add(key);
      return consumerFixture;
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
  createRuntimeQueuePlacementGoldenFixtureCache,
  getRuntimeQueuePlacementGoldenFixtureCacheKey
};

const crypto = require('crypto');

const cacheStore = new Map();

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createCacheKey({ templateName, templateVersion, params }) {
  const raw = stableStringify({ templateName, templateVersion, params });
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function getCacheEntry(cacheKey, now = Date.now()) {
  const entry = cacheStore.get(cacheKey);
  if (!entry) return { status: 'miss' };

  if (entry.expiresAt <= now) {
    cacheStore.delete(cacheKey);
    return { status: 'expired', entry };
  }

  return { status: 'hit', entry };
}

function setCacheEntry(cacheKey, value, ttlMs, metadata = {}, now = Date.now()) {
  if (!ttlMs || ttlMs <= 0) return null;

  const entry = {
    value,
    metadata,
    createdAt: now,
    expiresAt: now + ttlMs,
    ttlMs
  };
  cacheStore.set(cacheKey, entry);
  return entry;
}

function clearCache() {
  cacheStore.clear();
}

module.exports = {
  clearCache,
  createCacheKey,
  getCacheEntry,
  setCacheEntry,
  stableStringify
};

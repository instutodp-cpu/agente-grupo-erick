'use strict';

const { uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const {
  PROVIDER_ADAPTER_SAFE_FLAGS,
  cloneFrozen,
  safeAdapterResult,
  validateProviderAdapterMetadata
} = require('./transcription-provider-adapter-interface');

function createProviderAdapterRegistry({ historyLimit = 20 } = {}) {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();

  function registerAdapter(record, context = {}) {
    const validation = validateProviderAdapterMetadata(record);
    if (!validation.valid) return safeAdapterResult({ ok: false, errors: validation.errors });
    if (context.expected_version !== undefined && context.expected_version !== record.adapter_version) {
      return safeAdapterResult({ ok: false, errors: ['adapter_optimistic_version_conflict'] });
    }
    let hash;
    try {
      hash = stablePayload(record);
    } catch (error) {
      return safeAdapterResult({ ok: false, errors: [`adapter_fingerprint_invalid::${error.message}`] });
    }
    const id = record.adapter_id;
    if (records.has(id)) {
      if (hashes.get(id) === hash) return safeAdapterResult({ ok: false, errors: ['adapter_replay_duplicate'] });
      return safeAdapterResult({ ok: false, errors: ['adapter_replay_payload_mismatch'] });
    }
    const previousVersion = versions.get(record.provider_slug) || 0;
    if (record.adapter_version <= previousVersion) return safeAdapterResult({ ok: false, errors: ['adapter_version_downgrade'] });
    const stored = cloneFrozen(record);
    records.set(id, stored);
    hashes.set(id, hash);
    versions.set(record.provider_slug, record.adapter_version);
    history.set(record.provider_slug, [...(history.get(record.provider_slug) || []), {
      adapter_id: record.adapter_id,
      adapter_version: record.adapter_version,
      provider_slug: record.provider_slug,
      contract_version: record.contract_version,
      validator_version: record.validator_version,
      ...PROVIDER_ADAPTER_SAFE_FLAGS
    }].slice(-historyLimit));
    return safeAdapterResult({ ok: true, adapter_id: id, adapter_version: record.adapter_version });
  }

  function getAdapter(adapterId) {
    return records.has(adapterId) ? cloneFrozen(records.get(adapterId)) : null;
  }

  function getHistory(providerSlug) {
    return cloneFrozen(history.get(providerSlug) || []);
  }

  return Object.freeze({
    registerAdapter,
    getAdapter,
    getHistory,
    listAdapterIds() {
      return cloneFrozen([...records.keys()].sort());
    },
    validateRegistryInvariant() {
      const errors = [];
      for (const record of records.values()) {
        const validation = validateProviderAdapterMetadata(record);
        if (!validation.valid) errors.push(...validation.errors);
      }
      return safeAdapterResult({ ok: errors.length === 0, errors: uniqueSorted(errors) });
    }
  });
}

module.exports = {
  createProviderAdapterRegistry
};

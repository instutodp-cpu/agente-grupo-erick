'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const { uniqueSorted } = require('./read-only-adapter-contract');
const {
  deepFreeze,
  safeTransportResult,
  validateTranscriptionTransportContract
} = require('./transcription-transport-contract');

function cloneFrozen(value) {
  return deepFreeze(deepClone(sanitizeTranscriptionData(value)));
}

function createTranscriptionTransportRegistry({ historyLimit = 20 } = {}) {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  const transitions = new Set();

  function registerTransportContract(record) {
    const validation = validateTranscriptionTransportContract(record);
    if (!validation.valid) return safeTransportResult({ ok: false, errors: validation.errors });
    let hash;
    try {
      hash = stablePayload(record);
    } catch (error) {
      return safeTransportResult({ ok: false, errors: [`transport_fingerprint_invalid::${error.message}`] });
    }
    const id = record.transport_contract_id;
    if (records.has(id)) {
      if (hashes.get(id) === hash) return safeTransportResult({ ok: false, errors: ['transport_replay_duplicate'] });
      return safeTransportResult({ ok: false, errors: ['transport_replay_payload_mismatch'] });
    }
    const versionKey = record.provider_slug;
    const previousVersion = versions.get(versionKey) || 0;
    if (record.transport_version <= previousVersion) return safeTransportResult({ ok: false, errors: ['transport_version_downgrade'] });
    const stored = cloneFrozen(record);
    records.set(id, stored);
    hashes.set(id, hash);
    versions.set(versionKey, record.transport_version);
    history.set(versionKey, [...(history.get(versionKey) || []), {
      transport_contract_id: id,
      transport_version: record.transport_version,
      provider_slug: record.provider_slug,
      transport_state: record.transport_state
    }].slice(-historyLimit));
    return safeTransportResult({ ok: true, transport_contract_id: id, transport_version: record.transport_version });
  }

  function recordTransition(transition = {}) {
    const errors = [];
    if (!transition.transition_id) errors.push('transition_id_required');
    if (!transition.transport_contract_id) errors.push('transport_contract_id_required');
    if (!records.has(transition.transport_contract_id)) errors.push('transport_contract_not_found');
    if (transition.transition_id && transitions.has(transition.transition_id)) errors.push('transport_transition_replay');
    if (errors.length > 0) return safeTransportResult({ ok: false, errors: uniqueSorted(errors) });
    transitions.add(transition.transition_id);
    return safeTransportResult({ ok: true, transition_id: transition.transition_id });
  }

  return Object.freeze({
    registerTransportContract,
    recordTransition,
    getTransportContract(id) {
      return records.has(id) ? cloneFrozen(records.get(id)) : null;
    },
    getTransportHistory(providerSlug) {
      return cloneFrozen(history.get(providerSlug) || []);
    }
  });
}

module.exports = {
  createTranscriptionTransportRegistry
};

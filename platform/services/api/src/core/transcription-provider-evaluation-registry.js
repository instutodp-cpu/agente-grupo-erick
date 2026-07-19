'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');

const REGISTRY_STORAGE = new WeakMap();

function stablePayload(value) {
  if (Array.isArray(value)) return `[${value.map(stablePayload).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stablePayload(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function createTranscriptionProviderEvaluationRegistry() {
  const evaluations = new Map();
  const history = new Map();

  function blocked(reason, errors = [reason]) {
    return Object.freeze({ ok: false, blocked_reason: reason, errors: uniqueSorted(errors), simulated: true, executed: false, real_provider_called: false, external_network_called: false });
  }

  function registerEvaluation(record) {
    const errors = [];
    if (!isPlainObject(record)) return blocked('evaluation_missing');
    for (const field of ['evaluation_id', 'provider_candidate_id', 'candidate_version', 'evaluation_version', 'dataset_version', 'criteria_version', 'evaluation_expires_at', 'payload']) {
      if (!Object.prototype.hasOwnProperty.call(record, field)) errors.push(`missing_${field}`);
    }
    for (const field of ['evaluation_id', 'provider_candidate_id', 'dataset_version', 'criteria_version', 'evaluation_expires_at']) {
      if (!isNonEmptyString(record[field])) errors.push(`invalid_${field}`);
    }
    if (!Number.isInteger(record.candidate_version) || record.candidate_version < 1) errors.push('candidate_version_invalid');
    if (!Number.isInteger(record.evaluation_version) || record.evaluation_version < 1) errors.push('evaluation_version_invalid');
    if (!record.evaluation_expires_at || Number.isNaN(Date.parse(record.evaluation_expires_at))) errors.push('evaluation_expires_at_invalid');
    if (record.evaluation_expires_at && Date.parse(record.evaluation_expires_at) <= Date.parse(record.now || new Date(0).toISOString())) errors.push('dataset_expired');
    const { payload, ...recordWithoutPayload } = record;
    errors.push(...findTranscriptionForbiddenFields(recordWithoutPayload));
    errors.push(...findTranscriptionForbiddenFields(payload));
    if (errors.length > 0) return blocked(errors[0], errors);
    const current = evaluations.get(record.evaluation_id);
    const hash = stablePayload(record.payload);
    if (current) {
      if (current.payload_hash === hash) return blocked('evaluation_replay_duplicate');
      return blocked('evaluation_replay_payload_mismatch');
    }
    const byProvider = [...evaluations.values()].filter((item) => item.provider_candidate_id === record.provider_candidate_id);
    const latest = byProvider.sort((a, b) => b.evaluation_version - a.evaluation_version)[0];
    if (latest && record.evaluation_version < latest.evaluation_version) return blocked('evaluation_version_downgrade');
    if (latest && record.evaluation_version === latest.evaluation_version && record.candidate_version !== latest.candidate_version) return blocked('optimistic_version_conflict');
    const stored = Object.freeze(sanitizeTranscriptionData({ ...record, payload_hash: hash, simulated: true, executed: false, real_provider_called: false, external_network_called: false }));
    evaluations.set(record.evaluation_id, stored);
    const events = history.get(record.provider_candidate_id) || [];
    events.push(Object.freeze(sanitizeTranscriptionData({ evaluation_id: record.evaluation_id, evaluation_version: record.evaluation_version, dataset_version: record.dataset_version })));
    history.set(record.provider_candidate_id, events);
    return Object.freeze({ ok: true, evaluation: deepClone(stored), simulated: true, executed: false, real_provider_called: false, external_network_called: false });
  }

  const registry = Object.freeze({
    registerEvaluation,
    getEvaluation(evaluationId) {
      return evaluations.has(evaluationId) ? deepClone(evaluations.get(evaluationId)) : null;
    },
    getHistory(providerCandidateId) {
      return (history.get(providerCandidateId) || []).map(deepClone);
    }
  });
  REGISTRY_STORAGE.set(registry, { evaluations, history });
  return registry;
}

module.exports = {
  createTranscriptionProviderEvaluationRegistry
};

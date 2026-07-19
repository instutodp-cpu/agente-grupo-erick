'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderContract } = require('./transcription-provider-contract');
const { validateProviderCapabilitiesSet } = require('./transcription-provider-capabilities');
const { validateTranscriptionProviderConfiguration } = require('./transcription-provider-configuration-boundary');
const { validateTranscriptionProviderSecretReference } = require('./transcription-provider-secret-boundary');
const { PROVIDER_CONTRACT_READINESS_DECISIONS } = require('./transcription-provider-contract-readiness');

const SAFE_FLAGS = Object.freeze({
  simulated: true,
  executed: false,
  real_provider_called: false,
  external_network_called: false,
  can_trigger_real_execution: false,
  production_blocked: true,
  provider_runtime_enabled: false,
  provider_selected_for_execution: false,
  transport_enabled: false,
  secret_resolved: false
});

function safeResponse(payload) {
  return Object.freeze({ ...payload, ...SAFE_FLAGS });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return value;
}

function stableCanonicalize(value, seen = new WeakSet()) {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('non_finite_number_not_serializable');
    return value;
  }
  if (type === 'undefined') throw new TypeError('undefined_not_serializable');
  if (type === 'function') throw new TypeError('function_not_serializable');
  if (type === 'symbol') throw new TypeError('symbol_not_serializable');
  if (type === 'bigint') throw new TypeError('bigint_not_serializable');
  if (Buffer.isBuffer(value) || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new TypeError('binary_not_serializable');
  }
  if (value instanceof Date) throw new TypeError('date_not_serializable');
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError('cyclic_reference_not_serializable');
    seen.add(value);
    const canonical = value.map((item) => stableCanonicalize(item, seen));
    seen.delete(value);
    return canonical;
  }
  if (!isPlainObject(value)) throw new TypeError('non_plain_object_not_serializable');
  if (seen.has(value)) throw new TypeError('cyclic_reference_not_serializable');
  seen.add(value);
  const canonical = {};
  for (const key of Object.keys(value).sort()) {
    canonical[key] = stableCanonicalize(value[key], seen);
  }
  seen.delete(value);
  return canonical;
}

function stablePayload(value) {
  return JSON.stringify(stableCanonicalize(value));
}

function cloneSanitizedFrozen(value) {
  return deepFreeze(deepClone(sanitizeTranscriptionData(value)));
}

function validateReadinessEvaluation(record) {
  const errors = [];
  if (!isPlainObject(record)) return { valid: false, errors: ['readiness_evaluation_must_be_object'] };
  for (const field of ['readiness_evaluation_id', 'readiness_evaluation_version', 'provider_slug', 'readiness_decision', 'evaluated_at', 'simulated', 'executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'rollout_percentage', 'production_blocked', 'provider_runtime_enabled', 'provider_selected_for_execution', 'transport_enabled', 'secret_resolved']) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['readiness_evaluation_id', 'provider_slug', 'readiness_decision', 'evaluated_at']) {
    if (!isNonEmptyString(record[field])) errors.push(`invalid_${field}`);
  }
  if (!['deepgram', 'google_cloud_speech'].includes(record.provider_slug)) errors.push(`provider_slug_not_allowed::${record.provider_slug}`);
  if (!PROVIDER_CONTRACT_READINESS_DECISIONS.includes(record.readiness_decision)) errors.push(`readiness_decision_not_allowed::${record.readiness_decision}`);
  if (!Number.isInteger(record.readiness_evaluation_version) || record.readiness_evaluation_version < 1) errors.push('readiness_evaluation_version_invalid');
  if (!isNonEmptyString(record.evaluated_at) || Number.isNaN(Date.parse(record.evaluated_at))) errors.push('evaluated_at_invalid');
  if (record.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'provider_runtime_enabled', 'provider_selected_for_execution', 'transport_enabled', 'secret_resolved']) {
    if (record[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (record.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (record.production_blocked !== true) errors.push('production_blocked_must_be_true');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function createBucket(name, validator, idField, versionField) {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  function register(record) {
    const validation = validator(record);
    if (!validation.valid) return safeResponse({ ok: false, errors: validation.errors });
    const id = record[idField];
    const version = record[versionField];
    let hash;
    try {
      hash = stablePayload(record);
    } catch (error) {
      return safeResponse({ ok: false, errors: [`${name}_fingerprint_invalid::${error.message}`] });
    }
    if (records.has(id)) {
      if (hashes.get(id) === hash) return safeResponse({ ok: false, errors: [`${name}_replay_duplicate`] });
      return safeResponse({ ok: false, errors: [`${name}_replay_payload_mismatch`] });
    }
    const previousVersion = versions.get(record.provider_slug || id) || 0;
    if (version <= previousVersion) return safeResponse({ ok: false, errors: [`${name}_version_downgrade`] });
    const sanitized = cloneSanitizedFrozen(record);
    records.set(id, sanitized);
    hashes.set(id, hash);
    versions.set(record.provider_slug || id, version);
    const key = record.provider_slug || id;
    history.set(key, [...(history.get(key) || []), sanitized].slice(-20));
    return safeResponse({ ok: true, id, version });
  }
  function get(id) {
    return records.has(id) ? cloneSanitizedFrozen(records.get(id)) : null;
  }
  function getHistory(key) {
    return cloneSanitizedFrozen(history.get(key) || []);
  }
  return { register, get, getHistory };
}

function createTranscriptionProviderContractRegistry(validators = {}) {
  validators = {
    validateContract: validators.validateContract || validateProviderContract,
    validateCapabilities: validators.validateCapabilities || validateProviderCapabilitiesSet,
    validateConfiguration: validators.validateConfiguration || validateTranscriptionProviderConfiguration,
    validateSecretReference: validators.validateSecretReference || validateTranscriptionProviderSecretReference
  };
  const contractBucket = createBucket('contract', validators.validateContract, 'provider_contract_id', 'contract_version');
  const configurationBucket = createBucket('configuration', validators.validateConfiguration, 'configuration_id', 'configuration_version');
  const secretBucket = createBucket('secret_reference', validators.validateSecretReference, 'secret_reference_id', 'reference_version');
  const readinessBucket = createBucket('readiness', validateReadinessEvaluation, 'readiness_evaluation_id', 'readiness_evaluation_version');
  const capabilities = new Map();
  function registerCapabilities(providerSlug, capabilityRecords) {
    const validation = validators.validateCapabilities(capabilityRecords, { provider_slug: providerSlug });
    if (!validation.valid) return safeResponse({ ok: false, errors: validation.errors });
    let hash;
    try {
      hash = stablePayload(capabilityRecords);
    } catch (error) {
      return safeResponse({ ok: false, errors: [`capabilities_fingerprint_invalid::${error.message}`] });
    }
    if (capabilities.has(providerSlug)) {
      if (capabilities.get(providerSlug).hash === hash) return safeResponse({ ok: false, errors: ['capabilities_replay_duplicate'] });
      return safeResponse({ ok: false, errors: ['capabilities_replay_payload_mismatch'] });
    }
    capabilities.set(providerSlug, { hash, records: cloneSanitizedFrozen(capabilityRecords) });
    return safeResponse({ ok: true, provider_slug: providerSlug });
  }
  return Object.freeze({
    registerContract: contractBucket.register,
    getContract: contractBucket.get,
    getContractHistory: contractBucket.getHistory,
    registerConfiguration: configurationBucket.register,
    getConfiguration: configurationBucket.get,
    registerSecretReference: secretBucket.register,
    getSecretReference: secretBucket.get,
    registerReadinessEvaluation: readinessBucket.register,
    getReadinessEvaluation: readinessBucket.get,
    registerCapabilities,
    getCapabilities(providerSlug) {
      return capabilities.has(providerSlug) ? cloneSanitizedFrozen(capabilities.get(providerSlug).records) : null;
    }
  });
}

module.exports = {
  createTranscriptionProviderContractRegistry,
  stableCanonicalize,
  stablePayload
};

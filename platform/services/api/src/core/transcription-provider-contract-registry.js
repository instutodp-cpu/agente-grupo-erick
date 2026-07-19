'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { validateProviderContract } = require('./transcription-provider-contract');
const { validateProviderCapabilitiesSet } = require('./transcription-provider-capabilities');
const { validateTranscriptionProviderConfiguration } = require('./transcription-provider-configuration-boundary');
const { validateTranscriptionProviderSecretReference } = require('./transcription-provider-secret-boundary');

function stablePayload(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function createBucket(name, validator, idField, versionField) {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  function register(record) {
    const validation = validator(record);
    if (!validation.valid) return Object.freeze({ ok: false, errors: validation.errors, simulated: true, executed: false, real_provider_called: false });
    const id = record[idField];
    const version = record[versionField];
    const hash = stablePayload(record);
    if (records.has(id)) {
      if (hashes.get(id) === hash) return Object.freeze({ ok: false, errors: [`${name}_replay_duplicate`], simulated: true, executed: false, real_provider_called: false });
      return Object.freeze({ ok: false, errors: [`${name}_replay_payload_mismatch`], simulated: true, executed: false, real_provider_called: false });
    }
    const previousVersion = versions.get(record.provider_slug || id) || 0;
    if (version <= previousVersion) return Object.freeze({ ok: false, errors: [`${name}_version_downgrade`], simulated: true, executed: false, real_provider_called: false });
    const sanitized = sanitizeTranscriptionData(record);
    records.set(id, sanitized);
    hashes.set(id, hash);
    versions.set(record.provider_slug || id, version);
    const key = record.provider_slug || id;
    history.set(key, [...(history.get(key) || []), sanitized]);
    return Object.freeze({ ok: true, id, version, simulated: true, executed: false, real_provider_called: false });
  }
  function get(id) {
    return records.has(id) ? deepClone(records.get(id)) : null;
  }
  function getHistory(key) {
    return deepClone(history.get(key) || []);
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
  const readinessBucket = createBucket('readiness', (record) => (
    isPlainObject(record) && isNonEmptyString(record.readiness_evaluation_id)
      ? { valid: true, errors: [] }
      : { valid: false, errors: ['readiness_evaluation_id_invalid'] }
  ), 'readiness_evaluation_id', 'readiness_evaluation_version');
  const capabilities = new Map();
  function registerCapabilities(providerSlug, capabilityRecords) {
    const validation = validators.validateCapabilities(capabilityRecords, { provider_slug: providerSlug });
    if (!validation.valid) return Object.freeze({ ok: false, errors: validation.errors, simulated: true, executed: false, real_provider_called: false });
    if (capabilities.has(providerSlug)) return Object.freeze({ ok: false, errors: ['capabilities_replay_duplicate'], simulated: true, executed: false, real_provider_called: false });
    capabilities.set(providerSlug, sanitizeTranscriptionData(capabilityRecords));
    return Object.freeze({ ok: true, provider_slug: providerSlug, simulated: true, executed: false, real_provider_called: false });
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
      return capabilities.has(providerSlug) ? deepClone(capabilities.get(providerSlug)) : null;
    }
  });
}

module.exports = {
  createTranscriptionProviderContractRegistry,
  stablePayload
};

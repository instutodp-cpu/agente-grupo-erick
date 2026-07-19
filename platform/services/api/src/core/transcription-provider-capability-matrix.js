'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_PROVIDER_CAPABILITY_VALIDATOR_VERSION = 'transcription_provider_capability_validator_v1';
const CAPABILITY_EXECUTION_MODE = 'REVIEW_ONLY';
const ALLOWED_CAPABILITY_PROVIDER_SLUGS = Object.freeze(['mock-provider-a', 'mock-provider-b', 'mock-provider-c']);
const REQUIRED_CAPABILITY_PROFILE_FIELDS = Object.freeze([
  'provider_slug',
  'provider_version',
  'capability_profile_id',
  'capability_profile_version',
  'validator_version',
  'supports_batch',
  'supports_streaming',
  'supports_partial_results',
  'supports_word_timestamps',
  'supports_sentence_timestamps',
  'supports_speaker_diarization',
  'supports_language_detection',
  'supports_translation',
  'supports_punctuation',
  'supports_profanity_filter',
  'supports_custom_vocabulary',
  'supports_numeric_normalization',
  'supports_confidence_score',
  'supported_languages',
  'supported_audio_formats',
  'supported_sample_rates',
  'supported_channels',
  'max_audio_duration_seconds',
  'max_audio_size_mb',
  'estimated_latency_profile',
  'estimated_cost_profile',
  'execution_mode',
  'simulation',
  'network_enabled',
  'provider_enabled',
  'runtime_enabled',
  'production_blocked',
  'rollout_percentage'
]);
const BOOLEAN_CAPABILITY_FIELDS = Object.freeze([
  'supports_batch',
  'supports_streaming',
  'supports_partial_results',
  'supports_word_timestamps',
  'supports_sentence_timestamps',
  'supports_speaker_diarization',
  'supports_language_detection',
  'supports_translation',
  'supports_punctuation',
  'supports_profanity_filter',
  'supports_custom_vocabulary',
  'supports_numeric_normalization',
  'supports_confidence_score'
]);
const SAFE_FLAGS = Object.freeze({
  simulation: true,
  network_enabled: false,
  provider_enabled: false,
  runtime_enabled: false,
  production_blocked: true,
  rollout_percentage: 0
});

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function exactFields(value, required, prefix, errors) {
  const allowed = new Set(required);
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
  }
}

function validateSortedArray(value, field, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${field}_required`);
    return;
  }
  if (!value.every((entry) => isNonEmptyString(entry) || Number.isInteger(entry))) errors.push(`${field}_invalid`);
  const keys = value.map(String);
  if (new Set(keys).size !== keys.length) errors.push(`${field}_duplicate`);
  const sorted = value.every((entry) => Number.isInteger(entry))
    ? [...value].sort((left, right) => left - right)
    : [...value].sort((left, right) => String(left).localeCompare(String(right)));
  if (value.some((entry, index) => entry !== sorted[index])) errors.push(`${field}_must_be_sorted`);
}

function validateProfileObject(value, field, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${field}_must_be_object`);
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (!isNonEmptyString(key)) errors.push(`${field}_key_invalid`);
    if (typeof nested === 'number' && (!Number.isFinite(nested) || nested < 0)) errors.push(`${field}_${key}_invalid`);
    if (typeof nested !== 'string' && typeof nested !== 'number' && typeof nested !== 'boolean') errors.push(`${field}_${key}_unsupported`);
  }
}

function validateCapabilityProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['capability_profile_must_be_object'] };
  exactFields(profile, REQUIRED_CAPABILITY_PROFILE_FIELDS, 'profile', errors);
  for (const field of ['provider_slug', 'provider_version', 'capability_profile_id', 'validator_version', 'execution_mode']) {
    if (!isNonEmptyString(profile[field])) errors.push(`${field}_invalid`);
  }
  if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(profile.provider_slug)) errors.push(`provider_slug_not_allowed::${profile.provider_slug}`);
  if (!Number.isInteger(profile.capability_profile_version) || profile.capability_profile_version < 1) errors.push('capability_profile_version_invalid');
  if (profile.validator_version !== TRANSCRIPTION_PROVIDER_CAPABILITY_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  for (const field of BOOLEAN_CAPABILITY_FIELDS) {
    if (typeof profile[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  validateSortedArray(profile.supported_languages, 'supported_languages', errors);
  validateSortedArray(profile.supported_audio_formats, 'supported_audio_formats', errors);
  validateSortedArray(profile.supported_sample_rates, 'supported_sample_rates', errors);
  validateSortedArray(profile.supported_channels, 'supported_channels', errors);
  for (const field of ['max_audio_duration_seconds', 'max_audio_size_mb']) {
    if (!Number.isInteger(profile[field]) || profile[field] <= 0 || profile[field] > 1_000_000) errors.push(`${field}_out_of_bounds`);
  }
  validateProfileObject(profile.estimated_latency_profile, 'estimated_latency_profile', errors);
  validateProfileObject(profile.estimated_cost_profile, 'estimated_cost_profile', errors);
  if (profile.execution_mode !== CAPABILITY_EXECUTION_MODE) errors.push('execution_mode_must_be_REVIEW_ONLY');
  for (const [field, expected] of Object.entries(SAFE_FLAGS)) {
    if (profile[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  try {
    stablePayload(profile);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function fingerprintCapabilityProfile(profile) {
  return stablePayload(profile);
}

function normalizeCapabilityProfile(profile) {
  return cloneFrozen(profile);
}

function createTranscriptionProviderCapabilityRegistry(options = {}) {
  const records = new Map();
  const hashes = new Map();
  const versions = new Map();
  const history = new Map();
  const historyLimit = options.historyLimit || 20;

  function registerCapabilityProfile(profile, context = {}) {
    const validation = validateCapabilityProfile(profile);
    if (!validation.valid) return Object.freeze({ ok: false, errors: validation.errors, ...SAFE_FLAGS });
    if (context.expected_version !== undefined && context.expected_version !== (versions.get(profile.provider_slug) || 0) + 1) {
      return Object.freeze({ ok: false, errors: ['capability_profile_optimistic_version_conflict'], ...SAFE_FLAGS });
    }
    let fingerprint;
    try {
      fingerprint = fingerprintCapabilityProfile(profile);
    } catch (error) {
      return Object.freeze({ ok: false, errors: [`capability_profile_fingerprint_invalid::${error.message}`], ...SAFE_FLAGS });
    }
    const id = profile.capability_profile_id;
    if (records.has(id)) {
      if (hashes.get(id) === fingerprint) return Object.freeze({ ok: false, errors: ['capability_profile_replay_duplicate'], ...SAFE_FLAGS });
      return Object.freeze({ ok: false, errors: ['capability_profile_replay_payload_mismatch'], ...SAFE_FLAGS });
    }
    const previousVersion = versions.get(profile.provider_slug) || 0;
    if (profile.capability_profile_version <= previousVersion) {
      return Object.freeze({ ok: false, errors: ['capability_profile_version_downgrade'], ...SAFE_FLAGS });
    }
    const stored = normalizeCapabilityProfile(profile);
    records.set(id, stored);
    hashes.set(id, fingerprint);
    versions.set(profile.provider_slug, profile.capability_profile_version);
    history.set(profile.provider_slug, [...(history.get(profile.provider_slug) || []), stored].slice(-historyLimit));
    return Object.freeze({
      ok: true,
      capability_profile_id: id,
      provider_slug: profile.provider_slug,
      capability_profile_version: profile.capability_profile_version,
      fingerprint,
      ...SAFE_FLAGS
    });
  }

  function getCapabilityProfile(id) {
    return records.has(id) ? normalizeCapabilityProfile(records.get(id)) : null;
  }

  function getCapabilityProfileByProvider(providerSlug) {
    const entries = history.get(providerSlug) || [];
    return entries.length > 0 ? normalizeCapabilityProfile(entries[entries.length - 1]) : null;
  }

  function listCapabilityProfiles() {
    return cloneFrozen([...records.values()].sort((left, right) => left.provider_slug.localeCompare(right.provider_slug)));
  }

  function getHistory(providerSlug) {
    return cloneFrozen(history.get(providerSlug) || []);
  }

  return Object.freeze({
    registerCapabilityProfile,
    getCapabilityProfile,
    getCapabilityProfileByProvider,
    listCapabilityProfiles,
    getHistory
  });
}

module.exports = {
  ALLOWED_CAPABILITY_PROVIDER_SLUGS,
  BOOLEAN_CAPABILITY_FIELDS,
  CAPABILITY_EXECUTION_MODE,
  REQUIRED_CAPABILITY_PROFILE_FIELDS,
  SAFE_FLAGS,
  TRANSCRIPTION_PROVIDER_CAPABILITY_VALIDATOR_VERSION,
  createTranscriptionProviderCapabilityRegistry,
  fingerprintCapabilityProfile,
  normalizeCapabilityProfile,
  validateCapabilityProfile
};

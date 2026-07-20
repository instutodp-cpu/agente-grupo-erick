'use strict';

const { deepClone, findTranscriptionForbiddenFields, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const {
  ALLOWED_CAPABILITY_PROVIDER_SLUGS,
  SAFE_FLAGS,
  fingerprintCapabilityProfile,
  validateCapabilityProfile
} = require('./transcription-provider-capability-matrix');
const { createTranscriptionProviderCapabilityCatalog } = require('./transcription-provider-capability-catalog');
const { compareTranscriptionProviderCapabilities } = require('./transcription-provider-capability-comparator');
const { stablePayload } = require('./transcription-provider-contract-registry');
const {
  PRIORITY_PROFILES,
  SELECTION_WEIGHTS,
  TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION,
  estimateCost,
  estimateLatency,
  featureFields,
  scoreTranscriptionProviderCandidate
} = require('./transcription-provider-selection-scoring');
const { buildSelectionResult, validateSelectionResult } = require('./transcription-provider-selection-result');
const { buildProviderSelectionAudit } = require('./transcription-provider-selection-audit');

const TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION = 'transcription_provider_selection_engine_validator_v1';
const SELECTION_REQUEST_FIELDS = Object.freeze([
  'selection_request_id',
  'selection_request_version',
  'tenant_id',
  'conversation_id',
  'requested_language',
  'requested_audio_format',
  'requested_sample_rate',
  'requested_channels',
  'requested_duration_seconds',
  'requested_size_mb',
  'requested_features',
  'priority_profile',
  'cost_preference',
  'latency_preference',
  'quality_preference',
  'allowed_provider_slugs',
  'denied_provider_slugs',
  'simulation_context',
  'metadata',
  'validator_version'
]);
const REQUESTED_FEATURE_FIELDS = Object.freeze(Object.keys(featureFields()));
const PREFERENCES = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const FILTERS_APPLIED = Object.freeze([
  'language',
  'format',
  'sample_rate',
  'channels',
  'duration',
  'size',
  'required_features',
  'allowlist',
  'denylist',
  'profile_validation',
  'safety_flags'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function exactFields(value, required, prefix, errors) {
  const allowed = new Set(required);
  for (const field of required) if (!Object.prototype.hasOwnProperty.call(value, field)) errors.push(`${prefix}_missing_${field}`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) errors.push(`${prefix}_unexpected_field::${field}`);
}

function validateStringArray(value, field, errors, allowEmpty = false) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    errors.push(`${field}_invalid`);
    return;
  }
  if (!value.every(isNonEmptyString)) errors.push(`${field}_invalid`);
  if (new Set(value).size !== value.length) errors.push(`${field}_duplicate`);
}

function validateSelectionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['selection_request_must_be_object'] };
  exactFields(request, SELECTION_REQUEST_FIELDS, 'selection_request', errors);
  for (const field of ['selection_request_id', 'tenant_id', 'conversation_id', 'requested_language', 'requested_audio_format', 'priority_profile', 'cost_preference', 'latency_preference', 'quality_preference', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.selection_request_version) || request.selection_request_version < 1) errors.push('selection_request_version_invalid');
  for (const field of ['requested_sample_rate', 'requested_channels', 'requested_duration_seconds', 'requested_size_mb']) {
    if (!Number.isInteger(request[field]) || request[field] <= 0) errors.push(`${field}_invalid`);
  }
  if (!isPlainObject(request.requested_features)) errors.push('requested_features_must_be_object');
  if (isPlainObject(request.requested_features)) {
    exactFields(request.requested_features, REQUESTED_FEATURE_FIELDS, 'requested_features', errors);
    for (const field of REQUESTED_FEATURE_FIELDS) {
      if (typeof request.requested_features[field] !== 'boolean') errors.push(`requested_features_${field}_must_be_boolean`);
    }
  }
  if (!PRIORITY_PROFILES.includes(request.priority_profile)) errors.push(`priority_profile_not_allowed::${request.priority_profile}`);
  for (const field of ['cost_preference', 'latency_preference', 'quality_preference']) {
    if (!PREFERENCES.includes(request[field])) errors.push(`${field}_not_allowed::${request[field]}`);
  }
  validateStringArray(request.allowed_provider_slugs, 'allowed_provider_slugs', errors, true);
  validateStringArray(request.denied_provider_slugs, 'denied_provider_slugs', errors, true);
  if (Array.isArray(request.allowed_provider_slugs)) {
    for (const slug of request.allowed_provider_slugs) if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(slug)) errors.push(`allowed_provider_slug_not_allowed::${slug}`);
  }
  if (Array.isArray(request.denied_provider_slugs)) {
    for (const slug of request.denied_provider_slugs) if (!ALLOWED_CAPABILITY_PROVIDER_SLUGS.includes(slug)) errors.push(`denied_provider_slug_not_allowed::${slug}`);
  }
  const overlap = (request.allowed_provider_slugs || []).filter((slug) => (request.denied_provider_slugs || []).includes(slug));
  if (overlap.length > 0) errors.push(`allowlist_denylist_conflict::${overlap.sort().join(',')}`);
  for (const field of ['simulation_context', 'metadata']) {
    if (!isPlainObject(request[field])) errors.push(`${field}_must_be_object`);
  }
  if (isPlainObject(request.simulation_context)) {
    if (request.simulation_context.simulation !== true) errors.push('simulation_context_simulation_must_be_true');
    if (request.simulation_context.network_used !== false) errors.push('simulation_context_network_used_must_be_false');
    if (request.simulation_context.provider_called !== false) errors.push('simulation_context_provider_called_must_be_false');
    if (request.simulation_context.executed !== false) errors.push('simulation_context_executed_must_be_false');
    if (request.simulation_context.production_blocked !== true) errors.push('simulation_context_production_blocked_must_be_true');
    if (request.simulation_context.rollout_percentage !== 0) errors.push('simulation_context_rollout_percentage_must_be_zero');
  }
  if (request.validator_version !== TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findTranscriptionForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function reject(profile, reasonCode, details, fields = []) {
  let fingerprint = 'fingerprint_unavailable';
  try {
    fingerprint = fingerprintCapabilityProfile(profile);
  } catch (error) {
    fingerprint = `fingerprint_invalid::${error.message}`;
  }
  return cloneFrozen({
    provider_slug: profile && profile.provider_slug ? profile.provider_slug : 'provider_not_available',
    reason_code: reasonCode,
    reason_details: details,
    blocking_fields: fields,
    profile_version: Number.isInteger(profile && profile.capability_profile_version) ? profile.capability_profile_version : 0,
    fingerprint
  });
}

function unsafeProfileFields(profile) {
  const fields = [];
  if (!isPlainObject(profile)) return fields;
  if (profile.simulation !== true) fields.push('simulation');
  if (profile.network_enabled !== false) fields.push('network_enabled');
  if (profile.provider_enabled !== false) fields.push('provider_enabled');
  if (profile.runtime_enabled !== false) fields.push('runtime_enabled');
  if (profile.production_blocked !== true) fields.push('production_blocked');
  if (profile.rollout_percentage !== 0) fields.push('rollout_percentage');
  return fields;
}

function filterProfile(profile, request) {
  const unsafeFields = unsafeProfileFields(profile);
  if (unsafeFields.length > 0) return reject(profile, 'UNSAFE_PROFILE', 'unsafe_profile_flags', unsafeFields);
  const validation = validateCapabilityProfile(profile);
  if (!validation.valid) return reject(profile, 'INVALID_PROFILE', validation.errors.join(','), validation.errors);
  if (request.denied_provider_slugs.includes(profile.provider_slug)) return reject(profile, 'DENYLIST_BLOCKED', 'provider_denied', ['denied_provider_slugs']);
  if (request.allowed_provider_slugs.length > 0 && !request.allowed_provider_slugs.includes(profile.provider_slug)) return reject(profile, 'ALLOWLIST_BLOCKED', 'provider_not_allowed', ['allowed_provider_slugs']);
  if (!profile.supported_languages.includes(request.requested_language)) return reject(profile, 'LANGUAGE_UNSUPPORTED', request.requested_language, ['requested_language']);
  if (!profile.supported_audio_formats.includes(request.requested_audio_format)) return reject(profile, 'FORMAT_UNSUPPORTED', request.requested_audio_format, ['requested_audio_format']);
  if (!profile.supported_sample_rates.includes(request.requested_sample_rate)) return reject(profile, 'SAMPLE_RATE_UNSUPPORTED', String(request.requested_sample_rate), ['requested_sample_rate']);
  if (!profile.supported_channels.includes(request.requested_channels)) return reject(profile, 'CHANNELS_UNSUPPORTED', String(request.requested_channels), ['requested_channels']);
  if (profile.max_audio_duration_seconds < request.requested_duration_seconds) return reject(profile, 'DURATION_EXCEEDED', String(request.requested_duration_seconds), ['requested_duration_seconds']);
  if (profile.max_audio_size_mb < request.requested_size_mb) return reject(profile, 'SIZE_EXCEEDED', String(request.requested_size_mb), ['requested_size_mb']);
  const featureMap = featureFields();
  const missing = Object.keys(featureMap).filter((feature) => request.requested_features[feature] === true && profile[featureMap[feature]] !== true);
  if (missing.length > 0) return reject(profile, 'REQUIRED_FEATURE_UNSUPPORTED', missing.join(','), missing);
  return null;
}

function rankCandidates(scored) {
  return [...scored].sort((left, right) => {
    const scoreOrder = [
      ['total_score', 'desc'],
      ['compatibility_score', 'desc'],
      ['feature_score', 'desc']
    ];
    for (const [field] of scoreOrder) {
      const delta = right.scores[field] - left.scores[field];
      if (delta !== 0) return delta;
    }
    const costDelta = left.estimated_cost - right.estimated_cost;
    if (costDelta !== 0) return costDelta;
    const latencyDelta = left.estimated_latency - right.estimated_latency;
    if (latencyDelta !== 0) return latencyDelta;
    const versionDelta = right.capability_profile_version - left.capability_profile_version;
    if (versionDelta !== 0) return versionDelta;
    return left.provider_slug.localeCompare(right.provider_slug);
  }).map((candidate, index) => cloneFrozen({
    rank: index + 1,
    provider_slug: candidate.provider_slug,
    provider_version: candidate.provider_version,
    capability_profile_id: candidate.capability_profile_id,
    capability_profile_version: candidate.capability_profile_version,
    scores: candidate.scores,
    matched_capabilities: candidate.matched_capabilities,
    missing_optional_capabilities: candidate.missing_optional_capabilities,
    decision_notes: [`priority_profile:${candidate.weights ? 'weighted' : 'default'}`]
  }));
}

function selectTranscriptionProvider(input = {}) {
  const request = input.request || {};
  const profiles = input.profiles || [];
  const requestValidation = validateSelectionRequest(request);
  const requestFingerprint = requestValidation.valid ? stablePayload(request) : 'invalid_request';
  if (!requestValidation.valid) {
    const result = buildSelectionResult({
      selection_request_id: request.selection_request_id,
      status: 'VALIDATION_FAILED',
      decision: 'VALIDATION_FAILED',
      decision_reason: requestValidation.errors[0] || 'selection_request_invalid',
      rejections: [],
      scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION
    });
    return cloneFrozen({
      result,
      audit: buildProviderSelectionAudit({
        selection_request_id: request.selection_request_id,
        request_fingerprint: requestFingerprint,
        decision: result.decision,
        scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION,
        validator_version: TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION
      }),
      errors: requestValidation.errors,
      ...SAFE_FLAGS
    });
  }

  const rejections = [];
  const validProfiles = [];
  for (const profile of profiles) {
    const unsafeFields = unsafeProfileFields(profile);
    const validation = validateCapabilityProfile(profile);
    if (unsafeFields.length > 0) rejections.push(reject(profile, 'UNSAFE_PROFILE', 'unsafe_profile_flags', unsafeFields));
    else if (!validation.valid) rejections.push(reject(profile, 'INVALID_PROFILE', validation.errors.join(','), validation.errors));
    else validProfiles.push(profile);
  }
  const catalog = createTranscriptionProviderCapabilityCatalog(validProfiles);
  const orderedProfiles = catalog.listProviders().map((slug) => catalog.getProvider(slug));
  const eligible = [];
  for (const profile of orderedProfiles) {
    const rejection = filterProfile(profile, request);
    if (rejection) rejections.push(rejection);
    else eligible.push(profile);
  }
  const scored = eligible.map((profile) => scoreTranscriptionProviderCandidate(profile, request));
  const ranked = rankCandidates(scored);
  const selected = ranked[0] || null;
  const result = buildSelectionResult({
    selection_request_id: request.selection_request_id,
    selected_provider_slug: selected ? selected.provider_slug : 'none',
    selected_provider_version: selected ? selected.provider_version : 'none',
    selected_capability_profile_id: selected ? selected.capability_profile_id : 'none',
    selected_capability_profile_version: selected ? selected.capability_profile_version : 0,
    status: selected ? 'SELECTED_SIMULATION' : 'NO_ELIGIBLE_PROVIDER',
    decision: selected ? 'SELECTED_SIMULATION' : 'NO_ELIGIBLE_PROVIDER',
    decision_reason: selected ? `selected_by_${request.priority_profile.toLowerCase()}_scoring` : 'no_eligible_provider',
    candidate_count: profiles.length,
    eligible_candidate_count: eligible.length,
    rejected_candidate_count: rejections.length,
    ranked_candidates: ranked,
    rejections,
    scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION
  });
  const validation = validateSelectionResult(result);
  const audit = buildProviderSelectionAudit({
    selection_request_id: request.selection_request_id,
    request_fingerprint: requestFingerprint,
    candidate_fingerprints: profiles.map((profile) => {
      try {
        return fingerprintCapabilityProfile(profile);
      } catch (error) {
        return `fingerprint_invalid::${error.message}`;
      }
    }),
    filters_applied: FILTERS_APPLIED,
    rejected_candidates: rejections,
    scoring: scored,
    weights: SELECTION_WEIGHTS[request.priority_profile],
    decision: result.decision,
    scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION,
    validator_version: TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION
  });
  return cloneFrozen({
    result: validation.valid ? result : buildSelectionResult({
      selection_request_id: request.selection_request_id,
      status: 'POLICY_BLOCKED',
      decision: 'POLICY_BLOCKED',
      decision_reason: validation.errors[0] || 'selection_result_invalid',
      rejections,
      scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION
    }),
    audit,
    comparisons: ranked.length > 1 ? [compareTranscriptionProviderCapabilities(eligible[0], eligible[1])] : [],
    errors: validation.valid ? [] : validation.errors,
    ...SAFE_FLAGS
  });
}

module.exports = {
  FILTERS_APPLIED,
  PREFERENCES,
  REQUESTED_FEATURE_FIELDS,
  SELECTION_REQUEST_FIELDS,
  TRANSCRIPTION_PROVIDER_SELECTION_ENGINE_VALIDATOR_VERSION,
  selectTranscriptionProvider,
  validateSelectionRequest
};

'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { SAFE_FLAGS } = require('./transcription-provider-capability-matrix');

const TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION = 'transcription_provider_selection_scoring_v1';
const SCORE_COMPONENTS = Object.freeze([
  'compatibility_score',
  'feature_score',
  'language_score',
  'format_score',
  'limit_score',
  'latency_score',
  'cost_score',
  'quality_score',
  'policy_score'
]);
const PRIORITY_PROFILES = Object.freeze(['BALANCED', 'LOW_COST', 'LOW_LATENCY', 'HIGH_QUALITY', 'MAX_COMPATIBILITY']);
const SELECTION_WEIGHTS = Object.freeze({
  BALANCED: Object.freeze({ compatibility_score: 20, feature_score: 15, language_score: 10, format_score: 10, limit_score: 10, latency_score: 10, cost_score: 10, quality_score: 10, policy_score: 5 }),
  LOW_COST: Object.freeze({ compatibility_score: 20, feature_score: 10, language_score: 10, format_score: 10, limit_score: 10, latency_score: 5, cost_score: 25, quality_score: 5, policy_score: 5 }),
  LOW_LATENCY: Object.freeze({ compatibility_score: 20, feature_score: 10, language_score: 10, format_score: 10, limit_score: 10, latency_score: 25, cost_score: 10, quality_score: 0, policy_score: 5 }),
  HIGH_QUALITY: Object.freeze({ compatibility_score: 20, feature_score: 15, language_score: 10, format_score: 5, limit_score: 5, latency_score: 5, cost_score: 5, quality_score: 30, policy_score: 5 }),
  MAX_COMPATIBILITY: Object.freeze({ compatibility_score: 30, feature_score: 25, language_score: 10, format_score: 10, limit_score: 15, latency_score: 0, cost_score: 0, quality_score: 5, policy_score: 5 })
});

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function clampScore(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function preferenceBonus(preference) {
  return preference === 'HIGH' ? 100 : preference === 'MEDIUM' ? 75 : 50;
}

function featureFields() {
  return Object.freeze({
    streaming: 'supports_streaming',
    partial_results: 'supports_partial_results',
    word_timestamps: 'supports_word_timestamps',
    sentence_timestamps: 'supports_sentence_timestamps',
    speaker_diarization: 'supports_speaker_diarization',
    language_detection: 'supports_language_detection',
    translation: 'supports_translation',
    punctuation: 'supports_punctuation',
    profanity_filter: 'supports_profanity_filter',
    custom_vocabulary: 'supports_custom_vocabulary',
    numeric_normalization: 'supports_numeric_normalization',
    confidence_score: 'supports_confidence_score'
  });
}

function estimateCost(profile) {
  return Number(profile.estimated_cost_profile && profile.estimated_cost_profile.minor_units_per_minute) || 0;
}

function estimateLatency(profile) {
  return Number(profile.estimated_latency_profile && profile.estimated_latency_profile.p95_ms) || 0;
}

function scoreTranscriptionProviderCandidate(profile, request) {
  const featureMap = featureFields();
  const requested = request.requested_features || {};
  const requestedKeys = Object.keys(featureMap).filter((key) => requested[key] === true);
  const matched = requestedKeys.filter((key) => profile[featureMap[key]] === true);
  const missing = requestedKeys.filter((key) => profile[featureMap[key]] !== true);
  const compatibilityScore = missing.length === 0 ? 100 : clampScore((matched.length / Math.max(1, requestedKeys.length)) * 100);
  const featureScore = requestedKeys.length === 0 ? 100 : compatibilityScore;
  const languageScore = profile.supported_languages.includes(request.requested_language) ? 100 : 0;
  const formatScore = profile.supported_audio_formats.includes(request.requested_audio_format) ? 100 : 0;
  const limitScore = (
    profile.supported_sample_rates.includes(request.requested_sample_rate) &&
    profile.supported_channels.includes(request.requested_channels) &&
    profile.max_audio_duration_seconds >= request.requested_duration_seconds &&
    profile.max_audio_size_mb >= request.requested_size_mb
  ) ? 100 : 0;
  const latencyScore = clampScore(100 - Math.min(100, estimateLatency(profile) / 10) + (request.latency_preference === 'HIGH' ? 10 : 0));
  const costScore = clampScore(100 - Math.min(100, estimateCost(profile)) + (request.cost_preference === 'HIGH' ? 10 : 0));
  const qualityScore = clampScore(([
    'supports_word_timestamps',
    'supports_sentence_timestamps',
    'supports_speaker_diarization',
    'supports_language_detection',
    'supports_punctuation',
    'supports_confidence_score'
  ].filter((field) => profile[field] === true).length / 6) * preferenceBonus(request.quality_preference));
  const policyScore = profile.simulation === true && profile.network_enabled === false && profile.provider_enabled === false && profile.runtime_enabled === false && profile.production_blocked === true && profile.rollout_percentage === 0 ? 100 : 0;
  const scores = {
    compatibility_score: compatibilityScore,
    feature_score: featureScore,
    language_score: languageScore,
    format_score: formatScore,
    limit_score: limitScore,
    latency_score: latencyScore,
    cost_score: costScore,
    quality_score: qualityScore,
    policy_score: policyScore
  };
  const weights = SELECTION_WEIGHTS[request.priority_profile] || SELECTION_WEIGHTS.BALANCED;
  const total = SCORE_COMPONENTS.reduce((sum, component) => sum + scores[component] * weights[component], 0) / 100;
  return cloneFrozen({
    scoring_version: TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION,
    provider_slug: profile.provider_slug,
    provider_version: profile.provider_version,
    capability_profile_id: profile.capability_profile_id,
    capability_profile_version: profile.capability_profile_version,
    scores: {
      ...scores,
      total_score: clampScore(total)
    },
    weights,
    matched_capabilities: matched,
    missing_optional_capabilities: missing,
    estimated_cost: estimateCost(profile),
    estimated_latency: estimateLatency(profile),
    ...SAFE_FLAGS
  });
}

module.exports = {
  PRIORITY_PROFILES,
  SCORE_COMPONENTS,
  SELECTION_WEIGHTS,
  TRANSCRIPTION_PROVIDER_SELECTION_SCORING_VERSION,
  estimateCost,
  estimateLatency,
  featureFields,
  scoreTranscriptionProviderCandidate
};

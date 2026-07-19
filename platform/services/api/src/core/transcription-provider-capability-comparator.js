'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { validateCapabilityProfile, SAFE_FLAGS } = require('./transcription-provider-capability-matrix');

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(deepClone(value)));
}

function intersection(left = [], right = []) {
  const rightSet = new Set(right);
  return uniqueSorted(left.filter((entry) => rightSet.has(entry)).map(String));
}

function difference(left = [], right = []) {
  const rightSet = new Set(right);
  return uniqueSorted(left.filter((entry) => !rightSet.has(entry)).map(String));
}

function compareTranscriptionProviderCapabilities(left, right) {
  const leftValidation = validateCapabilityProfile(left);
  const rightValidation = validateCapabilityProfile(right);
  const errors = [
    ...leftValidation.errors.map((error) => `left::${error}`),
    ...rightValidation.errors.map((error) => `right::${error}`)
  ];
  if (!leftValidation.valid || !rightValidation.valid) {
    return cloneFrozen({ comparable: false, errors: uniqueSorted(errors), ...SAFE_FLAGS });
  }
  const features = [
    'supports_streaming',
    'supports_word_timestamps',
    'supports_sentence_timestamps',
    'supports_speaker_diarization',
    'supports_language_detection',
    'supports_confidence_score'
  ];
  const featureComparison = {};
  for (const feature of features) {
    featureComparison[feature] = {
      left: left[feature],
      right: right[feature],
      match: left[feature] === right[feature]
    };
  }
  return cloneFrozen({
    comparable: true,
    left_provider_slug: left.provider_slug,
    right_provider_slug: right.provider_slug,
    shared_languages: intersection(left.supported_languages, right.supported_languages),
    left_only_languages: difference(left.supported_languages, right.supported_languages),
    right_only_languages: difference(right.supported_languages, left.supported_languages),
    shared_formats: intersection(left.supported_audio_formats, right.supported_audio_formats),
    left_only_formats: difference(left.supported_audio_formats, right.supported_audio_formats),
    right_only_formats: difference(right.supported_audio_formats, left.supported_audio_formats),
    feature_comparison: featureComparison,
    latency_profile: {
      left: left.estimated_latency_profile,
      right: right.estimated_latency_profile
    },
    cost_profile: {
      left: left.estimated_cost_profile,
      right: right.estimated_cost_profile
    },
    limits: {
      max_audio_duration_seconds: {
        left: left.max_audio_duration_seconds,
        right: right.max_audio_duration_seconds
      },
      max_audio_size_mb: {
        left: left.max_audio_size_mb,
        right: right.max_audio_size_mb
      }
    },
    errors: [],
    ...SAFE_FLAGS
  });
}

module.exports = {
  compareTranscriptionProviderCapabilities
};

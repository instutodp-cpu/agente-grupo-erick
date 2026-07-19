'use strict';

const { deepClone, sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const {
  ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS,
  findProviderBoundaryForbiddenFields,
  isIso
} = require('./transcription-provider-contract');

const RESPONSE_STATUSES = Object.freeze(['synthetic_success', 'synthetic_error', 'synthetic_timeout', 'synthetic_rate_limited', 'synthetic_rejected']);
const NORMALIZED_RESPONSE_STATUSES = Object.freeze(['completed', 'failed', 'timed_out', 'rate_limited', 'rejected']);
const MAX_SYNTHETIC_SUMMARY_CHARS = 512;

function validateSyntheticSegment(segment, index, durationMs, errors) {
  if (!isPlainObject(segment)) {
    errors.push(`synthetic_segment_invalid::${index}`);
    return;
  }
  for (const key of Object.keys(segment)) {
    if (!['start_ms', 'end_ms', 'text', 'confidence'].includes(key)) errors.push(`synthetic_segment_field_not_allowed::${key}`);
  }
  if (!Number.isInteger(segment.start_ms) || !Number.isInteger(segment.end_ms) || segment.start_ms < 0 || segment.end_ms < segment.start_ms || segment.end_ms > durationMs) {
    errors.push(`synthetic_segment_timing_invalid::${index}`);
  }
  if (!isNonEmptyString(segment.text) || segment.text.length > MAX_SYNTHETIC_SUMMARY_CHARS) errors.push(`synthetic_segment_text_invalid::${index}`);
  if (segment.confidence !== undefined && (typeof segment.confidence !== 'number' || segment.confidence < 0 || segment.confidence > 1)) errors.push(`synthetic_segment_confidence_invalid::${index}`);
}

function validateTranscriptionProviderResponse(response, context = {}) {
  const errors = [];
  if (!isPlainObject(response)) return { valid: false, errors: ['provider_response_must_be_object'] };
  for (const field of ['response_id', 'request_id', 'provider_slug', 'provider_contract_id', 'configuration_id', 'response_status', 'normalized_status', 'synthetic_transcript_summary', 'synthetic_segments', 'language', 'duration_ms', 'confidence_band', 'provider_latency_ms_synthetic', 'provider_cost_minor_synthetic', 'provider_request_id_synthetic', 'warnings', 'errors', 'received_at', 'simulated', 'executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution', 'production_blocked']) {
    if (!Object.prototype.hasOwnProperty.call(response, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['response_id', 'request_id', 'provider_slug', 'provider_contract_id', 'configuration_id', 'response_status', 'normalized_status', 'synthetic_transcript_summary', 'language', 'confidence_band', 'provider_request_id_synthetic', 'received_at']) {
    if (!isNonEmptyString(response[field])) errors.push(`invalid_${field}`);
  }
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(response.provider_slug)) errors.push(`provider_slug_not_allowed::${response.provider_slug}`);
  if (!RESPONSE_STATUSES.includes(response.response_status)) errors.push(`response_status_not_allowed::${response.response_status}`);
  if (!NORMALIZED_RESPONSE_STATUSES.includes(response.normalized_status)) errors.push(`normalized_status_not_allowed::${response.normalized_status}`);
  if (typeof response.synthetic_transcript_summary === 'string' && response.synthetic_transcript_summary.length > MAX_SYNTHETIC_SUMMARY_CHARS) errors.push('synthetic_transcript_summary_too_large');
  if (!Array.isArray(response.synthetic_segments)) errors.push('synthetic_segments_required');
  if (Array.isArray(response.synthetic_segments)) response.synthetic_segments.forEach((segment, index) => validateSyntheticSegment(segment, index, response.duration_ms, errors));
  for (const field of ['duration_ms', 'provider_latency_ms_synthetic', 'provider_cost_minor_synthetic']) {
    if (!Number.isInteger(response[field]) || response[field] < 0) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(response.warnings)) errors.push('warnings_must_be_array');
  if (!Array.isArray(response.errors)) errors.push('errors_must_be_array');
  if (!isIso(response.received_at)) errors.push('received_at_invalid');
  if (context.request && response.request_id !== context.request.request_id) errors.push('request_id_mismatch');
  if (context.request && response.provider_contract_id !== context.request.provider_contract_id) errors.push('provider_contract_id_mismatch');
  if (response.simulated !== true) errors.push('simulated_must_be_true');
  for (const field of ['executed', 'real_provider_called', 'external_network_called', 'can_trigger_real_execution']) {
    if (response[field] !== false) errors.push(`${field}_must_be_false`);
  }
  if (response.production_blocked !== true) errors.push('production_blocked_must_be_true');
  errors.push(...findProviderBoundaryForbiddenFields(response));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function normalizeProviderResponse(response) {
  return Object.freeze(sanitizeTranscriptionData(deepClone(response)));
}

module.exports = {
  MAX_SYNTHETIC_SUMMARY_CHARS,
  NORMALIZED_RESPONSE_STATUSES,
  RESPONSE_STATUSES,
  normalizeProviderResponse,
  validateTranscriptionProviderResponse
};

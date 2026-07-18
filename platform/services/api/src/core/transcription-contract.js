'use strict';

const {
  buildSafeAdapterError,
  isNonEmptyString,
  isPlainObject,
  uniqueSorted
} = require('./read-only-adapter-contract');

const TRANSCRIPTION_PROVIDER_ID = 'synthetic_transcription_provider';
const TRANSCRIPTION_ADAPTER_ID = 'transcription_sanitized_adapter';
const TRANSCRIPTION_CONNECTOR_ID = 'connector_transcription_sanitized';
const TRANSCRIPTION_CONFIGURATION_ID = 'config_transcription_sanitized_local_test';
const TRANSCRIPTION_SECRET_REFERENCE_ID = 'secretref_transcription_sanitized_local_test';
const TRANSCRIPTION_READINESS_CANDIDATE_ID = 'candidate_transcription_sanitized_adapter';

const ALLOWED_MEDIA_TYPES = Object.freeze([
  'audio/wav+synthetic',
  'audio/mpeg+synthetic',
  'audio/ogg+synthetic',
  'video/mp4+synthetic',
  'text/plain+sanitized-transcript'
]);

const ALLOWED_LANGUAGES = Object.freeze(['pt-BR', 'en-US', 'es-ES', 'auto']);
const MAX_TEXT_CHARS = 4000;
const MAX_SEGMENTS = 20;
const MAX_DURATION_MS = 30 * 60 * 1000;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_BASE64_CHARS = 2048;
const ALLOWED_SEGMENT_FIELDS = Object.freeze(['start_ms', 'end_ms', 'text', 'confidence', 'speaker_label']);
const MAX_SPEAKER_LABEL_CHARS = 64;

const FORBIDDEN_TRANSCRIPTION_FIELDS = uniqueSorted([
  'rawAudio',
  'raw_audio',
  'audio',
  'audioBuffer',
  'audio_buffer',
  'binary',
  'waveform',
  'request_headers',
  'headers',
  'cookies',
  'credentials',
  'authorization',
  'provider_token',
  'providerToken',
  'endpoint',
  'url',
  'provider_response_raw',
  'providerResponseRaw',
  'rawProviderResponse',
  'rawTranscript',
  'raw_transcript',
  'fullTranscript',
  'payload',
  'rawPayload',
  'requestBody',
  'responseBody',
  'token',
  'secret',
  'apiKey',
  'accessToken',
  'refreshToken',
  'privateUrl',
  'audioUrl',
  'fileUrl',
  'downloadUrl'
]);

const REQUIRED_TRANSCRIPTION_REQUEST_FIELDS = Object.freeze([
  'transcription_id',
  'provider_id',
  'adapter_id',
  'media_type',
  'language',
  'duration_ms',
  'size_bytes',
  'created_at',
  'workspace_type',
  'tenant_id',
  'user_id',
  'source_type',
  'simulated',
  'executed',
  'real_provider_called'
]);

const ALLOWED_RESULT_FIELDS = Object.freeze([
  'segments',
  'text',
  'confidence',
  'language_detected',
  'duration_ms'
]);

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function isIsoLikeString(value) {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isBinaryLike(value) {
  return Boolean(value) && (
    Buffer.isBuffer(value) ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value)
  );
}

function hasInvalidUtf8Text(value) {
  return typeof value === 'string' && (value.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value));
}

function looksLikeUnexpectedUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function looksLikeLargeBase64(value) {
  return typeof value === 'string' &&
    value.length > MAX_BASE64_CHARS &&
    /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function findTranscriptionForbiddenFields(value) {
  const found = [];
  const forbidden = new Set(FORBIDDEN_TRANSCRIPTION_FIELDS);
  const seen = new WeakSet();

  function visit(entry, path) {
    if (isBinaryLike(entry)) {
      found.push(`forbidden_binary::${path || 'value'}`);
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!isPlainObject(entry)) {
      if (hasInvalidUtf8Text(entry)) found.push(`invalid_utf8::${path || 'value'}`);
      if (looksLikeUnexpectedUrl(entry)) found.push(`unexpected_url::${path || 'value'}`);
      if (looksLikeLargeBase64(entry)) found.push(`base64_payload_too_large::${path || 'value'}`);
      return;
    }
    if (seen.has(entry)) {
      found.push('forbidden_field::cyclic_reference');
      return;
    }
    seen.add(entry);
    for (const [key, nested] of Object.entries(entry)) {
      const nestedPath = path ? `${path}.${key}` : key;
      if (forbidden.has(key)) {
        found.push(`forbidden_field::${key}`);
        continue;
      }
      visit(nested, nestedPath);
    }
    seen.delete(entry);
  }

  visit(value, '');
  return uniqueSorted(found);
}

function trimText(value) {
  if (typeof value !== 'string') return value;
  return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}

function sanitizeTranscriptionData(value) {
  const forbidden = new Set(FORBIDDEN_TRANSCRIPTION_FIELDS);
  const seen = new WeakSet();

  function sanitize(entry) {
    if (entry === null || entry === undefined) return entry;
    if (isBinaryLike(entry)) return undefined;
    if (typeof entry === 'string') {
      if (hasInvalidUtf8Text(entry) || looksLikeUnexpectedUrl(entry) || looksLikeLargeBase64(entry)) return undefined;
      return trimText(entry);
    }
    if (typeof entry === 'number' || typeof entry === 'boolean') return entry;
    if (Array.isArray(entry)) return entry.slice(0, MAX_SEGMENTS).map(sanitize).filter((item) => item !== undefined);
    if (!isPlainObject(entry)) return undefined;
    if (seen.has(entry)) return { blocked_reason: 'cycle_removed' };
    seen.add(entry);
    const output = {};
    for (const [key, nested] of Object.entries(entry)) {
      if (forbidden.has(key)) continue;
      const sanitized = sanitize(nested);
      if (sanitized !== undefined) output[key] = sanitized;
    }
    seen.delete(entry);
    return output;
  }

  return sanitize(value);
}

function validateTranscriptionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['transcription_request_must_be_object'] };
  for (const field of REQUIRED_TRANSCRIPTION_REQUEST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(request, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['transcription_id', 'provider_id', 'adapter_id', 'media_type', 'language', 'created_at', 'workspace_type', 'tenant_id', 'user_id', 'source_type']) {
    if (!isNonEmptyString(request[field])) errors.push(`invalid_${field}`);
  }
  if (request.provider_id !== TRANSCRIPTION_PROVIDER_ID) errors.push('provider_id_mismatch');
  if (request.adapter_id !== TRANSCRIPTION_ADAPTER_ID) errors.push('adapter_id_mismatch');
  if (!ALLOWED_MEDIA_TYPES.includes(request.media_type)) errors.push('media_type_not_allowed');
  if (!ALLOWED_LANGUAGES.includes(request.language)) errors.push('language_not_allowed');
  if (!Number.isInteger(request.duration_ms) || request.duration_ms < 0 || request.duration_ms > MAX_DURATION_MS) errors.push('duration_ms_out_of_bounds');
  if (!Number.isInteger(request.size_bytes) || request.size_bytes < 0 || request.size_bytes > MAX_SIZE_BYTES) errors.push('size_bytes_out_of_bounds');
  if (!isIsoLikeString(request.created_at)) errors.push('created_at_invalid');
  if (request.simulated !== true) errors.push('simulated_must_be_true');
  if (request.executed !== false) errors.push('executed_must_be_false');
  if (request.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  errors.push(...findTranscriptionForbiddenFields(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateTranscriptionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['transcription_result_must_be_object'] };
  for (const key of Object.keys(result)) {
    if (!ALLOWED_RESULT_FIELDS.includes(key)) errors.push(`result_field_not_allowed::${key}`);
  }
  if (!Array.isArray(result.segments)) errors.push('segments_required');
  if (Array.isArray(result.segments) && result.segments.length > MAX_SEGMENTS) errors.push('segments_too_large');
  if (typeof result.text !== 'string' || result.text.trim() === '') errors.push('text_required');
  if (typeof result.text === 'string' && result.text.length > MAX_TEXT_CHARS) errors.push('text_too_large');
  if (typeof result.confidence !== 'number' || result.confidence < 0 || result.confidence > 1) errors.push('confidence_out_of_bounds');
  if (!ALLOWED_LANGUAGES.includes(result.language_detected)) errors.push('language_detected_not_allowed');
  if (!Number.isInteger(result.duration_ms) || result.duration_ms < 0 || result.duration_ms > MAX_DURATION_MS) errors.push('duration_ms_out_of_bounds');
  if (Array.isArray(result.segments)) {
    let previousEnd = 0;
    for (const [index, segment] of result.segments.entries()) {
      if (!isPlainObject(segment)) {
        errors.push(`segment_invalid::${index}`);
        continue;
      }
      for (const key of Object.keys(segment)) {
        if (!ALLOWED_SEGMENT_FIELDS.includes(key)) errors.push(`segment_field_not_allowed::${key}`);
      }
      if (typeof segment.text !== 'string' || segment.text.trim() === '') errors.push(`segment_text_invalid::${index}`);
      if (typeof segment.text === 'string' && segment.text.length > MAX_TEXT_CHARS) errors.push(`segment_text_too_large::${index}`);
      if (!Number.isInteger(segment.start_ms) || !Number.isInteger(segment.end_ms) || segment.start_ms < 0 || segment.end_ms < segment.start_ms) {
        errors.push(`segment_timing_invalid::${index}`);
      } else {
        if (segment.end_ms > result.duration_ms) errors.push(`segment_outside_duration::${index}`);
        if (index > 0 && segment.start_ms < previousEnd) errors.push(`segment_overlap_or_out_of_order::${index}`);
        previousEnd = segment.end_ms;
      }
      if (segment.confidence !== undefined && (typeof segment.confidence !== 'number' || segment.confidence < 0 || segment.confidence > 1)) {
        errors.push(`segment_confidence_out_of_bounds::${index}`);
      }
      if (segment.speaker_label !== undefined && (!isNonEmptyString(segment.speaker_label) || segment.speaker_label.length > MAX_SPEAKER_LABEL_CHARS || findTranscriptionForbiddenFields(segment.speaker_label).length > 0)) {
        errors.push(`segment_speaker_label_invalid::${index}`);
      }
    }
  }
  errors.push(...findTranscriptionForbiddenFields(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSafeTranscriptionError(code, reason) {
  return buildSafeAdapterError(code || 'INVALID_ADAPTER_REQUEST', 'Transcription adapter operation blocked safely.', {
    blocked_reason: reason || 'transcription_blocked'
  });
}

function buildTranscriptionAuditEvent(input = {}) {
  return sanitizeTranscriptionData({
    event_name: 'transcription_sanitized_adapter_evaluated',
    trace_id: input.trace_id || 'trace_not_available',
    request_id: input.request_id || 'request_not_available',
    transcription_id: input.transcription_id || 'transcription_not_available',
    provider_id: input.provider_id || TRANSCRIPTION_PROVIDER_ID,
    adapter_id: input.adapter_id || TRANSCRIPTION_ADAPTER_ID,
    workspace_type: input.workspace_type || 'workspace_not_available',
    tenant_id: input.tenant_id || 'tenant_not_available',
    user_id: input.user_id || 'user_not_available',
    status: input.status || 'transcription_mock_blocked',
    simulated: true,
    executed: input.executed === true,
    real_provider_called: false,
    can_trigger_real_execution: false,
    blocked_reason: input.blocked_reason || null,
    occurred_at: input.occurred_at || new Date(0).toISOString()
  });
}

module.exports = {
  ALLOWED_LANGUAGES,
  ALLOWED_MEDIA_TYPES,
  ALLOWED_RESULT_FIELDS,
  ALLOWED_SEGMENT_FIELDS,
  FORBIDDEN_TRANSCRIPTION_FIELDS,
  MAX_BASE64_CHARS,
  MAX_DURATION_MS,
  MAX_SEGMENTS,
  MAX_SIZE_BYTES,
  MAX_TEXT_CHARS,
  REQUIRED_TRANSCRIPTION_REQUEST_FIELDS,
  TRANSCRIPTION_ADAPTER_ID,
  TRANSCRIPTION_CONFIGURATION_ID,
  TRANSCRIPTION_CONNECTOR_ID,
  TRANSCRIPTION_PROVIDER_ID,
  TRANSCRIPTION_READINESS_CANDIDATE_ID,
  TRANSCRIPTION_SECRET_REFERENCE_ID,
  buildSafeTranscriptionError,
  buildTranscriptionAuditEvent,
  deepClone,
  findTranscriptionForbiddenFields,
  sanitizeTranscriptionData,
  validateTranscriptionRequest,
  validateTranscriptionResult
};

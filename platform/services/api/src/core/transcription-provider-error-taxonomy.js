'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS, findProviderBoundaryForbiddenFields } = require('./transcription-provider-contract');

const TRANSCRIPTION_PROVIDER_ERROR_CATEGORIES = Object.freeze([
  'INVALID_REQUEST',
  'CONTRACT_MISMATCH',
  'CAPABILITY_UNAVAILABLE',
  'CONFIGURATION_INVALID',
  'SECRET_REFERENCE_UNAVAILABLE',
  'TRANSPORT_DISABLED',
  'NETWORK_BLOCKED',
  'TIMEOUT_SYNTHETIC',
  'RATE_LIMIT_SYNTHETIC',
  'PROVIDER_REJECTED_SYNTHETIC',
  'BUDGET_BLOCKED',
  'RETENTION_BLOCKED',
  'CONSENT_BLOCKED',
  'INTERNAL_SYNTHETIC_ERROR'
]);

function validateProviderError(error) {
  const errors = [];
  if (!isPlainObject(error)) return { valid: false, errors: ['provider_error_must_be_object'] };
  for (const field of ['error_code', 'category', 'retryable', 'safe_message', 'internal_reason', 'provider_slug', 'request_id', 'simulated', 'real_provider_called', 'external_network_called']) {
    if (!Object.prototype.hasOwnProperty.call(error, field)) errors.push(`missing_${field}`);
  }
  for (const field of ['error_code', 'category', 'safe_message', 'internal_reason', 'provider_slug', 'request_id']) {
    if (!isNonEmptyString(error[field])) errors.push(`invalid_${field}`);
  }
  if (!TRANSCRIPTION_PROVIDER_ERROR_CATEGORIES.includes(error.category)) errors.push(`category_not_allowed::${error.category}`);
  if (!ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(error.provider_slug)) errors.push(`provider_slug_not_allowed::${error.provider_slug}`);
  if (typeof error.retryable !== 'boolean') errors.push('retryable_must_be_boolean');
  if (error.simulated !== true) errors.push('simulated_must_be_true');
  if (error.real_provider_called !== false) errors.push('real_provider_called_must_be_false');
  if (error.external_network_called !== false) errors.push('external_network_called_must_be_false');
  if (error.stack || error.stackTrace || error.payload) errors.push('unsafe_error_detail_present');
  errors.push(...findProviderBoundaryForbiddenFields(error));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function classifyTranscriptionProviderError(input = {}) {
  const category = TRANSCRIPTION_PROVIDER_ERROR_CATEGORIES.includes(input.category) ? input.category : 'INTERNAL_SYNTHETIC_ERROR';
  const error = {
    error_code: isNonEmptyString(input.error_code) ? input.error_code : `TRANSCRIPTION_${category}`,
    category,
    retryable: input.retryable === true,
    safe_message: isNonEmptyString(input.safe_message) ? input.safe_message : 'Synthetic provider contract operation blocked safely.',
    internal_reason: isNonEmptyString(input.internal_reason) ? input.internal_reason : category,
    provider_slug: ALLOWED_TRANSCRIPTION_PROVIDER_SLUGS.includes(input.provider_slug) ? input.provider_slug : 'deepgram',
    request_id: isNonEmptyString(input.request_id) ? input.request_id : 'request_not_available',
    simulated: true,
    real_provider_called: false,
    external_network_called: false
  };
  const validation = validateProviderError(error);
  return Object.freeze(sanitizeTranscriptionData({
    ...error,
    valid: validation.valid,
    validation_errors: validation.errors
  }));
}

module.exports = {
  TRANSCRIPTION_PROVIDER_ERROR_CATEGORIES,
  classifyTranscriptionProviderError,
  validateProviderError
};

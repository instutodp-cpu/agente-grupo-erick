'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_LIMITS_CONTRACT_VALIDATOR_VERSION = 'model_limits_contract_validator_v1';
const MODEL_LIMITS_FIELDS = Object.freeze([
  'limits_id', 'provider_id', 'model_id', 'maximum_context_tokens', 'maximum_input_tokens', 'maximum_output_tokens',
  'maximum_requests_per_minute_reference', 'maximum_tokens_per_minute_reference', 'maximum_concurrent_requests_reference',
  'maximum_batch_size_reference', 'maximum_file_size_bytes_reference', 'maximum_images_per_request_reference',
  'maximum_audio_seconds_reference', 'limits_verified', 'simulation', 'production_blocked', 'validator_version'
]);
const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'maximum_context_tokens', 'maximum_input_tokens', 'maximum_output_tokens', 'maximum_requests_per_minute_reference',
  'maximum_tokens_per_minute_reference', 'maximum_concurrent_requests_reference', 'maximum_batch_size_reference',
  'maximum_file_size_bytes_reference', 'maximum_images_per_request_reference', 'maximum_audio_seconds_reference'
]);
const MAX_LIMIT_VALUE = 100000000000;

function isBoundedNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_LIMIT_VALUE;
}

function validateModelLimitsContract(limits) {
  const errors = [];
  if (!isPlainObject(limits)) return { valid: false, errors: ['model_limits_must_be_object'] };
  exactFields(limits, MODEL_LIMITS_FIELDS, 'model_limits', errors);
  for (const field of ['limits_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(limits[field])) errors.push(`${field}_invalid`);
  }
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!isBoundedNonNegativeInteger(limits[field])) errors.push(`${field}_invalid`);
  }
  if (
    isBoundedNonNegativeInteger(limits.maximum_context_tokens) &&
    isBoundedNonNegativeInteger(limits.maximum_input_tokens) &&
    isBoundedNonNegativeInteger(limits.maximum_output_tokens) &&
    limits.maximum_context_tokens < Math.max(limits.maximum_input_tokens, limits.maximum_output_tokens)
  ) {
    errors.push('maximum_context_tokens_below_component_limit');
  }
  if (limits.limits_verified !== false) errors.push('limits_verified_must_be_false');
  if (limits.simulation !== true) errors.push('simulation_must_be_true');
  if (limits.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (limits.validator_version !== MODEL_LIMITS_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(limits);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(limits));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_LIMIT_VALUE,
  MODEL_LIMITS_CONTRACT_VALIDATOR_VERSION,
  MODEL_LIMITS_FIELDS,
  validateModelLimitsContract
};

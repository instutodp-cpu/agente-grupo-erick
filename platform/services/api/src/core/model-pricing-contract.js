'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_PRICING_CONTRACT_VALIDATOR_VERSION = 'model_pricing_contract_validator_v1';
const MODEL_PRICING_FIELDS = Object.freeze([
  'pricing_id', 'pricing_version', 'provider_id', 'model_id', 'currency', 'billing_unit',
  'input_cost_minor_units_per_million', 'output_cost_minor_units_per_million', 'cached_input_cost_minor_units_per_million',
  'request_cost_minor_units', 'image_input_cost_minor_units', 'image_output_cost_minor_units',
  'audio_input_cost_minor_units_per_minute', 'audio_output_cost_minor_units_per_minute',
  'free_tier_available_reference', 'free_tier_limit_reference', 'pricing_verified', 'pricing_effective_sequence',
  'simulation', 'production_blocked', 'validator_version'
]);
const BILLING_UNITS = Object.freeze(['TOKEN_REFERENCE', 'REQUEST_REFERENCE', 'IMAGE_REFERENCE', 'AUDIO_MINUTE_REFERENCE', 'ZERO_COST_REFERENCE', 'MIXED_REFERENCE']);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const MAX_MINOR_UNITS = 1000000000;
const NON_NEGATIVE_INTEGER_FIELDS = Object.freeze([
  'input_cost_minor_units_per_million', 'output_cost_minor_units_per_million', 'cached_input_cost_minor_units_per_million',
  'request_cost_minor_units', 'image_input_cost_minor_units', 'image_output_cost_minor_units',
  'audio_input_cost_minor_units_per_minute', 'audio_output_cost_minor_units_per_minute', 'free_tier_limit_reference'
]);

function isBoundedNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_MINOR_UNITS;
}

function validateModelPricingContract(pricing) {
  const errors = [];
  if (!isPlainObject(pricing)) return { valid: false, errors: ['model_pricing_must_be_object'] };
  exactFields(pricing, MODEL_PRICING_FIELDS, 'model_pricing', errors);
  for (const field of ['pricing_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(pricing[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(pricing.pricing_version) || pricing.pricing_version < 1) errors.push('pricing_version_invalid');
  if (!CURRENCY_PATTERN.test(pricing.currency || '')) errors.push('currency_invalid');
  if (!BILLING_UNITS.includes(pricing.billing_unit)) errors.push(`billing_unit_not_allowed::${pricing.billing_unit}`);
  for (const field of NON_NEGATIVE_INTEGER_FIELDS) {
    if (!isBoundedNonNegativeInteger(pricing[field])) errors.push(`${field}_invalid`);
  }
  if (typeof pricing.free_tier_available_reference !== 'boolean') errors.push('free_tier_available_reference_must_be_boolean');
  if (pricing.pricing_verified !== false) errors.push('pricing_verified_must_be_false');
  if (!Number.isInteger(pricing.pricing_effective_sequence) || pricing.pricing_effective_sequence < 0) errors.push('pricing_effective_sequence_invalid');
  if (pricing.simulation !== true) errors.push('simulation_must_be_true');
  if (pricing.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (pricing.validator_version !== MODEL_PRICING_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(pricing);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(pricing));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  BILLING_UNITS,
  CURRENCY_PATTERN,
  MAX_MINOR_UNITS,
  MODEL_PRICING_CONTRACT_VALIDATOR_VERSION,
  MODEL_PRICING_FIELDS,
  validateModelPricingContract
};

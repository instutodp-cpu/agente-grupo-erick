'use strict';

const { isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { FORBIDDEN_PRIVACY_TIERS, LATENCY_TIERS, PRIVACY_TIERS, QUALITY_TIERS } = require('./model-contract');
const { HEALTH_STATUSES } = require('./model-health-contract');
const { AVAILABILITY_STATUSES } = require('./model-availability-contract');

const MODEL_SELECTION_CONSTRAINTS_VALIDATOR_VERSION = 'model_selection_constraints_validator_v1';
const SELECTION_CONSTRAINTS_FIELDS = Object.freeze([
  'allow_no_llm', 'allow_zero_cost', 'allow_local', 'allow_remote', 'allow_commercial', 'allow_open_source',
  'allow_fallback', 'allow_escalation', 'maximum_cost_minor_units', 'maximum_input_tokens', 'maximum_output_tokens',
  'maximum_total_tokens', 'maximum_latency_tier', 'minimum_quality_tier', 'required_privacy_tier',
  'required_health_status', 'required_availability_status', 'maximum_candidates', 'maximum_fallbacks',
  'maximum_escalations', 'prefer_cached_reference', 'prefer_same_provider_reference', 'prefer_local_reference',
  'prefer_zero_cost_reference', 'validator_version'
]);
const BOOLEAN_FIELDS = Object.freeze([
  'allow_no_llm', 'allow_zero_cost', 'allow_local', 'allow_remote', 'allow_commercial', 'allow_open_source',
  'allow_fallback', 'allow_escalation', 'prefer_cached_reference', 'prefer_same_provider_reference',
  'prefer_local_reference', 'prefer_zero_cost_reference'
]);
const MAX_COST_MINOR_UNITS = 1000000000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_CANDIDATES = 200;
const MAX_FALLBACKS = 20;
const MAX_ESCALATIONS = 20;

function isBoundedNonNegativeInteger(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max;
}

function validateModelSelectionConstraints(constraints) {
  const errors = [];
  if (!isPlainObject(constraints)) return { valid: false, errors: ['constraints_must_be_object'] };
  exactFields(constraints, SELECTION_CONSTRAINTS_FIELDS, 'constraints', errors);
  for (const field of BOOLEAN_FIELDS) {
    if (typeof constraints[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!isBoundedNonNegativeInteger(constraints.maximum_cost_minor_units, MAX_COST_MINOR_UNITS)) errors.push('maximum_cost_minor_units_invalid');
  for (const field of ['maximum_input_tokens', 'maximum_output_tokens', 'maximum_total_tokens']) {
    if (!isBoundedNonNegativeInteger(constraints[field], MAX_TOKENS_REFERENCE)) errors.push(`${field}_invalid`);
  }
  if (
    isBoundedNonNegativeInteger(constraints.maximum_input_tokens, MAX_TOKENS_REFERENCE) &&
    isBoundedNonNegativeInteger(constraints.maximum_output_tokens, MAX_TOKENS_REFERENCE) &&
    isBoundedNonNegativeInteger(constraints.maximum_total_tokens, MAX_TOKENS_REFERENCE) &&
    constraints.maximum_total_tokens < constraints.maximum_input_tokens + constraints.maximum_output_tokens
  ) {
    errors.push('maximum_total_tokens_below_component_limit');
  }
  if (!LATENCY_TIERS.includes(constraints.maximum_latency_tier)) errors.push(`maximum_latency_tier_not_allowed::${constraints.maximum_latency_tier}`);
  if (!QUALITY_TIERS.includes(constraints.minimum_quality_tier)) errors.push(`minimum_quality_tier_not_allowed::${constraints.minimum_quality_tier}`);
  if (!PRIVACY_TIERS.includes(constraints.required_privacy_tier)) errors.push(`required_privacy_tier_not_allowed::${constraints.required_privacy_tier}`);
  if (FORBIDDEN_PRIVACY_TIERS.includes(constraints.required_privacy_tier)) errors.push(`required_privacy_tier_forbidden::${constraints.required_privacy_tier}`);
  if (!HEALTH_STATUSES.includes(constraints.required_health_status)) errors.push(`required_health_status_not_allowed::${constraints.required_health_status}`);
  if (!AVAILABILITY_STATUSES.includes(constraints.required_availability_status)) errors.push(`required_availability_status_not_allowed::${constraints.required_availability_status}`);
  if (!isBoundedNonNegativeInteger(constraints.maximum_candidates, MAX_CANDIDATES) || constraints.maximum_candidates < 1) errors.push('maximum_candidates_invalid');
  if (!isBoundedNonNegativeInteger(constraints.maximum_fallbacks, MAX_FALLBACKS)) errors.push('maximum_fallbacks_invalid');
  if (!isBoundedNonNegativeInteger(constraints.maximum_escalations, MAX_ESCALATIONS)) errors.push('maximum_escalations_invalid');
  if (constraints.validator_version !== MODEL_SELECTION_CONSTRAINTS_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(constraints);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(constraints));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_CANDIDATES,
  MAX_COST_MINOR_UNITS,
  MAX_ESCALATIONS,
  MAX_FALLBACKS,
  MAX_TOKENS_REFERENCE,
  MODEL_SELECTION_CONSTRAINTS_VALIDATOR_VERSION,
  SELECTION_CONSTRAINTS_FIELDS,
  validateModelSelectionConstraints
};

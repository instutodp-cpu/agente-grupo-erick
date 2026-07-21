'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { RETENTION_CLASSES } = require('./agent-memory-item-contract');
const { AVAILABILITY_STATUSES, isNormalizedRegionList, MAX_REGION_REFERENCES } = require('./model-availability-contract');
const { CAPACITY_STATUS_REFERENCES, HEALTH_STATUSES } = require('./model-health-contract');
const {
  MODALITIES,
  MODEL_SLUG_PATTERN,
  isNormalizedModalityList,
  validateReferenceList,
  validateSingleReference
} = require('./model-contract');

const MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION = 'model_provider_contract_validator_v1';
const MODEL_PROVIDER_FIELDS = Object.freeze([
  'provider_id', 'provider_slug', 'provider_version', 'provider_type', 'tenant_id', 'organization_id',
  'display_name', 'description', 'provider_status', 'deployment_mode', 'supported_regions', 'supported_modalities',
  'privacy_profile', 'availability_profile', 'health_profile', 'rate_limit_profile', 'pricing_reference',
  'capability_references', 'model_references', 'simulation_context', 'created_sequence', 'validator_version'
]);
const PROVIDER_TYPES = Object.freeze([
  'COMMERCIAL_API_REFERENCE', 'LOCAL_RUNTIME_REFERENCE', 'SELF_HOSTED_REFERENCE', 'OPEN_SOURCE_REFERENCE',
  'ENTERPRISE_GATEWAY_REFERENCE', 'AGGREGATOR_REFERENCE', 'SYSTEM_REFERENCE'
]);
const PROVIDER_STATUSES = Object.freeze(['DRAFT', 'VALIDATED_SIMULATION', 'DEGRADED_REFERENCE', 'UNAVAILABLE_REFERENCE', 'SUSPENDED', 'ARCHIVED']);
const FORBIDDEN_PROVIDER_STATUSES = Object.freeze(['ACTIVE', 'CONNECTED', 'AUTHENTICATED', 'LIVE', 'PRODUCTION', 'ENABLED']);
const DEPLOYMENT_MODES = Object.freeze(['REMOTE_API_REFERENCE', 'LOCAL_REFERENCE', 'SELF_HOSTED_REFERENCE', 'HYBRID_REFERENCE', 'GATEWAY_REFERENCE']);

const PRIVACY_PROFILE_FIELDS = Object.freeze([
  'privacy_profile_id', 'data_retention_reference', 'training_usage_reference', 'regional_processing_reference',
  'private_network_reference', 'local_processing_reference', 'encryption_reference',
  'confidential_data_allowed_reference', 'restricted_data_allowed', 'privacy_verified', 'simulation',
  'production_blocked', 'validator_version'
]);
const AVAILABILITY_PROFILE_FIELDS = Object.freeze([
  'availability_profile_id', 'availability_status', 'maintenance_reference', 'quota_available_reference',
  'capacity_available_reference', 'availability_verified', 'last_evaluated_sequence', 'simulation',
  'production_blocked', 'validator_version'
]);
const HEALTH_PROFILE_FIELDS = Object.freeze([
  'health_profile_id', 'health_status', 'capacity_status_reference', 'health_verified', 'network_checked',
  'provider_called', 'last_checked_sequence', 'simulation', 'production_blocked', 'validator_version'
]);
const RATE_LIMIT_PROFILE_FIELDS = Object.freeze([
  'rate_limit_profile_id', 'maximum_requests_per_minute_reference', 'maximum_tokens_per_minute_reference',
  'maximum_concurrent_requests_reference', 'rate_limits_verified', 'simulation', 'production_blocked',
  'validator_version'
]);
const MAX_RATE_LIMIT_VALUE = 100000000000;

function validatePrivacyProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['privacy_profile_must_be_object'] };
  exactFields(profile, PRIVACY_PROFILE_FIELDS, 'privacy_profile', errors);
  if (!isNonEmptyString(profile.privacy_profile_id)) errors.push('privacy_profile_id_invalid');
  if (!RETENTION_CLASSES.includes(profile.data_retention_reference)) errors.push(`data_retention_reference_not_allowed::${profile.data_retention_reference}`);
  for (const field of ['training_usage_reference', 'regional_processing_reference', 'private_network_reference', 'local_processing_reference', 'encryption_reference', 'confidential_data_allowed_reference']) {
    if (typeof profile[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (profile.restricted_data_allowed !== false) errors.push('restricted_data_allowed_must_be_false');
  if (profile.privacy_verified !== false) errors.push('privacy_verified_must_be_false');
  if (profile.simulation !== true) errors.push('simulation_must_be_true');
  if (profile.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (profile.validator_version !== MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAvailabilityProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['availability_profile_must_be_object'] };
  exactFields(profile, AVAILABILITY_PROFILE_FIELDS, 'availability_profile', errors);
  if (!isNonEmptyString(profile.availability_profile_id)) errors.push('availability_profile_id_invalid');
  if (!AVAILABILITY_STATUSES.includes(profile.availability_status)) errors.push(`availability_status_not_allowed::${profile.availability_status}`);
  for (const field of ['maintenance_reference', 'quota_available_reference', 'capacity_available_reference']) {
    if (typeof profile[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (profile.availability_verified !== false) errors.push('availability_verified_must_be_false');
  if (!Number.isInteger(profile.last_evaluated_sequence) || profile.last_evaluated_sequence < 0) errors.push('last_evaluated_sequence_invalid');
  if (profile.simulation !== true) errors.push('simulation_must_be_true');
  if (profile.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (profile.validator_version !== MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateHealthProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['health_profile_must_be_object'] };
  exactFields(profile, HEALTH_PROFILE_FIELDS, 'health_profile', errors);
  if (!isNonEmptyString(profile.health_profile_id)) errors.push('health_profile_id_invalid');
  if (!HEALTH_STATUSES.includes(profile.health_status)) errors.push(`health_status_not_allowed::${profile.health_status}`);
  if (!CAPACITY_STATUS_REFERENCES.includes(profile.capacity_status_reference)) errors.push(`capacity_status_reference_not_allowed::${profile.capacity_status_reference}`);
  if (profile.health_verified !== false) errors.push('health_verified_must_be_false');
  if (profile.network_checked !== false) errors.push('network_checked_must_be_false');
  if (profile.provider_called !== false) errors.push('provider_called_must_be_false');
  if (!Number.isInteger(profile.last_checked_sequence) || profile.last_checked_sequence < 0) errors.push('last_checked_sequence_invalid');
  if (profile.simulation !== true) errors.push('simulation_must_be_true');
  if (profile.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (profile.validator_version !== MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRateLimitProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['rate_limit_profile_must_be_object'] };
  exactFields(profile, RATE_LIMIT_PROFILE_FIELDS, 'rate_limit_profile', errors);
  if (!isNonEmptyString(profile.rate_limit_profile_id)) errors.push('rate_limit_profile_id_invalid');
  for (const field of ['maximum_requests_per_minute_reference', 'maximum_tokens_per_minute_reference', 'maximum_concurrent_requests_reference']) {
    if (!Number.isInteger(profile[field]) || profile[field] < 0 || profile[field] > MAX_RATE_LIMIT_VALUE) errors.push(`${field}_invalid`);
  }
  if (profile.rate_limits_verified !== false) errors.push('rate_limits_verified_must_be_false');
  if (profile.simulation !== true) errors.push('simulation_must_be_true');
  if (profile.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (profile.validator_version !== MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateModelProviderContract(provider) {
  const errors = [];
  if (!isPlainObject(provider)) return { valid: false, errors: ['model_provider_must_be_object'] };
  exactFields(provider, MODEL_PROVIDER_FIELDS, 'model_provider', errors);
  for (const field of ['provider_id', 'provider_slug', 'tenant_id', 'organization_id', 'display_name', 'description', 'validator_version']) {
    if (!isNonEmptyString(provider[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(provider.provider_version) || provider.provider_version < 1) errors.push('provider_version_invalid');
  if (!Number.isInteger(provider.created_sequence) || provider.created_sequence < 0) errors.push('created_sequence_invalid');
  if (isNonEmptyString(provider.provider_slug) && !MODEL_SLUG_PATTERN.test(provider.provider_slug)) errors.push('provider_slug_not_normalized');
  if (!PROVIDER_TYPES.includes(provider.provider_type)) errors.push(`provider_type_not_allowed::${provider.provider_type}`);
  if (!PROVIDER_STATUSES.includes(provider.provider_status)) errors.push(`provider_status_not_allowed::${provider.provider_status}`);
  if (FORBIDDEN_PROVIDER_STATUSES.includes(provider.provider_status)) errors.push(`provider_status_forbidden::${provider.provider_status}`);
  if (!DEPLOYMENT_MODES.includes(provider.deployment_mode)) errors.push(`deployment_mode_not_allowed::${provider.deployment_mode}`);
  if (!isNormalizedRegionList(provider.supported_regions)) errors.push('supported_regions_invalid');
  if (Array.isArray(provider.supported_regions) && provider.supported_regions.length > MAX_REGION_REFERENCES) errors.push('supported_regions_exceeds_maximum');
  if (!isNormalizedModalityList(provider.supported_modalities)) errors.push('supported_modalities_invalid');
  if (Array.isArray(provider.supported_modalities) && !provider.supported_modalities.every((item) => MODALITIES.includes(item))) {
    errors.push('supported_modalities_contains_unknown_modality');
  }

  errors.push(...validatePrivacyProfile(provider.privacy_profile).errors.map((error) => `privacy_profile_${error}`));
  errors.push(...validateAvailabilityProfile(provider.availability_profile).errors.map((error) => `availability_profile_${error}`));
  errors.push(...validateHealthProfile(provider.health_profile).errors.map((error) => `health_profile_${error}`));
  errors.push(...validateRateLimitProfile(provider.rate_limit_profile).errors.map((error) => `rate_limit_profile_${error}`));
  errors.push(...validateSingleReference(provider.pricing_reference).errors.map((error) => `pricing_reference_${error}`));
  errors.push(...validateReferenceList(provider.capability_references).errors.map((error) => `capability_references_${error}`));
  errors.push(...validateReferenceList(provider.model_references).errors.map((error) => `model_references_${error}`));
  errors.push(...validateAgentSimulationContext(provider.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (isNonEmptyString(provider.tenant_id) && isNonEmptyString(provider.organization_id) && !provider.organization_id.startsWith(`${provider.tenant_id}:`)) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (provider.validator_version !== MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(provider);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(provider));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AVAILABILITY_PROFILE_FIELDS,
  DEPLOYMENT_MODES,
  FORBIDDEN_PROVIDER_STATUSES,
  HEALTH_PROFILE_FIELDS,
  MAX_RATE_LIMIT_VALUE,
  MODEL_PROVIDER_CONTRACT_VALIDATOR_VERSION,
  MODEL_PROVIDER_FIELDS,
  PRIVACY_PROFILE_FIELDS,
  PROVIDER_STATUSES,
  PROVIDER_TYPES,
  RATE_LIMIT_PROFILE_FIELDS,
  validateAvailabilityProfile,
  validateHealthProfile,
  validateModelProviderContract,
  validatePrivacyProfile,
  validateRateLimitProfile
};

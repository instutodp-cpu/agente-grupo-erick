'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');

const MODEL_CONTRACT_VALIDATOR_VERSION = 'model_contract_validator_v1';
const MODEL_FIELDS = Object.freeze([
  'model_id', 'model_slug', 'model_version', 'provider_id', 'provider_version', 'tenant_id', 'organization_id',
  'display_name', 'description', 'model_family', 'model_status', 'quality_tier', 'cost_tier', 'latency_tier',
  'privacy_tier', 'context_window_tokens', 'maximum_input_tokens', 'maximum_output_tokens', 'supported_modalities',
  'capability_references', 'pricing_reference', 'limits_reference', 'availability_reference', 'health_reference',
  'simulation_context', 'created_sequence', 'validator_version'
]);
const MODEL_STATUSES = Object.freeze(['DRAFT', 'VALIDATED_SIMULATION', 'DEGRADED_REFERENCE', 'UNAVAILABLE_REFERENCE', 'SUSPENDED', 'ARCHIVED']);
const FORBIDDEN_MODEL_STATUSES = Object.freeze(['ACTIVE', 'LOADED', 'RUNNING', 'SERVING', 'CONNECTED', 'ENABLED']);
const QUALITY_TIERS = Object.freeze(['UTILITY', 'BASIC', 'STANDARD', 'ADVANCED', 'PREMIUM', 'SPECIALIST']);
const COST_TIERS = Object.freeze(['ZERO_COST_REFERENCE', 'VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'PREMIUM', 'UNKNOWN_BLOCKED']);
const LATENCY_TIERS = Object.freeze(['VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'BATCH_REFERENCE', 'UNKNOWN_BLOCKED']);
const PRIVACY_TIERS = Object.freeze([
  'PUBLIC_PROCESSING_REFERENCE', 'STANDARD_PROCESSING_REFERENCE', 'NO_TRAINING_REFERENCE',
  'PRIVATE_GATEWAY_REFERENCE', 'LOCAL_PROCESSING_REFERENCE', 'RESTRICTED_BLOCKED'
]);
const FORBIDDEN_PRIVACY_TIERS = Object.freeze(['RESTRICTED_BLOCKED']);
const MODALITIES = Object.freeze([
  'TEXT_INPUT', 'TEXT_OUTPUT', 'IMAGE_INPUT_REFERENCE', 'IMAGE_OUTPUT_REFERENCE', 'AUDIO_INPUT_REFERENCE',
  'AUDIO_OUTPUT_REFERENCE', 'VIDEO_INPUT_REFERENCE', 'EMBEDDING_REFERENCE', 'TOOL_CALLING_REFERENCE',
  'STRUCTURED_OUTPUT_REFERENCE', 'CODE_REFERENCE', 'REASONING_REFERENCE'
]);
const MODEL_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MODEL_FAMILY_PATTERN = /^[a-z0-9]+([ -][a-z0-9]+)*$/;
const MAX_MODEL_FAMILY_LENGTH = 60;
const MAX_TOKENS_BOUND = 100000000;
const MAX_MODALITIES = MODALITIES.length;

const SINGLE_REFERENCE_FIELDS = Object.freeze(['reference_id', 'reference_version', 'reference_fingerprint', 'reference_present', 'validator_version']);
const LIST_REFERENCE_ITEM_FIELDS = Object.freeze(['reference_id', 'reference_version', 'reference_fingerprint', 'validator_version']);
const MAX_REFERENCE_LIST_ITEMS = 100;

function validateSingleReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['reference_must_be_object'] };
  exactFields(reference, SINGLE_REFERENCE_FIELDS, 'reference', errors);
  for (const field of ['reference_id', 'reference_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 0) errors.push('reference_version_invalid');
  if (typeof reference.reference_present !== 'boolean') errors.push('reference_present_must_be_boolean');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateReferenceListItem(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['reference_item_must_be_object'] };
  exactFields(reference, LIST_REFERENCE_ITEM_FIELDS, 'reference_item', errors);
  for (const field of ['reference_id', 'reference_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 1) errors.push('reference_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateReferenceList(list, options = {}) {
  const maxItems = Number.isInteger(options.maxItems) ? options.maxItems : MAX_REFERENCE_LIST_ITEMS;
  if (!Array.isArray(list) || list.length > maxItems) return { valid: false, errors: ['reference_list_invalid'] };
  const errors = [];
  const ids = new Set();
  list.forEach((item, index) => {
    const validation = validateReferenceListItem(item);
    errors.push(...validation.errors.map((error) => `reference_list[${index}]_${error}`));
    if (isPlainObject(item) && isNonEmptyString(item.reference_id)) {
      if (ids.has(item.reference_id)) errors.push(`reference_list_duplicate::${item.reference_id}`);
      ids.add(item.reference_id);
    }
  });
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isNormalizedModalityList(list) {
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MODALITIES) return false;
  if (!list.every((item) => MODALITIES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelContract(model) {
  const errors = [];
  if (!isPlainObject(model)) return { valid: false, errors: ['model_must_be_object'] };
  exactFields(model, MODEL_FIELDS, 'model', errors);
  for (const field of ['model_id', 'model_slug', 'provider_id', 'tenant_id', 'organization_id', 'display_name', 'description', 'model_family', 'validator_version']) {
    if (!isNonEmptyString(model[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(model.model_version) || model.model_version < 1) errors.push('model_version_invalid');
  if (!Number.isInteger(model.provider_version) || model.provider_version < 1) errors.push('provider_version_invalid');
  if (!Number.isInteger(model.created_sequence) || model.created_sequence < 0) errors.push('created_sequence_invalid');
  if (isNonEmptyString(model.model_slug) && !MODEL_SLUG_PATTERN.test(model.model_slug)) errors.push('model_slug_not_normalized');
  if (isNonEmptyString(model.model_family) && (!MODEL_FAMILY_PATTERN.test(model.model_family) || model.model_family.length > MAX_MODEL_FAMILY_LENGTH)) {
    errors.push('model_family_not_normalized');
  }
  if (!MODEL_STATUSES.includes(model.model_status)) errors.push(`model_status_not_allowed::${model.model_status}`);
  if (FORBIDDEN_MODEL_STATUSES.includes(model.model_status)) errors.push(`model_status_forbidden::${model.model_status}`);
  if (!QUALITY_TIERS.includes(model.quality_tier)) errors.push(`quality_tier_not_allowed::${model.quality_tier}`);
  if (!COST_TIERS.includes(model.cost_tier)) errors.push(`cost_tier_not_allowed::${model.cost_tier}`);
  if (!LATENCY_TIERS.includes(model.latency_tier)) errors.push(`latency_tier_not_allowed::${model.latency_tier}`);
  if (!PRIVACY_TIERS.includes(model.privacy_tier)) errors.push(`privacy_tier_not_allowed::${model.privacy_tier}`);
  if (FORBIDDEN_PRIVACY_TIERS.includes(model.privacy_tier)) errors.push(`privacy_tier_forbidden::${model.privacy_tier}`);
  for (const field of ['context_window_tokens', 'maximum_input_tokens', 'maximum_output_tokens']) {
    if (!Number.isInteger(model[field]) || model[field] < 0 || model[field] > MAX_TOKENS_BOUND) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(model.context_window_tokens) && Number.isInteger(model.maximum_input_tokens) && Number.isInteger(model.maximum_output_tokens) &&
    model.context_window_tokens < Math.max(model.maximum_input_tokens, model.maximum_output_tokens)
  ) {
    errors.push('context_window_tokens_below_component_limit');
  }
  if (!isNormalizedModalityList(model.supported_modalities)) errors.push('supported_modalities_invalid');

  errors.push(...validateReferenceList(model.capability_references).errors.map((error) => `capability_references_${error}`));
  errors.push(...validateSingleReference(model.pricing_reference).errors.map((error) => `pricing_reference_${error}`));
  errors.push(...validateSingleReference(model.limits_reference).errors.map((error) => `limits_reference_${error}`));
  errors.push(...validateSingleReference(model.availability_reference).errors.map((error) => `availability_reference_${error}`));
  errors.push(...validateSingleReference(model.health_reference).errors.map((error) => `health_reference_${error}`));
  errors.push(...validateAgentSimulationContext(model.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (isNonEmptyString(model.tenant_id) && isNonEmptyString(model.organization_id) && !model.organization_id.startsWith(`${model.tenant_id}:`)) {
    errors.push('organization_id_not_compatible_with_tenant');
  }
  if (model.validator_version !== MODEL_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(model);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(model));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  COST_TIERS,
  FORBIDDEN_MODEL_STATUSES,
  FORBIDDEN_PRIVACY_TIERS,
  LATENCY_TIERS,
  LIST_REFERENCE_ITEM_FIELDS,
  MAX_MODALITIES,
  MAX_REFERENCE_LIST_ITEMS,
  MODALITIES,
  MODEL_CONTRACT_VALIDATOR_VERSION,
  MODEL_FAMILY_PATTERN,
  MODEL_FIELDS,
  MODEL_SLUG_PATTERN,
  MODEL_STATUSES,
  PRIVACY_TIERS,
  QUALITY_TIERS,
  SINGLE_REFERENCE_FIELDS,
  isNormalizedModalityList,
  validateModelContract,
  validateReferenceList,
  validateReferenceListItem,
  validateSingleReference
};

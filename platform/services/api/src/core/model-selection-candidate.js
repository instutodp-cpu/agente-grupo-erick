'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { HEALTH_STATUSES } = require('./model-health-contract');
const { AVAILABILITY_STATUSES } = require('./model-availability-contract');
const { FORBIDDEN_PRIVACY_TIERS, MODALITIES, PRIVACY_TIERS, QUALITY_TIERS, COST_TIERS, LATENCY_TIERS } = require('./model-contract');

const MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION = 'model_selection_candidate_validator_v1';
const SELECTION_CANDIDATE_FIELDS = Object.freeze([
  'candidate_id', 'candidate_version', 'provider_id', 'model_id', 'tenant_id', 'organization_id',
  'provider_fingerprint', 'model_fingerprint', 'capability_fingerprints', 'pricing_fingerprint', 'limits_fingerprint',
  'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint', 'quality_tier', 'cost_tier',
  'latency_tier', 'privacy_tier', 'supported_capabilities', 'supported_modalities', 'context_window_tokens',
  'maximum_input_tokens', 'maximum_output_tokens', 'estimated_cost_minor_units', 'availability_status',
  'health_status', 'local_reference', 'zero_cost_reference', 'candidate_status', 'validator_version'
]);
const CANDIDATE_STATUSES = Object.freeze([
  'PENDING_EVALUATION', 'ELIGIBLE_SIMULATION', 'INELIGIBLE', 'POLICY_BLOCKED', 'CAPABILITY_BLOCKED',
  'CONTEXT_BLOCKED', 'PRIVACY_BLOCKED', 'AVAILABILITY_BLOCKED', 'HEALTH_BLOCKED', 'BUDGET_BLOCKED',
  'VERSION_BLOCKED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED'
]);
const NO_LLM_CANDIDATE_ID = 'NO_LLM';
const NO_LLM_SENTINEL_FINGERPRINT = 'no_llm_reference';
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 1000000000;
const VISION_AUDIO_MODALITIES = Object.freeze([
  'IMAGE_INPUT_REFERENCE', 'IMAGE_OUTPUT_REFERENCE', 'AUDIO_INPUT_REFERENCE', 'AUDIO_OUTPUT_REFERENCE', 'VIDEO_INPUT_REFERENCE'
]);

function isOrderedUniqueEnumList(list, allowedValues, { minItems = 0, maxItems = allowedValues.length } = {}) {
  if (!Array.isArray(list) || list.length < minItems || list.length > maxItems) return false;
  if (!list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueStringList(list, maxItems = 100) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionCandidate(candidate) {
  const errors = [];
  if (!isPlainObject(candidate)) return { valid: false, errors: ['candidate_must_be_object'] };
  exactFields(candidate, SELECTION_CANDIDATE_FIELDS, 'candidate', errors);
  const isNoLlm = candidate.candidate_id === NO_LLM_CANDIDATE_ID;
  for (const field of ['candidate_id', 'tenant_id', 'organization_id', 'provider_fingerprint', 'model_fingerprint', 'pricing_fingerprint', 'limits_fingerprint', 'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(candidate[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(candidate.capability_fingerprints)) errors.push('capability_fingerprints_invalid');
  if (!Number.isInteger(candidate.candidate_version) || candidate.candidate_version < 1) errors.push('candidate_version_invalid');
  if (isNoLlm) {
    if (candidate.provider_id !== null) errors.push('provider_id_must_be_null_for_no_llm');
    if (candidate.model_id !== null) errors.push('model_id_must_be_null_for_no_llm');
  } else {
    if (!isNonEmptyString(candidate.provider_id)) errors.push('provider_id_invalid');
    if (!isNonEmptyString(candidate.model_id)) errors.push('model_id_invalid');
  }
  if (!QUALITY_TIERS.includes(candidate.quality_tier)) errors.push(`quality_tier_not_allowed::${candidate.quality_tier}`);
  if (!COST_TIERS.includes(candidate.cost_tier)) errors.push(`cost_tier_not_allowed::${candidate.cost_tier}`);
  if (!LATENCY_TIERS.includes(candidate.latency_tier)) errors.push(`latency_tier_not_allowed::${candidate.latency_tier}`);
  if (!PRIVACY_TIERS.includes(candidate.privacy_tier)) errors.push(`privacy_tier_not_allowed::${candidate.privacy_tier}`);
  if (FORBIDDEN_PRIVACY_TIERS.includes(candidate.privacy_tier)) errors.push(`privacy_tier_forbidden::${candidate.privacy_tier}`);
  if (!isOrderedUniqueEnumList(candidate.supported_capabilities, CAPABILITY_TYPES)) errors.push('supported_capabilities_invalid');
  if (!isOrderedUniqueEnumList(candidate.supported_modalities, MODALITIES)) errors.push('supported_modalities_invalid');
  for (const field of ['context_window_tokens', 'maximum_input_tokens', 'maximum_output_tokens']) {
    if (!Number.isInteger(candidate[field]) || candidate[field] < 0 || candidate[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(candidate.estimated_cost_minor_units) || candidate.estimated_cost_minor_units < 0 || candidate.estimated_cost_minor_units > MAX_COST_MINOR_UNITS) {
    errors.push('estimated_cost_minor_units_invalid');
  }
  if (!AVAILABILITY_STATUSES.includes(candidate.availability_status)) errors.push(`availability_status_not_allowed::${candidate.availability_status}`);
  if (!HEALTH_STATUSES.includes(candidate.health_status)) errors.push(`health_status_not_allowed::${candidate.health_status}`);
  for (const field of ['local_reference', 'zero_cost_reference']) {
    if (typeof candidate[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (!CANDIDATE_STATUSES.includes(candidate.candidate_status)) errors.push(`candidate_status_not_allowed::${candidate.candidate_status}`);
  if (isNoLlm) {
    if (candidate.estimated_cost_minor_units !== 0) errors.push('no_llm_estimated_cost_must_be_0');
    if (candidate.zero_cost_reference !== true) errors.push('no_llm_zero_cost_reference_must_be_true');
    if (candidate.local_reference !== true) errors.push('no_llm_local_reference_must_be_true');
    if (candidate.context_window_tokens !== 0) errors.push('no_llm_context_window_tokens_must_be_0');
    if (candidate.maximum_input_tokens !== 0) errors.push('no_llm_maximum_input_tokens_must_be_0');
    if (candidate.maximum_output_tokens !== 0) errors.push('no_llm_maximum_output_tokens_must_be_0');
  }
  if (candidate.validator_version !== MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(candidate);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(candidate));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isNoLlmEligible(taskProfile, constraints) {
  if (!isPlainObject(taskProfile) || !isPlainObject(constraints)) return false;
  if (constraints.allow_no_llm !== true) return false;
  if (taskProfile.deterministic_resolution_available !== true) return false;
  if (taskProfile.complexity_tier !== 'TIER_0_DETERMINISTIC') return false;
  if (!Array.isArray(taskProfile.required_capabilities) || taskProfile.required_capabilities.includes('REASONING_REFERENCE')) return false;
  if (taskProfile.required_capabilities.length > 0) return false;
  if (!Array.isArray(taskProfile.required_modalities) || taskProfile.required_modalities.some((modality) => VISION_AUDIO_MODALITIES.includes(modality))) return false;
  if (taskProfile.requires_tool_calling !== false) return false;
  if (taskProfile.requires_long_context !== false) return false;
  return true;
}

function buildNoLlmCandidate(tenantId, organizationId) {
  const candidate = {
    candidate_id: NO_LLM_CANDIDATE_ID,
    candidate_version: 1,
    provider_id: null,
    model_id: null,
    tenant_id: tenantId,
    organization_id: organizationId,
    provider_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    model_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    capability_fingerprints: [],
    pricing_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    limits_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    availability_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    privacy_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    health_fingerprint: NO_LLM_SENTINEL_FINGERPRINT,
    quality_tier: 'UTILITY',
    cost_tier: 'ZERO_COST_REFERENCE',
    latency_tier: 'VERY_LOW',
    privacy_tier: 'LOCAL_PROCESSING_REFERENCE',
    supported_capabilities: [],
    supported_modalities: [],
    context_window_tokens: 0,
    maximum_input_tokens: 0,
    maximum_output_tokens: 0,
    estimated_cost_minor_units: 0,
    availability_status: 'AVAILABLE_REFERENCE',
    health_status: 'HEALTHY_REFERENCE',
    local_reference: true,
    zero_cost_reference: true,
    candidate_status: 'PENDING_EVALUATION',
    validator_version: MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION
  };
  const validation = validateModelSelectionCandidate(candidate);
  if (!validation.valid) {
    throw new Error(`no_llm_candidate_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(candidate);
}

module.exports = {
  CANDIDATE_STATUSES,
  MODEL_SELECTION_CANDIDATE_VALIDATOR_VERSION,
  NO_LLM_CANDIDATE_ID,
  NO_LLM_SENTINEL_FINGERPRINT,
  SELECTION_CANDIDATE_FIELDS,
  VISION_AUDIO_MODALITIES,
  buildNoLlmCandidate,
  isNoLlmEligible,
  validateModelSelectionCandidate
};

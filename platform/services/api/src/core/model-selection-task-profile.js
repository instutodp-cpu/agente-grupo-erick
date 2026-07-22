'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { MODALITIES, QUALITY_TIERS, LATENCY_TIERS } = require('./model-contract');

const MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION = 'model_selection_task_profile_validator_v1';
const TASK_PROFILE_FIELDS = Object.freeze([
  'task_profile_id', 'task_profile_version', 'agent_id', 'tenant_id', 'organization_id', 'task_type',
  'complexity_tier', 'risk_classification', 'data_classification', 'required_capabilities', 'required_modalities',
  'minimum_quality_tier', 'maximum_latency_tier', 'estimated_input_tokens', 'estimated_output_tokens',
  'estimated_total_tokens', 'requires_structured_output', 'requires_tool_calling', 'requires_long_context',
  'requires_multilingual', 'deterministic_resolution_available', 'deterministic_resolution_reference',
  'human_review_required', 'logical_sequence', 'validator_version'
]);
const TASK_TYPES = Object.freeze([
  'DETERMINISTIC_QUERY_REFERENCE', 'CLASSIFICATION_REFERENCE', 'EXTRACTION_REFERENCE', 'SUMMARIZATION_REFERENCE',
  'ROUTING_REFERENCE', 'ANALYSIS_REFERENCE', 'PLANNING_REFERENCE', 'REASONING_REFERENCE', 'CODE_REFERENCE',
  'DOCUMENT_GENERATION_REFERENCE', 'VISION_REFERENCE', 'AUDIO_TRANSCRIPTION_REFERENCE', 'AUDIT_REFERENCE'
]);
const COMPLEXITY_TIERS = Object.freeze(['TIER_0_DETERMINISTIC', 'TIER_1_TRIVIAL', 'TIER_2_SIMPLE', 'TIER_3_MODERATE', 'TIER_4_COMPLEX', 'TIER_5_CRITICAL']);
const QUALITY_TIER_RANK = Object.freeze({ UTILITY: 0, BASIC: 1, STANDARD: 2, ADVANCED: 3, PREMIUM: 4, SPECIALIST: 5 });
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_REQUIRED_CAPABILITIES = CAPABILITY_TYPES.length;
const MAX_REQUIRED_MODALITIES = MODALITIES.length;

function isOrderedUniqueEnumList(list, allowedValues, { minItems = 0, maxItems = allowedValues.length } = {}) {
  if (!Array.isArray(list) || list.length < minItems || list.length > maxItems) return false;
  if (!list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionTaskProfile(profile) {
  const errors = [];
  if (!isPlainObject(profile)) return { valid: false, errors: ['task_profile_must_be_object'] };
  exactFields(profile, TASK_PROFILE_FIELDS, 'task_profile', errors);
  for (const field of ['task_profile_id', 'agent_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(profile[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(profile.task_profile_version) || profile.task_profile_version < 1) errors.push('task_profile_version_invalid');
  if (!TASK_TYPES.includes(profile.task_type)) errors.push(`task_type_not_allowed::${profile.task_type}`);
  if (!COMPLEXITY_TIERS.includes(profile.complexity_tier)) errors.push(`complexity_tier_not_allowed::${profile.complexity_tier}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(profile.risk_classification)) errors.push(`risk_classification_not_allowed::${profile.risk_classification}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(profile.data_classification)) errors.push(`data_classification_not_allowed::${profile.data_classification}`);
  if (!isOrderedUniqueEnumList(profile.required_capabilities, CAPABILITY_TYPES, { maxItems: MAX_REQUIRED_CAPABILITIES })) errors.push('required_capabilities_invalid');
  if (!isOrderedUniqueEnumList(profile.required_modalities, MODALITIES, { maxItems: MAX_REQUIRED_MODALITIES })) errors.push('required_modalities_invalid');
  if (!QUALITY_TIERS.includes(profile.minimum_quality_tier)) errors.push(`minimum_quality_tier_not_allowed::${profile.minimum_quality_tier}`);
  if (!LATENCY_TIERS.includes(profile.maximum_latency_tier)) errors.push(`maximum_latency_tier_not_allowed::${profile.maximum_latency_tier}`);
  for (const field of ['estimated_input_tokens', 'estimated_output_tokens', 'estimated_total_tokens']) {
    if (!Number.isInteger(profile[field]) || profile[field] < 0 || profile[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (
    Number.isInteger(profile.estimated_input_tokens) && Number.isInteger(profile.estimated_output_tokens) &&
    Number.isInteger(profile.estimated_total_tokens) &&
    profile.estimated_total_tokens !== profile.estimated_input_tokens + profile.estimated_output_tokens
  ) {
    errors.push('estimated_total_tokens_mismatch');
  }
  for (const field of ['requires_structured_output', 'requires_tool_calling', 'requires_long_context', 'requires_multilingual', 'deterministic_resolution_available', 'human_review_required']) {
    if (typeof profile[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (profile.deterministic_resolution_available === true && !isNonEmptyString(profile.deterministic_resolution_reference)) {
    errors.push('deterministic_resolution_reference_required_when_available');
  }
  if (profile.deterministic_resolution_available === false && profile.deterministic_resolution_reference !== null) {
    errors.push('deterministic_resolution_reference_must_be_null_when_unavailable');
  }
  if (!Number.isInteger(profile.logical_sequence) || profile.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (profile.complexity_tier === 'TIER_0_DETERMINISTIC' && profile.deterministic_resolution_available !== true) {
    errors.push('tier_0_requires_deterministic_resolution_available');
  }
  if (profile.complexity_tier === 'TIER_5_CRITICAL' && profile.human_review_required !== true) {
    errors.push('tier_5_requires_human_review_required');
  }
  if (
    (profile.risk_classification === 'HIGH' || profile.complexity_tier === 'TIER_5_CRITICAL') &&
    QUALITY_TIERS.includes(profile.minimum_quality_tier) &&
    QUALITY_TIER_RANK[profile.minimum_quality_tier] < QUALITY_TIER_RANK.ADVANCED
  ) {
    errors.push('high_risk_or_tier_5_requires_minimum_quality_advanced');
  }
  if (profile.validator_version !== MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(profile);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(profile));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  COMPLEXITY_TIERS,
  MAX_TOKENS_REFERENCE,
  MODEL_SELECTION_TASK_PROFILE_VALIDATOR_VERSION,
  QUALITY_TIER_RANK,
  TASK_PROFILE_FIELDS,
  TASK_TYPES,
  isOrderedUniqueEnumList,
  validateModelSelectionTaskProfile
};

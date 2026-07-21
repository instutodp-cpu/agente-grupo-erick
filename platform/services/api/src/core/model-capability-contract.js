'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_CAPABILITY_CONTRACT_VALIDATOR_VERSION = 'model_capability_contract_validator_v1';
const MODEL_CAPABILITY_FIELDS = Object.freeze([
  'capability_id', 'capability_version', 'provider_id', 'model_id', 'capability_type', 'support_level',
  'quality_score_reference', 'latency_score_reference', 'cost_score_reference', 'structured_output_supported',
  'tool_calling_supported', 'streaming_supported', 'batch_supported', 'multilingual_supported',
  'deterministic_mode_reference', 'maximum_capability_input_tokens', 'maximum_capability_output_tokens',
  'simulation', 'production_blocked', 'validator_version'
]);
const CAPABILITY_TYPES = Object.freeze([
  'TEXT_GENERATION_REFERENCE', 'SUMMARIZATION_REFERENCE', 'CLASSIFICATION_REFERENCE', 'EXTRACTION_REFERENCE',
  'ROUTING_REFERENCE', 'PLANNING_REFERENCE', 'REASONING_REFERENCE', 'CODE_REFERENCE', 'VISION_REFERENCE',
  'AUDIO_TRANSCRIPTION_REFERENCE', 'AUDIO_GENERATION_REFERENCE', 'IMAGE_GENERATION_REFERENCE', 'EMBEDDING_REFERENCE',
  'TOOL_CALLING_REFERENCE', 'STRUCTURED_OUTPUT_REFERENCE', 'LONG_CONTEXT_REFERENCE', 'MULTILINGUAL_REFERENCE'
]);
const SUPPORT_LEVELS = Object.freeze(['UNSUPPORTED', 'EXPERIMENTAL_REFERENCE', 'SUPPORTED_REFERENCE', 'STRONG_REFERENCE', 'SPECIALIST_REFERENCE']);
const MAX_SCORE_REFERENCE = 100;
const MAX_CAPABILITY_TOKENS = 10000000;

function isBoundedScore(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_SCORE_REFERENCE;
}

function validateModelCapabilityContract(capability) {
  const errors = [];
  if (!isPlainObject(capability)) return { valid: false, errors: ['model_capability_must_be_object'] };
  exactFields(capability, MODEL_CAPABILITY_FIELDS, 'model_capability', errors);
  for (const field of ['capability_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(capability[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(capability.capability_version) || capability.capability_version < 1) errors.push('capability_version_invalid');
  if (!CAPABILITY_TYPES.includes(capability.capability_type)) errors.push(`capability_type_not_allowed::${capability.capability_type}`);
  if (!SUPPORT_LEVELS.includes(capability.support_level)) errors.push(`support_level_not_allowed::${capability.support_level}`);
  for (const field of ['quality_score_reference', 'latency_score_reference', 'cost_score_reference']) {
    if (!isBoundedScore(capability[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['structured_output_supported', 'tool_calling_supported', 'streaming_supported', 'batch_supported', 'multilingual_supported', 'deterministic_mode_reference']) {
    if (typeof capability[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of ['maximum_capability_input_tokens', 'maximum_capability_output_tokens']) {
    if (!Number.isInteger(capability[field]) || capability[field] < 0 || capability[field] > MAX_CAPABILITY_TOKENS) errors.push(`${field}_invalid`);
  }
  if (capability.simulation !== true) errors.push('simulation_must_be_true');
  if (capability.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (capability.validator_version !== MODEL_CAPABILITY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(capability);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(capability));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CAPABILITY_TYPES,
  MAX_CAPABILITY_TOKENS,
  MAX_SCORE_REFERENCE,
  MODEL_CAPABILITY_CONTRACT_VALIDATOR_VERSION,
  MODEL_CAPABILITY_FIELDS,
  SUPPORT_LEVELS,
  validateModelCapabilityContract
};

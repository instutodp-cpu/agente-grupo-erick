'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_DATA_CLASSIFICATIONS, AGENT_RISK_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { CAPABILITY_TYPES } = require('./model-capability-contract');
const { FORBIDDEN_PRIVACY_TIERS, LATENCY_TIERS, MODALITIES, PRIVACY_TIERS, QUALITY_TIERS } = require('./model-contract');

const MODEL_SELECTION_REFERENCE_VALIDATOR_VERSION = 'model_selection_reference_validator_v1';
const MODEL_SELECTION_REFERENCE_FIELDS = Object.freeze([
  'selection_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'task_reference_id', 'task_type_reference',
  'complexity_tier_reference', 'risk_classification', 'data_classification', 'required_capabilities',
  'preferred_modalities', 'maximum_cost_minor_units_reference', 'maximum_input_tokens_reference',
  'maximum_output_tokens_reference', 'maximum_latency_tier_reference', 'minimum_quality_tier_reference',
  'privacy_requirement_reference', 'free_or_low_cost_preferred', 'local_preferred', 'fallback_allowed_reference',
  'escalation_allowed_reference', 'selection_requested', 'selection_executed', 'selected_provider_id',
  'selected_model_id', 'selection_reason_codes', 'simulation', 'production_blocked', 'validator_version'
]);
const COMPLEXITY_TIER_REFERENCES = Object.freeze(['TRIVIAL_REFERENCE', 'SIMPLE_REFERENCE', 'MODERATE_REFERENCE', 'COMPLEX_REFERENCE', 'EXPERT_REFERENCE']);
const MAX_COST_MINOR_UNITS_REFERENCE = 1000000000;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_REQUIRED_CAPABILITIES = CAPABILITY_TYPES.length;
const MAX_PREFERRED_MODALITIES = MODALITIES.length;
const MAX_REASON_CODES = 50;

function isOrderedUniqueStringList(list, maxItems) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function isOrderedUniqueEnumList(list, allowedValues, { minItems = 0, maxItems = allowedValues.length } = {}) {
  if (!Array.isArray(list) || list.length < minItems || list.length > maxItems) return false;
  if (!list.every((item) => allowedValues.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelSelectionReference(selection) {
  const errors = [];
  if (!isPlainObject(selection)) return { valid: false, errors: ['model_selection_reference_must_be_object'] };
  exactFields(selection, MODEL_SELECTION_REFERENCE_FIELDS, 'model_selection_reference', errors);
  for (const field of ['selection_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'task_reference_id', 'validator_version']) {
    if (!isNonEmptyString(selection[field])) errors.push(`${field}_invalid`);
  }
  if (!CAPABILITY_TYPES.includes(selection.task_type_reference)) errors.push(`task_type_reference_not_allowed::${selection.task_type_reference}`);
  if (!COMPLEXITY_TIER_REFERENCES.includes(selection.complexity_tier_reference)) errors.push(`complexity_tier_reference_not_allowed::${selection.complexity_tier_reference}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(selection.risk_classification)) errors.push(`risk_classification_not_allowed::${selection.risk_classification}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(selection.data_classification)) errors.push(`data_classification_not_allowed::${selection.data_classification}`);
  if (!isOrderedUniqueEnumList(selection.required_capabilities, CAPABILITY_TYPES, { minItems: 1, maxItems: MAX_REQUIRED_CAPABILITIES })) errors.push('required_capabilities_invalid');
  if (!isOrderedUniqueEnumList(selection.preferred_modalities, MODALITIES, { minItems: 0, maxItems: MAX_PREFERRED_MODALITIES })) errors.push('preferred_modalities_invalid');
  if (!Number.isInteger(selection.maximum_cost_minor_units_reference) || selection.maximum_cost_minor_units_reference < 0 || selection.maximum_cost_minor_units_reference > MAX_COST_MINOR_UNITS_REFERENCE) {
    errors.push('maximum_cost_minor_units_reference_invalid');
  }
  for (const field of ['maximum_input_tokens_reference', 'maximum_output_tokens_reference']) {
    if (!Number.isInteger(selection[field]) || selection[field] < 0 || selection[field] > MAX_TOKENS_REFERENCE) errors.push(`${field}_invalid`);
  }
  if (!LATENCY_TIERS.includes(selection.maximum_latency_tier_reference)) errors.push(`maximum_latency_tier_reference_not_allowed::${selection.maximum_latency_tier_reference}`);
  if (!QUALITY_TIERS.includes(selection.minimum_quality_tier_reference)) errors.push(`minimum_quality_tier_reference_not_allowed::${selection.minimum_quality_tier_reference}`);
  if (!PRIVACY_TIERS.includes(selection.privacy_requirement_reference)) errors.push(`privacy_requirement_reference_not_allowed::${selection.privacy_requirement_reference}`);
  if (FORBIDDEN_PRIVACY_TIERS.includes(selection.privacy_requirement_reference)) errors.push(`privacy_requirement_reference_forbidden::${selection.privacy_requirement_reference}`);
  for (const field of ['free_or_low_cost_preferred', 'local_preferred', 'fallback_allowed_reference', 'escalation_allowed_reference']) {
    if (typeof selection[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (selection.selection_requested !== true) errors.push('selection_requested_must_be_true');
  if (selection.selection_executed !== false) errors.push('selection_executed_must_be_false');
  if (selection.selected_provider_id !== null) errors.push('selected_provider_id_must_be_null');
  if (selection.selected_model_id !== null) errors.push('selected_model_id_must_be_null');
  if (!isOrderedUniqueStringList(selection.selection_reason_codes, MAX_REASON_CODES)) errors.push('selection_reason_codes_invalid');
  if (selection.simulation !== true) errors.push('simulation_must_be_true');
  if (selection.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (selection.validator_version !== MODEL_SELECTION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(selection);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(selection));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  COMPLEXITY_TIER_REFERENCES,
  MAX_COST_MINOR_UNITS_REFERENCE,
  MAX_TOKENS_REFERENCE,
  MODEL_SELECTION_REFERENCE_FIELDS,
  MODEL_SELECTION_REFERENCE_VALIDATOR_VERSION,
  isOrderedUniqueEnumList,
  isOrderedUniqueStringList,
  validateModelSelectionReference
};

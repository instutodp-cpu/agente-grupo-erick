'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');
const { validateModelProviderContract } = require('./model-provider-contract');
const { validateModelContract } = require('./model-contract');
const { validateModelCapabilityContract } = require('./model-capability-contract');
const { validateModelPricingContract } = require('./model-pricing-contract');
const { validateModelLimitsContract } = require('./model-limits-contract');
const { validateModelAvailabilityContract } = require('./model-availability-contract');
const { validateModelPrivacyContract } = require('./model-privacy-contract');
const { validateModelHealthContract } = require('./model-health-contract');
const { validateModelSelectionReference } = require('./model-selection-reference');

const MODEL_PROVIDER_DECISION_VALIDATOR_VERSION = 'model_provider_decision_validator_v1';
const MODEL_PROVIDER_DECISION_FIELDS = Object.freeze([
  'decision_id', 'provider_id', 'model_id', 'status', 'decision', 'eligible_in_simulation', 'provider_fingerprint',
  'model_fingerprint', 'capability_fingerprints', 'pricing_fingerprint', 'limits_fingerprint',
  'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint', 'selection_reference_fingerprint',
  'registry_version', 'blockers', 'reason_codes', 'provider_validated', 'model_validated', 'capabilities_validated',
  'pricing_validated', 'limits_validated', 'availability_validated', 'privacy_validated', 'health_validated',
  'model_selected', 'provider_called', 'network_used', 'tokens_consumed', 'cost_consumed', 'executed',
  'runtime_enabled', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);
const DECISION_STATUSES = Object.freeze([
  'ELIGIBLE_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED',
  'CAPABILITY_BLOCKED', 'PRICING_BLOCKED', 'LIMIT_BLOCKED', 'AVAILABILITY_BLOCKED', 'PRIVACY_BLOCKED',
  'HEALTH_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED'
]);
const DECISION_VALUES = Object.freeze(['VALIDATE_PROVIDER_REFERENCE', 'VALIDATE_MODEL_REFERENCE', 'VALIDATE_ELIGIBILITY_REFERENCE', 'BLOCKED']);
const MODEL_PROVIDER_DECISION_SAFE_FLAGS = Object.freeze({
  model_selected: false,
  provider_called: false,
  network_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';
const MAX_LIST_ITEMS = 200;
const QUALITY_TIER_RANK = Object.freeze({ UTILITY: 0, BASIC: 1, STANDARD: 2, ADVANCED: 3, PREMIUM: 4, SPECIALIST: 5 });
const LATENCY_TIER_RANK = Object.freeze({ VERY_LOW: 0, LOW: 1, MODERATE: 2, HIGH: 3, BATCH_REFERENCE: 4, UNKNOWN_BLOCKED: 5 });
const PRIVACY_TIER_RANK = Object.freeze({
  PUBLIC_PROCESSING_REFERENCE: 0, STANDARD_PROCESSING_REFERENCE: 1, NO_TRAINING_REFERENCE: 2,
  PRIVATE_GATEWAY_REFERENCE: 3, LOCAL_PROCESSING_REFERENCE: 4, RESTRICTED_BLOCKED: 5
});

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelProviderDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['model_provider_decision_must_be_object'] };
  exactFields(decision, MODEL_PROVIDER_DECISION_FIELDS, 'model_provider_decision', errors);
  for (const field of [
    'decision_id', 'provider_id', 'model_id', 'provider_fingerprint', 'model_fingerprint', 'pricing_fingerprint',
    'limits_fingerprint', 'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint',
    'selection_reference_fingerprint', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueStringList(decision.capability_fingerprints)) errors.push('capability_fingerprints_invalid');
  if (!DECISION_STATUSES.includes(decision.status)) errors.push(`status_not_allowed::${decision.status}`);
  if (!DECISION_VALUES.includes(decision.decision)) errors.push(`decision_not_allowed::${decision.decision}`);
  if (typeof decision.eligible_in_simulation !== 'boolean') errors.push('eligible_in_simulation_must_be_boolean');
  if (!isOrderedUniqueStringList(decision.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(decision.reason_codes)) errors.push('reason_codes_invalid');
  for (const field of [
    'provider_validated', 'model_validated', 'capabilities_validated', 'pricing_validated', 'limits_validated',
    'availability_validated', 'privacy_validated', 'health_validated'
  ]) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(MODEL_PROVIDER_DECISION_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.eligible_in_simulation === true && decision.status !== 'ELIGIBLE_SIMULATION') {
    errors.push('eligible_in_simulation_inconsistent_with_status');
  }
  if (decision.validator_version !== MODEL_PROVIDER_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelProviderDecision(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const decision = {
    decision_id: overrides.decision_id || 'model_provider_decision_not_available',
    provider_id: overrides.provider_id || 'provider_not_available',
    model_id: overrides.model_id || 'model_not_available',
    status,
    decision: DECISION_VALUES.includes(overrides.decision) ? overrides.decision : 'BLOCKED',
    eligible_in_simulation: status === 'ELIGIBLE_SIMULATION' && overrides.eligible_in_simulation === true,
    provider_fingerprint: overrides.provider_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_fingerprint: overrides.model_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    capability_fingerprints: Array.isArray(overrides.capability_fingerprints) ? uniqueSorted(overrides.capability_fingerprints) : [],
    pricing_fingerprint: overrides.pricing_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    limits_fingerprint: overrides.limits_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    availability_fingerprint: overrides.availability_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    privacy_fingerprint: overrides.privacy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    health_fingerprint: overrides.health_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    selection_reference_fingerprint: overrides.selection_reference_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    registry_version: overrides.registry_version || 'registry_version_not_available',
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    provider_validated: overrides.provider_validated === true,
    model_validated: overrides.model_validated === true,
    capabilities_validated: overrides.capabilities_validated === true,
    pricing_validated: overrides.pricing_validated === true,
    limits_validated: overrides.limits_validated === true,
    availability_validated: overrides.availability_validated === true,
    privacy_validated: overrides.privacy_validated === true,
    health_validated: overrides.health_validated === true,
    validator_version: MODEL_PROVIDER_DECISION_VALIDATOR_VERSION,
    ...MODEL_PROVIDER_DECISION_SAFE_FLAGS
  };
  const validation = validateModelProviderDecision(decision);
  if (!validation.valid) {
    return cloneFrozen({
      ...decision,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      eligible_in_simulation: false,
      provider_validated: false,
      model_validated: false,
      capabilities_validated: false,
      pricing_validated: false,
      limits_validated: false,
      availability_validated: false,
      privacy_validated: false,
      health_validated: false,
      blockers: uniqueSorted([...(decision.blockers || []), ...validation.errors]),
      reason_codes: uniqueSorted([...(decision.reason_codes || []), validation.errors[0] || 'model_provider_decision_invalid']),
      ...MODEL_PROVIDER_DECISION_SAFE_FLAGS
    });
  }
  return cloneFrozen(decision);
}

function safeFingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function blocked(context, status, reasonCodes, extra = {}) {
  const provider = isPlainObject(context.provider) ? context.provider : null;
  const model = isPlainObject(context.model) ? context.model : null;
  return buildModelProviderDecision({
    decision_id: context.decision_id,
    provider_id: provider ? provider.provider_id : 'provider_not_available',
    model_id: model ? model.model_id : 'model_not_available',
    status,
    decision: 'BLOCKED',
    eligible_in_simulation: false,
    provider_fingerprint: provider ? safeFingerprint(provider) : NOT_AVAILABLE_FINGERPRINT,
    model_fingerprint: model ? safeFingerprint(model) : NOT_AVAILABLE_FINGERPRINT,
    registry_version: context.registry_version,
    blockers: uniqueSorted(reasonCodes),
    reason_codes: uniqueSorted(reasonCodes),
    ...extra
  });
}

function rankOrDefault(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function evaluateModelProviderDecision(operation, context = {}) {
  if (!DECISION_VALUES.includes(operation) || operation === 'BLOCKED') {
    return blocked(context, 'VALIDATION_FAILED', ['operation_not_allowed']);
  }

  const providerValidation = validateModelProviderContract(context.provider);
  if (!providerValidation.valid) {
    return blocked(context, 'VALIDATION_FAILED', providerValidation.errors);
  }
  const provider = context.provider;
  if (isNonEmptyString(context.tenant_id) && context.tenant_id !== provider.tenant_id) {
    return blocked(context, 'TENANT_BLOCKED', ['tenant_not_bound_to_provider']);
  }
  if (isNonEmptyString(context.organization_id) && context.organization_id !== provider.organization_id) {
    return blocked(context, 'ORGANIZATION_BLOCKED', ['organization_not_bound_to_provider']);
  }

  if (operation === 'VALIDATE_PROVIDER_REFERENCE') {
    return buildModelProviderDecision({
      decision_id: context.decision_id,
      provider_id: provider.provider_id,
      model_id: 'model_not_available',
      status: 'ELIGIBLE_SIMULATION',
      decision: 'VALIDATE_PROVIDER_REFERENCE',
      eligible_in_simulation: false,
      provider_fingerprint: safeFingerprint(provider),
      registry_version: context.registry_version,
      blockers: [],
      reason_codes: ['model_provider_reference_reviewed_simulation_only'],
      provider_validated: true
    });
  }

  const modelValidation = validateModelContract(context.model);
  if (!modelValidation.valid) {
    return blocked(context, 'VALIDATION_FAILED', modelValidation.errors, { provider_validated: true, provider_fingerprint: safeFingerprint(provider) });
  }
  const model = context.model;
  if (model.provider_id !== provider.provider_id) {
    return blocked(context, 'CONFLICT_BLOCKED', ['model_provider_id_mismatch'], { provider_validated: true, provider_fingerprint: safeFingerprint(provider), model_fingerprint: safeFingerprint(model) });
  }
  if (model.provider_version !== provider.provider_version) {
    return blocked(context, 'VERSION_BLOCKED', ['model_provider_version_mismatch'], { provider_validated: true, provider_fingerprint: safeFingerprint(provider), model_fingerprint: safeFingerprint(model) });
  }
  if (model.tenant_id !== provider.tenant_id || model.organization_id !== provider.organization_id) {
    return blocked(context, 'TENANT_BLOCKED', ['model_tenant_organization_mismatch'], { provider_validated: true, provider_fingerprint: safeFingerprint(provider), model_fingerprint: safeFingerprint(model) });
  }

  if (operation === 'VALIDATE_MODEL_REFERENCE') {
    return buildModelProviderDecision({
      decision_id: context.decision_id,
      provider_id: provider.provider_id,
      model_id: model.model_id,
      status: 'ELIGIBLE_SIMULATION',
      decision: 'VALIDATE_MODEL_REFERENCE',
      eligible_in_simulation: false,
      provider_fingerprint: safeFingerprint(provider),
      model_fingerprint: safeFingerprint(model),
      registry_version: context.registry_version,
      blockers: [],
      reason_codes: ['model_reference_reviewed_simulation_only'],
      provider_validated: true,
      model_validated: true
    });
  }

  const baseExtra = { provider_validated: true, model_validated: true, provider_fingerprint: safeFingerprint(provider), model_fingerprint: safeFingerprint(model) };

  const capabilities = Array.isArray(context.capabilities) ? context.capabilities : [];
  for (const capability of capabilities) {
    const capabilityValidation = validateModelCapabilityContract(capability);
    if (!capabilityValidation.valid) {
      return blocked(context, 'CAPABILITY_BLOCKED', capabilityValidation.errors, baseExtra);
    }
  }
  const capabilityFingerprints = uniqueSorted(capabilities.map(safeFingerprint));

  const pricingValidation = validateModelPricingContract(context.pricing);
  if (!pricingValidation.valid) return blocked(context, 'PRICING_BLOCKED', pricingValidation.errors, baseExtra);
  const pricing = context.pricing;

  const limitsValidation = validateModelLimitsContract(context.limits);
  if (!limitsValidation.valid) return blocked(context, 'LIMIT_BLOCKED', limitsValidation.errors, baseExtra);
  const limits = context.limits;

  const availabilityValidation = validateModelAvailabilityContract(context.availability);
  if (!availabilityValidation.valid) return blocked(context, 'AVAILABILITY_BLOCKED', availabilityValidation.errors, baseExtra);
  const availability = context.availability;

  const privacyValidation = validateModelPrivacyContract(context.privacy);
  if (!privacyValidation.valid) return blocked(context, 'PRIVACY_BLOCKED', privacyValidation.errors, baseExtra);
  const privacy = context.privacy;

  const healthValidation = validateModelHealthContract(context.health);
  if (!healthValidation.valid) return blocked(context, 'HEALTH_BLOCKED', healthValidation.errors, baseExtra);
  const health = context.health;

  const selectionValidation = validateModelSelectionReference(context.selectionReference);
  if (!selectionValidation.valid) return blocked(context, 'VALIDATION_FAILED', selectionValidation.errors, baseExtra);
  const selection = context.selectionReference;
  if (selection.tenant_id !== provider.tenant_id) return blocked(context, 'TENANT_BLOCKED', ['selection_tenant_mismatch'], baseExtra);
  if (selection.organization_id !== provider.organization_id) return blocked(context, 'ORGANIZATION_BLOCKED', ['selection_organization_mismatch'], baseExtra);

  const fullExtra = {
    ...baseExtra,
    capability_fingerprints: capabilityFingerprints,
    pricing_fingerprint: safeFingerprint(pricing),
    limits_fingerprint: safeFingerprint(limits),
    availability_fingerprint: safeFingerprint(availability),
    privacy_fingerprint: safeFingerprint(privacy),
    health_fingerprint: safeFingerprint(health),
    selection_reference_fingerprint: safeFingerprint(selection),
    capabilities_validated: true,
    pricing_validated: true,
    limits_validated: true,
    availability_validated: true,
    privacy_validated: true,
    health_validated: true
  };

  if (!selection.required_capabilities.every((required) => capabilities.some((capability) => capability.capability_type === required && capability.support_level !== 'UNSUPPORTED'))) {
    return blocked(context, 'CAPABILITY_BLOCKED', ['required_capability_not_supported'], fullExtra);
  }
  if (selection.preferred_modalities.length > 0 && !selection.preferred_modalities.some((modality) => model.supported_modalities.includes(modality))) {
    return blocked(context, 'CAPABILITY_BLOCKED', ['preferred_modalities_incompatible'], fullExtra);
  }
  if (rankOrDefault(QUALITY_TIER_RANK, model.quality_tier, -1) < rankOrDefault(QUALITY_TIER_RANK, selection.minimum_quality_tier_reference, 0)) {
    return blocked(context, 'CAPABILITY_BLOCKED', ['quality_tier_below_minimum'], fullExtra);
  }

  if (model.cost_tier === 'UNKNOWN_BLOCKED') return blocked(context, 'PRICING_BLOCKED', ['cost_tier_unknown'], fullExtra);
  if (pricing.input_cost_minor_units_per_million > selection.maximum_cost_minor_units_reference) {
    return blocked(context, 'PRICING_BLOCKED', ['cost_above_maximum_reference'], fullExtra);
  }

  if (selection.maximum_input_tokens_reference > limits.maximum_input_tokens) {
    return blocked(context, 'LIMIT_BLOCKED', ['input_tokens_exceeded'], fullExtra);
  }
  if (selection.maximum_output_tokens_reference > limits.maximum_output_tokens) {
    return blocked(context, 'LIMIT_BLOCKED', ['output_tokens_exceeded'], fullExtra);
  }
  if (selection.maximum_input_tokens_reference + selection.maximum_output_tokens_reference > model.context_window_tokens) {
    return blocked(context, 'LIMIT_BLOCKED', ['context_window_exceeded'], fullExtra);
  }
  if (rankOrDefault(LATENCY_TIER_RANK, model.latency_tier, 99) > rankOrDefault(LATENCY_TIER_RANK, selection.maximum_latency_tier_reference, 99)) {
    return blocked(context, 'LIMIT_BLOCKED', ['latency_tier_above_maximum'], fullExtra);
  }

  if (availability.availability_status !== 'AVAILABLE_REFERENCE') {
    return blocked(context, 'AVAILABILITY_BLOCKED', ['availability_status_not_available'], fullExtra);
  }

  if (selection.data_classification === 'RESTRICTED') {
    return blocked(context, 'PRIVACY_BLOCKED', ['restricted_data_classification_always_blocked'], fullExtra);
  }
  if (privacy.restricted_data_allowed !== false) {
    return blocked(context, 'PRIVACY_BLOCKED', ['restricted_data_allowed_not_permitted'], fullExtra);
  }
  if (rankOrDefault(PRIVACY_TIER_RANK, model.privacy_tier, -1) < rankOrDefault(PRIVACY_TIER_RANK, selection.privacy_requirement_reference, 0)) {
    return blocked(context, 'PRIVACY_BLOCKED', ['privacy_tier_incompatible'], fullExtra);
  }

  if (health.health_status === 'UNKNOWN_BLOCKED') return blocked(context, 'HEALTH_BLOCKED', ['health_status_unknown'], fullExtra);
  if (health.health_status === 'UNHEALTHY_REFERENCE') return blocked(context, 'HEALTH_BLOCKED', ['health_status_unhealthy'], fullExtra);

  return buildModelProviderDecision({
    decision_id: context.decision_id,
    provider_id: provider.provider_id,
    model_id: model.model_id,
    status: 'ELIGIBLE_SIMULATION',
    decision: 'VALIDATE_ELIGIBILITY_REFERENCE',
    eligible_in_simulation: true,
    registry_version: context.registry_version,
    blockers: [],
    reason_codes: ['model_provider_eligibility_reviewed_simulation_only'],
    ...fullExtra
  });
}

module.exports = {
  DECISION_STATUSES,
  DECISION_VALUES,
  LATENCY_TIER_RANK,
  MODEL_PROVIDER_DECISION_FIELDS,
  MODEL_PROVIDER_DECISION_SAFE_FLAGS,
  MODEL_PROVIDER_DECISION_VALIDATOR_VERSION,
  PRIVACY_TIER_RANK,
  QUALITY_TIER_RANK,
  buildModelProviderDecision,
  evaluateModelProviderDecision,
  validateModelProviderDecision
};

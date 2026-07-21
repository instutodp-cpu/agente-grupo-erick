'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, stablePayload } = require('./agent-identity-contract');

const MODEL_PROVIDER_AUDIT_VERSION = 'model_provider_audit_v1';
const MODEL_PROVIDER_AUDIT_FIELDS = Object.freeze([
  'audit_id', 'provider_fingerprint', 'model_fingerprint', 'capability_fingerprints', 'pricing_fingerprint',
  'limits_fingerprint', 'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint',
  'selection_reference_fingerprint', 'tenant_binding', 'organization_binding', 'provider_type', 'quality_tier',
  'cost_tier', 'latency_tier', 'privacy_tier', 'decision_status', 'blockers', 'reason_codes', 'logical_sequence',
  'registry_version', 'simulation', 'production_blocked', 'executed', 'validator_version'
]);
const NOT_AVAILABLE = 'not_available';

function fingerprint(value) {
  try {
    return stablePayload(value || {});
  } catch (error) {
    return `fingerprint_invalid::${error.message}`;
  }
}

function validateModelProviderAudit(audit) {
  const errors = [];
  if (!isPlainObject(audit)) return { valid: false, errors: ['model_provider_audit_must_be_object'] };
  exactFields(audit, MODEL_PROVIDER_AUDIT_FIELDS, 'model_provider_audit', errors);
  for (const field of [
    'audit_id', 'provider_fingerprint', 'model_fingerprint', 'pricing_fingerprint', 'limits_fingerprint',
    'availability_fingerprint', 'privacy_fingerprint', 'health_fingerprint', 'selection_reference_fingerprint',
    'provider_type', 'quality_tier', 'cost_tier', 'latency_tier', 'privacy_tier', 'decision_status',
    'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(audit[field])) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(audit.capability_fingerprints) || !audit.capability_fingerprints.every(isNonEmptyString)) {
    errors.push('capability_fingerprints_invalid');
  }
  for (const field of ['tenant_binding', 'organization_binding']) {
    if (!isPlainObject(audit[field])) errors.push(`${field}_must_be_object`);
  }
  if (!Array.isArray(audit.blockers)) errors.push('blockers_must_be_array');
  if (!Array.isArray(audit.reason_codes)) errors.push('reason_codes_must_be_array');
  if (!Number.isInteger(audit.logical_sequence) || audit.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (audit.simulation !== true) errors.push('simulation_must_be_true');
  if (audit.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (audit.executed !== false) errors.push('executed_must_be_false');
  if (audit.validator_version !== MODEL_PROVIDER_AUDIT_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(audit);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildModelProviderAudit(input = {}) {
  const provider = isPlainObject(input.provider) ? input.provider : {};
  const model = isPlainObject(input.model) ? input.model : {};
  const decision = isPlainObject(input.decision) ? input.decision : {};
  const audit = {
    audit_id: `model_provider_audit_${decision.decision_id || provider.provider_id || NOT_AVAILABLE}`,
    provider_fingerprint: decision.provider_fingerprint || fingerprint(provider),
    model_fingerprint: decision.model_fingerprint || fingerprint(model),
    capability_fingerprints: uniqueSorted(Array.isArray(decision.capability_fingerprints) ? decision.capability_fingerprints : []),
    pricing_fingerprint: decision.pricing_fingerprint || `pricing_${NOT_AVAILABLE}`,
    limits_fingerprint: decision.limits_fingerprint || `limits_${NOT_AVAILABLE}`,
    availability_fingerprint: decision.availability_fingerprint || `availability_${NOT_AVAILABLE}`,
    privacy_fingerprint: decision.privacy_fingerprint || `privacy_${NOT_AVAILABLE}`,
    health_fingerprint: decision.health_fingerprint || `health_${NOT_AVAILABLE}`,
    selection_reference_fingerprint: decision.selection_reference_fingerprint || `selection_reference_${NOT_AVAILABLE}`,
    tenant_binding: {
      provider_tenant_id: provider.tenant_id || `tenant_${NOT_AVAILABLE}`,
      model_tenant_id: model.tenant_id || `tenant_${NOT_AVAILABLE}`
    },
    organization_binding: {
      provider_organization_id: provider.organization_id || `organization_${NOT_AVAILABLE}`,
      model_organization_id: model.organization_id || `organization_${NOT_AVAILABLE}`
    },
    provider_type: provider.provider_type || `provider_type_${NOT_AVAILABLE}`,
    quality_tier: model.quality_tier || `quality_tier_${NOT_AVAILABLE}`,
    cost_tier: model.cost_tier || `cost_tier_${NOT_AVAILABLE}`,
    latency_tier: model.latency_tier || `latency_tier_${NOT_AVAILABLE}`,
    privacy_tier: model.privacy_tier || `privacy_tier_${NOT_AVAILABLE}`,
    decision_status: decision.status || 'VALIDATION_FAILED',
    blockers: uniqueSorted(decision.blockers || []),
    reason_codes: uniqueSorted(decision.reason_codes || []),
    logical_sequence: Number.isInteger(input.logical_sequence) && input.logical_sequence >= 0 ? input.logical_sequence : 0,
    registry_version: decision.registry_version || `registry_version_${NOT_AVAILABLE}`,
    simulation: true,
    production_blocked: true,
    executed: false,
    validator_version: MODEL_PROVIDER_AUDIT_VERSION
  };
  return cloneFrozen(audit);
}

module.exports = {
  MODEL_PROVIDER_AUDIT_FIELDS,
  MODEL_PROVIDER_AUDIT_VERSION,
  buildModelProviderAudit,
  validateModelProviderAudit
};

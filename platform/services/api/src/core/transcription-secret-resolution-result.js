'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_SECRET_RESOLUTION_RESULT_VALIDATOR_VERSION = 'transcription_secret_resolution_result_validator_v1';
const SECRET_RESOLUTION_SAFE_FLAGS = Object.freeze({
  secret_material_present: false,
  secret_material_returned: false,
  secret_loaded: false,
  secret_decrypted: false,
  secret_resolved: false,
  network_used: false,
  provider_called: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  runtime_enabled: false,
  rollout_percentage: 0
});
const SECRET_RESOLUTION_STATUSES = Object.freeze([
  'REFERENCE_VALID_SIMULATION',
  'ACCESS_DENIED',
  'INVALID_REFERENCE',
  'TENANT_MISMATCH',
  'PROVIDER_MISMATCH',
  'SCOPE_MISMATCH',
  'REVOKED_REFERENCE',
  'INACTIVE_REFERENCE',
  'POLICY_BLOCKED',
  'VALIDATION_FAILED'
]);
const FORBIDDEN_SECRET_RESOLUTION_STATUSES = Object.freeze([
  'SECRET_RESOLVED',
  'SECRET_LOADED',
  'SECRET_RETURNED',
  'CONNECTED',
  'EXECUTED',
  'PRODUCTION_READY'
]);
const SECRET_RESOLUTION_RESULT_FIELDS = Object.freeze([
  'resolution_id',
  'resolution_request_id',
  'provider_slug',
  'adapter_id',
  'secret_ref_id',
  'secret_alias',
  'secret_type',
  'environment',
  'scope',
  'status',
  'decision',
  'decision_reason',
  'access_policy_status',
  'reference_valid',
  'secret_material_present',
  'secret_material_returned',
  'secret_loaded',
  'secret_decrypted',
  'secret_resolved',
  'network_used',
  'provider_called',
  'executed',
  'simulation',
  'production_blocked',
  'runtime_enabled',
  'rollout_percentage',
  'validator_version'
]);

function cloneFrozen(value) {
  return deepFreeze(sanitizeTranscriptionData(JSON.parse(JSON.stringify(stableCanonicalize(value)))));
}

function validateSecretResolutionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['secret_resolution_result_must_be_object'] };
  const allowed = new Set(SECRET_RESOLUTION_RESULT_FIELDS);
  for (const field of SECRET_RESOLUTION_RESULT_FIELDS) if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`result_missing_${field}`);
  for (const field of Object.keys(result)) if (!allowed.has(field)) errors.push(`result_unexpected_field::${field}`);
  for (const field of ['resolution_id', 'resolution_request_id', 'provider_slug', 'adapter_id', 'secret_ref_id', 'secret_alias', 'secret_type', 'environment', 'scope', 'status', 'decision', 'decision_reason', 'access_policy_status', 'validator_version']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!SECRET_RESOLUTION_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (FORBIDDEN_SECRET_RESOLUTION_STATUSES.includes(result.status)) errors.push(`status_forbidden::${result.status}`);
  if (typeof result.reference_valid !== 'boolean') errors.push('reference_valid_must_be_boolean');
  for (const [field, expected] of Object.entries(SECRET_RESOLUTION_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.validator_version !== TRANSCRIPTION_SECRET_RESOLUTION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildSecretResolutionResult(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const result = {
    resolution_id: overrides.resolution_id || `secret_resolution_${overrides.resolution_request_id || 'missing'}`,
    resolution_request_id: overrides.resolution_request_id || 'resolution_request_not_available',
    provider_slug: overrides.provider_slug || 'provider_not_available',
    adapter_id: overrides.adapter_id || 'adapter_not_available',
    secret_ref_id: overrides.secret_ref_id || 'secret_ref_not_available',
    secret_alias: overrides.secret_alias || 'secret_alias_not_available',
    secret_type: overrides.secret_type || 'CUSTOM_REFERENCE',
    environment: overrides.environment || 'DEVELOPMENT',
    scope: overrides.scope || 'TRANSCRIPTION_PROVIDER',
    status,
    decision: overrides.decision || status,
    decision_reason: overrides.decision_reason || 'fail_closed',
    access_policy_status: overrides.access_policy_status || 'ACCESS_VALIDATION_FAILED',
    reference_valid: overrides.reference_valid === true,
    validator_version: TRANSCRIPTION_SECRET_RESOLUTION_RESULT_VALIDATOR_VERSION,
    ...SECRET_RESOLUTION_SAFE_FLAGS
  };
  const validation = validateSecretResolutionResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'VALIDATION_FAILED',
      decision_reason: validation.errors[0] || 'secret_resolution_result_invalid',
      reference_valid: false,
      ...SECRET_RESOLUTION_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  FORBIDDEN_SECRET_RESOLUTION_STATUSES,
  SECRET_RESOLUTION_RESULT_FIELDS,
  SECRET_RESOLUTION_SAFE_FLAGS,
  SECRET_RESOLUTION_STATUSES,
  TRANSCRIPTION_SECRET_RESOLUTION_RESULT_VALIDATOR_VERSION,
  buildSecretResolutionResult,
  cloneFrozen,
  validateSecretResolutionResult
};

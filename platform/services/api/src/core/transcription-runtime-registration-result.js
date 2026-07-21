'use strict';

const { sanitizeTranscriptionData } = require('./transcription-contract');
const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { deepFreeze } = require('./transcription-provider-adapter-interface');
const { stableCanonicalize, stablePayload } = require('./transcription-provider-contract-registry');

const TRANSCRIPTION_RUNTIME_REGISTRATION_RESULT_VALIDATOR_VERSION = 'transcription_runtime_registration_result_validator_v1';
const RUNTIME_REGISTRATION_SAFE_FLAGS = Object.freeze({
  registration_allowed: false,
  runtime_mutated: false,
  components_registered: false,
  components_initialized: false,
  components_activated: false,
  network_used: false,
  provider_called: false,
  secret_loaded: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  runtime_enabled: false,
  rollout_percentage: 0
});
const RUNTIME_REGISTRATION_STATUSES = Object.freeze([
  'REGISTRATION_SIMULATION_REVIEWED',
  'REGISTRATION_DENIED',
  'REGISTRATION_POLICY_BLOCKED',
  'COMPONENT_GRAPH_BLOCKED',
  'VALIDATION_FAILED'
]);
const FORBIDDEN_RUNTIME_REGISTRATION_STATUSES = Object.freeze([
  'REGISTERED',
  'INITIALIZED',
  'ACTIVATED',
  'RUNTIME_MUTATED',
  'COMPONENT_LOADED',
  'EXECUTED',
  'PRODUCTION_READY'
]);
const RUNTIME_REGISTRATION_RESULT_FIELDS = Object.freeze([
  'registration_decision_id',
  'registration_request_id',
  'tenant_id',
  'environment',
  'component_type',
  'component_id',
  'status',
  'decision',
  'decision_reason',
  'policy_status',
  'component_descriptor_valid',
  'dependency_graph_valid',
  'bindings_valid',
  'tenant_binding_valid',
  'environment_binding_valid',
  'plan_fingerprint',
  'registration_allowed',
  'runtime_mutated',
  'components_registered',
  'components_initialized',
  'components_activated',
  'network_used',
  'provider_called',
  'secret_loaded',
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

function validateRuntimeRegistrationResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['runtime_registration_result_must_be_object'] };
  const allowed = new Set(RUNTIME_REGISTRATION_RESULT_FIELDS);
  for (const field of RUNTIME_REGISTRATION_RESULT_FIELDS) if (!Object.prototype.hasOwnProperty.call(result, field)) errors.push(`result_missing_${field}`);
  for (const field of Object.keys(result)) if (!allowed.has(field)) errors.push(`result_unexpected_field::${field}`);
  for (const field of ['registration_decision_id', 'registration_request_id', 'tenant_id', 'environment', 'component_type', 'component_id', 'status', 'decision', 'decision_reason', 'policy_status', 'plan_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_REGISTRATION_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (FORBIDDEN_RUNTIME_REGISTRATION_STATUSES.includes(result.status)) errors.push(`status_forbidden::${result.status}`);
  for (const field of ['component_descriptor_valid', 'dependency_graph_valid', 'bindings_valid', 'tenant_binding_valid', 'environment_binding_valid']) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(RUNTIME_REGISTRATION_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (result.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeRegistrationResult(overrides = {}) {
  const status = overrides.status || 'VALIDATION_FAILED';
  const result = {
    registration_decision_id: overrides.registration_decision_id || `runtime_registration_${overrides.registration_request_id || 'missing'}`,
    registration_request_id: overrides.registration_request_id || 'registration_request_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    environment: overrides.environment || 'environment_not_available',
    component_type: overrides.component_type || 'component_type_not_available',
    component_id: overrides.component_id || 'component_not_available',
    status,
    decision: overrides.decision || status,
    decision_reason: overrides.decision_reason || 'fail_closed',
    policy_status: overrides.policy_status || 'REGISTRATION_VALIDATION_FAILED',
    component_descriptor_valid: overrides.component_descriptor_valid === true,
    dependency_graph_valid: overrides.dependency_graph_valid === true,
    bindings_valid: overrides.bindings_valid === true,
    tenant_binding_valid: overrides.tenant_binding_valid === true,
    environment_binding_valid: overrides.environment_binding_valid === true,
    plan_fingerprint: overrides.plan_fingerprint || 'plan_fingerprint_not_available',
    validator_version: TRANSCRIPTION_RUNTIME_REGISTRATION_RESULT_VALIDATOR_VERSION,
    ...RUNTIME_REGISTRATION_SAFE_FLAGS
  };
  const validation = validateRuntimeRegistrationResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'VALIDATION_FAILED',
      decision_reason: validation.errors[0] || 'runtime_registration_result_invalid',
      component_descriptor_valid: false,
      dependency_graph_valid: false,
      bindings_valid: false,
      tenant_binding_valid: false,
      environment_binding_valid: false,
      ...RUNTIME_REGISTRATION_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  FORBIDDEN_RUNTIME_REGISTRATION_STATUSES,
  RUNTIME_REGISTRATION_RESULT_FIELDS,
  RUNTIME_REGISTRATION_SAFE_FLAGS,
  RUNTIME_REGISTRATION_STATUSES,
  TRANSCRIPTION_RUNTIME_REGISTRATION_RESULT_VALIDATOR_VERSION,
  buildRuntimeRegistrationResult,
  cloneFrozen,
  validateRuntimeRegistrationResult
};

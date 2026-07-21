'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { stablePayload } = require('./transcription-provider-contract-registry');
const {
  FORBIDDEN_RUNTIME_REGISTRATION_STATUSES,
  RUNTIME_REGISTRATION_SAFE_FLAGS,
  RUNTIME_REGISTRATION_STATUSES,
  cloneFrozen
} = require('./transcription-runtime-registration-result');

const TRANSCRIPTION_RUNTIME_REGISTRATION_PLAN_VALIDATOR_VERSION = 'transcription_runtime_registration_plan_validator_v1';
const RUNTIME_REGISTRATION_PLAN_FIELDS = Object.freeze([
  'plan_id',
  'registration_request_id',
  'tenant_id',
  'environment',
  'component_type',
  'component_id',
  'entrypoint_reference',
  'dependency_order',
  'binding_count',
  'plan_status',
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

function validateRuntimeRegistrationPlan(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['runtime_registration_plan_must_be_object'] };
  const allowed = new Set(RUNTIME_REGISTRATION_PLAN_FIELDS);
  for (const field of RUNTIME_REGISTRATION_PLAN_FIELDS) if (!Object.prototype.hasOwnProperty.call(plan, field)) errors.push(`plan_missing_${field}`);
  for (const field of Object.keys(plan)) if (!allowed.has(field)) errors.push(`plan_unexpected_field::${field}`);
  for (const field of ['plan_id', 'registration_request_id', 'tenant_id', 'environment', 'component_type', 'component_id', 'entrypoint_reference', 'plan_status', 'validator_version']) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  if (!Array.isArray(plan.dependency_order) || !plan.dependency_order.every((entry) => isNonEmptyString(entry))) errors.push('dependency_order_invalid');
  if (!Number.isInteger(plan.binding_count) || plan.binding_count < 0) errors.push('binding_count_invalid');
  if (!RUNTIME_REGISTRATION_STATUSES.includes(plan.plan_status)) errors.push(`plan_status_not_allowed::${plan.plan_status}`);
  if (FORBIDDEN_RUNTIME_REGISTRATION_STATUSES.includes(plan.plan_status)) errors.push(`plan_status_forbidden::${plan.plan_status}`);
  for (const [field, expected] of Object.entries(RUNTIME_REGISTRATION_SAFE_FLAGS)) {
    if (plan[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (plan.validator_version !== TRANSCRIPTION_RUNTIME_REGISTRATION_PLAN_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeRegistrationPlan(overrides = {}) {
  const plan_status = overrides.plan_status || 'VALIDATION_FAILED';
  const plan = {
    plan_id: overrides.plan_id || `runtime_registration_plan_${overrides.registration_request_id || 'missing'}`,
    registration_request_id: overrides.registration_request_id || 'registration_request_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    environment: overrides.environment || 'environment_not_available',
    component_type: overrides.component_type || 'component_type_not_available',
    component_id: overrides.component_id || 'component_not_available',
    entrypoint_reference: overrides.entrypoint_reference || 'entrypoint_reference_not_available',
    dependency_order: Array.isArray(overrides.dependency_order) && overrides.dependency_order.every((entry) => isNonEmptyString(entry)) ? overrides.dependency_order : [],
    binding_count: Number.isInteger(overrides.binding_count) ? overrides.binding_count : 0,
    plan_status,
    validator_version: TRANSCRIPTION_RUNTIME_REGISTRATION_PLAN_VALIDATOR_VERSION,
    ...RUNTIME_REGISTRATION_SAFE_FLAGS
  };
  const validation = validateRuntimeRegistrationPlan(plan);
  if (!validation.valid) {
    return cloneFrozen({
      ...plan,
      plan_status: 'VALIDATION_FAILED',
      dependency_order: [],
      binding_count: 0,
      ...RUNTIME_REGISTRATION_SAFE_FLAGS
    });
  }
  return cloneFrozen(plan);
}

module.exports = {
  RUNTIME_REGISTRATION_PLAN_FIELDS,
  TRANSCRIPTION_RUNTIME_REGISTRATION_PLAN_VALIDATOR_VERSION,
  buildRuntimeRegistrationPlan,
  validateRuntimeRegistrationPlan
};

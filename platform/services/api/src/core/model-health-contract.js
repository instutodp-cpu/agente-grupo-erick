'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_HEALTH_CONTRACT_VALIDATOR_VERSION = 'model_health_contract_validator_v1';
const MODEL_HEALTH_FIELDS = Object.freeze([
  'health_id', 'provider_id', 'model_id', 'health_status', 'latency_ms_reference', 'error_rate_basis_points_reference',
  'success_rate_basis_points_reference', 'capacity_status_reference', 'last_checked_sequence', 'health_verified',
  'network_checked', 'provider_called', 'simulation', 'production_blocked', 'validator_version'
]);
const HEALTH_STATUSES = Object.freeze(['HEALTHY_REFERENCE', 'DEGRADED_REFERENCE', 'UNHEALTHY_REFERENCE', 'UNKNOWN_BLOCKED']);
const CAPACITY_STATUS_REFERENCES = Object.freeze(['AVAILABLE_REFERENCE', 'DEGRADED_REFERENCE', 'UNAVAILABLE_REFERENCE', 'UNKNOWN_BLOCKED']);
const MAX_BASIS_POINTS = 10000;
const MAX_LATENCY_MS_REFERENCE = 600000;

function validateModelHealthContract(health) {
  const errors = [];
  if (!isPlainObject(health)) return { valid: false, errors: ['model_health_must_be_object'] };
  exactFields(health, MODEL_HEALTH_FIELDS, 'model_health', errors);
  for (const field of ['health_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(health[field])) errors.push(`${field}_invalid`);
  }
  if (!HEALTH_STATUSES.includes(health.health_status)) errors.push(`health_status_not_allowed::${health.health_status}`);
  if (!CAPACITY_STATUS_REFERENCES.includes(health.capacity_status_reference)) errors.push(`capacity_status_reference_not_allowed::${health.capacity_status_reference}`);
  if (!Number.isInteger(health.latency_ms_reference) || health.latency_ms_reference < 0 || health.latency_ms_reference > MAX_LATENCY_MS_REFERENCE) {
    errors.push('latency_ms_reference_invalid');
  }
  for (const field of ['error_rate_basis_points_reference', 'success_rate_basis_points_reference']) {
    if (!Number.isInteger(health[field]) || health[field] < 0 || health[field] > MAX_BASIS_POINTS) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(health.last_checked_sequence) || health.last_checked_sequence < 0) errors.push('last_checked_sequence_invalid');
  if (health.health_verified !== false) errors.push('health_verified_must_be_false');
  if (health.network_checked !== false) errors.push('network_checked_must_be_false');
  if (health.provider_called !== false) errors.push('provider_called_must_be_false');
  if (health.simulation !== true) errors.push('simulation_must_be_true');
  if (health.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (health.validator_version !== MODEL_HEALTH_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(health);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(health));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CAPACITY_STATUS_REFERENCES,
  HEALTH_STATUSES,
  MAX_BASIS_POINTS,
  MAX_LATENCY_MS_REFERENCE,
  MODEL_HEALTH_CONTRACT_VALIDATOR_VERSION,
  MODEL_HEALTH_FIELDS,
  validateModelHealthContract
};

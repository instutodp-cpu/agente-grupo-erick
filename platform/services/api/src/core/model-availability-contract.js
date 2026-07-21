'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const MODEL_AVAILABILITY_CONTRACT_VALIDATOR_VERSION = 'model_availability_contract_validator_v1';
const MODEL_AVAILABILITY_FIELDS = Object.freeze([
  'availability_id', 'provider_id', 'model_id', 'availability_status', 'region_references', 'tenant_available',
  'organization_available', 'maintenance_reference', 'quota_available_reference', 'capacity_available_reference',
  'availability_verified', 'last_evaluated_sequence', 'simulation', 'production_blocked', 'validator_version'
]);
const AVAILABILITY_STATUSES = Object.freeze(['AVAILABLE_REFERENCE', 'DEGRADED_REFERENCE', 'UNAVAILABLE_REFERENCE', 'UNKNOWN_BLOCKED']);
const MAX_REGION_REFERENCES = 50;
const MAX_REGION_REFERENCE_LENGTH = 40;
const REGION_REFERENCE_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isNormalizedRegionList(list) {
  if (!Array.isArray(list) || list.length > MAX_REGION_REFERENCES) return false;
  if (!list.every((item) => isNonEmptyString(item) && item.length <= MAX_REGION_REFERENCE_LENGTH && REGION_REFERENCE_PATTERN.test(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateModelAvailabilityContract(availability) {
  const errors = [];
  if (!isPlainObject(availability)) return { valid: false, errors: ['model_availability_must_be_object'] };
  exactFields(availability, MODEL_AVAILABILITY_FIELDS, 'model_availability', errors);
  for (const field of ['availability_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(availability[field])) errors.push(`${field}_invalid`);
  }
  if (!AVAILABILITY_STATUSES.includes(availability.availability_status)) errors.push(`availability_status_not_allowed::${availability.availability_status}`);
  if (!isNormalizedRegionList(availability.region_references)) errors.push('region_references_invalid');
  for (const field of ['tenant_available', 'organization_available', 'maintenance_reference', 'quota_available_reference', 'capacity_available_reference']) {
    if (typeof availability[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (availability.availability_verified !== false) errors.push('availability_verified_must_be_false');
  if (!Number.isInteger(availability.last_evaluated_sequence) || availability.last_evaluated_sequence < 0) errors.push('last_evaluated_sequence_invalid');
  if (availability.simulation !== true) errors.push('simulation_must_be_true');
  if (availability.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (availability.validator_version !== MODEL_AVAILABILITY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(availability);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(availability));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AVAILABILITY_STATUSES,
  MAX_REGION_REFERENCES,
  MODEL_AVAILABILITY_CONTRACT_VALIDATOR_VERSION,
  MODEL_AVAILABILITY_FIELDS,
  REGION_REFERENCE_PATTERN,
  isNormalizedRegionList,
  validateModelAvailabilityContract
};

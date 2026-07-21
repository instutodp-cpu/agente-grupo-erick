'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { RETENTION_CLASSES } = require('./agent-memory-item-contract');

const MODEL_PRIVACY_CONTRACT_VALIDATOR_VERSION = 'model_privacy_contract_validator_v1';
const MODEL_PRIVACY_FIELDS = Object.freeze([
  'privacy_id', 'provider_id', 'model_id', 'data_retention_reference', 'training_usage_reference',
  'regional_processing_reference', 'private_network_reference', 'local_processing_reference', 'encryption_reference',
  'confidential_data_allowed_reference', 'restricted_data_allowed', 'privacy_verified', 'simulation',
  'production_blocked', 'validator_version'
]);

function validateModelPrivacyContract(privacy) {
  const errors = [];
  if (!isPlainObject(privacy)) return { valid: false, errors: ['model_privacy_must_be_object'] };
  exactFields(privacy, MODEL_PRIVACY_FIELDS, 'model_privacy', errors);
  for (const field of ['privacy_id', 'provider_id', 'model_id', 'validator_version']) {
    if (!isNonEmptyString(privacy[field])) errors.push(`${field}_invalid`);
  }
  if (!RETENTION_CLASSES.includes(privacy.data_retention_reference)) errors.push(`data_retention_reference_not_allowed::${privacy.data_retention_reference}`);
  for (const field of ['training_usage_reference', 'regional_processing_reference', 'private_network_reference', 'local_processing_reference', 'encryption_reference', 'confidential_data_allowed_reference']) {
    if (typeof privacy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (privacy.restricted_data_allowed !== false) errors.push('restricted_data_allowed_must_be_false');
  if (privacy.privacy_verified !== false) errors.push('privacy_verified_must_be_false');
  if (privacy.simulation !== true) errors.push('simulation_must_be_true');
  if (privacy.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (privacy.validator_version !== MODEL_PRIVACY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(privacy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(privacy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MODEL_PRIVACY_CONTRACT_VALIDATOR_VERSION,
  MODEL_PRIVACY_FIELDS,
  validateModelPrivacyContract
};

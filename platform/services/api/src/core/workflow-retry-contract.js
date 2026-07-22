'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_RETRY_CONTRACT_VALIDATOR_VERSION = 'workflow_retry_contract_validator_v1';
const WORKFLOW_RETRY_FIELDS = Object.freeze([
  'retry_reference_id', 'tenant_id', 'organization_id', 'retry_type', 'maximum_attempts', 'simulation',
  'production_blocked', 'validator_version'
]);
const WORKFLOW_RETRY_TYPES = Object.freeze(['NONE', 'FIXED_REFERENCE', 'EXPONENTIAL_REFERENCE', 'MANUAL_REFERENCE']);
const MAX_RETRY_ATTEMPTS = 100;

function validateWorkflowRetryContract(retryReference) {
  const errors = [];
  if (!isPlainObject(retryReference)) return { valid: false, errors: ['retry_reference_must_be_object'] };
  exactFields(retryReference, WORKFLOW_RETRY_FIELDS, 'retry_reference', errors);
  for (const field of ['retry_reference_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(retryReference[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_RETRY_TYPES.includes(retryReference.retry_type)) errors.push(`retry_type_not_allowed::${retryReference.retry_type}`);
  if (!Number.isInteger(retryReference.maximum_attempts) || retryReference.maximum_attempts < 0 || retryReference.maximum_attempts > MAX_RETRY_ATTEMPTS) {
    errors.push('maximum_attempts_invalid');
  }
  if (retryReference.retry_type === 'NONE' && retryReference.maximum_attempts !== 0) errors.push('maximum_attempts_must_be_zero_when_retry_type_none');
  if (retryReference.simulation !== true) errors.push('simulation_must_be_true');
  if (retryReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (retryReference.validator_version !== WORKFLOW_RETRY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(retryReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(retryReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_RETRY_ATTEMPTS,
  WORKFLOW_RETRY_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_RETRY_FIELDS,
  WORKFLOW_RETRY_TYPES,
  validateWorkflowRetryContract
};

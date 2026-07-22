'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_TIMEOUT_CONTRACT_VALIDATOR_VERSION = 'workflow_timeout_contract_validator_v1';
const WORKFLOW_TIMEOUT_FIELDS = Object.freeze([
  'timeout_reference_id', 'tenant_id', 'organization_id', 'timeout_type', 'simulation', 'production_blocked',
  'validator_version'
]);
const WORKFLOW_TIMEOUT_TYPES = Object.freeze(['NONE', 'SHORT_REFERENCE', 'NORMAL_REFERENCE', 'LONG_REFERENCE', 'MANUAL_REFERENCE']);

function validateWorkflowTimeoutContract(timeoutReference) {
  const errors = [];
  if (!isPlainObject(timeoutReference)) return { valid: false, errors: ['timeout_reference_must_be_object'] };
  exactFields(timeoutReference, WORKFLOW_TIMEOUT_FIELDS, 'timeout_reference', errors);
  for (const field of ['timeout_reference_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(timeoutReference[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_TIMEOUT_TYPES.includes(timeoutReference.timeout_type)) errors.push(`timeout_type_not_allowed::${timeoutReference.timeout_type}`);
  if (timeoutReference.simulation !== true) errors.push('simulation_must_be_true');
  if (timeoutReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (timeoutReference.validator_version !== WORKFLOW_TIMEOUT_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(timeoutReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(timeoutReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  WORKFLOW_TIMEOUT_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_TIMEOUT_FIELDS,
  WORKFLOW_TIMEOUT_TYPES,
  validateWorkflowTimeoutContract
};

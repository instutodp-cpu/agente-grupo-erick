'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_COMPENSATION_CONTRACT_VALIDATOR_VERSION = 'workflow_compensation_contract_validator_v1';
const WORKFLOW_COMPENSATION_FIELDS = Object.freeze([
  'compensation_reference_id', 'tenant_id', 'organization_id', 'compensation_type', 'simulation',
  'production_blocked', 'validator_version'
]);
const WORKFLOW_COMPENSATION_TYPES = Object.freeze([
  'NONE', 'ROLLBACK_REFERENCE', 'MANUAL_COMPENSATION_REFERENCE', 'HUMAN_COMPENSATION_REFERENCE'
]);

function validateWorkflowCompensationContract(compensationReference) {
  const errors = [];
  if (!isPlainObject(compensationReference)) return { valid: false, errors: ['compensation_reference_must_be_object'] };
  exactFields(compensationReference, WORKFLOW_COMPENSATION_FIELDS, 'compensation_reference', errors);
  for (const field of ['compensation_reference_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(compensationReference[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_COMPENSATION_TYPES.includes(compensationReference.compensation_type)) {
    errors.push(`compensation_type_not_allowed::${compensationReference.compensation_type}`);
  }
  if (compensationReference.simulation !== true) errors.push('simulation_must_be_true');
  if (compensationReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (compensationReference.validator_version !== WORKFLOW_COMPENSATION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(compensationReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(compensationReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  WORKFLOW_COMPENSATION_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_COMPENSATION_FIELDS,
  WORKFLOW_COMPENSATION_TYPES,
  validateWorkflowCompensationContract
};

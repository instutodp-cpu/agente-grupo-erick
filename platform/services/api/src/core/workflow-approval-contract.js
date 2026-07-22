'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const WORKFLOW_APPROVAL_CONTRACT_VALIDATOR_VERSION = 'workflow_approval_contract_validator_v1';
const WORKFLOW_APPROVAL_FIELDS = Object.freeze([
  'approval_reference_id', 'tenant_id', 'organization_id', 'approval_type', 'simulation', 'production_blocked',
  'validator_version'
]);
const WORKFLOW_APPROVAL_TYPES = Object.freeze([
  'NONE', 'USER_REFERENCE', 'SUPERVISOR_REFERENCE', 'ADMIN_REFERENCE', 'DUAL_APPROVAL_REFERENCE'
]);

function validateWorkflowApprovalContract(approvalReference) {
  const errors = [];
  if (!isPlainObject(approvalReference)) return { valid: false, errors: ['approval_reference_must_be_object'] };
  exactFields(approvalReference, WORKFLOW_APPROVAL_FIELDS, 'approval_reference', errors);
  for (const field of ['approval_reference_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(approvalReference[field])) errors.push(`${field}_invalid`);
  }
  if (!WORKFLOW_APPROVAL_TYPES.includes(approvalReference.approval_type)) {
    errors.push(`approval_type_not_allowed::${approvalReference.approval_type}`);
  }
  if (approvalReference.simulation !== true) errors.push('simulation_must_be_true');
  if (approvalReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (approvalReference.validator_version !== WORKFLOW_APPROVAL_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(approvalReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(approvalReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  WORKFLOW_APPROVAL_CONTRACT_VALIDATOR_VERSION,
  WORKFLOW_APPROVAL_FIELDS,
  WORKFLOW_APPROVAL_TYPES,
  validateWorkflowApprovalContract
};

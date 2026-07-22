'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const TOOL_PERMISSION_CONTRACT_VALIDATOR_VERSION = 'tool_permission_contract_validator_v1';
const TOOL_PERMISSION_FIELDS = Object.freeze([
  'permission_set_id', 'tool_id', 'tenant_id', 'organization_id', 'requires_confirmation',
  'requires_human_review', 'requires_network', 'requires_secret', 'requires_filesystem', 'requires_database',
  'requires_external_provider', 'requires_runtime', 'simulation', 'production_blocked', 'validator_version'
]);
const PERMISSION_BOOLEAN_FIELDS = Object.freeze([
  'requires_confirmation', 'requires_human_review', 'requires_network', 'requires_secret', 'requires_filesystem',
  'requires_database', 'requires_external_provider', 'requires_runtime'
]);

function validateToolPermissionContract(permissionSet) {
  const errors = [];
  if (!isPlainObject(permissionSet)) return { valid: false, errors: ['permission_set_must_be_object'] };
  exactFields(permissionSet, TOOL_PERMISSION_FIELDS, 'permission_set', errors);
  for (const field of ['permission_set_id', 'tool_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(permissionSet[field])) errors.push(`${field}_invalid`);
  }
  for (const field of PERMISSION_BOOLEAN_FIELDS) {
    if (typeof permissionSet[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (permissionSet.simulation !== true) errors.push('simulation_must_be_true');
  if (permissionSet.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (permissionSet.validator_version !== TOOL_PERMISSION_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(permissionSet);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(permissionSet));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  PERMISSION_BOOLEAN_FIELDS,
  TOOL_PERMISSION_CONTRACT_VALIDATOR_VERSION,
  TOOL_PERMISSION_FIELDS,
  validateToolPermissionContract
};

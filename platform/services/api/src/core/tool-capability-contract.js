'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const TOOL_CAPABILITY_CONTRACT_VALIDATOR_VERSION = 'tool_capability_contract_validator_v1';
const TOOL_CAPABILITY_FIELDS = Object.freeze([
  'capability_set_id', 'tool_id', 'tenant_id', 'organization_id', 'capabilities', 'simulation',
  'production_blocked', 'validator_version'
]);
const TOOL_CAPABILITIES = Object.freeze([
  'READ_REFERENCE', 'WRITE_REFERENCE', 'UPDATE_REFERENCE', 'DELETE_REFERENCE', 'EXECUTE_REFERENCE',
  'SEARCH_REFERENCE', 'GENERATE_REFERENCE', 'CLASSIFY_REFERENCE', 'SUMMARIZE_REFERENCE', 'ROUTE_REFERENCE',
  'VALIDATE_REFERENCE'
]);
const MAX_CAPABILITIES = TOOL_CAPABILITIES.length;

function isOrderedUniqueCapabilityList(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_CAPABILITIES) return false;
  if (!list.every((item) => isNonEmptyString(item) && TOOL_CAPABILITIES.includes(item))) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateToolCapabilityContract(capabilitySet) {
  const errors = [];
  if (!isPlainObject(capabilitySet)) return { valid: false, errors: ['capability_set_must_be_object'] };
  exactFields(capabilitySet, TOOL_CAPABILITY_FIELDS, 'capability_set', errors);
  for (const field of ['capability_set_id', 'tool_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(capabilitySet[field])) errors.push(`${field}_invalid`);
  }
  if (!isOrderedUniqueCapabilityList(capabilitySet.capabilities)) errors.push('capabilities_invalid');
  if (Array.isArray(capabilitySet.capabilities)) {
    for (const capability of capabilitySet.capabilities) {
      if (!TOOL_CAPABILITIES.includes(capability)) errors.push(`capability_not_allowed::${capability}`);
    }
  }
  if (capabilitySet.simulation !== true) errors.push('simulation_must_be_true');
  if (capabilitySet.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (capabilitySet.validator_version !== TOOL_CAPABILITY_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(capabilitySet);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(capabilitySet));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_CAPABILITIES,
  TOOL_CAPABILITIES,
  TOOL_CAPABILITY_CONTRACT_VALIDATOR_VERSION,
  TOOL_CAPABILITY_FIELDS,
  isOrderedUniqueCapabilityList,
  validateToolCapabilityContract
};

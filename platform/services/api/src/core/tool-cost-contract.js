'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const TOOL_COST_CONTRACT_VALIDATOR_VERSION = 'tool_cost_contract_validator_v1';
const TOOL_COST_FIELDS = Object.freeze([
  'cost_reference_id', 'tool_id', 'tenant_id', 'organization_id', 'cost_tier', 'simulation', 'production_blocked',
  'validator_version'
]);
const TOOL_COST_TIERS = Object.freeze(['ZERO_COST_REFERENCE', 'VERY_LOW', 'LOW', 'MODERATE', 'HIGH', 'UNKNOWN_BLOCKED']);

function validateToolCostContract(costReference) {
  const errors = [];
  if (!isPlainObject(costReference)) return { valid: false, errors: ['cost_reference_must_be_object'] };
  exactFields(costReference, TOOL_COST_FIELDS, 'cost_reference', errors);
  for (const field of ['cost_reference_id', 'tool_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(costReference[field])) errors.push(`${field}_invalid`);
  }
  if (!TOOL_COST_TIERS.includes(costReference.cost_tier)) errors.push(`cost_tier_not_allowed::${costReference.cost_tier}`);
  if (costReference.simulation !== true) errors.push('simulation_must_be_true');
  if (costReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (costReference.validator_version !== TOOL_COST_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(costReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(costReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  TOOL_COST_CONTRACT_VALIDATOR_VERSION,
  TOOL_COST_FIELDS,
  TOOL_COST_TIERS,
  validateToolCostContract
};

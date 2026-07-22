'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const TOOL_SIDE_EFFECTS_CONTRACT_VALIDATOR_VERSION = 'tool_side_effects_contract_validator_v1';
const TOOL_SIDE_EFFECT_FIELDS = Object.freeze([
  'side_effect_reference_id', 'tool_id', 'tenant_id', 'organization_id', 'side_effect', 'simulation',
  'production_blocked', 'validator_version'
]);
const TOOL_SIDE_EFFECTS = Object.freeze([
  'NONE', 'READ_ONLY_REFERENCE', 'STATE_CHANGE_REFERENCE', 'EXTERNAL_EFFECT_REFERENCE', 'IRREVERSIBLE_REFERENCE'
]);

function validateToolSideEffectsContract(sideEffectReference) {
  const errors = [];
  if (!isPlainObject(sideEffectReference)) return { valid: false, errors: ['side_effect_reference_must_be_object'] };
  exactFields(sideEffectReference, TOOL_SIDE_EFFECT_FIELDS, 'side_effect_reference', errors);
  for (const field of ['side_effect_reference_id', 'tool_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(sideEffectReference[field])) errors.push(`${field}_invalid`);
  }
  if (!TOOL_SIDE_EFFECTS.includes(sideEffectReference.side_effect)) errors.push(`side_effect_not_allowed::${sideEffectReference.side_effect}`);
  if (sideEffectReference.simulation !== true) errors.push('simulation_must_be_true');
  if (sideEffectReference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (sideEffectReference.validator_version !== TOOL_SIDE_EFFECTS_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(sideEffectReference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(sideEffectReference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  TOOL_SIDE_EFFECTS,
  TOOL_SIDE_EFFECTS_CONTRACT_VALIDATOR_VERSION,
  TOOL_SIDE_EFFECT_FIELDS,
  validateToolSideEffectsContract
};

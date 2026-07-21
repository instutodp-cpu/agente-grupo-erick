'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { DECISION_STATUSES } = require('./agent-policy-decision');

const AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION = 'agent_memory_policy_reference_validator_v1';
const AGENT_MEMORY_POLICY_REFERENCE_FIELDS = Object.freeze([
  'policy_request_id', 'policy_decision_id', 'policy_decision_fingerprint', 'policy_status',
  'allowed_in_simulation', 'approval_required', 'policy_evaluated', 'memory_read_allowed',
  'memory_write_allowed', 'memory_delete_allowed', 'memory_share_allowed', 'validator_version'
]);
const AGENT_MEMORY_POLICY_REFERENCE_SAFE_FLAGS = Object.freeze({
  memory_read_allowed: false,
  memory_write_allowed: false,
  memory_delete_allowed: false,
  memory_share_allowed: false
});

function validateMemoryPolicyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['memory_policy_reference_must_be_object'] };
  exactFields(reference, AGENT_MEMORY_POLICY_REFERENCE_FIELDS, 'memory_policy_reference', errors);
  for (const field of ['policy_request_id', 'policy_decision_id', 'policy_decision_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(reference.policy_status)) errors.push(`policy_status_not_allowed::${reference.policy_status}`);
  if (typeof reference.allowed_in_simulation !== 'boolean') errors.push('allowed_in_simulation_must_be_boolean');
  if (typeof reference.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (reference.policy_evaluated !== true) errors.push('policy_evaluated_must_be_true');
  for (const [field, expected] of Object.entries(AGENT_MEMORY_POLICY_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_MEMORY_POLICY_REFERENCE_FIELDS,
  AGENT_MEMORY_POLICY_REFERENCE_SAFE_FLAGS,
  AGENT_MEMORY_POLICY_REFERENCE_VALIDATOR_VERSION,
  validateMemoryPolicyReference
};

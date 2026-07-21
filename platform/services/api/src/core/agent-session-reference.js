'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_CONTRACT_STATUSES } = require('./agent-core-contract');
const { AGENT_LIFECYCLE_STATES } = require('./agent-lifecycle-contract');
const { DECISION_STATUSES } = require('./agent-policy-decision');

const AGENT_SESSION_REFERENCE_VALIDATOR_VERSION = 'agent_session_reference_validator_v1';
const CONVERSATION_REFERENCE_FIELDS = Object.freeze([
  'conversation_ref_id', 'conversation_ref_version', 'conversation_present', 'history_present',
  'history_loaded', 'history_mutated', 'message_count_reference', 'last_message_sequence_reference',
  'conversation_fingerprint', 'validator_version'
]);
const SESSION_POLICY_REFERENCE_FIELDS = Object.freeze([
  'policy_request_id', 'policy_decision_id', 'policy_decision_fingerprint', 'policy_status',
  'allowed_in_simulation', 'approval_required', 'policy_evaluated', 'validator_version'
]);
const REQUEST_SESSION_REFERENCE_FIELDS = Object.freeze([
  'session_id', 'session_version', 'session_fingerprint', 'session_present', 'session_loaded', 'session_mutated', 'validator_version'
]);
const REQUEST_AGENT_CONTRACT_REFERENCE_FIELDS = Object.freeze([
  'contract_id', 'contract_version', 'contract_fingerprint', 'agent_id', 'agent_version',
  'tenant_id', 'organization_id', 'contract_status', 'lifecycle_state', 'validator_version'
]);

function validateConversationReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['conversation_reference_must_be_object'] };
  exactFields(reference, CONVERSATION_REFERENCE_FIELDS, 'conversation_reference', errors);
  for (const field of ['conversation_ref_id', 'conversation_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.conversation_ref_version) || reference.conversation_ref_version < 1) errors.push('conversation_ref_version_invalid');
  for (const field of ['conversation_present', 'history_present']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (reference.history_loaded !== false) errors.push('history_loaded_must_be_false');
  if (reference.history_mutated !== false) errors.push('history_mutated_must_be_false');
  if (!Number.isInteger(reference.message_count_reference) || reference.message_count_reference < 0) errors.push('message_count_reference_invalid');
  if (!Number.isInteger(reference.last_message_sequence_reference) || reference.last_message_sequence_reference < 0) errors.push('last_message_sequence_reference_invalid');
  if (reference.validator_version !== AGENT_SESSION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateSessionPolicyReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['policy_reference_must_be_object'] };
  exactFields(reference, SESSION_POLICY_REFERENCE_FIELDS, 'policy_reference', errors);
  for (const field of ['policy_request_id', 'policy_decision_id', 'policy_decision_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(reference.policy_status)) errors.push(`policy_status_not_allowed::${reference.policy_status}`);
  if (typeof reference.allowed_in_simulation !== 'boolean') errors.push('allowed_in_simulation_must_be_boolean');
  if (typeof reference.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  if (reference.policy_evaluated !== true) errors.push('policy_evaluated_must_be_true');
  if (reference.validator_version !== AGENT_SESSION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRequestSessionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['session_reference_must_be_object'] };
  exactFields(reference, REQUEST_SESSION_REFERENCE_FIELDS, 'session_reference', errors);
  for (const field of ['session_id', 'session_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.session_version) || reference.session_version < 0) errors.push('session_version_invalid');
  if (typeof reference.session_present !== 'boolean') errors.push('session_present_must_be_boolean');
  if (reference.session_loaded !== false) errors.push('session_loaded_must_be_false');
  if (reference.session_mutated !== false) errors.push('session_mutated_must_be_false');
  if (reference.validator_version !== AGENT_SESSION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateRequestAgentContractReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['agent_contract_reference_must_be_object'] };
  exactFields(reference, REQUEST_AGENT_CONTRACT_REFERENCE_FIELDS, 'agent_contract_reference', errors);
  for (const field of ['contract_id', 'contract_fingerprint', 'agent_id', 'tenant_id', 'organization_id', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.contract_version) || reference.contract_version < 1) errors.push('contract_version_invalid');
  if (!Number.isInteger(reference.agent_version) || reference.agent_version < 1) errors.push('agent_version_invalid');
  if (!AGENT_CONTRACT_STATUSES.includes(reference.contract_status)) errors.push(`contract_status_not_allowed::${reference.contract_status}`);
  if (!AGENT_LIFECYCLE_STATES.includes(reference.lifecycle_state)) errors.push(`lifecycle_state_not_allowed::${reference.lifecycle_state}`);
  if (reference.validator_version !== AGENT_SESSION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_SESSION_REFERENCE_VALIDATOR_VERSION,
  CONVERSATION_REFERENCE_FIELDS,
  REQUEST_AGENT_CONTRACT_REFERENCE_FIELDS,
  REQUEST_SESSION_REFERENCE_FIELDS,
  SESSION_POLICY_REFERENCE_FIELDS,
  validateConversationReference,
  validateRequestAgentContractReference,
  validateRequestSessionReference,
  validateSessionPolicyReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_CHANNELS, validateActorContext, validateAgentSimulationContext } = require('./agent-context-contract');
const { SESSION_TYPES } = require('./agent-session-contract');
const { TRANSITION_TYPES } = require('./agent-session-transition');
const {
  validateRequestAgentContractReference,
  validateRequestSessionReference,
  validateSessionPolicyReference
} = require('./agent-session-reference');

const AGENT_SESSION_REQUEST_VALIDATOR_VERSION = 'agent_session_request_validator_v1';
const AGENT_SESSION_REQUEST_FIELDS = Object.freeze([
  'session_request_id', 'session_request_version', 'request_type', 'session_reference', 'agent_contract_reference',
  'policy_reference', 'tenant_id', 'organization_id', 'actor_context', 'channel', 'requested_session_type',
  'requested_transition', 'logical_sequence', 'expected_session_version', 'expected_session_fingerprint',
  'expiration_evaluation', 'correlation_id', 'causation_id', 'trace_id', 'simulation_context', 'validator_version'
]);
const EXPIRATION_EVALUATION_FIELDS = Object.freeze(['evaluate_expiration', 'current_sequence', 'last_activity_sequence', 'validator_version']);
const SESSION_REQUEST_TYPES = Object.freeze([
  'CREATE_SESSION_REFERENCE', 'VALIDATE_SESSION_REFERENCE', 'TRANSITION_SESSION_REFERENCE', 'READ_SESSION_REFERENCE',
  'LIST_SESSION_REFERENCES', 'EVALUATE_EXPIRATION_REFERENCE', 'CLOSE_SESSION_REFERENCE', 'ARCHIVE_SESSION_REFERENCE'
]);

function validateExpirationEvaluationInput(input) {
  const errors = [];
  if (!isPlainObject(input)) return { valid: false, errors: ['expiration_evaluation_must_be_object'] };
  exactFields(input, EXPIRATION_EVALUATION_FIELDS, 'expiration_evaluation', errors);
  if (typeof input.evaluate_expiration !== 'boolean') errors.push('evaluate_expiration_must_be_boolean');
  if (!Number.isInteger(input.current_sequence) || input.current_sequence < 0) errors.push('current_sequence_invalid');
  if (!Number.isInteger(input.last_activity_sequence) || input.last_activity_sequence < 0) errors.push('last_activity_sequence_invalid');
  if (input.validator_version !== AGENT_SESSION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentSessionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['agent_session_request_must_be_object'] };
  exactFields(request, AGENT_SESSION_REQUEST_FIELDS, 'agent_session_request', errors);
  for (const field of ['session_request_id', 'tenant_id', 'organization_id', 'expected_session_fingerprint', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.session_request_version) || request.session_request_version < 1) errors.push('session_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_session_version) || request.expected_session_version < 0) errors.push('expected_session_version_invalid');
  if (!SESSION_REQUEST_TYPES.includes(request.request_type)) errors.push(`request_type_not_allowed::${request.request_type}`);
  if (!AGENT_CHANNELS.includes(request.channel)) errors.push(`channel_not_allowed::${request.channel}`);
  if (!SESSION_TYPES.includes(request.requested_session_type)) errors.push(`requested_session_type_not_allowed::${request.requested_session_type}`);
  if (!TRANSITION_TYPES.includes(request.requested_transition)) errors.push(`requested_transition_not_allowed::${request.requested_transition}`);

  const sessionRefValidation = validateRequestSessionReference(request.session_reference);
  errors.push(...sessionRefValidation.errors.map((error) => `session_reference_${error}`));
  const contractRefValidation = validateRequestAgentContractReference(request.agent_contract_reference);
  errors.push(...contractRefValidation.errors.map((error) => `agent_contract_reference_${error}`));
  const policyRefValidation = validateSessionPolicyReference(request.policy_reference);
  errors.push(...policyRefValidation.errors.map((error) => `policy_reference_${error}`));
  const actorValidation = validateActorContext(request.actor_context);
  errors.push(...actorValidation.errors);
  const expirationEvaluationValidation = validateExpirationEvaluationInput(request.expiration_evaluation);
  errors.push(...expirationEvaluationValidation.errors.map((error) => `expiration_evaluation_${error}`));
  const simulationValidation = validateAgentSimulationContext(request.simulation_context);
  errors.push(...simulationValidation.errors.map((error) => `simulation_context_${error}`));

  if (isPlainObject(request.session_reference)) {
    const expectedPresent = request.request_type === 'CREATE_SESSION_REFERENCE' ? false : true;
    if (request.session_reference.session_present !== expectedPresent) {
      errors.push(`session_present_inconsistent_with_request_type::${request.request_type}`);
    }
  }
  if (isPlainObject(request.actor_context) && request.actor_context.tenant_id && request.tenant_id !== request.actor_context.tenant_id) {
    errors.push('actor_tenant_mismatch');
  }
  if (isPlainObject(request.actor_context) && request.actor_context.organization_id && request.organization_id !== request.actor_context.organization_id) {
    errors.push('actor_organization_mismatch');
  }
  if (isPlainObject(request.agent_contract_reference) && request.agent_contract_reference.tenant_id && request.tenant_id !== request.agent_contract_reference.tenant_id) {
    errors.push('contract_tenant_mismatch');
  }
  if (isPlainObject(request.agent_contract_reference) && request.agent_contract_reference.contract_status && request.agent_contract_reference.contract_status !== 'VALIDATED_SIMULATION') {
    errors.push('agent_contract_not_validated_simulation');
  }

  if (request.validator_version !== AGENT_SESSION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial({
    session_request_id: request.session_request_id,
    correlation_id: request.correlation_id,
    causation_id: request.causation_id,
    trace_id: request.trace_id
  }));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_SESSION_REQUEST_FIELDS,
  AGENT_SESSION_REQUEST_VALIDATOR_VERSION,
  EXPIRATION_EVALUATION_FIELDS,
  SESSION_REQUEST_TYPES,
  validateAgentSessionRequest,
  validateExpirationEvaluationInput
};

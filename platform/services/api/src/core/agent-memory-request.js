'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateActorContext, validateAgentSimulationContext } = require('./agent-context-contract');
const {
  validateRequestAgentContractReference,
  validateRequestSessionReference
} = require('./agent-session-reference');
const { AGENT_MEMORY_CONTRACT_STATUSES } = require('./agent-memory-contract');
const { validateMemoryPolicyReference } = require('./agent-memory-policy-reference');
const { validateRetrievalReference } = require('./agent-memory-retrieval-reference');

const AGENT_MEMORY_REQUEST_VALIDATOR_VERSION = 'agent_memory_request_validator_v1';
const AGENT_MEMORY_REQUEST_FIELDS = Object.freeze([
  'memory_request_id', 'memory_request_version', 'request_type', 'memory_contract_reference', 'memory_item_reference',
  'retrieval_reference', 'agent_contract_reference', 'session_reference', 'policy_reference', 'tenant_id',
  'organization_id', 'actor_context', 'logical_sequence', 'expected_memory_version', 'expected_memory_fingerprint',
  'simulation_context', 'validator_version'
]);
const MEMORY_CONTRACT_REFERENCE_FIELDS = Object.freeze(['memory_contract_id', 'memory_contract_version', 'memory_contract_fingerprint', 'contract_status', 'validator_version']);
const MEMORY_ITEM_REFERENCE_FIELDS = Object.freeze(['memory_item_id', 'memory_item_version', 'memory_item_fingerprint', 'memory_item_present', 'validator_version']);
const MEMORY_REQUEST_TYPES = Object.freeze([
  'VALIDATE_MEMORY_REFERENCE', 'REGISTER_MEMORY_REFERENCE', 'READ_MEMORY_REFERENCE', 'LIST_MEMORY_REFERENCES',
  'RETRIEVE_MEMORY_REFERENCE', 'UPDATE_MEMORY_REFERENCE', 'DELETE_MEMORY_REFERENCE', 'SHARE_MEMORY_REFERENCE',
  'EVALUATE_RETENTION_REFERENCE'
]);

function validateMemoryContractReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['memory_contract_reference_must_be_object'] };
  exactFields(reference, MEMORY_CONTRACT_REFERENCE_FIELDS, 'memory_contract_reference', errors);
  for (const field of ['memory_contract_id', 'memory_contract_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.memory_contract_version) || reference.memory_contract_version < 1) errors.push('memory_contract_version_invalid');
  if (!AGENT_MEMORY_CONTRACT_STATUSES.includes(reference.contract_status)) errors.push(`contract_status_not_allowed::${reference.contract_status}`);
  if (reference.validator_version !== AGENT_MEMORY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateMemoryItemReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['memory_item_reference_must_be_object'] };
  exactFields(reference, MEMORY_ITEM_REFERENCE_FIELDS, 'memory_item_reference', errors);
  for (const field of ['memory_item_id', 'memory_item_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.memory_item_version) || reference.memory_item_version < 0) errors.push('memory_item_version_invalid');
  if (typeof reference.memory_item_present !== 'boolean') errors.push('memory_item_present_must_be_boolean');
  if (reference.validator_version !== AGENT_MEMORY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentMemoryRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['agent_memory_request_must_be_object'] };
  exactFields(request, AGENT_MEMORY_REQUEST_FIELDS, 'agent_memory_request', errors);
  for (const field of ['memory_request_id', 'tenant_id', 'organization_id', 'expected_memory_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.memory_request_version) || request.memory_request_version < 1) errors.push('memory_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (!Number.isInteger(request.expected_memory_version) || request.expected_memory_version < 0) errors.push('expected_memory_version_invalid');
  if (!MEMORY_REQUEST_TYPES.includes(request.request_type)) errors.push(`request_type_not_allowed::${request.request_type}`);

  errors.push(...validateMemoryContractReference(request.memory_contract_reference).errors.map((error) => `memory_contract_reference_${error}`));
  errors.push(...validateMemoryItemReference(request.memory_item_reference).errors.map((error) => `memory_item_reference_${error}`));
  errors.push(...validateRetrievalReference(request.retrieval_reference).errors.map((error) => `retrieval_reference_${error}`));
  errors.push(...validateRequestAgentContractReference(request.agent_contract_reference).errors.map((error) => `agent_contract_reference_${error}`));
  errors.push(...validateRequestSessionReference(request.session_reference).errors.map((error) => `session_reference_${error}`));
  errors.push(...validateMemoryPolicyReference(request.policy_reference).errors.map((error) => `policy_reference_${error}`));
  errors.push(...validateActorContext(request.actor_context).errors);
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((error) => `simulation_context_${error}`));

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

  if (request.validator_version !== AGENT_MEMORY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_MEMORY_REQUEST_FIELDS,
  AGENT_MEMORY_REQUEST_VALIDATOR_VERSION,
  MEMORY_CONTRACT_REFERENCE_FIELDS,
  MEMORY_ITEM_REFERENCE_FIELDS,
  MEMORY_REQUEST_TYPES,
  validateAgentMemoryRequest,
  validateMemoryContractReference,
  validateMemoryItemReference
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { AGENT_CONTRACT_STATUSES } = require('./agent-core-contract');
const { AGENT_LIFECYCLE_STATES } = require('./agent-lifecycle-contract');
const { AGENT_CAPABILITY_TYPES } = require('./agent-capability-contract');
const { AGENT_CHANNELS, validateActorContext, validateAgentSimulationContext } = require('./agent-context-contract');
const { AGENT_RISK_CLASSIFICATIONS, AGENT_DATA_CLASSIFICATIONS } = require('./agent-metadata-contract');
const { ACTIONS, RESOURCE_TYPES } = require('./agent-policy-scope');
const { validateBudgetRequest } = require('./agent-policy-budget');
const { validateLimitRequest } = require('./agent-policy-limits');

const AGENT_POLICY_REQUEST_VALIDATOR_VERSION = 'agent_policy_request_validator_v1';
const AGENT_POLICY_REQUEST_FIELDS = Object.freeze([
  'policy_request_id',
  'policy_request_version',
  'agent_contract_reference',
  'agent_id',
  'tenant_id',
  'organization_id',
  'actor_context',
  'capability_reference',
  'requested_action',
  'resource_reference',
  'channel',
  'risk_classification',
  'data_classification',
  'budget_request',
  'limit_request',
  'approval_context',
  'correlation_id',
  'causation_id',
  'trace_id',
  'logical_sequence',
  'simulation_context',
  'validator_version'
]);
const AGENT_CONTRACT_REFERENCE_FIELDS = Object.freeze(['contract_id', 'contract_version', 'contract_fingerprint', 'identity_fingerprint', 'context_fingerprint', 'lifecycle_state', 'contract_status', 'validator_version']);
const CAPABILITY_REFERENCE_FIELDS = Object.freeze(['capability_id', 'capability_version', 'capability_slug', 'capability_type', 'capability_fingerprint', 'declared', 'enabled', 'execution_allowed', 'validator_version']);
const RESOURCE_REFERENCE_FIELDS = Object.freeze(['resource_type', 'resource_id', 'resource_classification', 'resource_domain', 'resource_present', 'resource_loaded', 'resource_mutated', 'validator_version']);
const APPROVAL_CONTEXT_FIELDS = Object.freeze(['approval_present', 'approval_reference_id', 'approval_granted', 'approval_applied', 'validator_version']);
const CAPABILITY_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function validateAgentContractReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['agent_contract_reference_must_be_object'] };
  exactFields(reference, AGENT_CONTRACT_REFERENCE_FIELDS, 'agent_contract_reference', errors);
  for (const field of ['contract_id', 'contract_fingerprint', 'identity_fingerprint', 'context_fingerprint', 'lifecycle_state', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.contract_version) || reference.contract_version < 1) errors.push('contract_version_invalid');
  if (!AGENT_LIFECYCLE_STATES.includes(reference.lifecycle_state)) errors.push(`lifecycle_state_not_allowed::${reference.lifecycle_state}`);
  if (!AGENT_CONTRACT_STATUSES.includes(reference.contract_status)) errors.push(`contract_status_not_allowed::${reference.contract_status}`);
  if (reference.validator_version !== AGENT_POLICY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateCapabilityReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['capability_reference_must_be_object'] };
  exactFields(reference, CAPABILITY_REFERENCE_FIELDS, 'capability_reference', errors);
  for (const field of ['capability_id', 'capability_slug', 'capability_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.capability_version) || reference.capability_version < 1) errors.push('capability_version_invalid');
  if (isNonEmptyString(reference.capability_slug) && !CAPABILITY_SLUG_PATTERN.test(reference.capability_slug)) errors.push('capability_slug_not_normalized');
  if (!AGENT_CAPABILITY_TYPES.includes(reference.capability_type)) errors.push(`capability_type_not_allowed::${reference.capability_type}`);
  if (reference.declared !== true) errors.push('declared_must_be_true');
  if (reference.enabled !== false) errors.push('enabled_must_be_false');
  if (reference.execution_allowed !== false) errors.push('execution_allowed_must_be_false');
  if (reference.validator_version !== AGENT_POLICY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateResourceReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['resource_reference_must_be_object'] };
  exactFields(reference, RESOURCE_REFERENCE_FIELDS, 'resource_reference', errors);
  for (const field of ['resource_id', 'resource_domain', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!RESOURCE_TYPES.includes(reference.resource_type)) errors.push(`resource_type_not_allowed::${reference.resource_type}`);
  if (!['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'].includes(reference.resource_classification)) errors.push(`resource_classification_not_allowed::${reference.resource_classification}`);
  if (typeof reference.resource_present !== 'boolean') errors.push('resource_present_must_be_boolean');
  if (reference.resource_loaded !== false) errors.push('resource_loaded_must_be_false');
  if (reference.resource_mutated !== false) errors.push('resource_mutated_must_be_false');
  if (reference.validator_version !== AGENT_POLICY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateApprovalContext(context) {
  const errors = [];
  if (!isPlainObject(context)) return { valid: false, errors: ['approval_context_must_be_object'] };
  exactFields(context, APPROVAL_CONTEXT_FIELDS, 'approval_context', errors);
  if (!isNonEmptyString(context.approval_reference_id)) errors.push('approval_reference_id_invalid');
  if (typeof context.approval_present !== 'boolean') errors.push('approval_present_must_be_boolean');
  if (context.approval_granted !== false) errors.push('approval_granted_must_be_false');
  if (context.approval_applied !== false) errors.push('approval_applied_must_be_false');
  if (context.validator_version !== AGENT_POLICY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateAgentPolicyRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['agent_policy_request_must_be_object'] };
  exactFields(request, AGENT_POLICY_REQUEST_FIELDS, 'agent_policy_request', errors);
  for (const field of ['policy_request_id', 'agent_id', 'tenant_id', 'organization_id', 'correlation_id', 'causation_id', 'trace_id', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.policy_request_version) || request.policy_request_version < 1) errors.push('policy_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 1) errors.push('logical_sequence_invalid');
  if (!ACTIONS.includes(request.requested_action)) errors.push(`requested_action_not_allowed::${request.requested_action}`);
  if (!AGENT_CHANNELS.includes(request.channel)) errors.push(`channel_not_allowed::${request.channel}`);
  if (!AGENT_RISK_CLASSIFICATIONS.includes(request.risk_classification)) errors.push(`risk_classification_not_allowed::${request.risk_classification}`);
  if (!AGENT_DATA_CLASSIFICATIONS.includes(request.data_classification)) errors.push(`data_classification_not_allowed::${request.data_classification}`);

  const contractReferenceValidation = validateAgentContractReference(request.agent_contract_reference);
  errors.push(...contractReferenceValidation.errors.map((error) => `agent_contract_reference_${error}`));
  const actorValidation = validateActorContext(request.actor_context);
  errors.push(...actorValidation.errors);
  const capabilityValidation = validateCapabilityReference(request.capability_reference);
  errors.push(...capabilityValidation.errors.map((error) => `capability_reference_${error}`));
  const resourceValidation = validateResourceReference(request.resource_reference);
  errors.push(...resourceValidation.errors.map((error) => `resource_reference_${error}`));
  const budgetValidation = validateBudgetRequest(request.budget_request);
  errors.push(...budgetValidation.errors.map((error) => `budget_request_${error}`));
  const limitValidation = validateLimitRequest(request.limit_request);
  errors.push(...limitValidation.errors.map((error) => `limit_request_${error}`));
  const approvalValidation = validateApprovalContext(request.approval_context);
  errors.push(...approvalValidation.errors.map((error) => `approval_context_${error}`));
  const simulationValidation = validateAgentSimulationContext(request.simulation_context);
  errors.push(...simulationValidation.errors.map((error) => `simulation_context_${error}`));

  if (isPlainObject(request.actor_context) && request.actor_context.tenant_id && request.tenant_id !== request.actor_context.tenant_id) {
    errors.push('actor_tenant_mismatch');
  }
  if (isPlainObject(request.actor_context) && request.actor_context.organization_id && request.organization_id !== request.actor_context.organization_id) {
    errors.push('actor_organization_mismatch');
  }
  if (isPlainObject(request.agent_contract_reference) && request.agent_contract_reference.contract_status && request.agent_contract_reference.contract_status !== 'VALIDATED_SIMULATION') {
    errors.push('agent_contract_not_validated_simulation');
  }
  if (request.validator_version !== AGENT_POLICY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AGENT_CONTRACT_REFERENCE_FIELDS,
  AGENT_POLICY_REQUEST_FIELDS,
  AGENT_POLICY_REQUEST_VALIDATOR_VERSION,
  APPROVAL_CONTEXT_FIELDS,
  CAPABILITY_REFERENCE_FIELDS,
  CAPABILITY_SLUG_PATTERN,
  RESOURCE_REFERENCE_FIELDS,
  validateAgentContractReference,
  validateAgentPolicyRequest,
  validateApprovalContext,
  validateCapabilityReference,
  validateResourceReference
};

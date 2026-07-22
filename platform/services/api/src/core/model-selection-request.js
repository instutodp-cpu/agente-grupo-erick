'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const {
  validateRequestAgentContractReference,
  validateRequestSessionReference,
  validateSessionPolicyReference
} = require('./agent-session-reference');
const { validateMemoryContractReference } = require('./agent-memory-request');
const { validateReferenceList } = require('./model-contract');
const { validateModelSelectionTaskProfile } = require('./model-selection-task-profile');
const { validateModelSelectionConstraints } = require('./model-selection-constraints');

const MODEL_SELECTION_REQUEST_VALIDATOR_VERSION = 'model_selection_request_validator_v1';
const SELECTION_REQUEST_FIELDS = Object.freeze([
  'selection_request_id', 'selection_request_version', 'agent_contract_reference', 'policy_decision_reference',
  'session_reference', 'memory_reference', 'task_profile', 'candidate_model_references', 'constraints',
  'budget_reference', 'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_registry_version',
  'simulation_context', 'validator_version'
]);
const BUDGET_REFERENCE_FIELDS = Object.freeze([
  'budget_reference_id', 'within_budget_reference', 'remaining_budget_minor_units_reference',
  'budget_evaluated_reference', 'validator_version'
]);
const MAX_REMAINING_BUDGET_MINOR_UNITS = 1000000000;
const MAX_CANDIDATE_REFERENCES = 200;

function validateBudgetReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['budget_reference_must_be_object'] };
  exactFields(reference, BUDGET_REFERENCE_FIELDS, 'budget_reference', errors);
  if (!isNonEmptyString(reference.budget_reference_id)) errors.push('budget_reference_id_invalid');
  if (typeof reference.within_budget_reference !== 'boolean') errors.push('within_budget_reference_must_be_boolean');
  if (
    !Number.isInteger(reference.remaining_budget_minor_units_reference) ||
    reference.remaining_budget_minor_units_reference < 0 ||
    reference.remaining_budget_minor_units_reference > MAX_REMAINING_BUDGET_MINOR_UNITS
  ) {
    errors.push('remaining_budget_minor_units_reference_invalid');
  }
  if (reference.budget_evaluated_reference !== true) errors.push('budget_evaluated_reference_must_be_true');
  if (reference.validator_version !== MODEL_SELECTION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateModelSelectionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['selection_request_must_be_object'] };
  exactFields(request, SELECTION_REQUEST_FIELDS, 'selection_request', errors);
  for (const field of ['selection_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.selection_request_version) || request.selection_request_version < 1) errors.push('selection_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateRequestAgentContractReference(request.agent_contract_reference).errors.map((error) => `agent_contract_reference_${error}`));
  errors.push(...validateSessionPolicyReference(request.policy_decision_reference).errors.map((error) => `policy_decision_reference_${error}`));
  errors.push(...validateRequestSessionReference(request.session_reference).errors.map((error) => `session_reference_${error}`));
  errors.push(...validateMemoryContractReference(request.memory_reference).errors.map((error) => `memory_reference_${error}`));
  errors.push(...validateModelSelectionTaskProfile(request.task_profile).errors.map((error) => `task_profile_${error}`));
  errors.push(...validateReferenceList(request.candidate_model_references, { maxItems: MAX_CANDIDATE_REFERENCES }).errors.map((error) => `candidate_model_references_${error}`));
  errors.push(...validateModelSelectionConstraints(request.constraints).errors.map((error) => `constraints_${error}`));
  errors.push(...validateBudgetReference(request.budget_reference).errors.map((error) => `budget_reference_${error}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (
    isPlainObject(request.agent_contract_reference) && isPlainObject(request.task_profile) &&
    request.agent_contract_reference.agent_id !== request.task_profile.agent_id
  ) {
    errors.push('agent_id_mismatch_between_agent_contract_reference_and_task_profile');
  }
  if (
    isPlainObject(request.agent_contract_reference) && isPlainObject(request.task_profile) &&
    (request.agent_contract_reference.tenant_id !== request.task_profile.tenant_id ||
      request.agent_contract_reference.organization_id !== request.task_profile.organization_id)
  ) {
    errors.push('tenant_or_organization_mismatch_between_agent_contract_reference_and_task_profile');
  }

  if (request.validator_version !== MODEL_SELECTION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  BUDGET_REFERENCE_FIELDS,
  MAX_CANDIDATE_REFERENCES,
  MAX_REMAINING_BUDGET_MINOR_UNITS,
  MODEL_SELECTION_REQUEST_VALIDATOR_VERSION,
  SELECTION_REQUEST_FIELDS,
  validateBudgetReference,
  validateModelSelectionRequest
};

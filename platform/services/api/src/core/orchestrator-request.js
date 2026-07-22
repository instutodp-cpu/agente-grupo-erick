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
const { validateRetrievalReference } = require('./agent-memory-retrieval-reference');
const { validateSingleReference, validateReferenceList } = require('./model-contract');
const { validateModelSelectionDecisionReference } = require('./context-assembly-request');

const ORCHESTRATOR_REQUEST_VALIDATOR_VERSION = 'orchestrator_request_validator_v1';
const ORCHESTRATOR_REQUEST_FIELDS = Object.freeze([
  'orchestrator_request_id', 'orchestrator_request_version', 'agent_contract_reference', 'policy_decision_reference',
  'session_reference', 'memory_contract_reference', 'memory_retrieval_reference', 'model_selection_decision_reference',
  'context_assembly_result_reference', 'workflow_reference', 'tool_references', 'task_reference', 'budget_reference',
  'user_preference_references', 'project_state_reference', 'continuity_summary_reference', 'required_memory_references',
  'memory_selection_policy_reference', 'correlation_id', 'causation_id', 'trace_id', 'logical_sequence',
  'expected_registry_version', 'simulation_context', 'validator_version'
]);
const MAX_TOOL_REFERENCES = 100;
const MAX_USER_PREFERENCE_REFERENCES = 100;
const MAX_REQUIRED_MEMORY_REFERENCES = 100;

function validateOrchestratorRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['orchestrator_request_must_be_object'] };
  exactFields(request, ORCHESTRATOR_REQUEST_FIELDS, 'orchestrator_request', errors);
  for (const field of ['orchestrator_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.orchestrator_request_version) || request.orchestrator_request_version < 1) {
    errors.push('orchestrator_request_version_invalid');
  }
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateRequestAgentContractReference(request.agent_contract_reference).errors.map((error) => `agent_contract_reference_${error}`));
  errors.push(...validateSessionPolicyReference(request.policy_decision_reference).errors.map((error) => `policy_decision_reference_${error}`));
  errors.push(...validateRequestSessionReference(request.session_reference).errors.map((error) => `session_reference_${error}`));
  errors.push(...validateMemoryContractReference(request.memory_contract_reference).errors.map((error) => `memory_contract_reference_${error}`));
  errors.push(...validateRetrievalReference(request.memory_retrieval_reference).errors.map((error) => `memory_retrieval_reference_${error}`));
  errors.push(...validateModelSelectionDecisionReference(request.model_selection_decision_reference).errors.map((error) => `model_selection_decision_reference_${error}`));
  errors.push(...validateSingleReference(request.context_assembly_result_reference).errors.map((error) => `context_assembly_result_reference_${error}`));
  errors.push(...validateSingleReference(request.workflow_reference).errors.map((error) => `workflow_reference_${error}`));
  errors.push(...validateSingleReference(request.task_reference).errors.map((error) => `task_reference_${error}`));
  errors.push(...validateSingleReference(request.budget_reference).errors.map((error) => `budget_reference_${error}`));
  errors.push(...validateReferenceList(request.tool_references, { maxItems: MAX_TOOL_REFERENCES }).errors.map((error) => `tool_references_${error}`));
  errors.push(...validateReferenceList(request.user_preference_references, { maxItems: MAX_USER_PREFERENCE_REFERENCES }).errors.map((error) => `user_preference_references_${error}`));
  errors.push(...validateSingleReference(request.project_state_reference).errors.map((error) => `project_state_reference_${error}`));
  errors.push(...validateSingleReference(request.continuity_summary_reference).errors.map((error) => `continuity_summary_reference_${error}`));
  errors.push(...validateReferenceList(request.required_memory_references, { maxItems: MAX_REQUIRED_MEMORY_REFERENCES }).errors.map((error) => `required_memory_references_${error}`));
  errors.push(...validateSingleReference(request.memory_selection_policy_reference).errors.map((error) => `memory_selection_policy_reference_${error}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (request.validator_version !== ORCHESTRATOR_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  MAX_REQUIRED_MEMORY_REFERENCES,
  MAX_TOOL_REFERENCES,
  MAX_USER_PREFERENCE_REFERENCES,
  ORCHESTRATOR_REQUEST_FIELDS,
  ORCHESTRATOR_REQUEST_VALIDATOR_VERSION,
  validateOrchestratorRequest
};

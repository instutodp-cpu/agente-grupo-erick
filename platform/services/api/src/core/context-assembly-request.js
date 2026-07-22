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
const { validateSingleReference } = require('./model-contract');
const { DECISION_STATUSES, DECISION_VALUES } = require('./model-selection-decision');
const { validateContextAssemblySourceReference } = require('./context-assembly-source-reference');
const { validateContextAssemblyPolicy } = require('./context-assembly-policy');
const { validateContextBudget } = require('./context-assembly-budget');

const CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION = 'context_assembly_request_validator_v1';
const CONTEXT_ASSEMBLY_REQUEST_FIELDS = Object.freeze([
  'assembly_request_id', 'assembly_request_version', 'agent_contract_reference', 'policy_decision_reference',
  'session_reference', 'memory_contract_reference', 'memory_retrieval_reference', 'task_profile_reference',
  'model_selection_decision_reference', 'source_references', 'assembly_policy', 'context_budget', 'correlation_id',
  'causation_id', 'trace_id', 'logical_sequence', 'expected_registry_version', 'simulation_context', 'validator_version'
]);
const MODEL_SELECTION_DECISION_REFERENCE_FIELDS = Object.freeze([
  'decision_reference_id', 'decision_status', 'decision_value', 'selected_provider_id', 'selected_model_id',
  'decision_fingerprint', 'validator_version'
]);
const ACCEPTABLE_MODEL_SELECTION_DECISION_STATUSES = Object.freeze(['NO_LLM_SELECTED_SIMULATION', 'MODEL_SELECTED_SIMULATION']);
const MAX_SOURCE_REFERENCES = 500;

function validateModelSelectionDecisionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['model_selection_decision_reference_must_be_object'] };
  exactFields(reference, MODEL_SELECTION_DECISION_REFERENCE_FIELDS, 'model_selection_decision_reference', errors);
  for (const field of ['decision_reference_id', 'decision_fingerprint', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!DECISION_STATUSES.includes(reference.decision_status)) errors.push(`decision_status_not_allowed::${reference.decision_status}`);
  if (!DECISION_VALUES.includes(reference.decision_value)) errors.push(`decision_value_not_allowed::${reference.decision_value}`);
  if (reference.selected_provider_id !== null && !isNonEmptyString(reference.selected_provider_id)) errors.push('selected_provider_id_must_be_null_or_string');
  if (reference.selected_model_id !== null && !isNonEmptyString(reference.selected_model_id)) errors.push('selected_model_id_must_be_null_or_string');
  if (reference.decision_status === 'MODEL_SELECTED_SIMULATION') {
    if (reference.decision_value !== 'SELECT_MODEL_REFERENCE') errors.push('decision_value_must_be_select_model_reference');
    if (!isNonEmptyString(reference.selected_provider_id)) errors.push('selected_provider_id_required_for_model_selected');
    if (!isNonEmptyString(reference.selected_model_id)) errors.push('selected_model_id_required_for_model_selected');
  } else if (reference.decision_status === 'NO_LLM_SELECTED_SIMULATION') {
    if (reference.decision_value !== 'SELECT_NO_LLM_REFERENCE') errors.push('decision_value_must_be_select_no_llm_reference');
    if (reference.selected_provider_id !== null) errors.push('selected_provider_id_must_be_null_for_no_llm');
    if (reference.selected_model_id !== null) errors.push('selected_model_id_must_be_null_for_no_llm');
  } else if (DECISION_STATUSES.includes(reference.decision_status)) {
    if (reference.decision_value !== 'BLOCKED') errors.push('decision_value_must_be_blocked');
    if (reference.selected_provider_id !== null) errors.push('selected_provider_id_must_be_null_when_blocked');
    if (reference.selected_model_id !== null) errors.push('selected_model_id_must_be_null_when_blocked');
  }
  if (reference.validator_version !== CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateContextAssemblyRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['assembly_request_must_be_object'] };
  exactFields(request, CONTEXT_ASSEMBLY_REQUEST_FIELDS, 'assembly_request', errors);
  for (const field of ['assembly_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.assembly_request_version) || request.assembly_request_version < 1) errors.push('assembly_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateRequestAgentContractReference(request.agent_contract_reference).errors.map((error) => `agent_contract_reference_${error}`));
  errors.push(...validateSessionPolicyReference(request.policy_decision_reference).errors.map((error) => `policy_decision_reference_${error}`));
  errors.push(...validateRequestSessionReference(request.session_reference).errors.map((error) => `session_reference_${error}`));
  errors.push(...validateMemoryContractReference(request.memory_contract_reference).errors.map((error) => `memory_contract_reference_${error}`));
  errors.push(...validateRetrievalReference(request.memory_retrieval_reference).errors.map((error) => `memory_retrieval_reference_${error}`));
  errors.push(...validateSingleReference(request.task_profile_reference).errors.map((error) => `task_profile_reference_${error}`));
  errors.push(...validateModelSelectionDecisionReference(request.model_selection_decision_reference).errors.map((error) => `model_selection_decision_reference_${error}`));
  errors.push(...validateContextAssemblyPolicy(request.assembly_policy).errors.map((error) => `assembly_policy_${error}`));
  errors.push(...validateContextBudget(request.context_budget).errors.map((error) => `context_budget_${error}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((error) => `simulation_context_${error}`));

  if (!Array.isArray(request.source_references) || request.source_references.length > MAX_SOURCE_REFERENCES) {
    errors.push('source_references_invalid');
  } else {
    const seenIds = new Set();
    request.source_references.forEach((source, index) => {
      const validation = validateContextAssemblySourceReference(source);
      errors.push(...validation.errors.map((error) => `source_references[${index}]_${error}`));
      if (isPlainObject(source) && isNonEmptyString(source.source_reference_id)) {
        if (seenIds.has(source.source_reference_id)) errors.push(`source_references_duplicate::${source.source_reference_id}`);
        seenIds.add(source.source_reference_id);
      }
    });
  }

  if (request.validator_version !== CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ACCEPTABLE_MODEL_SELECTION_DECISION_STATUSES,
  CONTEXT_ASSEMBLY_REQUEST_FIELDS,
  CONTEXT_ASSEMBLY_REQUEST_VALIDATOR_VERSION,
  MAX_SOURCE_REFERENCES,
  MODEL_SELECTION_DECISION_REFERENCE_FIELDS,
  validateContextAssemblyRequest,
  validateModelSelectionDecisionReference
};

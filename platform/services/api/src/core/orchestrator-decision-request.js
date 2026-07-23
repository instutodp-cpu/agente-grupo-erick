'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateRequestSessionReference, validateSessionPolicyReference } = require('./agent-session-reference');
const {
  validateContextAssemblyResultReferenceMinimal,
  validateMemorySelectionDecisionReference,
  validateModelSelectionDecisionReferenceMinimal,
  validateToolDecisionReferenceList,
  validateWorkflowDecisionReferenceMinimal
} = require('./orchestrator-planning-request');
const { validateOrchestrationPlanReference, validatePlanningResultReference } = require('./orchestrator-plan-reference');
const { validateOrchestratorDecisionPolicy } = require('./orchestrator-decision-policy');

const ORCHESTRATOR_DECISION_REQUEST_VALIDATOR_VERSION = 'orchestrator_decision_request_validator_v1';

const ORCHESTRATOR_DECISION_REQUEST_FIELDS = Object.freeze([
  'decision_request_id', 'decision_request_version', 'planning_result_reference', 'orchestration_plan_reference',
  'policy_decision_reference', 'session_decision_reference', 'memory_selection_decision_reference',
  'context_assembly_result_reference', 'model_selection_decision_reference', 'tool_decision_references',
  'workflow_decision_reference', 'decision_policy', 'correlation_id', 'causation_id', 'trace_id',
  'logical_sequence', 'expected_registry_version', 'simulation_context', 'validator_version'
]);

function validateOrchestratorDecisionRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['decision_request_must_be_object'] };
  exactFields(request, ORCHESTRATOR_DECISION_REQUEST_FIELDS, 'decision_request', errors);
  for (const field of ['decision_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.decision_request_version) || request.decision_request_version < 1) errors.push('decision_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validatePlanningResultReference(request.planning_result_reference).errors.map((e) => `planning_result_reference_${e}`));
  errors.push(...validateOrchestrationPlanReference(request.orchestration_plan_reference).errors.map((e) => `orchestration_plan_reference_${e}`));
  errors.push(...validateSessionPolicyReference(request.policy_decision_reference).errors.map((e) => `policy_decision_reference_${e}`));
  errors.push(...validateRequestSessionReference(request.session_decision_reference).errors.map((e) => `session_decision_reference_${e}`));
  errors.push(...validateMemorySelectionDecisionReference(request.memory_selection_decision_reference).errors.map((e) => `memory_selection_decision_reference_${e}`));
  errors.push(...validateContextAssemblyResultReferenceMinimal(request.context_assembly_result_reference).errors.map((e) => `context_assembly_result_reference_${e}`));
  errors.push(...validateModelSelectionDecisionReferenceMinimal(request.model_selection_decision_reference).errors.map((e) => `model_selection_decision_reference_${e}`));
  errors.push(...validateToolDecisionReferenceList(request.tool_decision_references).errors);
  errors.push(...validateWorkflowDecisionReferenceMinimal(request.workflow_decision_reference).errors.map((e) => `workflow_decision_reference_${e}`));
  errors.push(...validateOrchestratorDecisionPolicy(request.decision_policy).errors.map((e) => `decision_policy_${e}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  if (request.validator_version !== ORCHESTRATOR_DECISION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  ORCHESTRATOR_DECISION_REQUEST_FIELDS,
  ORCHESTRATOR_DECISION_REQUEST_VALIDATOR_VERSION,
  validateOrchestratorDecisionRequest
};

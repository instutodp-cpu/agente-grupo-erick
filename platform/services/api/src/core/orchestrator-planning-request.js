'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const {
  validateRequestAgentContractReference,
  validateRequestSessionReference,
  validateSessionPolicyReference
} = require('./agent-session-reference');
const { COST_TIERS } = require('./model-contract');
const { validateOrchestratorTaskDefinition } = require('./orchestrator-task-definition');
const { validateOrchestratorPlanningPolicy } = require('./orchestrator-planning-policy');
const { validateOrchestratorPlanBudget } = require('./orchestrator-plan-budget');
const { validateOrchestratorPlanApproval } = require('./orchestrator-plan-approval');

const ORCHESTRATOR_PLANNING_REQUEST_VALIDATOR_VERSION = 'orchestrator_planning_request_validator_v1';
const DECISION_REFERENCE_VALIDATOR_VERSION = 'orchestrator_decision_reference_validator_v1';

const ORCHESTRATOR_PLANNING_REQUEST_FIELDS = Object.freeze([
  'planning_request_id', 'planning_request_version', 'orchestrator_request_reference', 'agent_contract_reference',
  'policy_decision_reference', 'session_decision_reference', 'memory_selection_decision_reference',
  'context_assembly_result_reference', 'model_selection_decision_reference', 'tool_decision_references',
  'workflow_decision_reference', 'task_definition', 'planning_policy', 'plan_budget', 'approval_context',
  'correlation_id', 'causation_id', 'trace_id', 'logical_sequence', 'expected_registry_version',
  'simulation_context', 'validator_version'
]);

const DECISION_REFERENCE_BASE_FIELDS = Object.freeze([
  'reference_id', 'reference_version', 'reference_fingerprint', 'tenant_id', 'organization_id', 'agent_id',
  'project_id', 'session_id', 'status', 'decision', 'blockers', 'simulation', 'production_blocked', 'executed',
  'operational_flags', 'validator_version'
]);

const MAX_LIST_ITEMS = 200;
const MAX_TOOL_DECISION_REFERENCES = 100;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

// A "decision reference" carries only the minimal declarative shape spec'd for this PR:
// id/version/fingerprint/tenant/organization/agent/project/session/status/decision/blockers/
// simulation flags, plus a small domain-specific `operational_flags` object -- never the
// full upstream contract. This single generic validator is reused (with different
// operational_flags configuration) for every domain this Planner consumes references from.
function validateDecisionReference(reference, config) {
  const { label, operationalFlagFields, fixedOperationalFlags = {}, extraFields = [], validateExtraFields } = config;
  const allowedFields = [...DECISION_REFERENCE_BASE_FIELDS, ...extraFields];
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: [`${label}_must_be_object`] };
  exactFields(reference, allowedFields, label, errors);
  for (const field of ['reference_id', 'reference_fingerprint', 'tenant_id', 'organization_id', 'status', 'decision', 'validator_version']) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(reference.reference_version) || reference.reference_version < 0) errors.push('reference_version_invalid');
  for (const field of ['agent_id', 'project_id', 'session_id']) {
    if (reference[field] !== null && !isNonEmptyString(reference[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!isOrderedUniqueStringList(reference.blockers)) errors.push('blockers_invalid');
  if (reference.simulation !== true) errors.push('simulation_must_be_true');
  if (reference.production_blocked !== true) errors.push('production_blocked_must_be_true');
  if (reference.executed !== false) errors.push('executed_must_be_false');
  if (!isPlainObject(reference.operational_flags)) {
    errors.push('operational_flags_must_be_object');
  } else {
    exactFields(reference.operational_flags, operationalFlagFields, `${label}_operational_flags`, errors);
    for (const field of operationalFlagFields) {
      if (typeof reference.operational_flags[field] !== 'boolean') errors.push(`operational_flags_${field}_must_be_boolean`);
    }
    for (const [field, expected] of Object.entries(fixedOperationalFlags)) {
      if (reference.operational_flags[field] !== expected) errors.push(`operational_flags_${field}_must_be_${String(expected)}`);
    }
  }
  if (typeof validateExtraFields === 'function') validateExtraFields(reference, errors);
  if (reference.validator_version !== DECISION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateOrchestratorRequestReference(reference) {
  return validateDecisionReference(reference, { label: 'orchestrator_request_reference', operationalFlagFields: [] });
}

const MEMORY_SELECTION_REFERENCE_OPERATIONAL_FLAGS = Object.freeze([
  'required_memory_preserved', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'pending_tasks_preserved', 'applicable_decisions_preserved'
]);
function validateMemorySelectionDecisionReference(reference) {
  return validateDecisionReference(reference, {
    label: 'memory_selection_decision_reference', operationalFlagFields: MEMORY_SELECTION_REFERENCE_OPERATIONAL_FLAGS
  });
}

const CONTEXT_ASSEMBLY_REFERENCE_OPERATIONAL_FLAGS = Object.freeze([
  'assembly_planned', 'context_assembled', 'content_loaded', 'prompt_generated'
]);
function validateContextAssemblyResultReferenceMinimal(reference) {
  return validateDecisionReference(reference, {
    label: 'context_assembly_result_reference',
    operationalFlagFields: CONTEXT_ASSEMBLY_REFERENCE_OPERATIONAL_FLAGS,
    fixedOperationalFlags: { context_assembled: false, content_loaded: false, prompt_generated: false }
  });
}

const MODEL_SELECTION_REFERENCE_OPERATIONAL_FLAGS = Object.freeze(['model_selected_in_simulation', 'deterministic_resolution_selected']);
function validateModelSelectionDecisionReferenceMinimal(reference) {
  return validateDecisionReference(reference, {
    label: 'model_selection_decision_reference',
    operationalFlagFields: MODEL_SELECTION_REFERENCE_OPERATIONAL_FLAGS,
    extraFields: ['selected_cost_tier'],
    validateExtraFields: (ref, errors) => {
      if (!COST_TIERS.includes(ref.selected_cost_tier)) errors.push(`selected_cost_tier_not_allowed::${ref.selected_cost_tier}`);
      if (
        isPlainObject(ref.operational_flags) && ref.operational_flags.deterministic_resolution_selected === true &&
        ref.operational_flags.model_selected_in_simulation === true
      ) {
        errors.push('deterministic_resolution_and_model_selected_are_mutually_exclusive');
      }
    }
  });
}

const TOOL_DECISION_REFERENCE_OPERATIONAL_FLAGS = Object.freeze(['tool_called', 'side_effect_free']);
function validateToolDecisionReferenceMinimal(reference) {
  return validateDecisionReference(reference, {
    label: 'tool_decision_reference',
    operationalFlagFields: TOOL_DECISION_REFERENCE_OPERATIONAL_FLAGS,
    fixedOperationalFlags: { tool_called: false }
  });
}

const WORKFLOW_DECISION_REFERENCE_OPERATIONAL_FLAGS = Object.freeze(['workflow_executed', 'step_executed']);
function validateWorkflowDecisionReferenceMinimal(reference) {
  return validateDecisionReference(reference, {
    label: 'workflow_decision_reference',
    operationalFlagFields: WORKFLOW_DECISION_REFERENCE_OPERATIONAL_FLAGS,
    fixedOperationalFlags: { workflow_executed: false, step_executed: false }
  });
}

function validateToolDecisionReferenceList(list, maxItems = MAX_TOOL_DECISION_REFERENCES) {
  if (!Array.isArray(list) || list.length > maxItems) return { valid: false, errors: ['tool_decision_references_invalid'] };
  const errors = [];
  const ids = new Set();
  list.forEach((reference, index) => {
    const validation = validateToolDecisionReferenceMinimal(reference);
    errors.push(...validation.errors.map((error) => `tool_decision_references[${index}]_${error}`));
    if (isPlainObject(reference) && isNonEmptyString(reference.reference_id)) {
      if (ids.has(reference.reference_id)) errors.push(`tool_decision_references_duplicate::${reference.reference_id}`);
      ids.add(reference.reference_id);
    }
  });
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function validateOrchestratorPlanningRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['planning_request_must_be_object'] };
  exactFields(request, ORCHESTRATOR_PLANNING_REQUEST_FIELDS, 'planning_request', errors);
  for (const field of ['planning_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.planning_request_version) || request.planning_request_version < 1) errors.push('planning_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateOrchestratorRequestReference(request.orchestrator_request_reference).errors.map((e) => `orchestrator_request_reference_${e}`));
  errors.push(...validateRequestAgentContractReference(request.agent_contract_reference).errors.map((e) => `agent_contract_reference_${e}`));
  errors.push(...validateSessionPolicyReference(request.policy_decision_reference).errors.map((e) => `policy_decision_reference_${e}`));
  errors.push(...validateRequestSessionReference(request.session_decision_reference).errors.map((e) => `session_decision_reference_${e}`));
  errors.push(...validateMemorySelectionDecisionReference(request.memory_selection_decision_reference).errors.map((e) => `memory_selection_decision_reference_${e}`));
  errors.push(...validateContextAssemblyResultReferenceMinimal(request.context_assembly_result_reference).errors.map((e) => `context_assembly_result_reference_${e}`));
  errors.push(...validateModelSelectionDecisionReferenceMinimal(request.model_selection_decision_reference).errors.map((e) => `model_selection_decision_reference_${e}`));
  errors.push(...validateToolDecisionReferenceList(request.tool_decision_references).errors);
  errors.push(...validateWorkflowDecisionReferenceMinimal(request.workflow_decision_reference).errors.map((e) => `workflow_decision_reference_${e}`));
  errors.push(...validateOrchestratorTaskDefinition(request.task_definition).errors.map((e) => `task_definition_${e}`));
  errors.push(...validateOrchestratorPlanningPolicy(request.planning_policy).errors.map((e) => `planning_policy_${e}`));
  errors.push(...validateOrchestratorPlanBudget(request.plan_budget).errors.map((e) => `plan_budget_${e}`));
  errors.push(...validateOrchestratorPlanApproval(request.approval_context).errors.map((e) => `approval_context_${e}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  if (request.validator_version !== ORCHESTRATOR_PLANNING_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  CONTEXT_ASSEMBLY_REFERENCE_OPERATIONAL_FLAGS,
  DECISION_REFERENCE_BASE_FIELDS,
  DECISION_REFERENCE_VALIDATOR_VERSION,
  MAX_TOOL_DECISION_REFERENCES,
  MEMORY_SELECTION_REFERENCE_OPERATIONAL_FLAGS,
  MODEL_SELECTION_REFERENCE_OPERATIONAL_FLAGS,
  ORCHESTRATOR_PLANNING_REQUEST_FIELDS,
  ORCHESTRATOR_PLANNING_REQUEST_VALIDATOR_VERSION,
  TOOL_DECISION_REFERENCE_OPERATIONAL_FLAGS,
  WORKFLOW_DECISION_REFERENCE_OPERATIONAL_FLAGS,
  isOrderedUniqueStringList,
  validateContextAssemblyResultReferenceMinimal,
  validateDecisionReference,
  validateMemorySelectionDecisionReference,
  validateModelSelectionDecisionReferenceMinimal,
  validateOrchestratorPlanningRequest,
  validateOrchestratorRequestReference,
  validateToolDecisionReferenceList,
  validateToolDecisionReferenceMinimal,
  validateWorkflowDecisionReferenceMinimal
};

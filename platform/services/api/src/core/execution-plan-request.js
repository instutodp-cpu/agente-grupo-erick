'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateOrchestrationPlanReference, validatePlanningResultReference } = require('./orchestrator-plan-reference');
const {
  validateContextAssemblyResultReferenceMinimal, validateMemorySelectionDecisionReference,
  validateModelSelectionDecisionReferenceMinimal, validateToolDecisionReferenceList,
  validateWorkflowDecisionReferenceMinimal
} = require('./orchestrator-planning-request');
const {
  validateEvidenceBundleReference, validateOrchestratorDecisionReference
} = require('./execution-authorization-request');
const { validateExecutionAuthorizationTaskReference } = require('./execution-authorization-task-reference');
const { AUTHORIZATION_DECISIONS, AUTHORIZATION_NEXT_STATES, AUTHORIZATION_STATUSES } = require('./execution-authorization-decision');
const { validateExecutionPlanBudget } = require('./execution-plan-budget');
const { validateExecutionPlanIdempotency } = require('./execution-plan-idempotency');
const { validateExecutionPlanStopCondition } = require('./execution-plan-stop-condition');
const { validateExecutionPlanCompensationReference } = require('./execution-plan-compensation-reference');

const EXECUTION_PLAN_REQUEST_VALIDATOR_VERSION = 'execution_plan_request_validator_v1';
const AUTHORIZATION_DECISION_REFERENCE_VALIDATOR_VERSION = 'execution_plan_authorization_decision_reference_validator_v1';
const EXECUTION_PLAN_POLICY_REFERENCE_VALIDATOR_VERSION = 'execution_plan_policy_reference_validator_v1';

const EXECUTION_PLAN_REQUEST_FIELDS = Object.freeze([
  'execution_plan_request_id', 'execution_plan_request_version', 'authorization_decision_reference',
  'orchestrator_decision_reference', 'readiness_evidence_bundle_reference', 'planning_result_reference',
  'orchestration_plan_reference', 'task_reference', 'memory_selection_reference', 'context_assembly_reference',
  'model_selection_reference', 'tool_decision_references', 'workflow_decision_reference',
  'execution_plan_policy_reference', 'execution_plan_budget', 'idempotency_policy_reference',
  'stop_condition_references', 'compensation_references', 'correlation_id', 'causation_id', 'trace_id',
  'logical_sequence', 'expected_registry_version', 'simulation_context', 'validator_version'
]);

// --- AuthorizationDecisionReference: a minimal, 23-field mirror of PR #97's AuthorizationDecision
// (70 fields) -- reuses its own AUTHORIZATION_STATUSES/AUTHORIZATION_DECISIONS/
// AUTHORIZATION_NEXT_STATES enums rather than redefining them.

const AUTHORIZATION_DECISION_REFERENCE_FIELDS = Object.freeze([
  'authorization_decision_id', 'authorization_request_id', 'authorization_decision_fingerprint',
  'decision_result_id', 'readiness_bundle_id', 'planning_result_id', 'plan_id', 'task_reference_id', 'agent_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'status', 'decision', 'next_state',
  'authorized_in_simulation', 'execution_authorized', 'execution_started', 'executed', 'simulation',
  'production_blocked', 'validator_version'
]);

const AUTHORIZATION_DECISION_REFERENCE_SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  execution_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

// The exact set of values PR #97's boundary must have produced for this PR to even consider
// preparing a plan -- see "Valores obrigatórios" in the spec.
const AUTHORIZATION_DECISION_READY_VALUES = Object.freeze({
  status: 'AUTHORIZED_SIMULATION',
  decision: 'AUTHORIZE_EXECUTION_REFERENCE_SIMULATION',
  next_state: 'EXECUTION_REFERENCE_AUTHORIZED_SIMULATION',
  authorized_in_simulation: true
});

function validateAuthorizationDecisionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['authorization_decision_reference_must_be_object'] };
  exactFields(reference, AUTHORIZATION_DECISION_REFERENCE_FIELDS, 'authorization_decision_reference', errors);
  for (const field of [
    'authorization_decision_id', 'authorization_request_id', 'authorization_decision_fingerprint',
    'decision_result_id', 'readiness_bundle_id', 'planning_result_id', 'plan_id', 'task_reference_id', 'agent_id',
    'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!AUTHORIZATION_STATUSES.includes(reference.status)) errors.push(`status_not_allowed::${reference.status}`);
  if (!AUTHORIZATION_DECISIONS.includes(reference.decision)) errors.push(`decision_not_allowed::${reference.decision}`);
  if (!AUTHORIZATION_NEXT_STATES.includes(reference.next_state)) errors.push(`next_state_not_allowed::${reference.next_state}`);
  if (typeof reference.authorized_in_simulation !== 'boolean') errors.push('authorized_in_simulation_must_be_boolean');
  for (const [field, expected] of Object.entries(AUTHORIZATION_DECISION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== AUTHORIZATION_DECISION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isAuthorizationDecisionReady(reference) {
  return isPlainObject(reference) && Object.entries(AUTHORIZATION_DECISION_READY_VALUES).every(([field, expected]) => reference[field] === expected);
}

function buildAuthorizationDecisionReference(input = {}) {
  const reference = {
    authorization_decision_id: input.authorization_decision_id,
    authorization_request_id: input.authorization_request_id,
    authorization_decision_fingerprint: input.authorization_decision_fingerprint,
    decision_result_id: input.decision_result_id,
    readiness_bundle_id: input.readiness_bundle_id,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    task_reference_id: input.task_reference_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    status: input.status,
    decision: input.decision,
    next_state: input.next_state,
    authorized_in_simulation: input.authorized_in_simulation === true,
    execution_authorized: false,
    execution_started: false,
    executed: false,
    simulation: true,
    production_blocked: true,
    validator_version: AUTHORIZATION_DECISION_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateAuthorizationDecisionReference(reference);
  if (!validation.valid) {
    throw new Error(`authorization_decision_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

// --- ExecutionPlanPolicyReference

const EXECUTION_PLAN_POLICY_REFERENCE_FIELDS = Object.freeze([
  'policy_reference_id', 'policy_reference_version', 'allow_no_llm_stage', 'allow_model_stage', 'allow_tool_stage',
  'allow_workflow_stage', 'allow_parallel_stage', 'allow_fallback_reference', 'allow_escalation_reference',
  'allow_compensation_reference', 'allow_external_side_effect_reference', 'allow_irreversible_reference',
  'require_authorized_simulation', 'require_ready_evidence', 'require_valid_bindings', 'require_budget_validation',
  'require_idempotency', 'require_stop_conditions', 'require_compensation_for_state_change',
  'fail_on_unknown_stage', 'fail_on_binding_mismatch', 'fail_on_budget_exceeded', 'fail_on_dependency_conflict',
  'fail_on_missing_idempotency', 'fail_on_missing_stop_condition', 'simulation', 'production_blocked',
  'validator_version'
]);

const ALLOW_FLAG_FIELDS = Object.freeze([
  'allow_no_llm_stage', 'allow_model_stage', 'allow_tool_stage', 'allow_workflow_stage', 'allow_parallel_stage',
  'allow_fallback_reference', 'allow_escalation_reference', 'allow_compensation_reference',
  'allow_external_side_effect_reference', 'allow_irreversible_reference'
]);

const REQUIRE_FLAG_FIELDS = Object.freeze([
  'require_authorized_simulation', 'require_ready_evidence', 'require_valid_bindings', 'require_budget_validation',
  'require_idempotency', 'require_stop_conditions', 'require_compensation_for_state_change'
]);

const FAIL_ON_FLAG_FIELDS = Object.freeze([
  'fail_on_unknown_stage', 'fail_on_binding_mismatch', 'fail_on_budget_exceeded', 'fail_on_dependency_conflict',
  'fail_on_missing_idempotency', 'fail_on_missing_stop_condition'
]);

const EXECUTION_PLAN_POLICY_REFERENCE_SAFE_FLAGS = Object.freeze({
  require_authorized_simulation: true,
  require_ready_evidence: true,
  require_valid_bindings: true,
  require_budget_validation: true,
  require_idempotency: true,
  require_stop_conditions: true,
  fail_on_unknown_stage: true,
  fail_on_binding_mismatch: true,
  fail_on_budget_exceeded: true,
  fail_on_dependency_conflict: true,
  fail_on_missing_idempotency: true,
  fail_on_missing_stop_condition: true,
  allow_external_side_effect_reference: false,
  allow_irreversible_reference: false,
  simulation: true,
  production_blocked: true
});

function validateExecutionPlanPolicyReference(policy) {
  const errors = [];
  if (!isPlainObject(policy)) return { valid: false, errors: ['execution_plan_policy_reference_must_be_object'] };
  exactFields(policy, EXECUTION_PLAN_POLICY_REFERENCE_FIELDS, 'execution_plan_policy_reference', errors);
  for (const field of ['policy_reference_id', 'validator_version']) {
    if (!isNonEmptyString(policy[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(policy.policy_reference_version) || policy.policy_reference_version < 1) errors.push('policy_reference_version_invalid');
  for (const field of [...ALLOW_FLAG_FIELDS, ...REQUIRE_FLAG_FIELDS, ...FAIL_ON_FLAG_FIELDS]) {
    if (typeof policy[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_POLICY_REFERENCE_SAFE_FLAGS)) {
    if (policy[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (policy.validator_version !== EXECUTION_PLAN_POLICY_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(policy);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(policy));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionPlanPolicyReference(input = {}) {
  const policy = {
    policy_reference_id: input.policy_reference_id,
    policy_reference_version: Number.isInteger(input.policy_reference_version) ? input.policy_reference_version : 1,
    allow_no_llm_stage: input.allow_no_llm_stage !== false,
    allow_model_stage: input.allow_model_stage !== false,
    allow_tool_stage: input.allow_tool_stage !== false,
    allow_workflow_stage: input.allow_workflow_stage !== false,
    allow_parallel_stage: input.allow_parallel_stage !== false,
    allow_fallback_reference: input.allow_fallback_reference === true,
    allow_escalation_reference: input.allow_escalation_reference === true,
    allow_compensation_reference: input.allow_compensation_reference !== false,
    require_compensation_for_state_change: input.require_compensation_for_state_change !== false,
    ...EXECUTION_PLAN_POLICY_REFERENCE_SAFE_FLAGS,
    validator_version: EXECUTION_PLAN_POLICY_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateExecutionPlanPolicyReference(policy);
  if (!validation.valid) {
    throw new Error(`execution_plan_policy_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(policy);
}

// --- ExecutionPlanRequest

const MAX_LIST_ITEMS = 50;

function validateExecutionPlanRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['execution_plan_request_must_be_object'] };
  exactFields(request, EXECUTION_PLAN_REQUEST_FIELDS, 'execution_plan_request', errors);
  for (const field of ['execution_plan_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.execution_plan_request_version) || request.execution_plan_request_version < 1) errors.push('execution_plan_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateAuthorizationDecisionReference(request.authorization_decision_reference).errors.map((e) => `authorization_decision_reference_${e}`));
  errors.push(...validateOrchestratorDecisionReference(request.orchestrator_decision_reference).errors.map((e) => `orchestrator_decision_reference_${e}`));
  errors.push(...validateEvidenceBundleReference(request.readiness_evidence_bundle_reference).errors.map((e) => `readiness_evidence_bundle_reference_${e}`));
  errors.push(...validatePlanningResultReference(request.planning_result_reference).errors.map((e) => `planning_result_reference_${e}`));
  errors.push(...validateOrchestrationPlanReference(request.orchestration_plan_reference).errors.map((e) => `orchestration_plan_reference_${e}`));
  errors.push(...validateExecutionAuthorizationTaskReference(request.task_reference).errors.map((e) => `task_reference_${e}`));
  errors.push(...validateMemorySelectionDecisionReference(request.memory_selection_reference).errors.map((e) => `memory_selection_reference_${e}`));
  errors.push(...validateContextAssemblyResultReferenceMinimal(request.context_assembly_reference).errors.map((e) => `context_assembly_reference_${e}`));
  errors.push(...validateModelSelectionDecisionReferenceMinimal(request.model_selection_reference).errors.map((e) => `model_selection_reference_${e}`));
  errors.push(...validateToolDecisionReferenceList(request.tool_decision_references).errors);
  errors.push(...validateWorkflowDecisionReferenceMinimal(request.workflow_decision_reference).errors.map((e) => `workflow_decision_reference_${e}`));
  errors.push(...validateExecutionPlanPolicyReference(request.execution_plan_policy_reference).errors.map((e) => `execution_plan_policy_reference_${e}`));
  errors.push(...validateExecutionPlanBudget(request.execution_plan_budget).errors.map((e) => `execution_plan_budget_${e}`));
  errors.push(...validateExecutionPlanIdempotency(request.idempotency_policy_reference).errors.map((e) => `idempotency_policy_reference_${e}`));

  if (!Array.isArray(request.stop_condition_references) || request.stop_condition_references.length > MAX_LIST_ITEMS) {
    errors.push('stop_condition_references_invalid');
  } else {
    request.stop_condition_references.forEach((condition, index) => {
      errors.push(...validateExecutionPlanStopCondition(condition).errors.map((e) => `stop_condition_references[${index}]_${e}`));
    });
  }
  if (!Array.isArray(request.compensation_references) || request.compensation_references.length > MAX_LIST_ITEMS) {
    errors.push('compensation_references_invalid');
  } else {
    request.compensation_references.forEach((reference, index) => {
      errors.push(...validateExecutionPlanCompensationReference(reference).errors.map((e) => `compensation_references[${index}]_${e}`));
    });
  }

  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  if (request.validator_version !== EXECUTION_PLAN_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  AUTHORIZATION_DECISION_READY_VALUES,
  AUTHORIZATION_DECISION_REFERENCE_FIELDS,
  AUTHORIZATION_DECISION_REFERENCE_SAFE_FLAGS,
  AUTHORIZATION_DECISION_REFERENCE_VALIDATOR_VERSION,
  ALLOW_FLAG_FIELDS,
  EXECUTION_PLAN_POLICY_REFERENCE_FIELDS,
  EXECUTION_PLAN_POLICY_REFERENCE_SAFE_FLAGS,
  EXECUTION_PLAN_POLICY_REFERENCE_VALIDATOR_VERSION,
  EXECUTION_PLAN_REQUEST_FIELDS,
  EXECUTION_PLAN_REQUEST_VALIDATOR_VERSION,
  FAIL_ON_FLAG_FIELDS,
  MAX_LIST_ITEMS,
  REQUIRE_FLAG_FIELDS,
  buildAuthorizationDecisionReference,
  buildExecutionPlanPolicyReference,
  isAuthorizationDecisionReady,
  validateAuthorizationDecisionReference,
  validateExecutionPlanPolicyReference,
  validateExecutionPlanRequest
};

'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_PLANNING_RESULT_VALIDATOR_VERSION = 'orchestrator_planning_result_validator_v1';
const NOT_AVAILABLE_REFERENCE = 'reference_not_available';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const ORCHESTRATOR_PLANNING_RESULT_FIELDS = Object.freeze([
  'result_id', 'planning_request_id', 'orchestration_request_id', 'agent_id', 'tenant_id', 'organization_id',
  'project_id', 'session_reference_id', 'status', 'decision', 'plan_id', 'stage_ids', 'dependency_ids',
  'approval_stage_ids', 'selected_model_reference_ids', 'selected_tool_reference_ids',
  'selected_workflow_reference_ids', 'required_memory_reference_ids', 'context_reference_ids',
  'success_criteria_ids', 'request_fingerprint', 'task_fingerprint', 'policy_fingerprint', 'budget_fingerprint',
  'plan_fingerprint', 'registry_version', 'stage_count', 'parallel_stage_count', 'model_stage_count',
  'tool_stage_count', 'workflow_stage_count', 'approval_stage_count', 'estimated_total_tokens',
  'estimated_total_cost_minor_units', 'blockers', 'reason_codes', 'request_validated', 'bindings_validated',
  'memory_preserved', 'continuity_preserved', 'project_state_preserved', 'policy_validated', 'budget_validated',
  'plan_generated', 'plan_executed', 'agent_executed', 'tool_called', 'workflow_executed', 'provider_called',
  'model_called', 'network_used', 'tokens_consumed', 'cost_consumed', 'fallback_executed', 'escalation_executed',
  'runtime_enabled', 'executed', 'simulation', 'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RESULT_STATUSES = Object.freeze([
  'PLAN_READY_SIMULATION', 'APPROVAL_REQUIRED_SIMULATION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'POLICY_BLOCKED', 'MEMORY_BLOCKED',
  'CONTEXT_BLOCKED', 'MODEL_SELECTION_BLOCKED', 'TOOL_BLOCKED', 'WORKFLOW_BLOCKED', 'BUDGET_BLOCKED',
  'APPROVAL_BLOCKED', 'DEPENDENCY_BLOCKED', 'CONFLICT_BLOCKED', 'VERSION_BLOCKED'
]);
const PLAN_GENERATED_STATUSES = Object.freeze(['PLAN_READY_SIMULATION', 'APPROVAL_REQUIRED_SIMULATION']);
const RESULT_DECISIONS = Object.freeze(['GENERATE_ORCHESTRATION_PLAN', 'GENERATE_APPROVAL_PLAN', 'BLOCKED']);

const REFERENCE_ID_LIST_FIELDS = Object.freeze([
  'stage_ids', 'dependency_ids', 'approval_stage_ids', 'selected_model_reference_ids',
  'selected_tool_reference_ids', 'selected_workflow_reference_ids', 'required_memory_reference_ids',
  'context_reference_ids', 'success_criteria_ids'
]);

const COUNT_FIELDS = Object.freeze([
  'stage_count', 'parallel_stage_count', 'model_stage_count', 'tool_stage_count', 'workflow_stage_count',
  'approval_stage_count'
]);

const PRESERVATION_VALIDATION_FIELDS_FOR_PLANNED = Object.freeze([
  'memory_preserved', 'continuity_preserved', 'project_state_preserved', 'policy_validated', 'budget_validated'
]);

const BOOLEAN_VALIDATION_FIELDS = Object.freeze([
  'request_validated', 'bindings_validated', 'memory_preserved', 'continuity_preserved', 'project_state_preserved',
  'policy_validated', 'budget_validated'
]);

const ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS = Object.freeze({
  plan_executed: false,
  agent_executed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  tokens_consumed: false,
  cost_consumed: false,
  fallback_executed: false,
  escalation_executed: false,
  runtime_enabled: false,
  executed: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

const MAX_LIST_ITEMS = 500;
const MAX_COUNT = 500;
const MAX_TOKENS_REFERENCE = 100000000;
const MAX_COST_MINOR_UNITS = 100000000;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorPlanningResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['planning_result_must_be_object'] };
  exactFields(result, ORCHESTRATOR_PLANNING_RESULT_FIELDS, 'planning_result', errors);
  for (const field of [
    'result_id', 'planning_request_id', 'orchestration_request_id', 'agent_id', 'tenant_id', 'organization_id',
    'project_id', 'session_reference_id', 'plan_id', 'request_fingerprint', 'task_fingerprint', 'policy_fingerprint',
    'budget_fingerprint', 'plan_fingerprint', 'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (!RESULT_DECISIONS.includes(result.decision)) errors.push(`decision_not_allowed::${result.decision}`);
  for (const field of REFERENCE_ID_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(result[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(result.estimated_total_tokens) || result.estimated_total_tokens < 0 || result.estimated_total_tokens > MAX_TOKENS_REFERENCE) {
    errors.push('estimated_total_tokens_invalid');
  }
  if (
    !Number.isInteger(result.estimated_total_cost_minor_units) || result.estimated_total_cost_minor_units < 0 ||
    result.estimated_total_cost_minor_units > MAX_COST_MINOR_UNITS
  ) {
    errors.push('estimated_total_cost_minor_units_invalid');
  }
  if (!isOrderedUniqueStringList(result.blockers)) errors.push('blockers_invalid');
  if (!isOrderedUniqueStringList(result.reason_codes)) errors.push('reason_codes_invalid');
  for (const field of BOOLEAN_VALIDATION_FIELDS) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof result.plan_generated !== 'boolean') errors.push('plan_generated_must_be_boolean');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  const shouldBeGenerated = PLAN_GENERATED_STATUSES.includes(result.status);
  if (result.plan_generated !== shouldBeGenerated) {
    errors.push(shouldBeGenerated ? 'plan_generated_must_be_true_for_planned_status' : 'plan_generated_must_be_false_unless_planned');
  }
  if (shouldBeGenerated) {
    for (const field of PRESERVATION_VALIDATION_FIELDS_FOR_PLANNED) {
      if (result[field] !== true) errors.push(`${field}_must_be_true_for_planned_status`);
    }
  }
  if (result.status === 'PLAN_READY_SIMULATION') {
    if (result.decision !== 'GENERATE_ORCHESTRATION_PLAN') errors.push('decision_must_be_generate_orchestration_plan');
  } else if (result.status === 'APPROVAL_REQUIRED_SIMULATION') {
    if (result.decision !== 'GENERATE_APPROVAL_PLAN') errors.push('decision_must_be_generate_approval_plan');
  } else if (result.decision !== 'BLOCKED') {
    errors.push('decision_must_be_blocked');
  }
  if (!shouldBeGenerated && result.plan_id !== NOT_AVAILABLE_REFERENCE) errors.push('plan_id_must_be_sentinel_unless_planned');

  if (result.validator_version !== ORCHESTRATOR_PLANNING_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorPlanningResult(overrides = {}) {
  const status = RESULT_STATUSES.includes(overrides.status) ? overrides.status : 'VALIDATION_FAILED';
  const isGenerated = PLAN_GENERATED_STATUSES.includes(status);
  const decision = status === 'PLAN_READY_SIMULATION' ? 'GENERATE_ORCHESTRATION_PLAN'
    : status === 'APPROVAL_REQUIRED_SIMULATION' ? 'GENERATE_APPROVAL_PLAN' : 'BLOCKED';

  const result = {
    result_id: overrides.result_id || 'planning_result_not_available',
    planning_request_id: overrides.planning_request_id || 'planning_request_not_available',
    orchestration_request_id: overrides.orchestration_request_id || 'orchestration_request_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    project_id: overrides.project_id || 'project_not_available',
    session_reference_id: overrides.session_reference_id || 'session_not_available',
    status,
    decision,
    plan_id: isGenerated ? (overrides.plan_id || NOT_AVAILABLE_REFERENCE) : NOT_AVAILABLE_REFERENCE,
    stage_ids: Array.isArray(overrides.stage_ids) ? uniqueSorted(overrides.stage_ids) : [],
    dependency_ids: Array.isArray(overrides.dependency_ids) ? uniqueSorted(overrides.dependency_ids) : [],
    approval_stage_ids: Array.isArray(overrides.approval_stage_ids) ? uniqueSorted(overrides.approval_stage_ids) : [],
    selected_model_reference_ids: Array.isArray(overrides.selected_model_reference_ids) ? uniqueSorted(overrides.selected_model_reference_ids) : [],
    selected_tool_reference_ids: Array.isArray(overrides.selected_tool_reference_ids) ? uniqueSorted(overrides.selected_tool_reference_ids) : [],
    selected_workflow_reference_ids: Array.isArray(overrides.selected_workflow_reference_ids) ? uniqueSorted(overrides.selected_workflow_reference_ids) : [],
    required_memory_reference_ids: Array.isArray(overrides.required_memory_reference_ids) ? uniqueSorted(overrides.required_memory_reference_ids) : [],
    context_reference_ids: Array.isArray(overrides.context_reference_ids) ? uniqueSorted(overrides.context_reference_ids) : [],
    success_criteria_ids: Array.isArray(overrides.success_criteria_ids) ? uniqueSorted(overrides.success_criteria_ids) : [],
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    task_fingerprint: overrides.task_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: overrides.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    budget_fingerprint: overrides.budget_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: isGenerated ? (overrides.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT) : NOT_AVAILABLE_FINGERPRINT,
    registry_version: overrides.registry_version || 'registry_version_not_available',
    stage_count: Number.isInteger(overrides.stage_count) ? overrides.stage_count : 0,
    parallel_stage_count: Number.isInteger(overrides.parallel_stage_count) ? overrides.parallel_stage_count : 0,
    model_stage_count: Number.isInteger(overrides.model_stage_count) ? overrides.model_stage_count : 0,
    tool_stage_count: Number.isInteger(overrides.tool_stage_count) ? overrides.tool_stage_count : 0,
    workflow_stage_count: Number.isInteger(overrides.workflow_stage_count) ? overrides.workflow_stage_count : 0,
    approval_stage_count: Number.isInteger(overrides.approval_stage_count) ? overrides.approval_stage_count : 0,
    estimated_total_tokens: Number.isInteger(overrides.estimated_total_tokens) ? overrides.estimated_total_tokens : 0,
    estimated_total_cost_minor_units: Number.isInteger(overrides.estimated_total_cost_minor_units) ? overrides.estimated_total_cost_minor_units : 0,
    blockers: Array.isArray(overrides.blockers) ? uniqueSorted(overrides.blockers) : [],
    reason_codes: Array.isArray(overrides.reason_codes) ? uniqueSorted(overrides.reason_codes) : [],
    request_validated: overrides.request_validated === true,
    bindings_validated: overrides.bindings_validated === true,
    memory_preserved: isGenerated ? true : overrides.memory_preserved === true,
    continuity_preserved: isGenerated ? true : overrides.continuity_preserved === true,
    project_state_preserved: isGenerated ? true : overrides.project_state_preserved === true,
    policy_validated: isGenerated ? true : overrides.policy_validated === true,
    budget_validated: isGenerated ? true : overrides.budget_validated === true,
    plan_generated: isGenerated,
    validator_version: ORCHESTRATOR_PLANNING_RESULT_VALIDATOR_VERSION,
    ...ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS
  };

  const validation = validateOrchestratorPlanningResult(result);
  if (!validation.valid) {
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: 'BLOCKED',
      plan_id: NOT_AVAILABLE_REFERENCE,
      plan_fingerprint: NOT_AVAILABLE_FINGERPRINT,
      plan_generated: false,
      memory_preserved: overrides.memory_preserved === true,
      continuity_preserved: overrides.continuity_preserved === true,
      project_state_preserved: overrides.project_state_preserved === true,
      policy_validated: overrides.policy_validated === true,
      budget_validated: overrides.budget_validated === true,
      blockers: uniqueSorted([...result.blockers, ...validation.errors]),
      reason_codes: uniqueSorted([...result.reason_codes, validation.errors[0] || 'planning_result_invalid']),
      ...ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  COUNT_FIELDS,
  MAX_COST_MINOR_UNITS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_TOKENS_REFERENCE,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_REFERENCE,
  ORCHESTRATOR_PLANNING_RESULT_FIELDS,
  ORCHESTRATOR_PLANNING_RESULT_SAFE_FLAGS,
  ORCHESTRATOR_PLANNING_RESULT_VALIDATOR_VERSION,
  PLAN_GENERATED_STATUSES,
  PRESERVATION_VALIDATION_FIELDS_FOR_PLANNED,
  REFERENCE_ID_LIST_FIELDS,
  RESULT_DECISIONS,
  RESULT_STATUSES,
  buildOrchestratorPlanningResult,
  isOrderedUniqueStringList,
  validateOrchestratorPlanningResult
};

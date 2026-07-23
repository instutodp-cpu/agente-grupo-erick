'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const EXECUTION_PLAN_CONTRACT_VALIDATOR_VERSION = 'execution_plan_contract_validator_v1';

const EXECUTION_PLAN_CONTRACT_FIELDS = Object.freeze([
  'execution_plan_id', 'execution_plan_version', 'execution_plan_status', 'authorization_decision_id',
  'orchestrator_decision_id', 'planning_result_id', 'orchestration_plan_id', 'task_reference_id', 'agent_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'ordered_stage_ids', 'dependency_ids',
  'stage_binding_ids', 'stop_condition_ids', 'compensation_reference_ids', 'memory_selection_reference_id',
  'context_assembly_reference_id', 'model_selection_reference_id', 'tool_reference_ids', 'workflow_reference_id',
  'budget_reference_id', 'idempotency_reference_id', 'execution_scope_reference_id', 'authorization_fingerprint',
  'orchestrator_decision_fingerprint', 'readiness_bundle_fingerprint', 'planning_result_fingerprint',
  'orchestration_plan_fingerprint', 'task_fingerprint', 'memory_fingerprint', 'context_fingerprint',
  'model_fingerprint', 'tool_fingerprints', 'workflow_fingerprint', 'budget_fingerprint',
  'idempotency_fingerprint', 'plan_fingerprint', 'logical_sequence', 'execution_plan_prepared', 'executable',
  'execution_authorized', 'execution_started', 'executed', 'runtime_enabled', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const EXECUTION_PLAN_STATUSES = Object.freeze([
  'PREPARED_SIMULATION', 'WAITING_APPROVAL_REFERENCE', 'BLOCKED', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'TASK_BLOCKED', 'AUTHORIZATION_BLOCKED',
  'EVIDENCE_BLOCKED', 'MEMORY_BLOCKED', 'CONTEXT_BLOCKED', 'MODEL_BLOCKED', 'TOOL_BLOCKED', 'WORKFLOW_BLOCKED',
  'BUDGET_BLOCKED', 'DEPENDENCY_BLOCKED', 'IDEMPOTENCY_BLOCKED', 'STOP_CONDITION_BLOCKED', 'COMPENSATION_BLOCKED',
  'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED'
]);

const NULLABLE_REFERENCE_ID_FIELDS = Object.freeze(['model_selection_reference_id', 'workflow_reference_id', 'model_fingerprint', 'workflow_fingerprint']);

const ORDERED_LIST_FIELDS = Object.freeze([
  'ordered_stage_ids', 'dependency_ids', 'stage_binding_ids', 'stop_condition_ids', 'compensation_reference_ids',
  'tool_reference_ids', 'tool_fingerprints'
]);

const FINGERPRINT_FIELDS = Object.freeze([
  'authorization_fingerprint', 'orchestrator_decision_fingerprint', 'readiness_bundle_fingerprint',
  'planning_result_fingerprint', 'orchestration_plan_fingerprint', 'task_fingerprint', 'memory_fingerprint',
  'context_fingerprint', 'budget_fingerprint', 'idempotency_fingerprint', 'plan_fingerprint'
]);

// executable is never true in this PR regardless of status -- "Nenhum status deve permitir
// executable=true nesta PR."
const EXECUTION_PLAN_CONTRACT_SAFE_FLAGS = Object.freeze({
  executable: false,
  execution_authorized: false,
  execution_started: false,
  executed: false,
  runtime_enabled: false,
  simulation: true,
  production_blocked: true,
  rollout_percentage: 0
});

const MAX_LIST_ITEMS = 500;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateExecutionPlanContract(plan) {
  const errors = [];
  if (!isPlainObject(plan)) return { valid: false, errors: ['execution_plan_contract_must_be_object'] };
  exactFields(plan, EXECUTION_PLAN_CONTRACT_FIELDS, 'execution_plan_contract', errors);
  for (const field of [
    'execution_plan_id', 'authorization_decision_id', 'orchestrator_decision_id', 'planning_result_id',
    'orchestration_plan_id', 'task_reference_id', 'agent_id', 'tenant_id', 'organization_id', 'project_id',
    'session_reference_id', 'memory_selection_reference_id', 'context_assembly_reference_id', 'budget_reference_id',
    'idempotency_reference_id', 'execution_scope_reference_id', 'validator_version', ...FINGERPRINT_FIELDS
  ]) {
    if (!isNonEmptyString(plan[field])) errors.push(`${field}_invalid`);
  }
  for (const field of ['model_selection_reference_id', 'workflow_reference_id', 'model_fingerprint', 'workflow_fingerprint']) {
    if (plan[field] !== null && !isNonEmptyString(plan[field])) errors.push(`${field}_must_be_null_or_string`);
  }
  if (!Number.isInteger(plan.execution_plan_version) || plan.execution_plan_version < 1) errors.push('execution_plan_version_invalid');
  if (!EXECUTION_PLAN_STATUSES.includes(plan.execution_plan_status)) errors.push(`execution_plan_status_not_allowed::${plan.execution_plan_status}`);
  for (const field of ORDERED_LIST_FIELDS) {
    if (!isOrderedUniqueStringList(plan[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(plan.logical_sequence) || plan.logical_sequence < 0) errors.push('logical_sequence_invalid');
  if (typeof plan.execution_plan_prepared !== 'boolean') errors.push('execution_plan_prepared_must_be_boolean');
  for (const [field, expected] of Object.entries(EXECUTION_PLAN_CONTRACT_SAFE_FLAGS)) {
    if (plan[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  if (plan.execution_plan_status === 'PREPARED_SIMULATION' && plan.execution_plan_prepared !== true) {
    errors.push('execution_plan_prepared_must_be_true_when_prepared_simulation');
  }
  if (plan.execution_plan_status !== 'PREPARED_SIMULATION' && plan.execution_plan_prepared !== false) {
    errors.push('execution_plan_prepared_must_be_false_unless_prepared_simulation');
  }

  if (plan.validator_version !== EXECUTION_PLAN_CONTRACT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(plan);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(plan));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildExecutionPlanContract(input = {}) {
  const status = EXECUTION_PLAN_STATUSES.includes(input.execution_plan_status) ? input.execution_plan_status : 'VALIDATION_FAILED';
  const plan = {
    execution_plan_id: input.execution_plan_id,
    execution_plan_version: Number.isInteger(input.execution_plan_version) ? input.execution_plan_version : 1,
    execution_plan_status: status,
    authorization_decision_id: input.authorization_decision_id,
    orchestrator_decision_id: input.orchestrator_decision_id,
    planning_result_id: input.planning_result_id,
    orchestration_plan_id: input.orchestration_plan_id,
    task_reference_id: input.task_reference_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    ordered_stage_ids: uniqueSorted(input.ordered_stage_ids || []),
    dependency_ids: uniqueSorted(input.dependency_ids || []),
    stage_binding_ids: uniqueSorted(input.stage_binding_ids || []),
    stop_condition_ids: uniqueSorted(input.stop_condition_ids || []),
    compensation_reference_ids: uniqueSorted(input.compensation_reference_ids || []),
    memory_selection_reference_id: input.memory_selection_reference_id,
    context_assembly_reference_id: input.context_assembly_reference_id,
    model_selection_reference_id: input.model_selection_reference_id === undefined ? null : input.model_selection_reference_id,
    tool_reference_ids: uniqueSorted(input.tool_reference_ids || []),
    workflow_reference_id: input.workflow_reference_id === undefined ? null : input.workflow_reference_id,
    budget_reference_id: input.budget_reference_id,
    idempotency_reference_id: input.idempotency_reference_id,
    execution_scope_reference_id: input.execution_scope_reference_id,
    authorization_fingerprint: input.authorization_fingerprint,
    orchestrator_decision_fingerprint: input.orchestrator_decision_fingerprint,
    readiness_bundle_fingerprint: input.readiness_bundle_fingerprint,
    planning_result_fingerprint: input.planning_result_fingerprint,
    orchestration_plan_fingerprint: input.orchestration_plan_fingerprint,
    task_fingerprint: input.task_fingerprint,
    memory_fingerprint: input.memory_fingerprint,
    context_fingerprint: input.context_fingerprint,
    model_fingerprint: input.model_fingerprint === undefined ? null : input.model_fingerprint,
    tool_fingerprints: uniqueSorted(input.tool_fingerprints || []),
    workflow_fingerprint: input.workflow_fingerprint === undefined ? null : input.workflow_fingerprint,
    budget_fingerprint: input.budget_fingerprint,
    idempotency_fingerprint: input.idempotency_fingerprint,
    plan_fingerprint: input.plan_fingerprint,
    logical_sequence: Number.isInteger(input.logical_sequence) ? input.logical_sequence : 0,
    execution_plan_prepared: status === 'PREPARED_SIMULATION',
    executable: false,
    execution_authorized: false,
    execution_started: false,
    executed: false,
    runtime_enabled: false,
    simulation: true,
    production_blocked: true,
    rollout_percentage: 0,
    validator_version: EXECUTION_PLAN_CONTRACT_VALIDATOR_VERSION
  };

  const validation = validateExecutionPlanContract(plan);
  if (!validation.valid) {
    throw new Error(`execution_plan_contract_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(plan);
}

module.exports = {
  EXECUTION_PLAN_CONTRACT_FIELDS,
  EXECUTION_PLAN_CONTRACT_SAFE_FLAGS,
  EXECUTION_PLAN_CONTRACT_VALIDATOR_VERSION,
  EXECUTION_PLAN_STATUSES,
  FINGERPRINT_FIELDS,
  MAX_LIST_ITEMS,
  NULLABLE_REFERENCE_ID_FIELDS,
  ORDERED_LIST_FIELDS,
  buildExecutionPlanContract,
  isOrderedUniqueStringList,
  validateExecutionPlanContract
};

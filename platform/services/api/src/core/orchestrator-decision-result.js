'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const ORCHESTRATOR_DECISION_RESULT_VALIDATOR_VERSION = 'orchestrator_decision_result_validator_v1';
const NOT_AVAILABLE_REFERENCE = 'reference_not_available';
const NOT_AVAILABLE_FINGERPRINT = 'fingerprint_not_available';

const ORCHESTRATOR_DECISION_RESULT_FIELDS = Object.freeze([
  'result_id', 'decision_request_id', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id', 'organization_id',
  'project_id', 'session_reference_id', 'status', 'decision', 'next_state', 'readiness_id', 'blocker_ids',
  'warning_ids', 'approval_reference_ids', 'resolution_reference_types', 'request_fingerprint',
  'planning_result_fingerprint', 'plan_fingerprint', 'policy_fingerprint', 'memory_fingerprint',
  'context_fingerprint', 'model_selection_fingerprint', 'tool_fingerprints', 'workflow_fingerprint',
  'decision_fingerprint', 'registry_version', 'blocking_count', 'warning_count', 'critical_count',
  'readiness_score', 'request_validated', 'planning_validated', 'bindings_validated', 'policy_validated',
  'memory_validated', 'preferences_preserved', 'project_state_preserved', 'continuity_preserved',
  'context_validated', 'model_selection_validated', 'tools_validated', 'workflow_validated', 'budget_validated',
  'dependencies_validated', 'approvals_validated', 'decision_evaluated', 'ready_in_simulation', 'approval_required',
  'execution_authorized', 'execution_started', 'agent_executed', 'tool_called', 'workflow_executed',
  'provider_called', 'model_called', 'network_used', 'memory_read', 'memory_written', 'tokens_consumed',
  'cost_consumed', 'fallback_executed', 'escalation_executed', 'runtime_enabled', 'executed', 'simulation',
  'production_blocked', 'rollout_percentage', 'validator_version'
]);

const RESULT_STATUSES = Object.freeze([
  'READY_SIMULATION', 'WAITING_APPROVAL_SIMULATION', 'WAITING_MEMORY_REFERENCE', 'WAITING_CONTEXT_REFERENCE',
  'WAITING_MODEL_REFERENCE', 'WAITING_TOOL_REFERENCE', 'WAITING_WORKFLOW_REFERENCE', 'WAITING_BUDGET_REFERENCE',
  'WAITING_DEPENDENCY_REFERENCE', 'WAITING_CONFLICT_RESOLUTION', 'DENY', 'VALIDATION_FAILED', 'TENANT_BLOCKED',
  'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED', 'POLICY_BLOCKED', 'MEMORY_BLOCKED',
  'CONTEXT_BLOCKED', 'MODEL_BLOCKED', 'TOOL_BLOCKED', 'WORKFLOW_BLOCKED', 'BUDGET_BLOCKED', 'DEPENDENCY_BLOCKED',
  'APPROVAL_BLOCKED', 'FINGERPRINT_BLOCKED', 'VERSION_BLOCKED', 'CONFLICT_BLOCKED'
]);

const RESULT_DECISIONS = Object.freeze([
  'AUTHORIZE_PLAN_SIMULATION', 'REQUEST_HUMAN_APPROVAL', 'REQUEST_MEMORY_RESELECTION',
  'REQUEST_CONTEXT_REASSEMBLY', 'REQUEST_MODEL_RESELECTION', 'REQUEST_TOOL_REVIEW', 'REQUEST_WORKFLOW_REVIEW',
  'REQUEST_BUDGET_REVIEW', 'REQUEST_DEPENDENCY_REVIEW', 'REQUEST_CONFLICT_RESOLUTION', 'BLOCKED'
]);

const NEXT_STATES = Object.freeze([
  'PLAN_READY_REFERENCE', 'WAITING_APPROVAL_REFERENCE', 'WAITING_MEMORY_REFERENCE', 'WAITING_CONTEXT_REFERENCE',
  'WAITING_MODEL_REFERENCE', 'WAITING_TOOL_REFERENCE', 'WAITING_WORKFLOW_REFERENCE', 'WAITING_BUDGET_REFERENCE',
  'WAITING_DEPENDENCY_REFERENCE', 'WAITING_CONFLICT_REFERENCE', 'BLOCKED_REFERENCE'
]);

// The single source of truth for status -> decision -> next_state. Every WAITING_* status
// maps to its matching REQUEST_*/WAITING_*_REFERENCE pair one-to-one; every other status
// (DENY, VALIDATION_FAILED, and every *_BLOCKED) collapses to BLOCKED / BLOCKED_REFERENCE.
const STATUS_OUTCOME_MAP = Object.freeze({
  READY_SIMULATION: { decision: 'AUTHORIZE_PLAN_SIMULATION', next_state: 'PLAN_READY_REFERENCE' },
  WAITING_APPROVAL_SIMULATION: { decision: 'REQUEST_HUMAN_APPROVAL', next_state: 'WAITING_APPROVAL_REFERENCE' },
  WAITING_MEMORY_REFERENCE: { decision: 'REQUEST_MEMORY_RESELECTION', next_state: 'WAITING_MEMORY_REFERENCE' },
  WAITING_CONTEXT_REFERENCE: { decision: 'REQUEST_CONTEXT_REASSEMBLY', next_state: 'WAITING_CONTEXT_REFERENCE' },
  WAITING_MODEL_REFERENCE: { decision: 'REQUEST_MODEL_RESELECTION', next_state: 'WAITING_MODEL_REFERENCE' },
  WAITING_TOOL_REFERENCE: { decision: 'REQUEST_TOOL_REVIEW', next_state: 'WAITING_TOOL_REFERENCE' },
  WAITING_WORKFLOW_REFERENCE: { decision: 'REQUEST_WORKFLOW_REVIEW', next_state: 'WAITING_WORKFLOW_REFERENCE' },
  WAITING_BUDGET_REFERENCE: { decision: 'REQUEST_BUDGET_REVIEW', next_state: 'WAITING_BUDGET_REFERENCE' },
  WAITING_DEPENDENCY_REFERENCE: { decision: 'REQUEST_DEPENDENCY_REVIEW', next_state: 'WAITING_DEPENDENCY_REFERENCE' },
  WAITING_CONFLICT_RESOLUTION: { decision: 'REQUEST_CONFLICT_RESOLUTION', next_state: 'WAITING_CONFLICT_REFERENCE' }
});
const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

function outcomeForStatus(status) {
  return STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;
}

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'planning_validated', 'bindings_validated', 'policy_validated', 'memory_validated',
  'preferences_preserved', 'project_state_preserved', 'continuity_preserved', 'context_validated',
  'model_selection_validated', 'tools_validated', 'workflow_validated', 'budget_validated',
  'dependencies_validated', 'approvals_validated'
]);

const COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);
const LIST_FIELDS = Object.freeze(['blocker_ids', 'warning_ids', 'approval_reference_ids', 'resolution_reference_types', 'tool_fingerprints']);

const ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS = Object.freeze({
  decision_evaluated: true,
  execution_authorized: false,
  execution_started: false,
  agent_executed: false,
  tool_called: false,
  workflow_executed: false,
  provider_called: false,
  model_called: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
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
const MAX_COUNT = 1000;
const MAX_SCORE = 100;

function isOrderedUniqueStringList(list, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(list) || list.length > maxItems) return false;
  if (!list.every(isNonEmptyString)) return false;
  if (new Set(list).size !== list.length) return false;
  const sorted = [...list].sort();
  return list.every((item, index) => item === sorted[index]);
}

function validateOrchestratorDecisionResult(result) {
  const errors = [];
  if (!isPlainObject(result)) return { valid: false, errors: ['decision_result_must_be_object'] };
  exactFields(result, ORCHESTRATOR_DECISION_RESULT_FIELDS, 'decision_result', errors);
  for (const field of [
    'result_id', 'decision_request_id', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'readiness_id', 'request_fingerprint',
    'planning_result_fingerprint', 'plan_fingerprint', 'policy_fingerprint', 'memory_fingerprint',
    'context_fingerprint', 'model_selection_fingerprint', 'workflow_fingerprint', 'decision_fingerprint',
    'registry_version', 'validator_version'
  ]) {
    if (!isNonEmptyString(result[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(result.status)) errors.push(`status_not_allowed::${result.status}`);
  if (!RESULT_DECISIONS.includes(result.decision)) errors.push(`decision_not_allowed::${result.decision}`);
  if (!NEXT_STATES.includes(result.next_state)) errors.push(`next_state_not_allowed::${result.next_state}`);
  for (const field of LIST_FIELDS) {
    if (!isOrderedUniqueStringList(result[field])) errors.push(`${field}_invalid`);
  }
  for (const field of COUNT_FIELDS) {
    if (!Number.isInteger(result[field]) || result[field] < 0 || result[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(result.readiness_score) || result.readiness_score < 0 || result.readiness_score > MAX_SCORE) {
    errors.push('readiness_score_invalid');
  }
  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof result[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof result.ready_in_simulation !== 'boolean') errors.push('ready_in_simulation_must_be_boolean');
  if (typeof result.approval_required !== 'boolean') errors.push('approval_required_must_be_boolean');
  for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS)) {
    if (result[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }

  const expectedOutcome = outcomeForStatus(result.status);
  if (result.decision !== expectedOutcome.decision) errors.push(`decision_inconsistent_with_status::expected_${expectedOutcome.decision}`);
  if (result.next_state !== expectedOutcome.next_state) errors.push(`next_state_inconsistent_with_status::expected_${expectedOutcome.next_state}`);

  if (result.status === 'READY_SIMULATION') {
    if (result.ready_in_simulation !== true) errors.push('ready_in_simulation_must_be_true_when_ready');
    if (result.approval_required !== false) errors.push('approval_required_must_be_false_when_ready');
    if (!VALIDATION_FLAG_FIELDS.every((field) => result[field] === true)) errors.push('every_validation_flag_must_be_true_when_ready');
    if (result.blocking_count !== 0 || result.critical_count !== 0) errors.push('blocking_and_critical_counts_must_be_0_when_ready');
  } else {
    if (result.ready_in_simulation !== false) errors.push('ready_in_simulation_must_be_false_unless_ready');
  }
  if (result.status === 'WAITING_APPROVAL_SIMULATION') {
    if (result.approval_required !== true) errors.push('approval_required_must_be_true_when_waiting_for_approval');
  } else if (result.status !== 'READY_SIMULATION' && result.approval_required !== false) {
    errors.push('approval_required_must_be_false_unless_waiting_for_approval');
  }

  if (result.validator_version !== ORCHESTRATOR_DECISION_RESULT_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(result);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(result));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildOrchestratorDecisionResult(overrides = {}) {
  const status = RESULT_STATUSES.includes(overrides.status) ? overrides.status : 'VALIDATION_FAILED';
  const outcome = outcomeForStatus(status);
  const isReady = status === 'READY_SIMULATION';
  const isWaitingApproval = status === 'WAITING_APPROVAL_SIMULATION';

  const validationFlags = {};
  for (const field of VALIDATION_FLAG_FIELDS) {
    validationFlags[field] = isReady ? true : overrides[field] === true;
  }

  const result = {
    result_id: overrides.result_id || 'orchestrator_decision_result_not_available',
    decision_request_id: overrides.decision_request_id || 'decision_request_not_available',
    planning_result_id: overrides.planning_result_id || 'planning_result_not_available',
    plan_id: overrides.plan_id || 'plan_not_available',
    agent_id: overrides.agent_id || 'agent_not_available',
    tenant_id: overrides.tenant_id || 'tenant_not_available',
    organization_id: overrides.organization_id || 'organization_not_available',
    project_id: overrides.project_id || 'project_not_available',
    session_reference_id: overrides.session_reference_id || 'session_not_available',
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    readiness_id: overrides.readiness_id || 'readiness_not_available',
    blocker_ids: Array.isArray(overrides.blocker_ids) ? uniqueSorted(overrides.blocker_ids) : [],
    warning_ids: Array.isArray(overrides.warning_ids) ? uniqueSorted(overrides.warning_ids) : [],
    approval_reference_ids: Array.isArray(overrides.approval_reference_ids) ? uniqueSorted(overrides.approval_reference_ids) : [],
    resolution_reference_types: Array.isArray(overrides.resolution_reference_types) ? uniqueSorted(overrides.resolution_reference_types) : [],
    request_fingerprint: overrides.request_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    planning_result_fingerprint: overrides.planning_result_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    plan_fingerprint: overrides.plan_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    policy_fingerprint: overrides.policy_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    memory_fingerprint: overrides.memory_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    context_fingerprint: overrides.context_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    model_selection_fingerprint: overrides.model_selection_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    tool_fingerprints: Array.isArray(overrides.tool_fingerprints) ? uniqueSorted(overrides.tool_fingerprints) : [],
    workflow_fingerprint: overrides.workflow_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    decision_fingerprint: overrides.decision_fingerprint || NOT_AVAILABLE_FINGERPRINT,
    registry_version: overrides.registry_version || 'registry_version_not_available',
    blocking_count: Number.isInteger(overrides.blocking_count) ? overrides.blocking_count : 0,
    warning_count: Number.isInteger(overrides.warning_count) ? overrides.warning_count : 0,
    critical_count: Number.isInteger(overrides.critical_count) ? overrides.critical_count : 0,
    readiness_score: Number.isInteger(overrides.readiness_score) ? overrides.readiness_score : 0,
    ...validationFlags,
    ready_in_simulation: isReady,
    approval_required: isWaitingApproval,
    validator_version: ORCHESTRATOR_DECISION_RESULT_VALIDATOR_VERSION,
    ...ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS
  };

  const validation = validateOrchestratorDecisionResult(result);
  if (!validation.valid) {
    const fallbackOutcome = outcomeForStatus('VALIDATION_FAILED');
    const fallbackValidationFlags = {};
    for (const field of VALIDATION_FLAG_FIELDS) fallbackValidationFlags[field] = overrides[field] === true;
    return cloneFrozen({
      ...result,
      status: 'VALIDATION_FAILED',
      decision: fallbackOutcome.decision,
      next_state: fallbackOutcome.next_state,
      ...fallbackValidationFlags,
      ready_in_simulation: false,
      approval_required: false,
      blocker_ids: uniqueSorted([...result.blocker_ids, ...validation.errors]),
      ...ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS
    });
  }
  return cloneFrozen(result);
}

module.exports = {
  COUNT_FIELDS,
  DEFAULT_OUTCOME,
  LIST_FIELDS,
  MAX_COUNT,
  MAX_LIST_ITEMS,
  MAX_SCORE,
  NEXT_STATES,
  NOT_AVAILABLE_FINGERPRINT,
  NOT_AVAILABLE_REFERENCE,
  ORCHESTRATOR_DECISION_RESULT_FIELDS,
  ORCHESTRATOR_DECISION_RESULT_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_RESULT_VALIDATOR_VERSION,
  RESULT_DECISIONS,
  RESULT_STATUSES,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildOrchestratorDecisionResult,
  outcomeForStatus,
  validateOrchestratorDecisionResult
};

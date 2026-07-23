'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');
const { validateAgentSimulationContext } = require('./agent-context-contract');
const { validateOrchestrationPlanReference, validatePlanningResultReference } = require('./orchestrator-plan-reference');
const { RESULT_DECISIONS, RESULT_STATUSES, NEXT_STATES } = require('./orchestrator-decision-result');
const { BUNDLE_STATUSES, DOMAIN_READY_FIELDS } = require('./orchestrator-readiness-evidence-bundle');
const { validateExecutionAuthorizationPolicy } = require('./execution-authorization-policy');
const { validateExecutionAuthorizationScope } = require('./execution-authorization-scope');
const { validateExecutionAuthorizationActorContext } = require('./execution-authorization-actor-context');
const { validateExecutionAuthorizationApprovalReference } = require('./execution-authorization-approval-reference');
const { validateExecutionAuthorizationBudgetReference } = require('./execution-authorization-budget-reference');
const { validateExecutionAuthorizationExpiration } = require('./execution-authorization-expiration');
const { validateExecutionAuthorizationTaskReference } = require('./execution-authorization-task-reference');

const EXECUTION_AUTHORIZATION_REQUEST_VALIDATOR_VERSION = 'execution_authorization_request_validator_v1';
const ORCHESTRATOR_DECISION_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_orchestrator_decision_reference_validator_v1';
const EVIDENCE_BUNDLE_REFERENCE_VALIDATOR_VERSION = 'execution_authorization_evidence_bundle_reference_validator_v1';

const EXECUTION_AUTHORIZATION_REQUEST_FIELDS = Object.freeze([
  'authorization_request_id', 'authorization_request_version', 'orchestrator_decision_reference',
  'readiness_evidence_bundle_reference', 'planning_result_reference', 'orchestration_plan_reference',
  'task_reference', 'authorization_policy', 'authorization_scope', 'actor_context', 'approval_reference',
  'budget_authorization_reference', 'expiration_evaluation', 'correlation_id', 'causation_id', 'trace_id',
  'logical_sequence', 'expected_registry_version', 'simulation_context', 'validator_version'
]);

// --- OrchestratorDecisionReference: a minimal mirror of PR #95's DecisionResult, exactly like
// every prior PR's own minimal "*Reference" mirrors an upstream full contract. Reuses PR #95's
// own RESULT_STATUSES/RESULT_DECISIONS/NEXT_STATES rather than redefining them.

const ORCHESTRATOR_DECISION_REFERENCE_FIELDS = Object.freeze([
  'decision_result_id', 'decision_request_id', 'decision_fingerprint', 'planning_result_id', 'plan_id', 'agent_id',
  'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'status', 'decision', 'next_state',
  'readiness_score', 'ready_in_simulation', 'approval_required', 'execution_authorized', 'execution_started',
  'executed', 'simulation', 'production_blocked', 'validator_version'
]);

const ORCHESTRATOR_DECISION_REFERENCE_SAFE_FLAGS = Object.freeze({
  execution_authorized: false,
  execution_started: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

// The exact set of values PR #96's Decision Engine must have produced for this boundary to ever
// consider AUTHORIZED_SIMULATION -- see "Orchestrator Decision Reference" / "Valores
// obrigatórios para autorização simulada" in the spec.
const ORCHESTRATOR_DECISION_READY_VALUES = Object.freeze({
  status: 'READY_SIMULATION',
  decision: 'AUTHORIZE_PLAN_SIMULATION',
  next_state: 'PLAN_READY_REFERENCE',
  ready_in_simulation: true,
  approval_required: false
});

function validateOrchestratorDecisionReference(reference) {
  const errors = [];
  if (!isPlainObject(reference)) return { valid: false, errors: ['orchestrator_decision_reference_must_be_object'] };
  exactFields(reference, ORCHESTRATOR_DECISION_REFERENCE_FIELDS, 'orchestrator_decision_reference', errors);
  for (const field of [
    'decision_result_id', 'decision_request_id', 'decision_fingerprint', 'planning_result_id', 'plan_id',
    'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'validator_version'
  ]) {
    if (!isNonEmptyString(reference[field])) errors.push(`${field}_invalid`);
  }
  if (!RESULT_STATUSES.includes(reference.status)) errors.push(`status_not_allowed::${reference.status}`);
  if (!RESULT_DECISIONS.includes(reference.decision)) errors.push(`decision_not_allowed::${reference.decision}`);
  if (!NEXT_STATES.includes(reference.next_state)) errors.push(`next_state_not_allowed::${reference.next_state}`);
  if (!Number.isInteger(reference.readiness_score) || reference.readiness_score < 0 || reference.readiness_score > 100) errors.push('readiness_score_invalid');
  for (const field of ['ready_in_simulation', 'approval_required']) {
    if (typeof reference[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const [field, expected] of Object.entries(ORCHESTRATOR_DECISION_REFERENCE_SAFE_FLAGS)) {
    if (reference[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (reference.validator_version !== ORCHESTRATOR_DECISION_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(reference);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(reference));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isOrchestratorDecisionReady(reference) {
  return isPlainObject(reference) && Object.entries(ORCHESTRATOR_DECISION_READY_VALUES).every(([field, expected]) => reference[field] === expected);
}

function buildOrchestratorDecisionReference(input = {}) {
  const reference = {
    decision_result_id: input.decision_result_id,
    decision_request_id: input.decision_request_id,
    decision_fingerprint: input.decision_fingerprint,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    status: input.status,
    decision: input.decision,
    next_state: input.next_state,
    readiness_score: Number.isInteger(input.readiness_score) ? input.readiness_score : 0,
    ready_in_simulation: input.ready_in_simulation === true,
    approval_required: input.approval_required === true,
    execution_authorized: false,
    execution_started: false,
    executed: false,
    simulation: true,
    production_blocked: true,
    validator_version: ORCHESTRATOR_DECISION_REFERENCE_VALIDATOR_VERSION
  };

  const validation = validateOrchestratorDecisionReference(reference);
  if (!validation.valid) {
    throw new Error(`orchestrator_decision_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(reference);
}

// --- EvidenceBundleReference: a minimal mirror of PR #96's ReadinessEvidenceBundle (drops the
// 4 embedded full evidence sub-objects, per-evidence fingerprints, and readiness_score -- only
// bundle_fingerprint and the consolidated flags this boundary actually needs). Reuses PR #96's
// own BUNDLE_STATUSES/DOMAIN_READY_FIELDS rather than redefining them.

const EVIDENCE_BUNDLE_REFERENCE_FIELDS = Object.freeze([
  'readiness_bundle_id', 'readiness_bundle_version', 'bundle_fingerprint', 'planning_result_id', 'plan_id',
  'agent_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id', 'bundle_status',
  'all_required_evidence_present', 'bindings_consistent', 'versions_consistent', 'fingerprints_consistent',
  ...DOMAIN_READY_FIELDS, 'overall_ready_in_simulation', 'blocking_count', 'warning_count', 'critical_count',
  'evidence_evaluated', 'execution_authorized', 'execution_started', 'simulation', 'production_blocked',
  'validator_version'
]);

const EVIDENCE_BUNDLE_REFERENCE_CONSISTENCY_FIELDS = Object.freeze(['all_required_evidence_present', 'bindings_consistent', 'versions_consistent', 'fingerprints_consistent']);
const EVIDENCE_BUNDLE_REFERENCE_COUNT_FIELDS = Object.freeze(['blocking_count', 'warning_count', 'critical_count']);

const EVIDENCE_BUNDLE_REFERENCE_SAFE_FLAGS = Object.freeze({
  evidence_evaluated: true,
  execution_authorized: false,
  execution_started: false,
  simulation: true,
  production_blocked: true
});

const EVIDENCE_BUNDLE_READY_VALUES = Object.freeze({
  bundle_status: 'READY_EVIDENCE_SIMULATION',
  all_required_evidence_present: true,
  bindings_consistent: true,
  versions_consistent: true,
  fingerprints_consistent: true,
  overall_ready_in_simulation: true,
  blocking_count: 0,
  critical_count: 0
});

const MAX_COUNT = 1000;

function validateEvidenceBundleReference(bundle) {
  const errors = [];
  if (!isPlainObject(bundle)) return { valid: false, errors: ['evidence_bundle_reference_must_be_object'] };
  exactFields(bundle, EVIDENCE_BUNDLE_REFERENCE_FIELDS, 'evidence_bundle_reference', errors);
  for (const field of [
    'readiness_bundle_id', 'bundle_fingerprint', 'planning_result_id', 'plan_id', 'agent_id', 'tenant_id',
    'organization_id', 'project_id', 'session_reference_id', 'bundle_status', 'validator_version'
  ]) {
    if (!isNonEmptyString(bundle[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(bundle.readiness_bundle_version) || bundle.readiness_bundle_version < 1) errors.push('readiness_bundle_version_invalid');
  if (!BUNDLE_STATUSES.includes(bundle.bundle_status)) errors.push(`bundle_status_not_allowed::${bundle.bundle_status}`);
  for (const field of EVIDENCE_BUNDLE_REFERENCE_CONSISTENCY_FIELDS) {
    if (typeof bundle[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  for (const field of DOMAIN_READY_FIELDS) {
    if (typeof bundle[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof bundle.overall_ready_in_simulation !== 'boolean') errors.push('overall_ready_in_simulation_must_be_boolean');
  for (const field of EVIDENCE_BUNDLE_REFERENCE_COUNT_FIELDS) {
    if (!Number.isInteger(bundle[field]) || bundle[field] < 0 || bundle[field] > MAX_COUNT) errors.push(`${field}_invalid`);
  }
  for (const [field, expected] of Object.entries(EVIDENCE_BUNDLE_REFERENCE_SAFE_FLAGS)) {
    if (bundle[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (bundle.validator_version !== EVIDENCE_BUNDLE_REFERENCE_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(bundle);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(bundle));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function isEvidenceBundleReady(bundle) {
  return isPlainObject(bundle) && Object.entries(EVIDENCE_BUNDLE_READY_VALUES).every(([field, expected]) => bundle[field] === expected);
}

function buildEvidenceBundleReference(input = {}) {
  const bundle = {
    readiness_bundle_id: input.readiness_bundle_id,
    readiness_bundle_version: Number.isInteger(input.readiness_bundle_version) ? input.readiness_bundle_version : 1,
    bundle_fingerprint: input.bundle_fingerprint,
    planning_result_id: input.planning_result_id,
    plan_id: input.plan_id,
    agent_id: input.agent_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    bundle_status: input.bundle_status,
    all_required_evidence_present: input.all_required_evidence_present === true,
    bindings_consistent: input.bindings_consistent === true,
    versions_consistent: input.versions_consistent === true,
    fingerprints_consistent: input.fingerprints_consistent === true,
    overall_ready_in_simulation: input.overall_ready_in_simulation === true,
    blocking_count: Number.isInteger(input.blocking_count) ? input.blocking_count : 0,
    warning_count: Number.isInteger(input.warning_count) ? input.warning_count : 0,
    critical_count: Number.isInteger(input.critical_count) ? input.critical_count : 0,
    evidence_evaluated: true,
    execution_authorized: false,
    execution_started: false,
    simulation: true,
    production_blocked: true,
    validator_version: EVIDENCE_BUNDLE_REFERENCE_VALIDATOR_VERSION
  };
  for (const field of DOMAIN_READY_FIELDS) bundle[field] = input[field] === true;

  const validation = validateEvidenceBundleReference(bundle);
  if (!validation.valid) {
    throw new Error(`evidence_bundle_reference_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(bundle);
}

// --- ExecutionAuthorizationRequest

function validateExecutionAuthorizationRequest(request) {
  const errors = [];
  if (!isPlainObject(request)) return { valid: false, errors: ['execution_authorization_request_must_be_object'] };
  exactFields(request, EXECUTION_AUTHORIZATION_REQUEST_FIELDS, 'execution_authorization_request', errors);
  for (const field of ['authorization_request_id', 'correlation_id', 'causation_id', 'trace_id', 'expected_registry_version', 'validator_version']) {
    if (!isNonEmptyString(request[field])) errors.push(`${field}_invalid`);
  }
  if (!Number.isInteger(request.authorization_request_version) || request.authorization_request_version < 1) errors.push('authorization_request_version_invalid');
  if (!Number.isInteger(request.logical_sequence) || request.logical_sequence < 0) errors.push('logical_sequence_invalid');

  errors.push(...validateOrchestratorDecisionReference(request.orchestrator_decision_reference).errors.map((e) => `orchestrator_decision_reference_${e}`));
  errors.push(...validateEvidenceBundleReference(request.readiness_evidence_bundle_reference).errors.map((e) => `readiness_evidence_bundle_reference_${e}`));
  errors.push(...validatePlanningResultReference(request.planning_result_reference).errors.map((e) => `planning_result_reference_${e}`));
  errors.push(...validateOrchestrationPlanReference(request.orchestration_plan_reference).errors.map((e) => `orchestration_plan_reference_${e}`));
  errors.push(...validateExecutionAuthorizationTaskReference(request.task_reference).errors.map((e) => `task_reference_${e}`));
  errors.push(...validateExecutionAuthorizationPolicy(request.authorization_policy).errors.map((e) => `authorization_policy_${e}`));
  errors.push(...validateExecutionAuthorizationScope(request.authorization_scope).errors.map((e) => `authorization_scope_${e}`));
  errors.push(...validateExecutionAuthorizationActorContext(request.actor_context).errors.map((e) => `actor_context_${e}`));
  errors.push(...validateExecutionAuthorizationApprovalReference(request.approval_reference).errors.map((e) => `approval_reference_${e}`));
  errors.push(...validateExecutionAuthorizationBudgetReference(request.budget_authorization_reference).errors.map((e) => `budget_authorization_reference_${e}`));
  errors.push(...validateExecutionAuthorizationExpiration(request.expiration_evaluation).errors.map((e) => `expiration_evaluation_${e}`));
  errors.push(...validateAgentSimulationContext(request.simulation_context).errors.map((e) => `simulation_context_${e}`));

  if (request.validator_version !== EXECUTION_AUTHORIZATION_REQUEST_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(request);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(request));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

module.exports = {
  EVIDENCE_BUNDLE_READY_VALUES,
  EVIDENCE_BUNDLE_REFERENCE_CONSISTENCY_FIELDS,
  EVIDENCE_BUNDLE_REFERENCE_COUNT_FIELDS,
  EVIDENCE_BUNDLE_REFERENCE_FIELDS,
  EVIDENCE_BUNDLE_REFERENCE_SAFE_FLAGS,
  EVIDENCE_BUNDLE_REFERENCE_VALIDATOR_VERSION,
  EXECUTION_AUTHORIZATION_REQUEST_FIELDS,
  EXECUTION_AUTHORIZATION_REQUEST_VALIDATOR_VERSION,
  ORCHESTRATOR_DECISION_READY_VALUES,
  ORCHESTRATOR_DECISION_REFERENCE_FIELDS,
  ORCHESTRATOR_DECISION_REFERENCE_SAFE_FLAGS,
  ORCHESTRATOR_DECISION_REFERENCE_VALIDATOR_VERSION,
  buildEvidenceBundleReference,
  buildOrchestratorDecisionReference,
  isEvidenceBundleReady,
  isOrchestratorDecisionReady,
  validateEvidenceBundleReference,
  validateExecutionAuthorizationRequest,
  validateOrchestratorDecisionReference
};

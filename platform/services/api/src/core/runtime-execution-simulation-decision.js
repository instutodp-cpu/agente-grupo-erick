'use strict';

const { isNonEmptyString, isPlainObject, uniqueSorted } = require('./read-only-adapter-contract');
const { cloneFrozen, exactFields, findAgentCoreOperationalMaterial, stablePayload } = require('./agent-identity-contract');

const RUNTIME_EXECUTION_SIMULATION_DECISION_VALIDATOR_VERSION = 'runtime_execution_simulation_decision_validator_v1';

// The 18 statuses this PR introduces (spec's own "Runtime Status" list, declaration order).
// TENANT_BLOCKED/ORGANIZATION_BLOCKED/PROJECT_BLOCKED/SESSION_BLOCKED/AGENT_BLOCKED/ACTOR_BLOCKED
// are the exact same literal strings execution-gateway-decision.js's own GATEWAY_STATUSES already
// use -- reused verbatim ("não criar enums paralelos incompatíveis"), not redeclared as
// runtime-prefixed variants, since they mean the exact same identity-boundary concept here too.
const RUNTIME_STATUSES = Object.freeze([
  'RUNTIME_PACKAGE_PREPARED_SIMULATION', 'RUNTIME_POLICY_BLOCKED', 'RUNTIME_GATEWAY_BLOCKED',
  'RUNTIME_PACKAGE_REFERENCE_BLOCKED', 'RUNTIME_STAGE_MANIFEST_BLOCKED', 'RUNTIME_DEPENDENCY_BLOCKED',
  'RUNTIME_BINDING_BLOCKED', 'RUNTIME_VALIDATION_BLOCKED', 'RUNTIME_BUDGET_BLOCKED', 'RUNTIME_STOP_BLOCKED',
  'RUNTIME_COMPENSATION_BLOCKED', 'RUNTIME_ARTIFACT_PLAN_BLOCKED', 'RUNTIME_EVENT_PLAN_BLOCKED',
  'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_VERSION_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED',
  'RUNTIME_VALIDATION_FAILED'
]);

const RUNTIME_EXECUTION_SIMULATION_STATUSES = Object.freeze([
  ...RUNTIME_STATUSES, 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED'
]);

// The real order runtime-execution-package.js evaluates gates in -- "Nenhum score pode alterar a
// precedência." Mirrors execution-gateway-decision.js's own GATEWAY_PRECEDENCE_ORDER /
// validation-taxonomy.js's own PRECEDENCE_ORDER split between declaration and evaluation order.
const RUNTIME_PRECEDENCE_ORDER = Object.freeze([
  'RUNTIME_VALIDATION_FAILED', 'TENANT_BLOCKED', 'ORGANIZATION_BLOCKED', 'PROJECT_BLOCKED', 'SESSION_BLOCKED',
  'AGENT_BLOCKED', 'ACTOR_BLOCKED', 'RUNTIME_POLICY_BLOCKED', 'RUNTIME_GATEWAY_BLOCKED',
  'RUNTIME_PACKAGE_REFERENCE_BLOCKED', 'RUNTIME_STAGE_MANIFEST_BLOCKED', 'RUNTIME_DEPENDENCY_BLOCKED',
  'RUNTIME_BINDING_BLOCKED', 'RUNTIME_VALIDATION_BLOCKED', 'RUNTIME_BUDGET_BLOCKED', 'RUNTIME_STOP_BLOCKED',
  'RUNTIME_COMPENSATION_BLOCKED', 'RUNTIME_ARTIFACT_PLAN_BLOCKED', 'RUNTIME_EVENT_PLAN_BLOCKED',
  'RUNTIME_FINGERPRINT_BLOCKED', 'RUNTIME_DIGEST_BLOCKED', 'RUNTIME_VERSION_BLOCKED', 'RUNTIME_CONFLICT_BLOCKED',
  'RUNTIME_PACKAGE_PREPARED_SIMULATION'
]);

const RUNTIME_DECISIONS = Object.freeze([
  'PREPARE_RUNTIME_PACKAGE_SIMULATION', 'REQUEST_GATEWAY_REBUILD', 'REQUEST_PLAN_REBUILD',
  'REQUEST_STAGE_MANIFEST_REBUILD', 'REQUEST_DEPENDENCY_REBUILD', 'REQUEST_BINDING_REBUILD',
  'REQUEST_VALIDATION_REBUILD', 'REQUEST_BUDGET_REBUILD', 'REQUEST_STOP_REBUILD', 'REQUEST_COMPENSATION_REBUILD',
  'REQUEST_ARTIFACT_PLAN_REBUILD', 'REQUEST_EVENT_PLAN_REBUILD', 'BLOCKED'
]);

const RUNTIME_NEXT_STATES = Object.freeze([
  'RUNTIME_PACKAGE_PREPARED_REFERENCE_SIMULATION', 'WAITING_GATEWAY_REBUILD_REFERENCE',
  'WAITING_PLAN_REBUILD_REFERENCE', 'WAITING_STAGE_MANIFEST_REBUILD_REFERENCE', 'WAITING_DEPENDENCY_REBUILD_REFERENCE',
  'WAITING_BINDING_REBUILD_REFERENCE', 'WAITING_VALIDATION_REBUILD_REFERENCE', 'WAITING_BUDGET_REBUILD_REFERENCE',
  'WAITING_STOP_REBUILD_REFERENCE', 'WAITING_COMPENSATION_REBUILD_REFERENCE', 'WAITING_ARTIFACT_PLAN_REBUILD_REFERENCE',
  'WAITING_EVENT_PLAN_REBUILD_REFERENCE', 'BLOCKED_REFERENCE'
]);

const DEFAULT_OUTCOME = Object.freeze({ decision: 'BLOCKED', next_state: 'BLOCKED_REFERENCE' });

// Statuses with no dedicated REQUEST_*_REBUILD decision name (RUNTIME_POLICY_BLOCKED,
// RUNTIME_FINGERPRINT_BLOCKED, RUNTIME_DIGEST_BLOCKED, RUNTIME_VERSION_BLOCKED,
// RUNTIME_CONFLICT_BLOCKED, RUNTIME_VALIDATION_FAILED, and the 6 reused identity-block statuses)
// fall to DEFAULT_OUTCOME -- the same choice execution-gateway-decision.js already made for its
// own POLICY_BLOCKED/TENANT_BLOCKED/etc. RUNTIME_PACKAGE_REFERENCE_BLOCKED also covers execution
// plan / execution plan result cross-check failures (this PR's Runtime Status vocabulary has no
// separate dedicated status for those two Gateway-inherited checks -- see docs "Limitações").
const STATUS_OUTCOME_MAP = Object.freeze({
  RUNTIME_PACKAGE_PREPARED_SIMULATION: { decision: 'PREPARE_RUNTIME_PACKAGE_SIMULATION', next_state: 'RUNTIME_PACKAGE_PREPARED_REFERENCE_SIMULATION' },
  RUNTIME_GATEWAY_BLOCKED: { decision: 'REQUEST_GATEWAY_REBUILD', next_state: 'WAITING_GATEWAY_REBUILD_REFERENCE' },
  RUNTIME_PACKAGE_REFERENCE_BLOCKED: { decision: 'REQUEST_PLAN_REBUILD', next_state: 'WAITING_PLAN_REBUILD_REFERENCE' },
  RUNTIME_STAGE_MANIFEST_BLOCKED: { decision: 'REQUEST_STAGE_MANIFEST_REBUILD', next_state: 'WAITING_STAGE_MANIFEST_REBUILD_REFERENCE' },
  RUNTIME_DEPENDENCY_BLOCKED: { decision: 'REQUEST_DEPENDENCY_REBUILD', next_state: 'WAITING_DEPENDENCY_REBUILD_REFERENCE' },
  RUNTIME_BINDING_BLOCKED: { decision: 'REQUEST_BINDING_REBUILD', next_state: 'WAITING_BINDING_REBUILD_REFERENCE' },
  RUNTIME_VALIDATION_BLOCKED: { decision: 'REQUEST_VALIDATION_REBUILD', next_state: 'WAITING_VALIDATION_REBUILD_REFERENCE' },
  RUNTIME_BUDGET_BLOCKED: { decision: 'REQUEST_BUDGET_REBUILD', next_state: 'WAITING_BUDGET_REBUILD_REFERENCE' },
  RUNTIME_STOP_BLOCKED: { decision: 'REQUEST_STOP_REBUILD', next_state: 'WAITING_STOP_REBUILD_REFERENCE' },
  RUNTIME_COMPENSATION_BLOCKED: { decision: 'REQUEST_COMPENSATION_REBUILD', next_state: 'WAITING_COMPENSATION_REBUILD_REFERENCE' },
  RUNTIME_ARTIFACT_PLAN_BLOCKED: { decision: 'REQUEST_ARTIFACT_PLAN_REBUILD', next_state: 'WAITING_ARTIFACT_PLAN_REBUILD_REFERENCE' },
  RUNTIME_EVENT_PLAN_BLOCKED: { decision: 'REQUEST_EVENT_PLAN_REBUILD', next_state: 'WAITING_EVENT_PLAN_REBUILD_REFERENCE' }
});

const RUNTIME_EXECUTION_SIMULATION_DECISION_FIELDS = Object.freeze([
  'runtime_decision_id', 'runtime_request_id', 'runtime_execution_package_id', 'gateway_decision_id',
  'gateway_result_id', 'execution_plan_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
  'agent_id', 'actor_id', 'status', 'decision', 'next_state', 'runtime_request_fingerprint',
  'runtime_package_fingerprint', 'runtime_package_digest', 'gateway_decision_fingerprint',
  'gateway_result_fingerprint', 'execution_plan_fingerprint', 'runtime_stage_manifest_fingerprint',
  'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint', 'runtime_artifact_plan_fingerprint',
  'runtime_event_plan_fingerprint', 'blockers', 'reason_codes', 'request_validated', 'policy_validated',
  'gateway_validated', 'execution_plan_validated', 'stage_manifest_validated', 'dependency_manifest_validated',
  'binding_ledger_validated', 'validation_ledger_validated', 'budget_validated', 'stops_validated',
  'compensations_validated', 'artifact_plan_validated', 'event_plan_validated', 'package_fingerprint_validated',
  'package_digest_validated', 'non_execution_invariants_validated', 'runtime_evaluated',
  'runtime_package_prepared_in_simulation', 'runtime_admitted_in_simulation', 'runtime_enabled',
  'execution_authorized', 'execution_started', 'stage_started', 'stage_completed', 'agent_executed', 'model_called',
  'provider_called', 'tool_called', 'workflow_executed', 'network_used', 'memory_read', 'memory_written',
  'tokens_reserved', 'tokens_consumed', 'cost_reserved', 'cost_consumed', 'job_created', 'queue_used',
  'worker_started', 'scheduler_started', 'dependency_applied', 'stop_condition_evaluated', 'stop_applied',
  'compensation_executed', 'artifact_created', 'event_emitted', 'executed', 'simulation', 'production_blocked',
  'rollout_percentage', 'validator_version'
]);

const VALIDATION_FLAG_FIELDS = Object.freeze([
  'request_validated', 'policy_validated', 'gateway_validated', 'execution_plan_validated',
  'stage_manifest_validated', 'dependency_manifest_validated', 'binding_ledger_validated',
  'validation_ledger_validated', 'budget_validated', 'stops_validated', 'compensations_validated',
  'artifact_plan_validated', 'event_plan_validated', 'package_fingerprint_validated', 'package_digest_validated',
  'non_execution_invariants_validated'
]);

// "Mesmo quando o pacote de runtime for preparado" -- every one of these 29 operational flags is
// forced false for every status this contract can ever represent, RUNTIME_PACKAGE_PREPARED_
// SIMULATION included. runtime_package_prepared_in_simulation is the ONE flag that legitimately
// varies by status (true only for RUNTIME_PACKAGE_PREPARED_SIMULATION) -- handled separately, not
// part of this forced-false set.
const OPERATIONAL_SAFE_FLAGS = Object.freeze({
  runtime_admitted_in_simulation: false,
  runtime_enabled: false,
  execution_authorized: false,
  execution_started: false,
  stage_started: false,
  stage_completed: false,
  agent_executed: false,
  model_called: false,
  provider_called: false,
  tool_called: false,
  workflow_executed: false,
  network_used: false,
  memory_read: false,
  memory_written: false,
  tokens_reserved: false,
  tokens_consumed: false,
  cost_reserved: false,
  cost_consumed: false,
  job_created: false,
  queue_used: false,
  worker_started: false,
  scheduler_started: false,
  dependency_applied: false,
  stop_condition_evaluated: false,
  stop_applied: false,
  compensation_executed: false,
  artifact_created: false,
  event_emitted: false,
  executed: false,
  simulation: true,
  production_blocked: true
});

const MAX_BLOCKERS = 50;
const MAX_REASON_CODES = 50;

function isSanitizedList(list, maxItems) {
  return Array.isArray(list) && list.length <= maxItems && list.every(isNonEmptyString);
}

function validateRuntimeExecutionSimulationDecision(decision) {
  const errors = [];
  if (!isPlainObject(decision)) return { valid: false, errors: ['runtime_execution_simulation_decision_must_be_object'] };
  exactFields(decision, RUNTIME_EXECUTION_SIMULATION_DECISION_FIELDS, 'runtime_execution_simulation_decision', errors);
  for (const field of [
    'runtime_decision_id', 'runtime_request_id', 'runtime_execution_package_id', 'gateway_decision_id',
    'gateway_result_id', 'execution_plan_id', 'tenant_id', 'organization_id', 'project_id', 'session_reference_id',
    'agent_id', 'actor_id', 'runtime_request_fingerprint', 'runtime_package_fingerprint', 'runtime_package_digest',
    'gateway_decision_fingerprint', 'gateway_result_fingerprint', 'execution_plan_fingerprint',
    'runtime_stage_manifest_fingerprint', 'runtime_dependency_manifest_fingerprint', 'runtime_budget_fingerprint',
    'runtime_artifact_plan_fingerprint', 'runtime_event_plan_fingerprint', 'validator_version'
  ]) {
    if (!isNonEmptyString(decision[field])) errors.push(`${field}_invalid`);
  }
  if (!RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(decision.status)) errors.push('status_invalid');
  if (!RUNTIME_DECISIONS.includes(decision.decision)) errors.push('decision_invalid');
  if (!RUNTIME_NEXT_STATES.includes(decision.next_state)) errors.push('next_state_invalid');
  const expectedOutcome = STATUS_OUTCOME_MAP[decision.status] || DEFAULT_OUTCOME;
  if (decision.decision !== expectedOutcome.decision) errors.push('decision_does_not_match_status');
  if (decision.next_state !== expectedOutcome.next_state) errors.push('next_state_does_not_match_status');

  if (!isSanitizedList(decision.blockers, MAX_BLOCKERS)) errors.push('blockers_invalid');
  if (!isSanitizedList(decision.reason_codes, MAX_REASON_CODES)) errors.push('reason_codes_invalid');

  for (const field of VALIDATION_FLAG_FIELDS) {
    if (typeof decision[field] !== 'boolean') errors.push(`${field}_must_be_boolean`);
  }
  if (typeof decision.runtime_evaluated !== 'boolean') errors.push('runtime_evaluated_must_be_boolean');
  if (decision.runtime_evaluated !== true) errors.push('runtime_evaluated_must_be_true');
  if (typeof decision.runtime_package_prepared_in_simulation !== 'boolean') errors.push('runtime_package_prepared_in_simulation_must_be_boolean');
  const expectedPrepared = decision.status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION';
  if (decision.runtime_package_prepared_in_simulation !== expectedPrepared) errors.push('runtime_package_prepared_in_simulation_does_not_match_status');

  for (const [field, expected] of Object.entries(OPERATIONAL_SAFE_FLAGS)) {
    if (decision[field] !== expected) errors.push(`${field}_must_be_${String(expected)}`);
  }
  if (decision.rollout_percentage !== 0) errors.push('rollout_percentage_must_be_zero');
  if (decision.validator_version !== RUNTIME_EXECUTION_SIMULATION_DECISION_VALIDATOR_VERSION) errors.push('validator_version_invalid');
  try {
    stablePayload(decision);
  } catch (error) {
    errors.push(`payload_not_serializable::${error.message}`);
  }
  errors.push(...findAgentCoreOperationalMaterial(decision));
  return { valid: errors.length === 0, errors: uniqueSorted(errors) };
}

function buildRuntimeExecutionSimulationDecision(input = {}) {
  const status = RUNTIME_EXECUTION_SIMULATION_STATUSES.includes(input.status) ? input.status : 'RUNTIME_VALIDATION_FAILED';
  const outcome = STATUS_OUTCOME_MAP[status] || DEFAULT_OUTCOME;

  const decision = {
    runtime_decision_id: input.runtime_decision_id,
    runtime_request_id: input.runtime_request_id,
    runtime_execution_package_id: input.runtime_execution_package_id,
    gateway_decision_id: input.gateway_decision_id,
    gateway_result_id: input.gateway_result_id,
    execution_plan_id: input.execution_plan_id,
    tenant_id: input.tenant_id,
    organization_id: input.organization_id,
    project_id: input.project_id,
    session_reference_id: input.session_reference_id,
    agent_id: input.agent_id,
    actor_id: input.actor_id,
    status,
    decision: outcome.decision,
    next_state: outcome.next_state,
    runtime_request_fingerprint: input.runtime_request_fingerprint || 'fingerprint_not_available',
    runtime_package_fingerprint: input.runtime_package_fingerprint || 'fingerprint_not_available',
    runtime_package_digest: input.runtime_package_digest || 'digest_not_available',
    gateway_decision_fingerprint: input.gateway_decision_fingerprint || 'fingerprint_not_available',
    gateway_result_fingerprint: input.gateway_result_fingerprint || 'fingerprint_not_available',
    execution_plan_fingerprint: input.execution_plan_fingerprint || 'fingerprint_not_available',
    runtime_stage_manifest_fingerprint: input.runtime_stage_manifest_fingerprint || 'fingerprint_not_available',
    runtime_dependency_manifest_fingerprint: input.runtime_dependency_manifest_fingerprint || 'fingerprint_not_available',
    runtime_budget_fingerprint: input.runtime_budget_fingerprint || 'fingerprint_not_available',
    runtime_artifact_plan_fingerprint: input.runtime_artifact_plan_fingerprint || 'fingerprint_not_available',
    runtime_event_plan_fingerprint: input.runtime_event_plan_fingerprint || 'fingerprint_not_available',
    blockers: Array.isArray(input.blockers) ? uniqueSorted(input.blockers) : [],
    reason_codes: Array.isArray(input.reason_codes) ? uniqueSorted(input.reason_codes) : [],
    runtime_evaluated: true,
    runtime_package_prepared_in_simulation: status === 'RUNTIME_PACKAGE_PREPARED_SIMULATION',
    rollout_percentage: 0,
    ...OPERATIONAL_SAFE_FLAGS,
    validator_version: RUNTIME_EXECUTION_SIMULATION_DECISION_VALIDATOR_VERSION
  };
  for (const field of VALIDATION_FLAG_FIELDS) {
    decision[field] = input[field] === true;
  }

  const validation = validateRuntimeExecutionSimulationDecision(decision);
  if (!validation.valid) {
    throw new Error(`runtime_execution_simulation_decision_construction_invalid::${JSON.stringify(validation.errors)}`);
  }
  return cloneFrozen(decision);
}

module.exports = {
  DEFAULT_OUTCOME,
  MAX_BLOCKERS,
  MAX_REASON_CODES,
  OPERATIONAL_SAFE_FLAGS,
  RUNTIME_DECISIONS,
  RUNTIME_EXECUTION_SIMULATION_DECISION_FIELDS,
  RUNTIME_EXECUTION_SIMULATION_DECISION_VALIDATOR_VERSION,
  RUNTIME_EXECUTION_SIMULATION_STATUSES,
  RUNTIME_NEXT_STATES,
  RUNTIME_PRECEDENCE_ORDER,
  RUNTIME_STATUSES,
  STATUS_OUTCOME_MAP,
  VALIDATION_FLAG_FIELDS,
  buildRuntimeExecutionSimulationDecision,
  validateRuntimeExecutionSimulationDecision
};
